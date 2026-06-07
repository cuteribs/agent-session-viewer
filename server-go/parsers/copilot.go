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
// Raw Copilot event types
// ──────────────────────────────────────────────────────────

type copilotToolRequest struct {
	ToolCallID string                 `json:"toolCallId"`
	Name       string                 `json:"name"`
	Arguments  map[string]interface{} `json:"arguments"`
	Type       string                 `json:"type"`
}

type copilotToolTelemetry struct {
	Properties           map[string]string  `json:"properties,omitempty"`
	RestrictedProperties map[string]string  `json:"restrictedProperties,omitempty"`
	Metrics              map[string]float64 `json:"metrics,omitempty"`
}

type copilotEventData struct {
	// session.start
	SessionID string `json:"sessionId,omitempty"`
	Context   *struct {
		CWD     string `json:"cwd"`
		GitRoot string `json:"gitRoot,omitempty"`
		Branch  string `json:"branch,omitempty"`
	} `json:"context,omitempty"`
	SelectedModel string `json:"selectedModel,omitempty"`

	// user.message
	Content            string `json:"content,omitempty"`
	TransformedContent string `json:"transformedContent,omitempty"`

	// assistant.message
	MessageID     string               `json:"messageId,omitempty"`
	ToolRequests  []copilotToolRequest `json:"toolRequests,omitempty"`
	ReasoningText string               `json:"reasoningText,omitempty"`
	OutputTokens  *int                 `json:"outputTokens,omitempty"`
	// Patched exact-token fields
	InputTokens       *int         `json:"input_tokens,omitempty"`
	OutputTokensExact *int         `json:"output_tokens,omitempty"`
	CacheReadTokens   *int         `json:"cache_read_tokens,omitempty"`
	TurnID            *interface{} `json:"turnId,omitempty"`

	// tool.execution_*
	ToolCallID string                 `json:"toolCallId,omitempty"`
	ToolName   string                 `json:"toolName,omitempty"`
	Arguments  map[string]interface{} `json:"arguments,omitempty"`
	Success    *bool                  `json:"success,omitempty"`
	Result     *struct {
		Content         string `json:"content"`
		DetailedContent string `json:"detailedContent,omitempty"`
	} `json:"result,omitempty"`
	ToolTelemetry *copilotToolTelemetry `json:"toolTelemetry,omitempty"`

	// subagent.*
	AgentName        string `json:"agentName,omitempty"`
	AgentDisplayName string `json:"agentDisplayName,omitempty"`
	AgentDescription string `json:"agentDescription,omitempty"`
	Model            string `json:"model,omitempty"`
	TotalTokens      *int   `json:"totalTokens,omitempty"`
	TotalToolCalls   *int   `json:"totalToolCalls,omitempty"`
	DurationMs       *int64 `json:"durationMs,omitempty"`

	// session.model_change
	PreviousModel string `json:"previousModel,omitempty"`
	NewModel      string `json:"newModel,omitempty"`

	// session.error
	ErrorType string `json:"errorType,omitempty"`
	Message   string `json:"message,omitempty"`

	// session.shutdown
	ModelMetrics map[string]copilotModelMetric `json:"modelMetrics,omitempty"`
}

type copilotModelMetric struct {
	Requests struct {
		Count int     `json:"count"`
		Cost  float64 `json:"cost"`
	} `json:"requests"`
	Usage struct {
		InputTokens      int `json:"inputTokens"`
		OutputTokens     int `json:"outputTokens"`
		CacheReadTokens  int `json:"cacheReadTokens"`
		CacheWriteTokens int `json:"cacheWriteTokens"`
		ReasoningTokens  int `json:"reasoningTokens"`
	} `json:"usage"`
}

type copilotEvent struct {
	Type      string           `json:"type"`
	ID        string           `json:"id"`
	ParentID  *string          `json:"parentId"`
	Timestamp string           `json:"timestamp"`
	AgentID   string           `json:"agentId,omitempty"`
	Data      copilotEventData `json:"data"`
}

// ──────────────────────────────────────────────────────────
// Parser
// ──────────────────────────────────────────────────────────

func ParseCopilotSessionFile(filePath string) *types.SessionDetail {
	events, rawLines := readCopilotEvents(filePath)
	if len(events) == 0 {
		return nil
	}

	startEvent := findEvent(events, "session.start")
	sessionID := ""
	if startEvent != nil {
		sessionID = startEvent.Data.SessionID
	}
	if sessionID == "" {
		sessionID = filepath.Base(filepath.Dir(filePath))
	}

	projectPath := ""
	if startEvent != nil && startEvent.Data.Context != nil {
		projectPath = startEvent.Data.Context.CWD
	}
	if projectPath == "" {
		projectPath = filepath.Dir(filePath)
	}
	project := filepath.Base(projectPath)

	model := ""
	if startEvent != nil {
		model = startEvent.Data.SelectedModel
	}

	// ── First pass: collect tool names, results, subagents, model changes ──
	toolNamesById := map[string]string{}
	toolResultsById := map[string]types.ToolResult{}
	toolUsageMap := map[string]struct{ count, successes int }{}
	subAgentMap := map[string]*types.SubAgent{}    // keyed by toolCallId
	subAgentByName := map[string]*types.SubAgent{} // keyed by agentId/name

	for _, ev := range events {
		if ev.Type == "tool.execution_start" && ev.Data.ToolCallID != "" && ev.Data.ToolName != "" {
			toolNamesById[ev.Data.ToolCallID] = ev.Data.ToolName
		}
		if ev.Type == "tool.execution_complete" && ev.Data.ToolCallID != "" {
			toolName := toolNamesById[ev.Data.ToolCallID]
			if toolName == "" {
				toolName = ev.Data.ToolName
			}
			if toolName == "" {
				toolName = "unknown"
			}
			content := ""
			if ev.Data.Result != nil {
				content = ev.Data.Result.Content
			}
			success := true
			if ev.Data.Success != nil {
				success = *ev.Data.Success
			}
			toolResultsById[ev.Data.ToolCallID] = types.ToolResult{
				ToolCallID: ev.Data.ToolCallID,
				Success:    success,
				Content:    content,
			}
			u := toolUsageMap[toolName]
			u.count++
			if success {
				u.successes++
			}
			toolUsageMap[toolName] = u
		}

		if ev.Type == "tool.execution_start" && ev.Data.ToolName == "task" {
			callID := ev.Data.ToolCallID
			args := ev.Data.Arguments
			agentID := ""
			if v, ok := args["name"].(string); ok {
				agentID = v
			}
			if agentID == "" && len(callID) >= 8 {
				agentID = callID[:8]
			}
			agentType := "task"
			if v, ok := args["agent_type"].(string); ok {
				agentType = v
			}
			displayName := agentType
			prompt := (*string)(nil)
			if v, ok := args["prompt"].(string); ok {
				prompt = &v
			}
			desc := (*string)(nil)
			if v, ok := args["description"].(string); ok {
				desc = &v
			}
			agent := &types.SubAgent{
				ID:               callID,
				AgentID:          agentID,
				AgentType:        agentType,
				AgentDisplayName: titleCase(displayName),
				Description:      desc,
				Prompt:           prompt,
				Status:           "started",
				StartTime:        ev.Timestamp,
			}
			subAgentMap[callID] = agent
			subAgentByName[agentID] = agent
		}

		if ev.Type == "subagent.started" && ev.Data.ToolCallID != "" {
			if agent, ok := subAgentMap[ev.Data.ToolCallID]; ok {
				if ev.Data.AgentDisplayName != "" {
					agent.AgentDisplayName = ev.Data.AgentDisplayName
				}
				if ev.Data.AgentDescription != "" {
					d := ev.Data.AgentDescription
					agent.Description = &d
				}
			}
		}

		if ev.Type == "subagent.completed" && ev.Data.ToolCallID != "" {
			if agent, ok := subAgentMap[ev.Data.ToolCallID]; ok {
				patchedIn, patchedOut, _ := getPatchedTokenUsage(ev.Data)
				agent.Status = "completed"
				if ev.Data.Model != "" {
					m := ev.Data.Model
					agent.Model = &m
				}
				if patchedIn >= 0 {
					t := patchedIn + patchedOut
					agent.TotalTokens = &t
				} else if ev.Data.TotalTokens != nil {
					agent.TotalTokens = ev.Data.TotalTokens
				}
				agent.TotalToolCalls = ev.Data.TotalToolCalls
				agent.DurationMs = ev.Data.DurationMs
				end := ev.Timestamp
				agent.EndTime = &end
			}
		}

		if ev.Type == "tool.execution_complete" && ev.Data.ToolTelemetry != nil {
			props := ev.Data.ToolTelemetry.Properties
			if agentID, ok := props["agent_id"]; ok {
				agent := subAgentByName[agentID]
				if agent != nil {
					status := props["status"]
					if status == "completed" {
						agent.Status = "completed"
					} else if status == "failed" || (ev.Data.Success != nil && !*ev.Data.Success) {
						agent.Status = "failed"
					}
					if (status == "completed" || status == "failed") && agent.EndTime == nil {
						end := ev.Timestamp
						agent.EndTime = &end
					}
					resultContent := ""
					if ev.Data.Result != nil {
						resultContent = ev.Data.Result.DetailedContent
						if resultContent == "" {
							resultContent = ev.Data.Result.Content
						}
					}
					if resultContent != "" && agent.Result == nil {
						agent.Result = &resultContent
					}
				}
			}
		}

		if ev.Type == "session.model_change" && ev.Data.NewModel != "" {
			model = ev.Data.NewModel
		}
	}

	// ── Detect patched-token mode ──
	hasPatchedTokens := false
	for _, ev := range events {
		if ev.Type == "assistant.message" {
			if ev.Data.InputTokens != nil && ev.Data.OutputTokensExact != nil {
				hasPatchedTokens = true
				break
			}
		}
	}

	// ── Parse session.shutdown totals ──
	exactTotalInput, exactTotalOutput, exactTotalCacheRead, exactTotalCacheWrite, exactTotalCost := 0, 0, 0, 0, 0.0
	var shutdownData map[string]copilotModelMetric
	if len(rawLines) > 0 {
		var lastEv struct {
			Type string `json:"type"`
			Data struct {
				ModelMetrics map[string]copilotModelMetric `json:"modelMetrics,omitempty"`
			} `json:"data"`
		}
		if err := json.Unmarshal([]byte(rawLines[len(rawLines)-1]), &lastEv); err == nil {
			if lastEv.Type == "session.shutdown" && lastEv.Data.ModelMetrics != nil {
				shutdownData = lastEv.Data.ModelMetrics
			}
		}
	}
	var usedModels []types.UsedModelEntry
	if shutdownData != nil {
		for modelName, m := range shutdownData {
			exactTotalInput += m.Usage.InputTokens
			exactTotalOutput += m.Usage.OutputTokens
			exactTotalCacheRead += m.Usage.CacheReadTokens
			exactTotalCacheWrite += m.Usage.CacheWriteTokens
			c := pricing.CalculateCost(pricing.TokenCounts{
				Input:         m.Usage.InputTokens,
				Output:        m.Usage.OutputTokens,
				CacheRead:     m.Usage.CacheReadTokens,
				CacheCreation: m.Usage.CacheWriteTokens,
			}, modelName)
			exactTotalCost += c
			usedModels = append(usedModels, types.UsedModelEntry{
				Model:        modelName,
				InputTokens:  m.Usage.InputTokens,
				OutputTokens: m.Usage.OutputTokens,
				TotalTokens:  m.Usage.InputTokens + m.Usage.OutputTokens,
				RequestCount: m.Requests.Count,
				Cost:         c,
			})
		}
		sort.Slice(usedModels, func(i, j int) bool { return usedModels[i].TotalTokens > usedModels[j].TotalTokens })
	} else {
		// Fallback: sum outputTokens from assistant.message events
		for _, line := range rawLines {
			var ev struct {
				Type string `json:"type"`
				Data struct {
					OutputTokens *int `json:"outputTokens,omitempty"`
				} `json:"data"`
			}
			if json.Unmarshal([]byte(line), &ev) == nil && ev.Type == "assistant.message" && ev.Data.OutputTokens != nil {
				exactTotalOutput += *ev.Data.OutputTokens
			}
		}
	}

	// ── Second pass: build messages ──
	messages := []types.Message{}
	inputPerMsg := []int{}
	outputPerMsg := []int{}
	cumulativeTokens := []int{}
	cumSum := 0
	subAgentOutputMap := map[string]int{} // agentId → accumulated output tokens

	for _, ev := range events {
		switch ev.Type {
		case "user.message":
			content := ev.Data.Content
			if content == "" {
				content = ev.Data.TransformedContent
			}
			messages = append(messages, types.Message{
				ID:        ev.ID,
				ParentID:  ev.ParentID,
				Role:      "user",
				Content:   content,
				Timestamp: ev.Timestamp,
			})

		case "assistant.message":
			var toolCalls []types.ToolCall
			for _, tr := range ev.Data.ToolRequests {
				args := tr.Arguments
				if args == nil {
					args = map[string]interface{}{}
				}
				toolCalls = append(toolCalls, types.ToolCall{ID: tr.ToolCallID, Name: tr.Name, Arguments: args})
			}
			msgContent := ev.Data.Content
			if msgContent == "" {
				msgContent = ev.Data.ReasoningText
			}
			msgModel := ev.Data.Model
			if msgModel == "" {
				msgModel = model
			}

			if ev.AgentID != "" {
				if agent, ok := subAgentMap[ev.AgentID]; ok {
					if agent.Messages == nil {
						agent.Messages = []types.Message{}
					}
					outTok := 0
					if ev.Data.OutputTokens != nil {
						outTok = *ev.Data.OutputTokens
					}
					if agent.Model == nil && msgModel != "" {
						agent.Model = &msgModel
					}
					subMsg := types.Message{
						ID:        ev.ID,
						ParentID:  ev.ParentID,
						Role:      "assistant",
						Content:   msgContent,
						Timestamp: ev.Timestamp,
					}
					if msgModel != "" {
						subMsg.Model = &msgModel
					}
					if len(toolCalls) > 0 {
						subMsg.ToolCalls = toolCalls
					}
					if outTok > 0 {
						f := false
						subMsg.Tokens = &types.Tokens{Input: 0, Output: outTok, Estimated: &f}
						subAgentOutputMap[ev.AgentID] += outTok
					}
					agent.Messages = append(agent.Messages, subMsg)
				}
			} else if hasPatchedTokens {
				pIn, pOut, pCR := getPatchedTokenUsage(ev.Data)
				isMainTurn := ev.Data.TurnID != nil && pIn >= 0
				msg := types.Message{
					ID:        ev.ID,
					ParentID:  ev.ParentID,
					Role:      "assistant",
					Content:   msgContent,
					Timestamp: ev.Timestamp,
				}
				if msgModel != "" {
					msg.Model = &msgModel
				}
				if len(toolCalls) > 0 {
					msg.ToolCalls = toolCalls
				}
				if isMainTurn {
					c := pricing.CalculateCost(pricing.TokenCounts{Input: pIn, Output: pOut, CacheRead: pCR}, model)
					f := false
					msg.Tokens = &types.Tokens{Input: pIn, Output: pOut, CacheRead: &pCR, Estimated: &f, Cost: &c}
					inputPerMsg = append(inputPerMsg, pIn)
					outputPerMsg = append(outputPerMsg, pOut)
					cumSum += pIn + pOut
					cumulativeTokens = append(cumulativeTokens, cumSum)
				}
				messages = append(messages, msg)
			} else {
				outTok := 0
				if ev.Data.OutputTokens != nil {
					outTok = *ev.Data.OutputTokens
				}
				msg := types.Message{
					ID:        ev.ID,
					ParentID:  ev.ParentID,
					Role:      "assistant",
					Content:   msgContent,
					Timestamp: ev.Timestamp,
				}
				if msgModel != "" {
					msg.Model = &msgModel
				}
				if len(toolCalls) > 0 {
					msg.ToolCalls = toolCalls
				}
				if outTok > 0 {
					f := false
					msg.Tokens = &types.Tokens{Input: 0, Output: outTok, Estimated: &f}
					inputPerMsg = append(inputPerMsg, 0)
					outputPerMsg = append(outputPerMsg, outTok)
					cumSum += outTok
					cumulativeTokens = append(cumulativeTokens, cumSum)
				}
				messages = append(messages, msg)
			}

		case "tool.execution_complete":
			result, hasResult := toolResultsById[ev.Data.ToolCallID]
			if !hasResult {
				continue
			}
			msg := types.Message{
				ID:         ev.ID,
				ParentID:   ev.ParentID,
				Role:       "tool",
				Content:    result.Content,
				Timestamp:  ev.Timestamp,
				ToolResult: &result,
			}
			if ev.AgentID != "" {
				if agent, ok := subAgentMap[ev.AgentID]; ok {
					if agent.Messages == nil {
						agent.Messages = []types.Message{}
					}
					agent.Messages = append(agent.Messages, msg)
				}
			} else {
				messages = append(messages, msg)
			}

		case "subagent.completed":
			refID := ev.AgentID
			if refID == "" {
				refID = ev.Data.ToolCallID
			}
			agent := subAgentMap[refID]
			agentLabel := refID
			if agent != nil {
				agentLabel = agent.AgentDisplayName
			}
			summary := fmt.Sprintf("Subagent %q completed", agentLabel)
			if ev.Data.TotalToolCalls != nil {
				summary += fmt.Sprintf(" · %d tool call(s)", *ev.Data.TotalToolCalls)
			}
			if ev.Data.DurationMs != nil {
				summary += fmt.Sprintf(" · %ds", *ev.Data.DurationMs/1000)
			}
			pIn, pOut, pCR := getPatchedTokenUsage(ev.Data)
			var completionTokens *types.Tokens
			if pIn >= 0 {
				c := pricing.CalculateCost(pricing.TokenCounts{Input: pIn, Output: pOut, CacheRead: pCR}, model)
				f := false
				completionTokens = &types.Tokens{Input: pIn, Output: pOut, CacheRead: &pCR, Estimated: &f, Cost: &c}
				if agent != nil && agent.TotalTokens == nil {
					t := pIn + pOut
					agent.TotalTokens = &t
				}
				inputPerMsg = append(inputPerMsg, pIn)
				outputPerMsg = append(outputPerMsg, pOut)
				cumSum += pIn + pOut
				cumulativeTokens = append(cumulativeTokens, cumSum)
			} else {
				outTokens := subAgentOutputMap[refID]
				if outTokens > 0 {
					f := false
					completionTokens = &types.Tokens{Input: 0, Output: outTokens, Estimated: &f}
					if agent != nil && agent.TotalTokens == nil {
						agent.TotalTokens = &outTokens
					}
				}
			}
			sysMsg := types.Message{
				ID:          ev.ID,
				ParentID:    ev.ParentID,
				Role:        "system",
				Content:     summary,
				Timestamp:   ev.Timestamp,
				SubAgentRef: &refID,
				Tokens:      completionTokens,
			}
			messages = append(messages, sysMsg)

		case "session.error":
			msg := fmt.Sprintf("Error: %s - %s", ev.Data.ErrorType, ev.Data.Message)
			messages = append(messages, types.Message{
				ID:        ev.ID,
				ParentID:  ev.ParentID,
				Role:      "system",
				Content:   msg,
				Timestamp: ev.Timestamp,
			})
		}
	}

	// Enrich subagent message logs with synthetic prompt/result entries
	for _, agent := range subAgentMap {
		if agent.Messages == nil {
			agent.Messages = []types.Message{}
		}
		if agent.Prompt != nil {
			agent.Messages = append([]types.Message{{
				ID:        agent.ID + "-prompt",
				ParentID:  nil,
				Role:      "user",
				Content:   *agent.Prompt,
				Timestamp: agent.StartTime,
			}}, agent.Messages...)
		}
		if agent.Result != nil {
			ts := agent.StartTime
			if agent.EndTime != nil {
				ts = *agent.EndTime
			}
			agent.Messages = append(agent.Messages, types.Message{
				ID:        agent.ID + "-result",
				ParentID:  nil,
				Role:      "system",
				Content:   *agent.Result,
				Timestamp: ts,
			})
		}
		if agent.TotalTokens == nil {
			outTok := subAgentOutputMap[agent.ID]
			if outTok > 0 {
				agent.TotalTokens = &outTok
			}
		}
	}

	// Build tool usage summaries
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

	userMsgs := 0
	assistantMsgs := 0
	for _, m := range messages {
		if m.Role == "user" {
			userMsgs++
		} else if m.Role == "assistant" {
			assistantMsgs++
		}
	}

	var duration int64
	if len(messages) >= 2 {
		t0, _ := time.Parse(time.RFC3339, messages[0].Timestamp)
		t1, _ := time.Parse(time.RFC3339, messages[len(messages)-1].Timestamp)
		duration = t1.Sub(t0).Milliseconds()
	}

	var tokenStats *types.TokenStats
	if shutdownData != nil {
		tc := exactTotalCost
		tokenStats = &types.TokenStats{
			TotalInput:         exactTotalInput,
			TotalOutput:        exactTotalOutput,
			TotalCacheRead:     exactTotalCacheRead,
			TotalCacheCreation: exactTotalCacheWrite,
			TotalCost:          &tc,
			InputPerMessage:    inputPerMsg,
			OutputPerMessage:   outputPerMsg,
			CumulativeTokens:   cumulativeTokens,
		}
	} else if len(outputPerMsg) > 0 {
		tokenStats = &types.TokenStats{
			TotalInput:       0,
			TotalOutput:      exactTotalOutput,
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
		Duration:          duration,
	}

	startTime := time.Now().UTC().Format(time.RFC3339)
	lastActivity := startTime
	if len(messages) > 0 {
		startTime = messages[0].Timestamp
		lastActivity = messages[len(messages)-1].Timestamp
	}

	totalTokens := exactTotalInput + exactTotalOutput
	var totalTok *int
	if totalTokens > 0 {
		totalTok = &totalTokens
	}
	var modelPtr *string
	if model != "" {
		modelPtr = &model
	}

	var subAgentSlice []types.SubAgent
	for _, a := range subAgentMap {
		subAgentSlice = append(subAgentSlice, *a)
	}
	var subAgentCount *int
	if len(subAgentSlice) > 0 {
		n := len(subAgentSlice)
		subAgentCount = &n
	}

	detail := &types.SessionDetail{
		SessionSummary: types.SessionSummary{
			ID:            sessionID,
			Source:        types.SourceCopilot,
			Project:       project,
			ProjectPath:   projectPath,
			StartTime:     startTime,
			LastActivity:  lastActivity,
			MessageCount:  len(messages),
			TotalTokens:   totalTok,
			Model:         modelPtr,
			SubAgentCount: subAgentCount,
			UsedModels:    usedModels,
		},
		Messages:  messages,
		Stats:     stats,
		ToolUsage: toolUsage,
	}
	if len(subAgentSlice) > 0 {
		detail.SubAgents = subAgentSlice
	}
	return detail
}

// ──────────────────────────────────────────────────────────
// Helper: read events from JSONL
// ──────────────────────────────────────────────────────────

func readCopilotEvents(filePath string) ([]copilotEvent, []string) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, nil
	}
	defer f.Close()

	var events []copilotEvent
	var rawLines []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 4*1024*1024), 4*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		rawLines = append(rawLines, line)
		var ev copilotEvent
		if err := json.Unmarshal([]byte(line), &ev); err == nil {
			events = append(events, ev)
		}
	}
	return events, rawLines
}

func findEvent(events []copilotEvent, typ string) *copilotEvent {
	for i, ev := range events {
		if ev.Type == typ {
			return &events[i]
		}
	}
	return nil
}

// getPatchedTokenUsage extracts exact token counts when they are present.
// Returns -1 for input when not available (estimation mode).
func getPatchedTokenUsage(d copilotEventData) (input, output, cacheRead int) {
	if d.InputTokens != nil && d.OutputTokensExact != nil {
		cr := 0
		if d.CacheReadTokens != nil {
			cr = *d.CacheReadTokens
		}
		return *d.InputTokens, *d.OutputTokensExact, cr
	}
	return -1, 0, 0
}
