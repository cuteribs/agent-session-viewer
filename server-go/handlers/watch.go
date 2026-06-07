package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"agent-session-viewer/services"
	"agent-session-viewer/types"
	"agent-session-viewer/ws"
)

// WatchHandler binds /api/watch routes.
func WatchHandler(r chi.Router, hub *ws.Hub) {
	r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
		jsonResponse(w, map[string]bool{"active": services.IsWatcherRunning()})
	})

	r.Post("/", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Active *bool `json:"active"`
		}
		json.NewDecoder(r.Body).Decode(&body)

		shouldBeActive := !services.IsWatcherRunning()
		if body.Active != nil {
			shouldBeActive = *body.Active
		}

		if shouldBeActive && !services.IsWatcherRunning() {
			services.InitFileWatcher(hub)
		} else if !shouldBeActive && services.IsWatcherRunning() {
			services.StopFileWatcher()
		}

		newActive := services.IsWatcherRunning()
		hub.Broadcast(types.WSMessage{
			Type:    "watch_status",
			Payload: types.WSPayload{Active: &newActive},
		})
		jsonResponse(w, map[string]bool{"active": newActive})
	})
}

// IsDBPath re-exports parsers.IsDBPath for use outside the parsers package.
// Placed here to avoid import cycles in the handlers package.
func IsDBPathHandler(r chi.Router) {}
