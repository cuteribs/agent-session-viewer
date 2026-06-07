package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"agent-session-viewer/services"
	"agent-session-viewer/types"
)

// SessionsHandler binds all /api/sessions routes onto a chi.Router.
func SessionsHandler(r chi.Router) {
	r.Get("/", listSessions)
	r.Get("/{source}/{sessionId}", getSession)
	r.Get("/{source}/{sessionId}/messages", getMessages)
	r.Get("/{source}/{sessionId}/stats", getStats)
	r.Get("/{source}/{sessionId}/logfile", downloadLogFile)
	r.Delete("/{source}/{sessionId}", deleteSession)
}

func listSessions(w http.ResponseWriter, r *http.Request) {
	source := r.URL.Query().Get("source")
	sessions := services.ListSessions(source)
	if sessions == nil {
		sessions = []types.SessionSummary{}
	}
	jsonResponse(w, sessions)
}

func getSession(w http.ResponseWriter, r *http.Request) {
	src, ok := parseSource(w, chi.URLParam(r, "source"))
	if !ok {
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	detail := services.GetSession(src, sessionID)
	if detail == nil {
		http.Error(w, `{"error":"Not found"}`, http.StatusNotFound)
		return
	}
	jsonResponse(w, detail)
}

func getMessages(w http.ResponseWriter, r *http.Request) {
	src, ok := parseSource(w, chi.URLParam(r, "source"))
	if !ok {
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 50
	}
	msgs := services.GetSessionMessages(src, sessionID, offset, limit)
	if msgs == nil {
		msgs = []types.Message{}
	}
	jsonResponse(w, msgs)
}

func getStats(w http.ResponseWriter, r *http.Request) {
	src, ok := parseSource(w, chi.URLParam(r, "source"))
	if !ok {
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	stats := services.GetSessionStats(src, sessionID)
	if stats == nil {
		http.Error(w, `{"error":"Not found"}`, http.StatusNotFound)
		return
	}
	jsonResponse(w, stats)
}

func downloadLogFile(w http.ResponseWriter, r *http.Request) {
	src, ok := parseSource(w, chi.URLParam(r, "source"))
	if !ok {
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	files := services.FindSessionFiles(src)
	filePath, exists := files[sessionID]
	if !exists {
		http.Error(w, `{"error":"Not found"}`, http.StatusNotFound)
		return
	}
	if services.IsDBPath(filePath) {
		http.Error(w, `{"error":"No raw file","message":"Session is stored in SQLite. Use Export JSON instead."}`, http.StatusConflict)
		return
	}
	ext := ".log"
	if len(filePath) > 6 {
		ext = filePath[len(filePath)-6:]
		if ext[:1] != "." {
			ext = ".log"
		}
	}
	downloadName := fmt.Sprintf("%s-%s%s", src, sessionID, ext)
	w.Header().Set("Content-Disposition", `attachment; filename="`+downloadName+`"`)
	http.ServeFile(w, r, filePath)
}

func deleteSession(w http.ResponseWriter, r *http.Request) {
	src, ok := parseSource(w, chi.URLParam(r, "source"))
	if !ok {
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	if !services.DeleteSession(src, sessionID) {
		http.Error(w, `{"error":"Failed to delete session"}`, http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]interface{}{"success": true, "message": "Session deleted successfully"})
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

func parseSource(w http.ResponseWriter, raw string) (types.SessionSource, bool) {
	src := types.SessionSource(raw)
	if !src.IsValid() {
		http.Error(w, `{"error":"Bad request","message":"Invalid source"}`, http.StatusBadRequest)
		return "", false
	}
	return src, true
}

func jsonResponse(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
