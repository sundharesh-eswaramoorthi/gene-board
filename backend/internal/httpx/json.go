package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
)

// MaxBodyBytes is the maximum accepted request body size.
const MaxBodyBytes = 1 << 20

// StatusClientClosedRequest is recorded when the client went away before the response was
// written (nginx's 499). Nobody receives the response; the code only shows in the access log.
const StatusClientClosedRequest = 499

// HandlerFunc is an http.HandlerFunc that may return an error; see Handle.
type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

// Handle adapts fn to http.HandlerFunc, rendering a returned error with WriteError.
func Handle(fn HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			WriteError(w, r, err)
		}
	}
}

// WriteJSON writes v as a JSON response with the given status. It only returns an error
// when v cannot be encoded (nothing has been written in that case); failures writing to
// the client are ignored because nothing useful can be done about them.
func WriteJSON(w http.ResponseWriter, status int, v any) error {
	body, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("httpx: encode response: %w", err)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(append(body, '\n'))
	return nil
}

// NoContent writes an empty 204 response.
func NoContent(w http.ResponseWriter) error {
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type errorBody struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

type errorEnvelope struct {
	Error errorBody `json:"error"`
}

// WriteError renders err as the standard error envelope. Errors that are not *Error are
// logged (with the request id) and rendered as a generic 500 so internals never leak.
//
// A request whose client has gone away (browser navigation, an aborted fetch) typically fails
// with context.Canceled from the database driver — or with an I/O timeout, when the driver
// interrupted a write to the database by setting a past deadline. That is not a server fault:
// it is recorded as 499 in the access log instead of being logged as an internal error.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	if r.Context().Err() != nil && (errors.Is(err, context.Canceled) || isTimeout(err)) {
		recordError(r.Context(), err)
		w.WriteHeader(StatusClientClosedRequest)
		return
	}
	var e *Error
	if !errors.As(err, &e) {
		recordError(r.Context(), err)
		if e = clientErrorForDB(err); e != nil {
			Logger(r.Context()).WarnContext(r.Context(), "database error answered as a client error", "status", e.Status, "err", err)
		} else {
			Logger(r.Context()).ErrorContext(r.Context(), "internal error", "err", err)
			e = &Error{Status: http.StatusInternalServerError, Code: CodeInternal, Message: "Internal server error"}
		}
	}
	body := errorEnvelope{Error: errorBody{Code: e.Code, Message: e.Message, Fields: e.Fields}}
	if werr := WriteJSON(w, e.Status, body); werr != nil {
		http.Error(w, `{"error":{"code":"internal","message":"Internal server error"}}`, http.StatusInternalServerError)
	}
}

// DecodeJSON decodes a single JSON value from the request body into dst.
// Bodies over MaxBodyBytes, empty bodies, malformed JSON, values of the wrong type and
// trailing data are rejected with 400 bad_request. Unknown fields are ignored.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	return decode(w, r, dst, false)
}

// DecodeOptionalJSON is DecodeJSON but treats an empty body as "{}" (dst is left as is).
func DecodeOptionalJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	return decode(w, r, dst, true)
}

func decode(w http.ResponseWriter, r *http.Request, dst any, allowEmpty bool) error {
	if r.Body == nil || r.Body == http.NoBody {
		if allowEmpty {
			return nil
		}
		return BadRequest("Request body is required")
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) && allowEmpty {
			return nil
		}
		return decodeError(err)
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return decodeError(err)
		}
		return BadRequest("Request body must contain a single JSON value")
	}
	return nil
}

func decodeError(err error) error {
	var (
		apiErr    *Error
		syntaxErr *json.SyntaxError
		typeErr   *json.UnmarshalTypeError
		maxErr    *http.MaxBytesError
	)
	switch {
	case errors.As(err, &apiErr): // e.g. a custom UnmarshalJSON rejecting a date
		return apiErr
	case errors.As(err, &maxErr):
		return BadRequest("Request body is too large (max %d bytes)", MaxBodyBytes)
	case errors.Is(err, io.EOF):
		return BadRequest("Request body is required")
	case errors.As(err, &typeErr):
		if typeErr.Field != "" {
			return BadRequest("Invalid value for field %q", typeErr.Field)
		}
		return BadRequest("Invalid value in request body")
	case errors.As(err, &syntaxErr), errors.Is(err, io.ErrUnexpectedEOF):
		return BadRequest("Malformed JSON in request body")
	default:
		return BadRequest("Malformed JSON in request body")
	}
}

// isTimeout reports whether err is a network timeout.
func isTimeout(err error) bool {
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}
