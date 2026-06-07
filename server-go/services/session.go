package services

import (
	"bufio"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"agent-session-viewer/config"
	"agent-session-viewer/parsers"
	"agent-session-viewer/types"
)

// ──────────────────────────────────────────────────────────
// In-memory cache
// ──────────────────────────────────────────────────────────

var (
	sessionCache   = map[string]*types.SessionDetail{}
	sessionCacheMu sync.RWMutex
)

func cacheKey(source types.SessionSource, sessionID string) string {
	return string(source) + ":" + sessionID
}

// ClearSessionCache removes all cached sessions.
func ClearSessionCache() {
	sessionCacheMu.Lock()
	sessionCache = map[string]*types.SessionDetail{}
	sessionCacheMu.Unlock()
}

// InvalidateSession removes a single session from cache.
func InvalidateSession(source types.SessionSource, sessionID string) {
	sessionCacheMu.Lock()
	delete(sessionCache, cacheKey(source, sessionID))
	sessionCacheMu.Unlock()
}

// ──────────────────────────────────────────────────────────
// File discovery
// ──────────────────────────────────────────────────────────

// FindSessionFiles returns map[sessionID]filePath for the given source.
func FindSessionFiles(source types.SessionSource) map[string]string {
	cfg := config.GetServerConfig()
	var paths []string
	switch source {
	case types.SourceClaude:
		paths = cfg.Paths.Claude
	case types.SourceCopilot:
		paths = cfg.Paths.Copilot
	case types.SourceCodex:
		paths = cfg.Paths.Codex
	case types.SourceOpenCode:
		paths = cfg.Paths.OpenCode
	case types.SourceVSCode:
		paths = cfg.Paths.VSCode
	}

	files := map[string]string{}
	for _, basePath := range paths {
		if _, err := os.Stat(basePath); err != nil {
			continue
		}
		switch source {
		case types.SourceClaude:
			findClaudeFiles(basePath, files)
		case types.SourceCopilot:
			findCopilotFiles(basePath, files)
		case types.SourceCodex:
			findCodexFiles(basePath, files, 0)
		case types.SourceOpenCode:
			findOpenCodeFiles(basePath, files)
		case types.SourceVSCode:
			findVSCodeFiles(basePath, files)
		}
	}
	return files
}

func findClaudeFiles(basePath string, files map[string]string) {
	entries, err := os.ReadDir(basePath)
	if err != nil {
		return
	}
	for _, projectDir := range entries {
		if !projectDir.IsDir() {
			continue
		}
		projectPath := filepath.Join(basePath, projectDir.Name())
		sessionFiles, err := os.ReadDir(projectPath)
		if err != nil {
			continue
		}
		for _, sf := range sessionFiles {
			if sf.IsDir() || !strings.HasSuffix(sf.Name(), ".jsonl") {
				continue
			}
			sessionID := strings.TrimSuffix(sf.Name(), ".jsonl")
			files[sessionID] = filepath.Join(projectPath, sf.Name())
		}
	}
}

func findCopilotFiles(basePath string, files map[string]string) {
	entries, err := os.ReadDir(basePath)
	if err != nil {
		return
	}
	for _, sessionDir := range entries {
		if !sessionDir.IsDir() {
			continue
		}
		eventsFile := filepath.Join(basePath, sessionDir.Name(), "events.jsonl")
		if _, err := os.Stat(eventsFile); err == nil {
			files[sessionDir.Name()] = eventsFile
		}
	}
}

func findCodexFiles(dir string, files map[string]string, depth int) {
	if depth > 4 {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			findCodexFiles(filepath.Join(dir, e.Name()), files, depth+1)
		} else if strings.HasSuffix(e.Name(), ".jsonl") {
			filePath := filepath.Join(dir, e.Name())
			sessionID := extractCodexSessionID(filePath)
			if sessionID == "" {
				sessionID = strings.TrimSuffix(e.Name(), ".jsonl")
			}
			files[sessionID] = filePath
		}
	}
}

func findOpenCodeFiles(basePath string, files map[string]string) {
	// DB mode: look for opencode.db in parent of storage dir
	dbPath := filepath.Join(basePath, "..", "opencode.db")
	if _, err := os.Stat(dbPath); err == nil {
		for _, id := range parsers.ListOpenCodeDBSessionIDs() {
			files[id] = "db::" + id
		}
	}

	// File mode (legacy)
	sessionDir := filepath.Join(basePath, "session")
	if _, err := os.Stat(sessionDir); err != nil {
		return
	}
	projectDirs, err := os.ReadDir(sessionDir)
	if err != nil {
		return
	}
	for _, pd := range projectDirs {
		if !pd.IsDir() {
			continue
		}
		sessionFiles, err := os.ReadDir(filepath.Join(sessionDir, pd.Name()))
		if err != nil {
			continue
		}
		for _, sf := range sessionFiles {
			if sf.IsDir() || !strings.HasSuffix(sf.Name(), ".json") {
				continue
			}
			sessionID := strings.TrimSuffix(sf.Name(), ".json")
			if _, exists := files[sessionID]; !exists {
				files[sessionID] = filepath.Join(sessionDir, pd.Name(), sf.Name())
			}
		}
	}
}

func findVSCodeFiles(basePath string, files map[string]string) {
	// workspaceStorage/<hash>/chatSessions/*.{json,jsonl}
	wsPath := filepath.Join(basePath, "workspaceStorage")
	if entries, err := os.ReadDir(wsPath); err == nil {
		for _, projectDir := range entries {
			chatSessions := filepath.Join(wsPath, projectDir.Name(), "chatSessions")
			addSessionFilesFromDir(chatSessions, files)
		}
	}
	// globalStorage/emptyWindowChatSessions/*.{json,jsonl}
	ewPath := filepath.Join(basePath, "globalStorage", "emptyWindowChatSessions")
	addSessionFilesFromDir(ewPath, files)
}

func addSessionFilesFromDir(dir string, files map[string]string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".json") && !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		sessionID := strings.TrimSuffix(strings.TrimSuffix(name, ".json"), ".jsonl")
		fp := filepath.Join(dir, name)
		// Prefer .jsonl (incremental log) over .json (snapshot)
		if existing, exists := files[sessionID]; !exists || (!strings.HasSuffix(existing, ".jsonl") && strings.HasSuffix(fp, ".jsonl")) {
			files[sessionID] = fp
		}
	}
}

func extractCodexSessionID(filePath string) string {
	f, err := os.Open(filePath)
	if err != nil {
		return ""
	}
	defer f.Close()
	buf := make([]byte, 512)
	n, _ := io.ReadAtLeast(f, buf, 1)
	chunk := string(buf[:n])
	if !strings.Contains(chunk, `"session_meta"`) {
		return ""
	}
	sc := bufio.NewScanner(strings.NewReader(chunk))
	for sc.Scan() {
		line := sc.Text()
		if !strings.Contains(line, "session_meta") {
			continue
		}
		// Look for "id":"<uuid>"
		idx := strings.Index(line, `"id":"`)
		if idx < 0 {
			continue
		}
		rest := line[idx+6:]
		end := strings.Index(rest, `"`)
		if end > 0 {
			return rest[:end]
		}
	}
	return ""
}

// ──────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────

// ListSessions returns summaries for all sessions from the given source(s).
func ListSessions(source string) []types.SessionSummary {
	sources := types.ValidSources
	if source != "" && source != "all" {
		src := types.SessionSource(source)
		if src.IsValid() {
			sources = []types.SessionSource{src}
		}
	}

	var summaries []types.SessionSummary
	for _, src := range sources {
		files := FindSessionFiles(src)
		for sessionID, filePath := range files {
			key := cacheKey(src, sessionID)
			sessionCacheMu.RLock()
			detail := sessionCache[key]
			sessionCacheMu.RUnlock()

			if detail == nil {
				detail = parsers.ParseSessionFile(filePath, src)
				if detail != nil {
					sessionCacheMu.Lock()
					sessionCache[key] = detail
					sessionCacheMu.Unlock()
				}
			}
			if detail != nil {
				summaries = append(summaries, parsers.GetSessionSummary(detail))
			}
		}
	}

	// Sort by lastActivity descending
	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].LastActivity > summaries[j].LastActivity
	})
	return summaries
}

// GetSession returns the full SessionDetail, loading from cache or disk.
func GetSession(source types.SessionSource, sessionID string) *types.SessionDetail {
	key := cacheKey(source, sessionID)
	sessionCacheMu.RLock()
	detail := sessionCache[key]
	sessionCacheMu.RUnlock()

	if detail == nil {
		files := FindSessionFiles(source)
		filePath, ok := files[sessionID]
		if !ok {
			return nil
		}
		detail = parsers.ParseSessionFile(filePath, source)
		if detail != nil {
			// Attach log file info
			isDB := parsers.IsDBPath(filePath)
			detail.LogFilePath = &filePath
			logAvail := !isDB
			if !isDB {
				_, err := os.Stat(filePath)
				logAvail = err == nil
			}
			detail.LogAvailable = &logAvail

			sessionCacheMu.Lock()
			sessionCache[key] = detail
			sessionCacheMu.Unlock()
		}
	}

	if detail != nil && (detail.LogFilePath == nil || detail.LogAvailable == nil) {
		files := FindSessionFiles(source)
		if fp, ok := files[sessionID]; ok {
			isDB := parsers.IsDBPath(fp)
			detail.LogFilePath = &fp
			logAvail := !isDB
			if !isDB {
				_, err := os.Stat(fp)
				logAvail = err == nil
			}
			detail.LogAvailable = &logAvail
		}
	}

	return detail
}

// GetSessionMessages returns paginated messages for a session.
func GetSessionMessages(source types.SessionSource, sessionID string, offset, limit int) []types.Message {
	detail := GetSession(source, sessionID)
	if detail == nil {
		return nil
	}
	msgs := detail.Messages
	if offset >= len(msgs) {
		return []types.Message{}
	}
	end := offset + limit
	if end > len(msgs) {
		end = len(msgs)
	}
	return msgs[offset:end]
}

// GetSessionStats returns statistics for a session.
func GetSessionStats(source types.SessionSource, sessionID string) *types.SessionStats {
	detail := GetSession(source, sessionID)
	if detail == nil {
		return nil
	}
	stats := detail.Stats
	return &stats
}

// IsDBPath re-exports parsers.IsDBPath for use by handlers.
func IsDBPath(filePath string) bool {
	return parsers.IsDBPath(filePath)
}

// DeleteSession deletes the underlying file(s) for a session and evicts it from cache.
func DeleteSession(source types.SessionSource, sessionID string) bool {
	files := FindSessionFiles(source)
	filePath, ok := files[sessionID]
	if !ok {
		return false
	}

	var err error
	switch source {
	case types.SourceCopilot:
		// Delete the entire session directory
		sessionDir := filepath.Dir(filePath)
		err = os.RemoveAll(sessionDir)
	case types.SourceClaude:
		// Delete the JSONL file and sibling subagents directory
		err = os.Remove(filePath)
		subagentsDir := filepath.Join(filepath.Dir(filePath), strings.TrimSuffix(filepath.Base(filePath), ".jsonl"))
		if _, e := os.Stat(subagentsDir); e == nil {
			os.RemoveAll(subagentsDir)
		}
	case types.SourceOpenCode:
		if parsers.IsDBPath(filePath) {
			// Cannot delete from DB via this backend (would require write access)
			log.Printf("Cannot delete DB-backed OpenCode session %s", sessionID)
			return false
		}
		err = os.Remove(filePath)
	default:
		err = os.Remove(filePath)
	}

	if err != nil {
		log.Printf("Error deleting session %s/%s: %v", source, sessionID, err)
		return false
	}

	InvalidateSession(source, sessionID)
	return true
}
