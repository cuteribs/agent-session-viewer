package config

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/joho/godotenv"

	"agent-session-viewer/types"
)

// ServerConfig holds startup configuration read from environment variables.
type ServerConfig struct {
	Port             int
	Host             string
	WatchEnabled     bool
	WatchDebounceMs  int
	Paths            types.ConfigPaths
}

func init() {
	// Try .env in the binary's directory, then cwd — ignore errors.
	_ = godotenv.Load()
}

func getDefaultClaudePath() string {
	return filepath.Join(homeDir(), ".claude", "projects")
}

func getDefaultCopilotPath() string {
	return filepath.Join(homeDir(), ".copilot", "session-state")
}

func getDefaultCodexPath() string {
	return filepath.Join(homeDir(), ".codex", "sessions")
}

func getDefaultOpenCodePath() string {
	return filepath.Join(homeDir(), ".local", "share", "opencode", "storage")
}

func getDefaultVSCodePath() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(homeDir(), "AppData", "Roaming", "Code", "User")
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(homeDir(), "Library", "Application Support", "Code", "User")
	}
	// Linux: check XDG_CONFIG_HOME first, then fall back to ~/.config/Code/User
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "Code", "User")
	}
	return filepath.Join(homeDir(), ".config", "Code", "User")
}

func homeDir() string {
	if h, err := os.UserHomeDir(); err == nil {
		return h
	}
	return "~"
}

func parsePathList(envValue, defaultPath string) []string {
	if envValue == "" {
		return []string{defaultPath}
	}
	parts := strings.Split(envValue, ",")
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return []string{defaultPath}
	}
	return out
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	var n int
	if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
		return n
	}
	return def
}

// GetServerConfig builds a ServerConfig from env vars / defaults.
func GetServerConfig() ServerConfig {
	return ServerConfig{
		Port:            envInt("PORT", 3000),
		Host:            envStr("HOST", "localhost"),
		WatchEnabled:    os.Getenv("WATCH_ENABLED") == "true",
		WatchDebounceMs: envInt("WATCH_DEBOUNCE_MS", 500),
		Paths: types.ConfigPaths{
			Claude:   parsePathList(os.Getenv("CLAUDE_PATHS"), getDefaultClaudePath()),
			Copilot:  parsePathList(os.Getenv("COPILOT_PATHS"), getDefaultCopilotPath()),
			Codex:    parsePathList(os.Getenv("CODEX_PATHS"), getDefaultCodexPath()),
			OpenCode: parsePathList(os.Getenv("OPENCODE_PATHS"), getDefaultOpenCodePath()),
			VSCode:   parsePathList(os.Getenv("VSCODE_PATHS"), getDefaultVSCodePath()),
		},
	}
}

func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ──────────────────────────────────────────────────────────
// In-memory AppConfig (mutable at runtime via PUT /api/config)
// ──────────────────────────────────────────────────────────

var appConfig types.AppConfig

// InitAppConfig seeds AppConfig from server config.
func InitAppConfig(sc ServerConfig) {
	appConfig = types.AppConfig{
		Paths:           sc.Paths,
		AutoRefresh:     true,
		RefreshInterval: 5000,
		Theme:           "system",
		DefaultView:     "date",
	}
}

// GetAppConfig returns a copy of the current AppConfig.
func GetAppConfig() types.AppConfig {
	return appConfig
}

// UpdateAppConfig merges partial updates and returns the new config.
// Only non-zero / explicitly set fields in update are applied.
func UpdateAppConfig(update types.AppConfig) types.AppConfig {
	if len(update.Paths.Claude) > 0 {
		appConfig.Paths.Claude = update.Paths.Claude
	}
	if len(update.Paths.Copilot) > 0 {
		appConfig.Paths.Copilot = update.Paths.Copilot
	}
	if len(update.Paths.Codex) > 0 {
		appConfig.Paths.Codex = update.Paths.Codex
	}
	if len(update.Paths.OpenCode) > 0 {
		appConfig.Paths.OpenCode = update.Paths.OpenCode
	}
	if len(update.Paths.VSCode) > 0 {
		appConfig.Paths.VSCode = update.Paths.VSCode
	}
	if update.Theme != "" {
		appConfig.Theme = update.Theme
	}
	if update.DefaultView != "" {
		appConfig.DefaultView = update.DefaultView
	}
	if update.RefreshInterval > 0 {
		appConfig.RefreshInterval = update.RefreshInterval
	}
	// AutoRefresh: zero value is false, which is a valid intent — check by comparing
	// the JSON representation (simpler: always overwrite from caller-supplied value).
	appConfig.AutoRefresh = update.AutoRefresh
	return GetAppConfig()
}
