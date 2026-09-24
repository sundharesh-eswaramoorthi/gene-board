package realtime

import (
	"sync"
	"testing"
	"time"
)

func recv(t *testing.T, s *Subscription) (Event, bool) {
	t.Helper()
	select {
	case ev, ok := <-s.C:
		return ev, ok
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
		return Event{}, false
	}
}

func TestPublishFanOutPerProject(t *testing.T) {
	h := NewHub(4)
	a1, a2, b := h.Subscribe(1), h.Subscribe(1), h.Subscribe(2)
	defer h.Unsubscribe(a1)
	defer h.Unsubscribe(a2)
	defer h.Unsubscribe(b)

	key := "GB-1"
	h.Publish(1, Event{Type: IssueCreated, ProjectKey: "GB", IssueKey: &key, ActorID: 3})

	for _, s := range []*Subscription{a1, a2} {
		ev, ok := recv(t, s)
		if !ok || ev.Type != IssueCreated || *ev.IssueKey != "GB-1" || ev.ActorID != 3 {
			t.Fatalf("unexpected event %+v ok=%v", ev, ok)
		}
	}
	select {
	case ev := <-b.C:
		t.Fatalf("project 2 subscriber received %+v", ev)
	default:
	}
	if h.SubscriberCount(1) != 2 || h.SubscriberCount(2) != 1 {
		t.Fatal("unexpected subscriber counts")
	}
}

func TestSlowSubscriberDropped(t *testing.T) {
	h := NewHub(2)
	slow := h.Subscribe(1)
	fast := h.Subscribe(1)
	defer h.Unsubscribe(fast)

	done := make(chan struct{})
	go func() { // fast consumer drains everything
		defer close(done)
		for range fast.C {
		}
	}()

	for range 10 { // must never block even though `slow` never reads
		h.Publish(1, Event{Type: IssueUpdated, ProjectKey: "GB"})
		time.Sleep(time.Millisecond)
	}

	// slow got its buffered events and then its channel was closed.
	n := 0
	for range slow.C {
		n++
	}
	if n != 2 {
		t.Fatalf("slow subscriber received %d buffered events, want 2", n)
	}
	if h.SubscriberCount(1) != 1 {
		t.Fatalf("slow subscriber not removed, count=%d", h.SubscriberCount(1))
	}
	h.Unsubscribe(slow) // idempotent after drop
	h.Unsubscribe(fast)
	<-done
}

func TestUnsubscribeIdempotentAndCloses(t *testing.T) {
	h := NewHub(0)
	s := h.Subscribe(5)
	h.Unsubscribe(s)
	h.Unsubscribe(s)
	if _, ok := <-s.C; ok {
		t.Fatal("channel should be closed")
	}
	h.Publish(5, Event{Type: ProjectChanged}) // no subscribers, no panic
	if h.SubscriberCount(5) != 0 {
		t.Fatal("expected no subscribers")
	}
}

func TestCloseDropsEveryone(t *testing.T) {
	h := NewHub(1)
	a, b := h.Subscribe(1), h.Subscribe(2)
	h.Close()
	for _, s := range []*Subscription{a, b} {
		if _, ok := <-s.C; ok {
			t.Fatal("channel should be closed after hub Close")
		}
	}
	late := h.Subscribe(1)
	if _, ok := <-late.C; ok {
		t.Fatal("subscription on closed hub should be closed")
	}
	h.Unsubscribe(late)
	h.Publish(1, Event{Type: ProjectChanged})
}

func TestConcurrentPublishSubscribe(t *testing.T) {
	h := NewHub(8)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			for range 200 {
				s := h.Subscribe(1)
				h.Publish(1, Event{Type: IssueMoved})
				h.Unsubscribe(s)
			}
		})
	}
	for range 4 {
		wg.Go(func() {
			for range 500 {
				h.Publish(1, Event{Type: IssueMoved})
			}
		})
	}
	wg.Wait()
	if h.SubscriberCount(1) != 0 {
		t.Fatal("leaked subscribers")
	}
}
