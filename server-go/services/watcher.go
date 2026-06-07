package services

import (
	"io/fs"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"agent-session-viewer/config"
	"agent-session-viewer/types"
	"agent-session-viewer/ws"
)

var (
	watcherMu     sync.Mutex
	globalWatcher *fsnotify.Watcher
	debounce      = map[string]*time.Timer{}
	debounceMu    sync.Mutex
	broadcastFn   func(interface{})
)

// IsWatcherRunning returns true when the file watcher is active.
func IsWatcherRunning() bool {
	watcherMu.Lock()
	defer watcherMu.Unlock()
	return globalWatcher != nil
}

// InitFileWatcher starts watching all configured session directories.
func InitFileWatcher(hub *ws.Hub) {
	watcherMu.Lock()
	defer watcherMu.Unlock()
	if globalWatcher != nil {
		return // already running
	}

	broadcastFn = hub.Broadcast

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("fileWatcher: failed to create watcher: %v", err)
		return
	}

	cfg := config.GetServerConfig()

	watchDirs := []string{}
	for _, p := range cfg.Paths.Claude {
		watchDirs = append(watchDirs, p)
	}
	for _, p := range cfg.Paths.Copilot {
		watchDirs = append(watchDirs, p)
	}
	for _, p := range cfg.Paths.Codex {
		watchDirs = append(watchDirs, p)
	}
	for _, p := range cfg.Paths.OpenCode {
		watchDirs = append(watchDirs, p)
	}
	// VSCode dirs can be large; skip adding them wholesale.

	addedDirs := 0
	for _, dir := range watchDirs {
		if err := watchRecursive(watcher, dir); err == nil {
			addedDirs++
		}
	}
	log.Printf("fileWatcher: watching %d directories", addedDirs)

	globalWatcher = watcher

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("fileWatcher goroutine panic: %v", r)
			}
		}()
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				handleWatchEvent(event)
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Printf("fileWatcher error: %v", err)
			}
		}
	}()
}

// StopFileWatcher closes the watcher.
func StopFileWatcher() {
	watcherMu.Lock()
	defer watcherMu.Unlock()
	if globalWatcher == nil {
		return
	}
	globalWatcher.Close()
	globalWatcher = nil
	log.Println("fileWatcher: stopped")
}

func watchRecursive(w *fsnotify.Watcher, root string) error {
	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		return w.Add(path)
	})
}

func handleWatchEvent(event fsnotify.Event) {
	filePath := event.Name
	src := determineSource(filePath)
	if src == "" {
		return
	}
	sessionID := extractSessionID(filePath, src)
	if sessionID == "" {
		return
	}

	key := filePath
	debounceMu.Lock()
	if t, ok := debounce[key]; ok {
		t.Stop()
	}
	cfg := config.GetServerConfig()
	debounce[key] = time.AfterFunc(time.Duration(cfg.WatchDebounceMs)*time.Millisecond, func() {
		debounceMu.Lock()
		delete(debounce, key)
		debounceMu.Unlock()
		processWatchEvent(event.Op, filePath, src, sessionID)
	})
	debounceMu.Unlock()
}

func processWatchEvent(op fsnotify.Op, filePath string, src types.SessionSource, sessionID string) {
	InvalidateSession(src, sessionID)

	var msgType string
	if op&fsnotify.Create != 0 {
		msgType = "session_created"
	} else if op&fsnotify.Remove != 0 || op&fsnotify.Rename != 0 {
		msgType = "session_deleted"
	} else {
		msgType = "session_updated"
	}

	var data *types.SessionSummary
	if msgType != "session_deleted" {
		detail := GetSession(src, sessionID)
		if detail != nil {
			s := detail.SessionSummary
			data = &s
		}
	}

	if broadcastFn != nil {
		broadcastFn(types.WSMessage{
			Type: msgType,
			Payload: types.WSPayload{
				Source:    &src,
				SessionID: &sessionID,
				Data:      data,
			},
		})
	}
}

func determineSource(filePath string) types.SessionSource {
	normalized := filepath.ToSlash(filePath)
	cfg := config.GetServerConfig()
	for _, p := range cfg.Paths.Claude {
		if strings.HasPrefix(normalized, filepath.ToSlash(p)) {
			return types.SourceClaude
		}
	}
	for _, p := range cfg.Paths.Copilot {
		if strings.HasPrefix(normalized, filepath.ToSlash(p)) {
			return types.SourceCopilot
		}
	}
	for _, p := range cfg.Paths.Codex {
		if strings.HasPrefix(normalized, filepath.ToSlash(p)) {
			return types.SourceCodex
		}
	}
	for _, p := range cfg.Paths.OpenCode {
		if strings.HasPrefix(normalized, filepath.ToSlash(p)) {
			return types.SourceOpenCode
		}
	}
	// Pattern fallbacks
	switch {
	case strings.Contains(normalized, ".claude/projects"):
		return types.SourceClaude
	case strings.Contains(normalized, ".copilot/session-state"):
		return types.SourceCopilot
	case strings.Contains(normalized, ".codex/sessions"):
		return types.SourceCodex
	case strings.Contains(normalized, "opencode/storage"):
		return types.SourceOpenCode
	case strings.Contains(normalized, "/chatSessions/") || strings.Contains(normalized, "emptyWindowChatSessions"):
		return types.SourceVSCode
	}
	return ""
}

func extractSessionID(filePath string, source types.SessionSource) string {
	base := filepath.Base(filePath)
	switch source {
	case types.SourceClaude:
		return strings.TrimSuffix(base, ".jsonl")
	case types.SourceCodex:
		return strings.TrimSuffix(base, ".jsonl")
	case types.SourceCopilot:
		return filepath.Base(filepath.Dir(filePath))
	case types.SourceOpenCode:
		return strings.TrimSuffix(base, ".json")
	case types.SourceVSCode:
		return strings.TrimSuffix(strings.TrimSuffix(base, ".json"), ".jsonl")
	}
	return ""
}
