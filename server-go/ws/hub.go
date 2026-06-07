// Package ws provides a WebSocket broadcast hub.
package ws

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

// Client is a single connected WebSocket peer.
type Client struct {
	conn *websocket.Conn
	send chan []byte
}

// Hub maintains the set of active clients and broadcasts messages to all.
type Hub struct {
	mu      sync.RWMutex
	clients map[*Client]struct{}
}

// New creates a ready-to-use Hub.
func New() *Hub {
	return &Hub{clients: make(map[*Client]struct{})}
}

// Register adds a new WebSocket connection to the hub and starts its pump goroutines.
func (h *Hub) Register(conn *websocket.Conn) {
	c := &Client{conn: conn, send: make(chan []byte, 64)}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	log.Println("WebSocket client connected")

	// writePump drains the send channel to the wire.
	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, c)
			h.mu.Unlock()
			conn.Close()
			log.Println("WebSocket client disconnected")
		}()
		for msg := range c.send {
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		}
	}()

	// readPump discards incoming frames but detects disconnection.
	go func() {
		defer close(c.send)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

// Broadcast serialises v as JSON and sends it to every connected client.
func (h *Hub) Broadcast(v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("ws.Broadcast marshal error: %v", err)
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.send <- data:
		default:
			// Slow client — drop the message rather than blocking the broadcast.
		}
	}
}
