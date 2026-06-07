package handlers

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"agent-session-viewer/services"
)

// ExportHandler binds /api/export routes.
func ExportHandler(r chi.Router) {
	r.Get("/{source}/{sessionId}", exportSession)
}

func exportSession(w http.ResponseWriter, r *http.Request) {
	src, ok := parseSource(w, chi.URLParam(r, "source"))
	if !ok {
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}

	session := services.GetSession(src, sessionID)
	if session == nil {
		http.Error(w, `{"error":"Not found"}`, http.StatusNotFound)
		return
	}

	filename := fmt.Sprintf("%s-%s", src, sessionID)

	switch format {
	case "json":
		data, err := services.ExportToJSON(session)
		if err != nil {
			http.Error(w, `{"error":"Export failed"}`, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.json"`, filename))
		w.Write([]byte(data))
	case "csv":
		data := services.ExportToCSV(session)
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.csv"`, filename))
		w.Write([]byte(data))
	case "summary":
		data, err := services.ExportSummaryToJSON(session)
		if err != nil {
			http.Error(w, `{"error":"Export failed"}`, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-summary.json"`, filename))
		w.Write([]byte(data))
	default:
		http.Error(w, `{"error":"Bad request","message":"Invalid format. Must be json, csv, or summary"}`, http.StatusBadRequest)
	}
}
