package parsers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"agent-session-viewer/pricing"
	"agent-session-viewer/types"
)

// ──────────────────────────────────────────────────────────
// Raw entry types from Claude JSONL files
// ──────────────────────────────────────────────────────────

type claudeUsage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
}

type claudeContentBlock struct {
	Type      string                 `json:"type"` // text|tool_use|tool_result|thinking
	Text      string                 `json:"text,omitempty"`
	Thinking  string                 `json:"thinking,omitempty"`
	ID        string                 `json:"id,omitempty"`
	Name      string                 `json:"name,omitempty"`
	Input     map[string]interface{} `json:"input,omitempty"`
	Content   interface{}            `json:"content,omitempty"` // string or []block for tool_result
	ToolUseID string                 `json:"tool_use_id,omitempty"`
	IsError   bool                   `json:"is_error,omitempty"`
}

type claudeMessage struct {
	Role    string       `json:"role"`
	Content interface{}  `json:"content"` // string | []claudeContentBlock
	Model   string       `json:"model,omitempty"`
	Usage   *claudeUsage `json:"usage,omitempty"`
}

type claudeAttachment struct {
	Type      string `json:"type,omitempty"`
	ItemCount int    `json:"itemCount,omitempty"`
}

type claudeEntry struct {
	Type             string            `json:"type"`
	UUID             string            `json:"uuid,omitempty"`
	ParentUUID       *string           `json:"parentUuid,omitempty"`
	SessionID        string            `json:"sessionId,omitempty"`
	Timestamp        string            `json:"timestamp,omitempty"`
	CWD              string            `json:"cwd,omitempty"`
	IsSidechain      bool              `json:"isSidechain,omitempty"`
	AgentID          string            `json:"agentId,omitempty"`
	AttributionAgent string            `json:"attributionAgent,omitempty"`
	Message          *claudeMessage    `json:"message,omitempty"`
	Subtype          string            `json:"subtype,omitempty"`
	DurationMs       *int64            `json:"durationMs,omitempty"`
	MessageID        string            `json:"messageId,omitempty"` // file-history-snapshot
	Attachment       *claudeAttachment `json:"attachment,omitempty"`
}

// ──────────────────────────────────────────────────────────
// Parser
// ──────────────────────────────────────────────────────────

func ParseClaudeSessionFile(filePath string) *types.SessionDetail {
	entries := readClaudeEntries(filePath)
	if len(entries) == 0 {
		return nil
	}

	sessionID := ""
	for _, e := range entries {
		if e.SessionID != "" {
			sessionID = e.SessionID
			break
		}
	}
	if sessionID == "" {
		sessionID = strings.TrimSuffix(filepath.Base(filePath), ".jsonl")
	}

	projectPath := decodeProjectPath(filepath.Dir(filePath))
	project := filepath.Base(projectPath)

	messages := buildClaudeDisplayMessages(entries)
	stats, toolUsage, model, totalTokens := buildClaudeStats(messages, entries)

	// timestamps
	var ts []string
	for _, e := range entries {
		if e.Timestamp != "" {
			ts = append(ts, e.Timestamp)
		}
	}
	startTime := time.Now().UTC().Format(time.RFC3339)
	lastActivity := startTime
	if len(ts) > 0 {
		startTime = ts[0]
		lastActivity = ts[len(ts)-1]
	}

	// subagents
	subAgents := loadClaudeSubagents(filePath)
	var subAgentCount *int
	if len(subAgents) > 0 {
		n := len(subAgents)
		subAgentCount = &n
	}

	var totalTok *int
	if totalTokens > 0 {
		totalTok = &totalTokens
	}

	var modelPtr *string
	if model != "" {
		modelPtr = &model
	}

	detail := &types.SessionDetail{
		SessionSummary: types.SessionSummary{
			ID:            sessionID,
			Source:        types.SourceClaude,
			Project:       project,
			ProjectPath:   projectPath,
			StartTime:     startTime,
			LastActivity:  lastActivity,
			MessageCount:  len(messages),
			TotalTokens:   totalTok,
			Model:         modelPtr,
			SubAgentCount: subAgentCount,
		},
		Messages:  messages,
		Stats:     stats,
		ToolUsage: toolUsage,
	}
	if len(subAgents) > 0 {
		detail.SubAgents = subAgents
	}
	return detail
}

// ──────────────────────────────────────────────────────────
// JSONL reading
// ──────────────────────────────────────────────────────────

func readClaudeEntries(filePath string) []claudeEntry {
	f, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer f.Close()

	var entries []claudeEntry
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 4*1024*1024), 4*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var e claudeEntry
		if err := json.Unmarshal([]byte(line), &e); err == nil {
			entries = append(entries, e)
		}
	}
	return entries
}

// ──────────────────────────────────────────────────────────
// Content extraction helpers
// ──────────────────────────────────────────────────────────

func normaliseContentBlocks(content interface{}) []claudeContentBlock {
	if content == nil {
		return nil
	}
	switch v := content.(type) {
	case string:
		if v == "" {
			return nil
		}
		return []claudeContentBlock{{Type: "text", Text: v}}
	case []interface{}:
		var blocks []claudeContentBlock
		for _, item := range v {
			data, _ := json.Marshal(item)
			var b claudeContentBlock
			if json.Unmarshal(data, &b) == nil {
				blocks = append(blocks, b)
			}
		}
		return blocks
	}
	return nil
}

func extractVisibleText(blocks []claudeContentBlock) string {
	var parts []string
	for _, b := range blocks {
		if b.Type == "text" && b.Text != "" {
			parts = append(parts, b.Text)
		}
	}
	return strings.Join(parts, "\n\n")
}

func extractThinkingText(blocks []claudeContentBlock) string {
	var parts []string
	for _, b := range blocks {
		if b.Type == "thinking" && b.Thinking != "" {
			parts = append(parts, b.Thinking)
		}
	}
	return strings.Join(parts, "\n\n")
}

func extractDisplayText(content interface{}) string {
	blocks := normaliseContentBlocks(content)
	if t := extractVisibleText(blocks); t != "" {
		return t
	}
	if t := extractThinkingText(blocks); t != "" {
		return t
	}
	return ""
}

type orderedToolCall struct {
	call  types.ToolCall
	order int
	ts    string
}

type orderedToolResult struct {
	result types.ToolResult
	order  int
	ts     string
}

func extractToolCalls(blocks []claudeContentBlock) []types.ToolCall {
	var out []types.ToolCall
	for _, b := range blocks {
		if b.Type == "tool_use" && b.ID != "" {
			args := b.Input
			if args == nil {
				args = map[string]interface{}{}
			}
			out = append(out, types.ToolCall{ID: b.ID, Name: b.Name, Arguments: args})
		}
	}
	return out
}

func extractToolResults(blocks []claudeContentBlock) []types.ToolResult {
	var out []types.ToolResult
	for _, b := range blocks {
		if b.Type == "tool_result" && b.ToolUseID != "" {
			content := ""
			switch v := b.Content.(type) {
			case string:
				content = v
			case []interface{}:
				var parts []string
				for _, item := range v {
					if m, ok := item.(map[string]interface{}); ok {
						if t, ok2 := m["text"].(string); ok2 {
							parts = append(parts, t)
						}
					}
				}
				content = strings.Join(parts, "\n")
			}
			out = append(out, types.ToolResult{
				ToolCallID: b.ToolUseID,
				Success:    !b.IsError,
				Content:    content,
			})
		}
	}
	return out
}

// ──────────────────────────────────────────────────────────
// Entry classification helpers
// ──────────────────────────────────────────────────────────

func isToolResultEntry(e claudeEntry) bool {
	if e.Message == nil {
		return false
	}
	blocks := normaliseContentBlocks(e.Message.Content)
	for _, b := range blocks {
		if b.Type == "tool_result" {
			return true
		}
	}
	return false
}

func isLocalCommandEntry(e claudeEntry) bool {
	return e.Subtype == "local_command" ||
		(e.Message != nil && e.Message.Role == "user" &&
			e.Subtype == "turn_duration" == false &&
			isCommandContent(e.Message.Content))
}

func isCommandContent(content interface{}) bool {
	if s, ok := content.(string); ok {
		return strings.HasPrefix(strings.TrimSpace(s), "/")
	}
	return false
}

type commandInfo struct{ name, args string }

func getCommandInfo(e claudeEntry) *commandInfo {
	if e.Message == nil {
		return nil
	}
	s := ""
	if str, ok := e.Message.Content.(string); ok {
		s = strings.TrimSpace(str)
	}
	if !strings.HasPrefix(s, "/") {
		return nil
	}
	parts := strings.SplitN(s[1:], " ", 2)
	ci := &commandInfo{name: parts[0]}
	if len(parts) > 1 {
		ci.args = parts[1]
	}
	return ci
}

// ──────────────────────────────────────────────────────────
// Message building
// ──────────────────────────────────────────────────────────

type orderedMessage struct {
	types.Message
	order int
}

func buildClaudeDisplayMessages(entries []claudeEntry) []types.Message {
	// Filter to entries with UUID + timestamp
	var ordered []orderedEntry
	for i, e := range entries {
		if e.UUID != "" && e.Timestamp != "" {
			ordered = append(ordered, orderedEntry{e, i})
		}
	}
	if len(ordered) == 0 {
		return nil
	}

	entryByID := map[string]claudeEntry{}
	rawOrder := map[string]int{}
	for _, oe := range ordered {
		entryByID[oe.entry.UUID] = oe.entry
		rawOrder[oe.entry.UUID] = oe.idx
	}

	rootEntries := findRootEntries(entries, ordered, entryByID)
	rootIDs := map[string]bool{}
	for _, r := range rootEntries {
		rootIDs[r.UUID] = true
	}

	// Group each entry under its owning root
	groups := map[string][]claudeEntry{}
	for _, oe := range ordered {
		rootID := findOwningRootID(oe.entry, entryByID, rootIDs)
		if rootID == "" {
			continue
		}
		groups[rootID] = append(groups[rootID], oe.entry)
	}

	var msgs []orderedMessage
	for _, root := range rootEntries {
		group := groups[root.UUID]
		if root.Message == nil {
			continue
		}
		if isLocalCommandEntry(root) {
			msgs = append(msgs, buildLocalCommandMessages(root, group, rawOrder)...)
			continue
		}
		msgs = append(msgs, buildPromptMessages(root, group, rawOrder)...)
	}

	sort.Slice(msgs, func(i, j int) bool { return msgs[i].order < msgs[j].order })
	out := make([]types.Message, len(msgs))
	for i, m := range msgs {
		out[i] = m.Message
	}
	return out
}

type orderedEntry struct {
	entry claudeEntry
	idx   int
}

func findRootEntries(
	allEntries []claudeEntry,
	ordered []orderedEntry,
	_ map[string]claudeEntry,
) []claudeEntry {
	// Look for file-history-snapshot roots first
	snapshotRootIDs := map[string]bool{}
	for _, e := range allEntries {
		if e.Type == "file-history-snapshot" && e.MessageID != "" {
			snapshotRootIDs[e.MessageID] = true
		}
	}
	if len(snapshotRootIDs) > 0 {
		var roots []claudeEntry
		for _, oe := range ordered {
			e := oe.entry
			if snapshotRootIDs[e.UUID] && e.Message != nil && e.Message.Role == "user" {
				roots = append(roots, e)
			}
		}
		if len(roots) > 0 {
			return roots
		}
	}

	// Fall back to entries with no parent, user role, not a tool result
	uuidSet := map[string]bool{}
	for _, oe := range ordered {
		uuidSet[oe.entry.UUID] = true
	}
	var roots []claudeEntry
	for _, oe := range ordered {
		e := oe.entry
		if e.Message == nil || e.Message.Role != "user" {
			continue
		}
		if isToolResultEntry(e) {
			continue
		}
		parentExists := false
		if e.ParentUUID != nil && *e.ParentUUID != "" {
			parentExists = uuidSet[*e.ParentUUID]
		}
		if !parentExists {
			roots = append(roots, e)
		}
	}
	return roots
}

func findOwningRootID(e claudeEntry, byID map[string]claudeEntry, rootIDs map[string]bool) string {
	visited := map[string]bool{}
	cur := e
	for {
		if rootIDs[cur.UUID] {
			return cur.UUID
		}
		if visited[cur.UUID] {
			return ""
		}
		visited[cur.UUID] = true
		if cur.ParentUUID == nil || *cur.ParentUUID == "" {
			return ""
		}
		parent, ok := byID[*cur.ParentUUID]
		if !ok {
			return ""
		}
		cur = parent
	}
}

func buildPromptMessages(
	root claudeEntry,
	group []claudeEntry,
	rawOrder map[string]int,
) []orderedMessage {
	rootOrder := rawOrder[root.UUID] * 100

	userContent := extractDisplayText(root.Message.Content)
	userMsg := orderedMessage{
		order: rootOrder,
		Message: types.Message{
			ID:        root.UUID,
			ParentID:  nil,
			Role:      "user",
			Content:   userContent,
			Timestamp: root.Timestamp,
		},
	}

	// Collect assistant entries
	var assistantEntries []claudeEntry
	for _, e := range group {
		if e.UUID != root.UUID && e.Type == "assistant" && e.Message != nil && e.Message.Role == "assistant" {
			assistantEntries = append(assistantEntries, e)
		}
	}
	if len(assistantEntries) == 0 {
		return []orderedMessage{userMsg}
	}

	first := assistantEntries[0]
	assistantID := root.UUID + "::assistant"

	var visibleSegs, thinkingSegs []string
	var orderedCalls []orderedToolCall
	orderedResults := collectOrderedToolResults(group, rawOrder)

	var totalInput, totalOutput, totalCacheRead, totalCacheCreation int
	var totalCost float64
	var model string
	hasTokens := false

	for _, e := range assistantEntries {
		blocks := normaliseContentBlocks(e.Message.Content)
		if t := extractVisibleText(blocks); t != "" && !contains(visibleSegs, t) {
			visibleSegs = append(visibleSegs, t)
		}
		if t := extractThinkingText(blocks); t != "" && !contains(thinkingSegs, t) {
			thinkingSegs = append(thinkingSegs, t)
		}
		if e.Message.Model != "" && e.Message.Model != "<synthetic>" && model == "" {
			model = e.Message.Model
		}
		if u := e.Message.Usage; u != nil {
			hasTokens = true
			totalInput += u.InputTokens
			totalOutput += u.OutputTokens
			totalCacheRead = int(math.Max(float64(totalCacheRead), float64(u.CacheReadInputTokens)))
			totalCacheCreation += u.CacheCreationInputTokens
			totalCost += pricing.CalculateCost(pricing.TokenCounts{
				Input:         u.InputTokens,
				Output:        u.OutputTokens,
				CacheRead:     u.CacheReadInputTokens,
				CacheCreation: u.CacheCreationInputTokens,
			}, pickModel(e.Message.Model, model))
		}
		entryOrder := rawOrder[e.UUID] * 100
		for idx, tc := range extractToolCalls(blocks) {
			orderedCalls = append(orderedCalls, orderedToolCall{tc, entryOrder + idx + 1, e.Timestamp})
		}
	}

	assistantContent := strings.Join(visibleSegs, "\n\n")
	if assistantContent == "" {
		assistantContent = strings.Join(thinkingSegs, "\n\n")
	}
	if assistantContent == "" && len(orderedCalls) > 0 {
		assistantContent = pluralise("Performed %d tool call", len(orderedCalls))
	}

	assistantMsg := orderedMessage{
		order: rawOrder[first.UUID] * 100,
		Message: types.Message{
			ID:        assistantID,
			ParentID:  strPtr(root.UUID),
			Role:      "assistant",
			Content:   assistantContent,
			Timestamp: first.Timestamp,
		},
	}
	if model != "" {
		assistantMsg.Model = &model
	}
	if hasTokens {
		cost := totalCost
		cacheRead := totalCacheRead
		cacheCreation := totalCacheCreation
		assistantMsg.Tokens = &types.Tokens{
			Input:         totalInput,
			Output:        totalOutput,
			CacheRead:     &cacheRead,
			CacheCreation: &cacheCreation,
			Cost:          &cost,
		}
	}

	toolMsgs := buildToolMessages(assistantID, orderedCalls, orderedResults)
	return append([]orderedMessage{userMsg, assistantMsg}, toolMsgs...)
}

func collectOrderedToolResults(group []claudeEntry, rawOrder map[string]int) map[string]orderedToolResult {
	m := map[string]orderedToolResult{}
	for _, e := range group {
		if e.Message == nil || !isToolResultEntry(e) {
			continue
		}
		order := rawOrder[e.UUID] * 100
		for idx, r := range extractToolResults(normaliseContentBlocks(e.Message.Content)) {
			if _, exists := m[r.ToolCallID]; !exists {
				m[r.ToolCallID] = orderedToolResult{r, order + idx + 1, e.Timestamp}
			}
		}
	}
	return m
}

func buildToolMessages(assistantID string, calls []orderedToolCall, results map[string]orderedToolResult) []orderedMessage {
	usedResults := map[string]bool{}
	var msgs []orderedMessage
	for _, oc := range calls {
		r, hasResult := results[oc.call.ID]
		if hasResult {
			usedResults[oc.call.ID] = true
		}
		call := oc.call
		ts := oc.ts
		if hasResult {
			ts = r.ts
			rc := r.result.Content
			call.Result = &rc
		}
		tr := (*types.ToolResult)(nil)
		if hasResult {
			tr = &r.result
		}
		msgs = append(msgs, orderedMessage{
			order: oc.order,
			Message: types.Message{
				ID:         assistantID + "::tool::" + oc.call.ID,
				ParentID:   strPtr(assistantID),
				Role:       "tool",
				Content:    "",
				Timestamp:  ts,
				ToolCalls:  []types.ToolCall{call},
				ToolResult: tr,
			},
		})
	}
	for id, r := range results {
		if usedResults[id] {
			continue
		}
		msgs = append(msgs, orderedMessage{
			order: r.order,
			Message: types.Message{
				ID:         assistantID + "::tool-result::" + id,
				ParentID:   strPtr(assistantID),
				Role:       "tool",
				Content:    "",
				Timestamp:  r.ts,
				ToolResult: &r.result,
			},
		})
	}
	return msgs
}

func buildLocalCommandMessages(root claudeEntry, group []claudeEntry, rawOrder map[string]int) []orderedMessage {
	var starts []claudeEntry
	starts = append(starts, root)
	for _, e := range group {
		if e.UUID != root.UUID && isLocalCommandEntry(e) {
			starts = append(starts, e)
		}
	}

	var msgs []orderedMessage
	for i, start := range starts {
		ci := getCommandInfo(start)
		if ci == nil {
			continue
		}
		nextOrder := math.MaxInt32
		if i+1 < len(starts) {
			nextOrder = rawOrder[starts[i+1].UUID]
		}
		startOrd := rawOrder[start.UUID]
		var outputs []string
		for _, e := range group {
			ord := rawOrder[e.UUID]
			if ord > startOrd && ord < nextOrder {
				if e.Message != nil {
					if t := extractDisplayText(e.Message.Content); t != "" {
						outputs = append(outputs, t)
					}
				}
			}
		}
		line := "/" + ci.name
		if ci.args != "" {
			line += " " + ci.args
		}
		parts := []string{line}
		parts = append(parts, outputs...)
		parentID := (*string)(nil)
		if start.UUID != root.UUID {
			parentID = strPtr(root.UUID)
		}
		msgs = append(msgs, orderedMessage{
			order: startOrd * 100,
			Message: types.Message{
				ID:        start.UUID,
				ParentID:  parentID,
				Role:      "system",
				Content:   strings.Join(parts, "\n\n"),
				Timestamp: start.Timestamp,
			},
		})
	}
	return msgs
}

// ──────────────────────────────────────────────────────────
// Stats
// ──────────────────────────────────────────────────────────

func buildClaudeStats(messages []types.Message, _ []claudeEntry) (types.SessionStats, []types.ToolUsageSummary, string, int) {
	var totalInput, totalOutput, totalCacheRead, totalCacheCreation int
	var totalCost float64
	var inputPerMsg, outputPerMsg, cumulativeTokens []int
	var cumTotal int
	var model string
	toolUsageMap := map[string]struct{ count, successes int }{}

	for _, m := range messages {
		if m.Model != nil && *m.Model != "<synthetic>" && model == "" {
			model = *m.Model
		}
		if m.Tokens != nil {
			totalInput += m.Tokens.Input
			totalOutput += m.Tokens.Output
			if m.Tokens.CacheRead != nil {
				totalCacheRead += *m.Tokens.CacheRead
			}
			if m.Tokens.CacheCreation != nil {
				totalCacheCreation += *m.Tokens.CacheCreation
			}
			if m.Tokens.Cost != nil {
				totalCost += *m.Tokens.Cost
			}
			if m.Role == "assistant" {
				inputPerMsg = append(inputPerMsg, m.Tokens.Input)
				outputPerMsg = append(outputPerMsg, m.Tokens.Output)
				cumTotal += m.Tokens.Input + m.Tokens.Output
				cumulativeTokens = append(cumulativeTokens, cumTotal)
			}
		}
		if m.Role == "tool" && len(m.ToolCalls) > 0 {
			for _, tc := range m.ToolCalls {
				u := toolUsageMap[tc.Name]
				u.count++
				if m.ToolResult == nil || m.ToolResult.Success {
					u.successes++
				}
				toolUsageMap[tc.Name] = u
			}
		}
	}

	var duration int64
	if len(messages) >= 2 {
		t0, _ := time.Parse(time.RFC3339, messages[0].Timestamp)
		t1, _ := time.Parse(time.RFC3339, messages[len(messages)-1].Timestamp)
		duration = t1.Sub(t0).Milliseconds()
	}

	userMsgs := 0
	assistantMsgs := 0
	for _, m := range messages {
		if m.Role == "user" {
			userMsgs++
		} else if m.Role == "assistant" {
			assistantMsgs++
		}
	}

	var toolStats []types.ToolStat
	var toolUsage []types.ToolUsageSummary
	for name, u := range toolUsageMap {
		sr := 0.0
		if u.count > 0 {
			sr = float64(u.successes) / float64(u.count)
		}
		toolStats = append(toolStats, types.ToolStat{Name: name, Count: u.count, SuccessRate: sr})
		toolUsage = append(toolUsage, types.ToolUsageSummary{Name: name, Count: u.count, SuccessRate: sr})
	}
	sort.Slice(toolStats, func(i, j int) bool { return toolStats[i].Count > toolStats[j].Count })
	sort.Slice(toolUsage, func(i, j int) bool { return toolUsage[i].Count > toolUsage[j].Count })

	var tokenStats *types.TokenStats
	if len(inputPerMsg) > 0 {
		tc := totalCost
		tokenStats = &types.TokenStats{
			TotalInput:         totalInput,
			TotalOutput:        totalOutput,
			TotalCacheRead:     totalCacheRead,
			TotalCacheCreation: totalCacheCreation,
			TotalCost:          &tc,
			InputPerMessage:    inputPerMsg,
			OutputPerMessage:   outputPerMsg,
			CumulativeTokens:   cumulativeTokens,
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

	totalTok := totalInput + totalOutput
	return stats, toolUsage, model, totalTok
}

// ──────────────────────────────────────────────────────────
// Subagents
// ──────────────────────────────────────────────────────────

func loadClaudeSubagents(sessionFilePath string) []types.SubAgent {
	// subagents live in: <dir>/<sessionID>/subagents/agent-*.jsonl
	sessionID := strings.TrimSuffix(filepath.Base(sessionFilePath), ".jsonl")
	subagentsDir := filepath.Join(filepath.Dir(sessionFilePath), sessionID, "subagents")

	entries, err := os.ReadDir(subagentsDir)
	if err != nil {
		return nil
	}

	var agents []types.SubAgent
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "agent-") || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		agentFilePath := filepath.Join(subagentsDir, entry.Name())
		detail := ParseClaudeSessionFile(agentFilePath)
		if detail == nil {
			continue
		}

		// Extract agentId from first sidechain entry
		rawEntries := readClaudeEntries(agentFilePath)
		agentID := ""
		agentType := ""
		for _, e := range rawEntries {
			if e.AgentID != "" && agentID == "" {
				agentID = e.AgentID
			}
			if e.AttributionAgent != "" && agentType == "" {
				agentType = e.AttributionAgent
			}
		}
		if agentID == "" {
			agentID = strings.TrimSuffix(strings.TrimPrefix(entry.Name(), "agent-"), ".jsonl")
		}

		prompt := (*string)(nil)
		result := (*string)(nil)
		if len(detail.Messages) > 0 {
			for _, m := range detail.Messages {
				if m.Role == "user" && prompt == nil {
					c := m.Content
					prompt = &c
				}
				if m.Role == "assistant" {
					c := m.Content
					result = &c
				}
			}
		}

		var totalTok *int
		if detail.TotalTokens != nil {
			totalTok = detail.TotalTokens
		}

		displayName := agentType
		if displayName == "" {
			displayName = agentID
		}

		agents = append(agents, types.SubAgent{
			ID:               agentID,
			AgentID:          agentID,
			AgentType:        agentType,
			AgentDisplayName: titleCase(displayName),
			Prompt:           prompt,
			Status:           "completed",
			Result:           result,
			Model:            detail.Model,
			TotalTokens:      totalTok,
			StartTime:        detail.StartTime,
			EndTime:          &detail.LastActivity,
			Messages:         detail.Messages,
		})
	}
	return agents
}

// ──────────────────────────────────────────────────────────
// Path decoding helpers
// ──────────────────────────────────────────────────────────

// decodeProjectPath converts the Claude encoded project path (URL-encoded directory separator)
// back to the real filesystem path.
func decodeProjectPath(encodedDir string) string {
	base := filepath.Base(encodedDir)
	// Claude encodes paths with `-` replacing `/` (and `-` is itself encoded as `--`)
	// Pattern: leading `-` is removed, remaining `-` → `/`, `--` → `-`
	if !strings.HasPrefix(base, "-") {
		return base
	}
	// Strip leading `-`
	s := base[1:]
	// `--` encodes a literal `-`, single `-` encodes `/`
	// We do a two-pass substitution via a placeholder
	const placeholder = "\x00"
	s = strings.ReplaceAll(s, "--", placeholder)
	s = strings.ReplaceAll(s, "-", "/")
	s = strings.ReplaceAll(s, placeholder, "-")
	return "/" + s
}

// ──────────────────────────────────────────────────────────
// Small utilities
// ──────────────────────────────────────────────────────────

func strPtr(s string) *string { return &s }

func pickModel(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func contains(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}

func pluralise(format string, n int) string {
	s := "s"
	if n == 1 {
		s = ""
	}
	return strings.Replace(format+s, "%d", itoa(n), 1)
}

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}

func titleCase(s string) string {
	if s == "" {
		return s
	}
	words := strings.Fields(strings.ReplaceAll(s, "-", " "))
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}
