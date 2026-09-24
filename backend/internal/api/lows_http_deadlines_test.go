package api

import (
	"bufio"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

// TestWebsocketPathOnlyExemptsHandshakes: the websocket route is exempt from the request
// deadlines only for genuine upgrade handshakes. Any other request to that path that
// announces a body and withholds it (a POST, or a GET with a body, with or without an
// Upgrade header) is cut off after the read deadline like every other route, instead of
// holding the connection forever. (TestRequestDeadlines covers the real websocket.)
func TestWebsocketPathOnlyExemptsHandshakes(t *testing.T) {
	e := newTestEnv(t)
	e.handler = NewRouter(Deps{
		Service: e.svc, Logger: discardLogger, CORSOrigins: []string{testCORSOrigin},
		RequestReadTimeout: 200 * time.Millisecond, ResponseWriteTimeout: 600 * time.Millisecond,
	})
	addr := strings.TrimPrefix(e.URL(), "http://")
	upgrade := "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"

	for name, head := range map[string]string{
		"POST":                      "POST /api/projects/GB/ws HTTP/1.1\r\nContent-Length: 100\r\n",
		"GET":                       "GET /api/projects/GB/ws HTTP/1.1\r\nContent-Length: 100\r\n",
		"upgrade with a body":       "GET /api/projects/GB/ws?token=x HTTP/1.1\r\nContent-Length: 100\r\n" + upgrade,
		"upgrade with chunked body": "GET /api/projects/GB/ws?token=x HTTP/1.1\r\nTransfer-Encoding: chunked\r\n" + upgrade,
	} {
		t.Run(name, func(t *testing.T) {
			conn, err := net.Dial("tcp", addr)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			start := time.Now()
			fmt.Fprintf(conn, "%sHost: test\r\n\r\n", head)
			_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
			res, err := http.ReadResponse(bufio.NewReader(conn), nil)
			if err != nil {
				t.Fatalf("no response within 5s (the connection was held open): %v", err)
			}
			_ = res.Body.Close()
			if time.Since(start) > 3*time.Second {
				t.Fatalf("%d after %s", res.StatusCode, time.Since(start))
			}
		})
	}
}
