package dto

import (
	"encoding/json"
	"fmt"
	"time"

	"geneboard/internal/httpx"
)

// Timestamp is an instant serialised as an RFC 3339 string in UTC with at most millisecond
// precision, e.g. "2026-09-24T10:15:00Z" or "2026-09-24T10:15:00.123Z".
type Timestamp struct{ time.Time }

// TS wraps t as a Timestamp.
func TS(t time.Time) Timestamp { return Timestamp{t} }

// TSPtr wraps a nullable time; nil stays nil (serialised as null).
func TSPtr(t *time.Time) *Timestamp {
	if t == nil {
		return nil
	}
	return &Timestamp{*t}
}

// MarshalJSON implements json.Marshaler.
func (t Timestamp) MarshalJSON() ([]byte, error) {
	return json.Marshal(t.UTC().Truncate(time.Millisecond).Format(time.RFC3339Nano))
}

// UnmarshalJSON implements json.Unmarshaler (RFC 3339).
func (t *Timestamp) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	parsed, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return httpx.BadRequest("Invalid timestamp %q, expected RFC 3339", s)
	}
	t.Time = parsed
	return nil
}

// Date is a calendar date serialised as "YYYY-MM-DD". It is a comparable value type.
type Date struct {
	Year  int
	Month time.Month
	Day   int
}

// DateLayout is the wire format of Date.
const DateLayout = "2006-01-02"

// NewDate returns the calendar date of t (in t's location).
func NewDate(t time.Time) Date {
	y, m, d := t.Date()
	return Date{Year: y, Month: m, Day: d}
}

// DatePtr converts a nullable DB date; nil stays nil.
func DatePtr(t *time.Time) *Date {
	if t == nil {
		return nil
	}
	d := NewDate(*t)
	return &d
}

// ParseDate parses "YYYY-MM-DD".
func ParseDate(s string) (Date, error) {
	t, err := time.Parse(DateLayout, s)
	if err != nil {
		return Date{}, fmt.Errorf("invalid date %q, expected YYYY-MM-DD", s)
	}
	return NewDate(t), nil
}

// Time returns midnight UTC of the date (the value stored in DATE columns).
func (d Date) Time() time.Time { return time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, time.UTC) }

// TimePtr converts a nullable Date to the *time.Time used by sqlc params.
func (d *Date) TimePtr() *time.Time {
	if d == nil {
		return nil
	}
	t := d.Time()
	return &t
}

// String formats the date as YYYY-MM-DD.
func (d Date) String() string { return fmt.Sprintf("%04d-%02d-%02d", d.Year, int(d.Month), d.Day) }

// MarshalJSON implements json.Marshaler.
func (d Date) MarshalJSON() ([]byte, error) { return json.Marshal(d.String()) }

// UnmarshalJSON implements json.Unmarshaler. Invalid dates yield a 400 bad_request.
func (d *Date) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return httpx.BadRequest("Invalid date, expected a \"YYYY-MM-DD\" string")
	}
	parsed, err := ParseDate(s)
	if err != nil {
		return httpx.BadRequest("Invalid date %q, expected YYYY-MM-DD", s)
	}
	*d = parsed
	return nil
}
