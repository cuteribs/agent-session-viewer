package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"agent-session-viewer/config"
	"agent-session-viewer/types"
)

// ConfigHandler binds all /api/config routes.
func ConfigHandler(r chi.Router) {
	r.Get("/", getConfig)
	r.Put("/", putConfig)
	r.Get("/paths", getPaths)
}

func getConfig(w http.ResponseWriter, _ *http.Request) {
	jsonResponse(w, config.GetAppConfig())
}

func putConfig(w http.ResponseWriter, r *http.Request) {
	var update types.AppConfig
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		http.Error(w, `{"error":"Bad request","message":"Invalid JSON body"}`, http.StatusBadRequest)
		return
	}
	updated := config.UpdateAppConfig(update)
	jsonResponse(w, updated)
}

func getPaths(w http.ResponseWriter, _ *http.Request) {
	cfg := config.GetAppConfig()
	jsonResponse(w, cfg.Paths)
}
