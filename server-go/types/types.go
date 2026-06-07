package types

// SessionSource represents the AI tool that created a session.
type SessionSource string

const (
	SourceClaude   SessionSource = "claude"
	SourceCopilot  SessionSource = "copilot"
	SourceCodex    SessionSource = "codex"
	SourceOpenCode SessionSource = "opencode"
	SourceVSCode   SessionSource = "vscode"
)

// ValidSources is the exhaustive list of known session sources.
var ValidSources = []SessionSource{SourceClaude, SourceCopilot, SourceCodex, SourceOpenCode, SourceVSCode}

// IsValid returns true when s is a known session source.
func (s SessionSource) IsValid() bool {
	for _, v := range ValidSources {
		if s == v {
			return true
		}
	}
	return false
}

// ──────────────────────────────────────────────────────────
// Application Data Models  (mirrors shared/types.ts)
// ──────────────────────────────────────────────────────────

type Tokens struct {
	Input         int      `json:"input"`
	Output        int      `json:"output"`
	CacheRead     *int     `json:"cacheRead,omitempty"`
	CacheCreation *int     `json:"cacheCreation,omitempty"`
	Estimated     *bool    `json:"estimated,omitempty"`
	Cost          *float64 `json:"cost,omitempty"`
}

type ToolCall struct {
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
	Result    *string                `json:"result,omitempty"`
}

type ToolResult struct {
	ToolCallID string `json:"toolCallId"`
	Success    bool   `json:"success"`
	Content    string `json:"content"`
}

type Message struct {
	ID          string      `json:"id"`
	ParentID    *string     `json:"parentId"`
	Role        string      `json:"role"` // user | assistant | system | tool
	Content     string      `json:"content"`
	Timestamp   string      `json:"timestamp"`
	Model       *string     `json:"model,omitempty"`
	SubAgentRef *string     `json:"subAgentRef,omitempty"`
	Tokens      *Tokens     `json:"tokens,omitempty"`
	ToolCalls   []ToolCall  `json:"toolCalls,omitempty"`
	ToolResult  *ToolResult `json:"toolResult,omitempty"`
}

type SubAgent struct {
	ID               string     `json:"id"`
	AgentID          string     `json:"agentId"`
	AgentType        string     `json:"agentType"`
	AgentDisplayName string     `json:"agentDisplayName"`
	Description      *string    `json:"description,omitempty"`
	Prompt           *string    `json:"prompt,omitempty"`
	Status           string     `json:"status"` // started | completed | failed
	Result           *string    `json:"result,omitempty"`
	Model            *string    `json:"model,omitempty"`
	TotalTokens      *int       `json:"totalTokens,omitempty"`
	TotalToolCalls   *int       `json:"totalToolCalls,omitempty"`
	DurationMs       *int64     `json:"durationMs,omitempty"`
	StartTime        string     `json:"startTime"`
	EndTime          *string    `json:"endTime,omitempty"`
	Messages         []Message  `json:"messages,omitempty"`
}

type UsedModelEntry struct {
	Model        string  `json:"model"`
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
	TotalTokens  int     `json:"totalTokens"`
	RequestCount int     `json:"requestCount"`
	Cost         float64 `json:"cost"`
}

type SessionSummary struct {
	ID           string           `json:"id"`
	Source       SessionSource    `json:"source"`
	Project      string           `json:"project"`
	ProjectPath  string           `json:"projectPath"`
	StartTime    string           `json:"startTime"`
	LastActivity string           `json:"lastActivity"`
	MessageCount int              `json:"messageCount"`
	TotalTokens  *int             `json:"totalTokens,omitempty"`
	Cost         *float64         `json:"cost,omitempty"`
	Model        *string          `json:"model,omitempty"`
	SubAgentCount *int            `json:"subAgentCount,omitempty"`
	UsedModels   []UsedModelEntry `json:"usedModels,omitempty"`
	TokenNote    *string          `json:"tokenNote,omitempty"`
}

type TokenStats struct {
	TotalInput        int       `json:"totalInput"`
	TotalOutput       int       `json:"totalOutput"`
	TotalCacheRead    int       `json:"totalCacheRead"`
	TotalCacheCreation int      `json:"totalCacheCreation"`
	TotalCost         *float64  `json:"totalCost,omitempty"`
	InputPerMessage   []int     `json:"inputPerMessage"`
	OutputPerMessage  []int     `json:"outputPerMessage"`
	CumulativeTokens  []int     `json:"cumulativeTokens"`
}

type ToolStat struct {
	Name        string  `json:"name"`
	Count       int     `json:"count"`
	SuccessRate float64 `json:"successRate"`
}

type ToolUsageSummary struct {
	Name        string  `json:"name"`
	Count       int     `json:"count"`
	SuccessRate float64 `json:"successRate"`
}

type SessionStats struct {
	MessageCount       int          `json:"messageCount"`
	UserMessages       int          `json:"userMessages"`
	AssistantMessages  int          `json:"assistantMessages"`
	Tokens             *TokenStats  `json:"tokens,omitempty"`
	Tools              []ToolStat   `json:"tools"`
	Duration           int64        `json:"duration"` // ms
	AverageTurnDuration *float64    `json:"averageTurnDuration,omitempty"`
}

type SessionDetail struct {
	SessionSummary
	Messages     []Message          `json:"messages"`
	Stats        SessionStats       `json:"stats"`
	ToolUsage    []ToolUsageSummary `json:"toolUsage"`
	SubAgents    []SubAgent         `json:"subAgents,omitempty"`
	LogFilePath  *string            `json:"logFilePath,omitempty"`
	LogAvailable *bool              `json:"logAvailable,omitempty"`
}

// ──────────────────────────────────────────────────────────
// App Configuration
// ──────────────────────────────────────────────────────────

type ConfigPaths struct {
	Claude   []string `json:"claude"`
	Copilot  []string `json:"copilot"`
	Codex    []string `json:"codex"`
	OpenCode []string `json:"opencode"`
	VSCode   []string `json:"vscode"`
}

type AppConfig struct {
	Paths           ConfigPaths `json:"paths"`
	AutoRefresh     bool        `json:"autoRefresh"`
	RefreshInterval int         `json:"refreshInterval"` // ms
	Theme           string      `json:"theme"`           // light | dark | system
	DefaultView     string      `json:"defaultView"`     // date | project
}

// ──────────────────────────────────────────────────────────
// WebSocket Messages
// ──────────────────────────────────────────────────────────

type WSPayload struct {
	Source    *SessionSource  `json:"source,omitempty"`
	SessionID *string         `json:"sessionId,omitempty"`
	Data      *SessionSummary `json:"data,omitempty"`
	Active    *bool           `json:"active,omitempty"`
}

type WSMessage struct {
	Type    string    `json:"type"` // session_updated | session_created | session_deleted | watch_status
	Payload WSPayload `json:"payload"`
}
