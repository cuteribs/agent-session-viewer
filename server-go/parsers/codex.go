package parsers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"agent-session-viewer/pricing"
	"agent-session-viewer/types"
)

// ──────────────────────────────────────────────────────────
// Raw Codex event types
// ──────────────────────────────────────────────────────────

type codexTokenUsage struct {
	InputTokens           int `json:"input_tokens"`
	CachedInputTokens     int `json:"cached_input_tokens"`
	OutputTokens          int `json:"output_tokens"`
	ReasoningOutputTokens int `json:"reasoning_output_tokens,omitempty"`
	TotalTokens           int `json:"total_tokens"`
}

type codexSessionMeta struct {
	ID            string `json:"id"`
	Timestamp     string `json:"timestamp"`
	CWD           string `json:"cwd"`
	Originator    string `json:"originator,omitempty"`
	CLIVersion    string `json:"cli_version,omitempty"`
	ModelProvider string `json:"model_provider,omitempty"`
}

type codexEventMsg struct {
	Type string `json:"type"`
	// user_message / agent_message
	Message string `json:"message,omitempty"`
	Phase   string `json:"phase,omitempty"`
	// task_complete
	DurationMs *int64 `json:"duration_ms,omitempty"`
	// token_count
	Info *struct {
		TotalTokenUsage *codexTokenUsage `json:"total_token_usage,omitempty"`
		LastTokenUsage  *codexTokenUsage `json:"last_token_usage,omitempty"`
	} `json:"info,omitempty"`
	// patch_apply_end
	CallID  string `json:"call_id,omitempty"`
	Success *bool  `json:"success,omitempty"`
}

type codexResponseItem struct {
	Type      string      `json:"type"`
	Name      string      `json:"name,omitempty"`
	Arguments string      `json:"arguments,omitempty"`
	Input     string      `json:"input,omitempty"`
	CallID    string      `json:"call_id,omitempty"`
	Output    interface{} `json:"output,omitempty"`
	Role      string      `json:"role,omitempty"`
	Content   []struct {
		Type string `json:"type"`
		Text string `json:"text,omitempty"`
	} `json:"content,omitempty"`
}

type codexTurnContext struct {
	TurnID string `json:"turn_id"`
	CWD    string `json:"cwd"`
	Model  string `json:"model,omitempty"`
	Effort string `json:"effort,omitempty"`
}

type codexEvent struct {
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

// ──────────────────────────────────────────────────────────
// Parser
// ──────────────────────────────────────────────────────────

func ParseCodexSessionFile(filePath string) *types.SessionDetail {
	events := readCodexEvents(filePath)
	if len(events) == 0 {
		return nil
	}

	// Extract metadata
	var meta *codexSessionMeta
	for _, ev := range events {
		if ev.Type == "session_meta" {
			var m codexSessionMeta
			if json.Unmarshal(ev.Payload, &m) == nil {
				meta = &m
				break
			}
		}
	}

	sessionID := filepath.Base(filePath)
	if meta != nil && meta.ID != "" {
		sessionID = meta.ID
	}
	sessionID = strings.TrimSuffix(sessionID, ".jsonl")

	projectPath := ""
	if meta != nil {
		projectPath = meta.CWD
	}
	project := filepath.Base(projectPath)
	if project == "" || project == "." {
		project = strings.TrimSuffix(filepath.Base(filePath), ".jsonl")
	}

	// Extract model from first turn_context
	model := ""
	for _, ev := range events {
		if ev.Type == "turn_context" {
			var tc codexTurnContext
			if json.Unmarshal(ev.Payload, &tc) == nil && tc.Model != "" {
				model = tc.Model
				break
			}
		}
	}

	// Build tool call/result maps
	toolCallsByCallID := map[string]struct {
		name string
		args map[string]interface{}
	}{}
	toolResultsByCallID := map[string]types.ToolResult{}
	toolUsageMap := map[string]struct{ count, successes int }{}

	for _, ev := range events {
		if ev.Type != "response_item" {
			continue
		}
		var item codexResponseItem
		if json.Unmarshal(ev.Payload, &item) != nil {
			continue
		}
		if item.Type == "function_call" || item.Type == "custom_tool_call" {
			callID := item.CallID
			name := item.Name
			if name == "" {
				name = "unknown"
			}
			rawArgs := item.Arguments
			if rawArgs == "" {
				rawArgs = item.Input
			}
			args := map[string]interface{}{}
			if rawArgs != "" {
				if json.Unmarshal([]byte(rawArgs), &args) != nil {
					args = map[string]interface{}{"raw": rawArgs}
				}
			}
			toolCallsByCallID[callID] = struct {
				name string
				args map[string]interface{}
			}{name, args}
		}
		if item.Type == "function_call_output" || item.Type == "custom_tool_call_output" {
			callID := item.CallID
			toolName := "unknown"
			if tc, ok := toolCallsByCallID[callID]; ok {
				toolName = tc.name
			}
			outputStr := ""
			if item.Output != nil {
				switch v := item.Output.(type) {
				case string:
					outputStr = v
				default:
					b, _ := json.MarshalIndent(v, "", "  ")
					outputStr = string(b)
				}
			}
			toolResultsByCallID[callID] = types.ToolResult{
				ToolCallID: callID,
				Success:    true,
				Content:    outputStr,
			}
			u := toolUsageMap[toolName]
			u.count++
			u.successes++
			toolUsageMap[toolName] = u
		}
	}

	// Track patch_apply_end as tool usage
	for _, ev := range events {
		if ev.Type != "event_msg" {
			continue
		}
		var msg codexEventMsg
		if json.Unmarshal(ev.Payload, &msg) != nil {
			continue
		}
		if msg.Type == "patch_apply_end" && msg.CallID != "" {
			u := toolUsageMap["apply_patch"]
			u.count++
			if msg.Success == nil || *msg.Success {
				u.successes++
			}
			toolUsageMap["apply_patch"] = u
		}
	}

	// Collect token_count events indexed by event position
	tokenCountsByIdx := map[int]*codexTokenUsage{}
	var finalTotalUsage *codexTokenUsage
	for i, ev := range events {
		if ev.Type != "event_msg" {
			continue
		}
		var msg codexEventMsg
		if json.Unmarshal(ev.Payload, &msg) != nil {
			continue
		}
		if msg.Type == "token_count" && msg.Info != nil {
			if msg.Info.LastTokenUsage != nil {
				tokenCountsByIdx[i] = msg.Info.LastTokenUsage
			}
			if msg.Info.TotalTokenUsage != nil {
				finalTotalUsage = msg.Info.TotalTokenUsage
			}
		}
	}

	// Build messages
	messages := []types.Message{}
	var totalDuration int64
	inputPerMsg := []int{}
	outputPerMsg := []int{}
	cumulativeTokens := []int{}
	cumTotal := 0
	var pendingToolCalls []types.ToolCall

	for i, ev := range events {
		if ev.Type == "response_item" {
			var item codexResponseItem
			if json.Unmarshal(ev.Payload, &item) != nil {
				continue
			}
			if item.Type == "function_call" || item.Type == "custom_tool_call" {
				if tc, ok := toolCallsByCallID[item.CallID]; ok {
					pendingToolCalls = append(pendingToolCalls, types.ToolCall{
						ID:        item.CallID,
						Name:      tc.name,
						Arguments: tc.args,
					})
				}
			} else if item.Type == "function_call_output" || item.Type == "custom_tool_call_output" {
				if r, ok := toolResultsByCallID[item.CallID]; ok {
					messages = append(messages, types.Message{
						ID:         fmt.Sprintf("%s-result", item.CallID),
						ParentID:   nil,
						Role:       "tool",
						Content:    r.Content,
						Timestamp:  ev.Timestamp,
						ToolResult: &r,
					})
				}
			}
			continue
		}

		if ev.Type != "event_msg" {
			continue
		}
		var msg codexEventMsg
		if json.Unmarshal(ev.Payload, &msg) != nil {
			continue
		}

		switch msg.Type {
		case "user_message":
			messages = append(messages, types.Message{
				ID:        fmt.Sprintf("user-%s", ev.Timestamp),
				ParentID:  nil,
				Role:      "user",
				Content:   msg.Message,
				Timestamp: ev.Timestamp,
			})
			pendingToolCalls = nil

		case "agent_message":
			toolCalls := pendingToolCalls
			pendingToolCalls = nil

			var tokens *types.Tokens
			// Look ahead up to 10 events for a token_count
			for j := i + 1; j < len(events) && j < i+10; j++ {
				if tc, ok := tokenCountsByIdx[j]; ok {
					c := pricing.CalculateCost(pricing.TokenCounts{
						Input:     tc.InputTokens,
						Output:    tc.OutputTokens,
						CacheRead: tc.CachedInputTokens,
					}, model)
					tokens = &types.Tokens{
						Input:     tc.InputTokens,
						Output:    tc.OutputTokens,
						CacheRead: intPtr(tc.CachedInputTokens),
						Cost:      &c,
					}
					inputPerMsg = append(inputPerMsg, tc.InputTokens)
					outputPerMsg = append(outputPerMsg, tc.OutputTokens)
					cumTotal += tc.InputTokens + tc.OutputTokens
					cumulativeTokens = append(cumulativeTokens, cumTotal)
					break
				}
			}

			m := types.Message{
				ID:        fmt.Sprintf("agent-%s", ev.Timestamp),
				ParentID:  nil,
				Role:      "assistant",
				Content:   msg.Message,
				Timestamp: ev.Timestamp,
				Tokens:    tokens,
			}
			if model != "" {
				m.Model = &model
			}
			if len(toolCalls) > 0 {
				m.ToolCalls = toolCalls
			}
			messages = append(messages, m)

		case "task_complete":
			if msg.DurationMs != nil {
				totalDuration += *msg.DurationMs
			}
		}
	}

	// Build tool summaries
	var toolUsage []types.ToolUsageSummary
	var toolStats []types.ToolStat
	for name, u := range toolUsageMap {
		sr := 0.0
		if u.count > 0 {
			sr = float64(u.successes) / float64(u.count)
		}
		toolUsage = append(toolUsage, types.ToolUsageSummary{Name: name, Count: u.count, SuccessRate: sr})
		toolStats = append(toolStats, types.ToolStat{Name: name, Count: u.count, SuccessRate: sr})
	}
	sort.Slice(toolUsage, func(i, j int) bool { return toolUsage[i].Count > toolUsage[j].Count })
	sort.Slice(toolStats, func(i, j int) bool { return toolStats[i].Count > toolStats[j].Count })

	userMsgs, assistantMsgs := 0, 0
	for _, m := range messages {
		if m.Role == "user" {
			userMsgs++
		} else if m.Role == "assistant" {
			assistantMsgs++
		}
	}

	var tokenStats *types.TokenStats
	if finalTotalUsage != nil {
		c := pricing.CalculateCost(pricing.TokenCounts{
			Input:     finalTotalUsage.InputTokens,
			Output:    finalTotalUsage.OutputTokens,
			CacheRead: finalTotalUsage.CachedInputTokens,
		}, model)
		tokenStats = &types.TokenStats{
			TotalInput:       finalTotalUsage.InputTokens,
			TotalOutput:      finalTotalUsage.OutputTokens,
			TotalCacheRead:   finalTotalUsage.CachedInputTokens,
			TotalCost:        &c,
			InputPerMessage:  inputPerMsg,
			OutputPerMessage: outputPerMsg,
			CumulativeTokens: cumulativeTokens,
		}
	}

	stats := types.SessionStats{
		MessageCount:      len(messages),
		UserMessages:      userMsgs,
		AssistantMessages: assistantMsgs,
		Tokens:            tokenStats,
		Tools:             toolStats,
		Duration:          totalDuration,
	}

	startTime := time.Now().UTC().Format(time.RFC3339)
	if meta != nil && meta.Timestamp != "" {
		startTime = meta.Timestamp
	}
	lastActivity := startTime
	if len(messages) > 0 {
		startTime = messages[0].Timestamp
		lastActivity = messages[len(messages)-1].Timestamp
	}

	var totalTok *int
	if finalTotalUsage != nil {
		t := finalTotalUsage.InputTokens + finalTotalUsage.OutputTokens
		totalTok = &t
	}
	var modelPtr *string
	if model != "" {
		modelPtr = &model
	}

	return &types.SessionDetail{
		SessionSummary: types.SessionSummary{
			ID:           sessionID,
			Source:       types.SourceCodex,
			Project:      project,
			ProjectPath:  projectPath,
			StartTime:    startTime,
			LastActivity: lastActivity,
			MessageCount: len(messages),
			TotalTokens:  totalTok,
			Model:        modelPtr,
		},
		Messages:  messages,
		Stats:     stats,
		ToolUsage: toolUsage,
	}
}

func readCodexEvents(filePath string) []codexEvent {
	f, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer f.Close()

	var events []codexEvent
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 4*1024*1024), 4*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var ev codexEvent
		if json.Unmarshal([]byte(line), &ev) == nil {
			events = append(events, ev)
		}
	}
	return events
}

func intPtr(n int) *int { return &n }
