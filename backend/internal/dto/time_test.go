package dto

import (
	"encoding/json"
	"testing"
	"time"

	"geneboard/internal/httpx"
)

func TestTimestampJSON(t *testing.T) {
	loc := time.FixedZone("IST", 5*3600+1800)
	ts := TS(time.Date(2026, 9, 24, 15, 45, 0, 123456789, loc))
	b, err := json.Marshal(ts)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `"2026-09-24T10:15:00.123Z"` {
		t.Fatalf("got %s", b)
	}
	whole, _ := json.Marshal(TS(time.Date(2026, 9, 24, 10, 15, 0, 0, time.UTC)))
	if string(whole) != `"2026-09-24T10:15:00Z"` {
		t.Fatalf("got %s", whole)
	}
	var back Timestamp
	if err := json.Unmarshal(b, &back); err != nil || !back.Equal(ts.Truncate(time.Millisecond)) {
		t.Fatalf("round trip: %v %v", back, err)
	}
	if TSPtr(nil) != nil {
		t.Fatal("TSPtr(nil)")
	}
}

func TestDateJSON(t *testing.T) {
	var s struct {
		D  Date  `json:"d"`
		P  *Date `json:"p"`
		NP *Date `json:"np"`
	}
	if err := json.Unmarshal([]byte(`{"d":"2026-02-28","p":"2026-12-01","np":null}`), &s); err != nil {
		t.Fatal(err)
	}
	if s.D != (Date{2026, time.February, 28}) || s.P == nil || s.P.String() != "2026-12-01" || s.NP != nil {
		t.Fatalf("got %+v", s)
	}
	out, _ := json.Marshal(s)
	if string(out) != `{"d":"2026-02-28","p":"2026-12-01","np":null}` {
		t.Fatalf("marshal: %s", out)
	}
	for _, bad := range []string{`{"d":"2026-02-30"}`, `{"d":"26-1-1"}`, `{"d":5}`, `{"d":"2026-02-28T00:00:00Z"}`} {
		err := json.Unmarshal([]byte(bad), &s)
		if !httpx.IsCode(err, httpx.CodeBadRequest) {
			t.Errorf("%s: want bad_request, got %v", bad, err)
		}
	}
	d := Date{2026, time.March, 1}
	if d.Time() != time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC) || *(&d).TimePtr() != d.Time() {
		t.Fatal("Time")
	}
	var nilDate *Date
	if nilDate.TimePtr() != nil || DatePtr(nil) != nil {
		t.Fatal("nil conversions")
	}
}
