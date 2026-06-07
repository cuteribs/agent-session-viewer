package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/gorilla/websocket"

	"agent-session-viewer/config"
	"agent-session-viewer/handlers"
	"agent-session-viewer/services"
	apitypes "agent-session-viewer/types"
	"agent-session-viewer/ws"
)

// Build-time variables (stamped by goreleaser / go build -ldflags)
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(_ *http.Request) bool { return true },
}

func main() {
	cfg := config.GetServerConfig()
	config.InitAppConfig(cfg)

	hub := ws.New()

	if cfg.WatchEnabled {
		log.Println("File watcher enabled (WATCH_ENABLED=true)")
		services.InitFileWatcher(hub)
	}

	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	// ── API routes ──────────────────────────────────────────
	r.Route("/api/sessions", func(r chi.Router) { handlers.SessionsHandler(r) })
	r.Route("/api/config", func(r chi.Router) { handlers.ConfigHandler(r) })
	r.Route("/api/export", func(r chi.Router) { handlers.ExportHandler(r) })
	r.Route("/api/watch", func(r chi.Router) { handlers.WatchHandler(r, hub) })

	r.Get("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","timestamp":"%s"}`, time.Now().UTC().Format(time.RFC3339))
	})

	r.Get("/api/version", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"name":"agent-session-viewer","version":"%s","commit":"%s","date":"%s"}`,
			version, commit, date)
	})

	// ── WebSocket ───────────────────────────────────────────
	r.Get("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("WS upgrade error: %v", err)
			return
		}
		hub.Register(conn)
	})

	// ── Static files (client dist) ─────────────────────────
	// Look for dist/public relative to the binary's directory first,
	// then fall back to cwd/dist/public (used when run from repo root via run-go.sh).
	exePath, _ := os.Executable()
	publicPath := filepath.Join(filepath.Dir(exePath), "dist", "public")
	if _, err := os.Stat(filepath.Join(publicPath, "index.html")); err != nil {
		cwd, _ := os.Getwd()
		publicPath = filepath.Join(cwd, "server-go", "dist", "public")
	}
	indexHTML := filepath.Join(publicPath, "index.html")
	if _, err := os.Stat(indexHTML); err == nil {
		log.Printf("Serving static files from: %s", publicPath)
		fs := http.FileServer(http.Dir(publicPath))
		r.Handle("/*", http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			// For unknown paths that don't start with /api or /ws, serve index.html
			// to support client-side routing.
			path := filepath.Join(publicPath, req.URL.Path)
			if _, err := os.Stat(path); os.IsNotExist(err) {
				http.ServeFile(w, req, indexHTML)
				return
			}
			fs.ServeHTTP(w, req)
		}))
	} else {
		log.Println("No client dist found — serving API only")
	}

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	server := &http.Server{Addr: addr, Handler: r}

	// ── Graceful shutdown ───────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("Agent Session Viewer %s listening on http://%s", version, addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	<-quit
	log.Println("Shutting down…")
	services.StopFileWatcher()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("server shutdown: %v", err)
	}
	log.Println("Server stopped")
}

// corsMiddleware adds permissive CORS headers for local development.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// expose IsDBPath for use in handlers without import cycles
func init() {
	_ = apitypes.ValidSources // ensure types package is linked
}
