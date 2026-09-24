// Package realtime fans project events out to websocket subscribers (SPEC §5 Realtime).
//
// Services publish an Event after a mutation has committed; the websocket handler
// subscribes per project and forwards events to the client. Publishing never blocks: each
// subscriber has a buffered channel, and a subscriber whose buffer is full is dropped
// (its channel is closed) so the handler can close the connection and let the client
// reconnect and refetch.
package realtime

import (
	"sync"
)

// Event types sent to clients.
const (
	IssueCreated   = "issue.created"
	IssueUpdated   = "issue.updated"
	IssueDeleted   = "issue.deleted"
	IssueMoved     = "issue.moved"
	CommentChanged = "comment.changed"
	SprintChanged  = "sprint.changed"
	ProjectChanged = "project.changed"
)

// Event is the JSON message pushed to websocket clients. Clients treat it as a
// cache-invalidation hint.
type Event struct {
	Type       string  `json:"type"`
	ProjectKey string  `json:"projectKey"`
	IssueKey   *string `json:"issueKey"`
	ActorID    int64   `json:"actorId"`
}

// DefaultBuffer is the per-subscriber channel capacity.
const DefaultBuffer = 64

// Subscription receives the events of one project on C. C is closed when the
// subscription is cancelled, when the subscriber is dropped for being too slow, or when
// the hub is closed.
type Subscription struct {
	C         <-chan Event
	ProjectID int64

	ch chan Event
}

// Hub is a concurrency-safe, per-project publish/subscribe registry.
type Hub struct {
	mu     sync.RWMutex
	subs   map[int64]map[*Subscription]struct{}
	buffer int
	closed bool
}

// NewHub returns a hub whose subscriptions buffer up to `buffer` events
// (DefaultBuffer when buffer <= 0).
func NewHub(buffer int) *Hub {
	if buffer <= 0 {
		buffer = DefaultBuffer
	}
	return &Hub{subs: make(map[int64]map[*Subscription]struct{}), buffer: buffer}
}

// Subscribe registers a new subscriber for projectID. Call Unsubscribe when done.
// Subscribing to a closed hub returns an already-closed subscription.
func (h *Hub) Subscribe(projectID int64) *Subscription {
	ch := make(chan Event, h.buffer)
	s := &Subscription{C: ch, ProjectID: projectID, ch: ch}

	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		close(ch)
		return s
	}
	if h.subs[projectID] == nil {
		h.subs[projectID] = make(map[*Subscription]struct{})
	}
	h.subs[projectID][s] = struct{}{}
	return s
}

// Unsubscribe removes s and closes its channel. It is safe to call more than once and
// after the subscriber has been dropped.
func (h *Hub) Unsubscribe(s *Subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.removeLocked(s)
}

// Publish delivers ev to every subscriber of projectID without blocking. Subscribers whose
// buffer is full are dropped.
func (h *Hub) Publish(projectID int64, ev Event) {
	var slow []*Subscription

	h.mu.RLock()
	for s := range h.subs[projectID] {
		select {
		case s.ch <- ev:
		default:
			slow = append(slow, s)
		}
	}
	h.mu.RUnlock()

	if len(slow) > 0 {
		h.mu.Lock()
		for _, s := range slow {
			h.removeLocked(s)
		}
		h.mu.Unlock()
	}
}

// SubscriberCount returns the number of live subscribers of projectID.
func (h *Hub) SubscriberCount(projectID int64) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subs[projectID])
}

// Close drops every subscriber (closing their channels) and makes later Subscribe calls
// return closed subscriptions. Used on server shutdown.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for _, set := range h.subs {
		for s := range set {
			h.removeLocked(s)
		}
	}
}

// removeLocked unregisters s and closes its channel exactly once. h.mu must be held for
// writing, which also guarantees no Publish is sending on s.ch concurrently.
func (h *Hub) removeLocked(s *Subscription) {
	set, ok := h.subs[s.ProjectID]
	if !ok {
		return
	}
	if _, ok := set[s]; !ok {
		return
	}
	delete(set, s)
	if len(set) == 0 {
		delete(h.subs, s.ProjectID)
	}
	close(s.ch)
}
