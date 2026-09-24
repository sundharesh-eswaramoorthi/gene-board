package httpx

import (
	"encoding/json"
)

// Optional is a tri-state JSON field for PATCH bodies (SPEC §3):
//
//   - absent from the body: Set == false (leave unchanged)
//   - explicitly null:      Set == true, Null == true (clear)
//   - a value:              Set == true, Null == false, Value holds it
//
// Declare fields as `json:"name,omitzero"` so that marshalling (e.g. in tests) omits
// absent fields; decoding needs no tag options.
type Optional[T any] struct {
	Set   bool
	Null  bool
	Value T
}

// Some returns an Optional holding v.
func Some[T any](v T) Optional[T] { return Optional[T]{Set: true, Value: v} }

// Null returns an explicitly-null Optional.
func Null[T any]() Optional[T] { return Optional[T]{Set: true, Null: true} }

// UnmarshalJSON implements json.Unmarshaler. It is only invoked when the field is present.
func (o *Optional[T]) UnmarshalJSON(data []byte) error {
	var zero T
	o.Set, o.Null, o.Value = true, false, zero
	if string(data) == "null" {
		o.Null = true
		return nil
	}
	return json.Unmarshal(data, &o.Value)
}

// MarshalJSON implements json.Marshaler (absent and null both encode as null; use the
// `omitzero` tag option to omit absent values).
func (o Optional[T]) MarshalJSON() ([]byte, error) {
	if !o.Set || o.Null {
		return []byte("null"), nil
	}
	return json.Marshal(o.Value)
}

// IsZero reports whether the field was absent (used by the `omitzero` tag option).
func (o Optional[T]) IsZero() bool { return !o.Set }

// HasValue reports whether a non-null value was supplied.
func (o Optional[T]) HasValue() bool { return o.Set && !o.Null }

// Ptr returns a pointer to the value, or nil when absent or null.
func (o Optional[T]) Ptr() *T {
	if !o.HasValue() {
		return nil
	}
	v := o.Value
	return &v
}
