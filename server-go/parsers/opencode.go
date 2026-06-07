package parsers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"agent-session-viewer/pricing"
	"agent-session-viewer/types"
)

const dbPrefix = "db::"

// IsDBPath returns true when filePath is a DB-backed sentinel ("db::<sessionId>").
func IsDBPath(filePath string) bool {
	return strings.HasPrefix(filePath, dbPrefix)
}

// ──────────────────────────────────────────────────────────
// DB row types
// ──────────────────────────────────────────────────────────

type dbSessionRow struct {
	ID          string
	ProjectID   string
	Title       sql.NullString
	Directory   sql.NullString
	TimeCreated int64
	TimeUpdated int64
	Model       sql.NullString
	Agent       sql.NullString
	ParentID    sql.NullString
}

type dbMessageRow struct {
	ID          string
	SessionID   string
	TimeCreated int64
	Data        string
}

type dbPartRow struct {
	ID          string
	MessageID   string
	TimeCreated int64
	Data        string
}

// ──────────────────────────────────────────────────────────
// JSON schemas inside DB data columns
// ──────────────────────────────────────────────────────────

type ocMsgData struct {
	Role string `json:"role"`
	Time struct {
		Created   int64  `json:"created"`
		Completed *int64 `json:"completed,omitempty"`
	} `json:"time"`
	ModelID    string `json:"modelID,omitempty"`
	ProviderID string `json:"providerID,omitempty"`
	ParentID   string `json:"parentID,omitempty"`
	Tokens     *struct {
		Total  int `json:"total"`
		Input  int `json:"input"`
		Output int `json:"output"`
		Cache  struct {
			Read  int `json:"read"`
			Write int `json:"write"`
		} `json:"cache"`
	} `json:"tokens,omitempty"`
	Cost *float64 `json:"cost,omitempty"`
}

type ocPartData struct {
	Type   string `json:"type"`
	Text   string `json:"text,omitempty"`
	Tool   string `json:"tool,omitempty"`
	CallID string `json:"callID,omitempty"`
	State  *struct {
		Status string      `json:"status"`
		Input  interface{} `json:"input,omitempty"`
		Output string      `json:"output,omitempty"`
		Title  string      `json:"title,omitempty"`
	} `json:"state,omitempty"`
	Reason string `json:"reason,omitempty"`
	Tokens *struct {
		Input  int `json:"input"`
		Output int `json:"output"`
		Cache  struct {
			Read  int `json:"read"`
			Write int `json:"write"`
		} `json:"cache"`
	} `json:"tokens,omitempty"`
}

// ──────────────────────────────────────────────────────────
// OpenCode parser entry point
// ──────────────────────────────────────────────────────────

func ParseOpenCodeSessionFile(filePath string) *types.SessionDetail {
	if IsDBPath(filePath) {
		sessionID := strings.TrimPrefix(filePath, dbPrefix)
		return parseOpenCodeDBSession(sessionID)
	}
	return parseOpenCodeFileSession(filePath)
}

// ──────────────────────────────────────────────────────────
// DB mode
// ──────────────────────────────────────────────────────────

func openDB() (*sql.DB, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dbPath := filepath.Join(home, ".local", "share", "opencode", "opencode.db")
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("opencode.db not found: %w", err)
	}
	return sql.Open("sqlite", "file:"+dbPath+"?mode=ro&_journal=WAL")
}

// ListOpenCodeDBSessionIDs returns root (non-child) session IDs from the DB.
func ListOpenCodeDBSessionIDs() []string {
	db, err := openDB()
	if err != nil {
		return nil
	}
	defer db.Close()

	rows, err := db.Query(`SELECT id FROM session WHERE parent_id IS NULL OR parent_id = '' ORDER BY time_created DESC`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

func parseOpenCodeDBSession(sessionID string) *types.SessionDetail {
	db, err := openDB()
	if err != nil {
		return nil
	}
	defer db.Close()

	session, err := queryDBSession(db, sessionID)
	if err != nil {
		return nil
	}

	defaultModel := parseModelString(session.Model)
	mainMessages := buildDBMessages(db, sessionID, defaultModel)

	// Load child sessions (subagents)
	childRows, err := queryChildSessions(db, sessionID)
	if err != nil || len(childRows) == 0 {
		return buildDetailFromDB(session, mainMessages, nil, nil)
	}

	var subAgents []types.SubAgent
	var syntheticMessages []types.Message

	for _, child := range childRows {
		childModel := parseModelString(child.Model)
		childMsgs := buildDBMessages(db, child.ID, childModel)

		var childInput, childOutput, childCacheRead, childCacheCreation int
		var childToolCalls int
		var childEndTime string

		for _, m := range childMsgs {
			if m.Role == "assistant" && m.Tokens != nil {
				childInput += m.Tokens.Input
				childOutput += m.Tokens.Output
				if m.Tokens.CacheRead != nil {
					childCacheRead += *m.Tokens.CacheRead
				}
				if m.Tokens.CacheCreation != nil {
					childCacheCreation += *m.Tokens.CacheCreation
				}
			}
			if len(m.ToolCalls) > 0 {
				childToolCalls += len(m.ToolCalls)
			}
			if m.Timestamp > childEndTime {
				childEndTime = m.Timestamp
			}
		}

		childCost := pricing.CalculateCost(pricing.TokenCounts{
			Input:         childInput,
			Output:        childOutput,
			CacheRead:     childCacheRead,
			CacheCreation: childCacheCreation,
		}, stringOrEmpty(childModel))

		childStartTime := msToISO(child.TimeCreated)
		childDuration := int64(0)
		if childEndTime != "" {
			t0 := time.UnixMilli(child.TimeCreated)
			t1, err := time.Parse(time.RFC3339, childEndTime)
			if err == nil {
				childDuration = t1.Sub(t0).Milliseconds()
			}
		}

		var promptStr *string
		var resultStr *string
		for _, m := range childMsgs {
			if m.Role == "user" && promptStr == nil {
				c := m.Content
				promptStr = &c
			}
			if m.Role == "assistant" {
				c := m.Content
				resultStr = &c
			}
		}

		title := child.Title.String
		agent := child.Agent.String
		displayName := title
		if displayName == "" {
			displayName = agent
		}
		if displayName == "" {
			displayName = "SubAgent"
		}

		effectiveIn := childInput + childCacheCreation
		totalTok := childInput + childOutput + childCacheCreation
		tc := childToolCalls

		subAgents = append(subAgents, types.SubAgent{
			ID:               child.ID,
			AgentID:          child.ID,
			AgentType:        agent,
			AgentDisplayName: displayName,
			Prompt:           promptStr,
			Status:           "completed",
			Result:           resultStr,
			Model:            childModel,
			TotalTokens:      &totalTok,
			TotalToolCalls:   &tc,
			DurationMs:       &childDuration,
			StartTime:        childStartTime,
			EndTime:          ptrStr(childEndTime),
			Messages:         childMsgs,
		})

		label := fmt.Sprintf("[%s] %s", agent, title)
		if label == "[] " {
			label = "Subagent task"
		}
		detail := fmt.Sprintf("in=%s out=%s tokens, cost=$%.4f",
			commaInt(effectiveIn), commaInt(childOutput), childCost)

		syntheticMessages = append(syntheticMessages, types.Message{
			ID:          fmt.Sprintf("subagent-summary-%s", child.ID),
			ParentID:    nil,
			Role:        "system",
			Content:     label + " — " + detail,
			Timestamp:   childStartTime,
			SubAgentRef: &child.ID,
			Tokens: &types.Tokens{
				Input:         childInput,
				Output:        childOutput,
				CacheRead:     ptrInt(childCacheRead),
				CacheCreation: ptrInt(childCacheCreation),
				Cost:          &childCost,
			},
		})
	}

	allMessages := append(mainMessages, syntheticMessages...)
	sort.Slice(allMessages, func(i, j int) bool {
		return allMessages[i].Timestamp < allMessages[j].Timestamp
	})

	return buildDetailFromDB(session, allMessages, subAgents, nil)
}

func queryDBSession(db *sql.DB, sessionID string) (dbSessionRow, error) {
	row := db.QueryRow(`SELECT id, COALESCE(project_id,''), title, directory, time_created, COALESCE(time_updated,0), model, agent, parent_id FROM session WHERE id = ?`, sessionID)
	var s dbSessionRow
	err := row.Scan(&s.ID, &s.ProjectID, &s.Title, &s.Directory, &s.TimeCreated, &s.TimeUpdated, &s.Model, &s.Agent, &s.ParentID)
	return s, err
}

func queryChildSessions(db *sql.DB, parentID string) ([]dbSessionRow, error) {
	rows, err := db.Query(`SELECT id, COALESCE(project_id,''), title, directory, time_created, COALESCE(time_updated,0), model, agent, parent_id FROM session WHERE parent_id = ? ORDER BY time_created`, parentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []dbSessionRow
	for rows.Next() {
		var s dbSessionRow
		if rows.Scan(&s.ID, &s.ProjectID, &s.Title, &s.Directory, &s.TimeCreated, &s.TimeUpdated, &s.Model, &s.Agent, &s.ParentID) == nil {
			out = append(out, s)
		}
	}
	return out, nil
}

func buildDBMessages(db *sql.DB, sessionID string, defaultModel *string) []types.Message {
	rows, err := db.Query(`SELECT id, session_id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created`, sessionID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var messages []types.Message
	for rows.Next() {
		var row dbMessageRow
		if rows.Scan(&row.ID, &row.SessionID, &row.TimeCreated, &row.Data) != nil {
			continue
		}
		var msgData ocMsgData
		if json.Unmarshal([]byte(row.Data), &msgData) != nil {
			continue
		}

		parts := loadDBParts(db, row.ID)

		var textParts []string
		var toolCalls []types.ToolCall
		for _, p := range parts {
			if p.Type == "text" && p.Text != "" {
				textParts = append(textParts, p.Text)
			} else if p.Type == "tool" && p.Tool != "" {
				args := map[string]interface{}{}
				if p.State != nil && p.State.Input != nil {
					if m, ok := p.State.Input.(map[string]interface{}); ok {
						args = m
					}
				}
				callID := p.CallID
				if callID == "" {
					callID = row.ID + "-tool"
				}
				toolCalls = append(toolCalls, types.ToolCall{ID: callID, Name: p.Tool, Arguments: args})
			}
		}

		// Prefer step-finish tokens for per-message breakdown
		var stepTokens *ocPartData
		for _, p := range parts {
			if p.Type == "step-finish" && p.Tokens != nil {
				stepTokens = &p
				break
			}
		}

		ts := msToISO(msgData.Time.Created)
		if ts == "" {
			ts = msToISO(row.TimeCreated)
		}
		parentIDVal := msgData.ParentID
		var parentIDPtr *string
		if parentIDVal != "" {
			parentIDPtr = &parentIDVal
		}

		if msgData.Role == "assistant" {
			var tok *types.Tokens
			modelID := msgData.ModelID
			if modelID == "" && defaultModel != nil {
				modelID = *defaultModel
			}

			var rawInput, rawOutput, rawCacheRead, rawCacheWrite int
			if stepTokens != nil && stepTokens.Tokens != nil {
				rawInput = stepTokens.Tokens.Input
				rawOutput = stepTokens.Tokens.Output
				rawCacheRead = stepTokens.Tokens.Cache.Read
				rawCacheWrite = stepTokens.Tokens.Cache.Write
			} else if msgData.Tokens != nil {
				rawInput = msgData.Tokens.Input
				rawOutput = msgData.Tokens.Output
				rawCacheRead = msgData.Tokens.Cache.Read
				rawCacheWrite = msgData.Tokens.Cache.Write
			}

			if rawInput+rawOutput > 0 {
				// For GPT-style models (cacheWrite=0), merge cache-write into input
				p := pricing.GetPricing(modelID)
				isGPT := p != nil && p.CacheWrite == 0
				input := rawInput
				cacheCreation := rawCacheWrite
				if isGPT {
					input = rawInput + rawCacheWrite
					cacheCreation = 0
				}
				c := pricing.CalculateCost(pricing.TokenCounts{
					Input:         input,
					Output:        rawOutput,
					CacheRead:     rawCacheRead,
					CacheCreation: cacheCreation,
				}, modelID)
				tok = &types.Tokens{
					Input:         input,
					Output:        rawOutput,
					CacheRead:     ptrInt(rawCacheRead),
					CacheCreation: ptrInt(cacheCreation),
					Cost:          &c,
				}
			}

			m := types.Message{
				ID:        row.ID,
				ParentID:  parentIDPtr,
				Role:      "assistant",
				Content:   strings.Join(textParts, "\n"),
				Timestamp: ts,
				Tokens:    tok,
			}
			if modelID != "" {
				m.Model = &modelID
			}
			if len(toolCalls) > 0 {
				m.ToolCalls = toolCalls
			}
			messages = append(messages, m)
		} else {
			messages = append(messages, types.Message{
				ID:        row.ID,
				ParentID:  parentIDPtr,
				Role:      "user",
				Content:   strings.Join(textParts, "\n"),
				Timestamp: ts,
			})
		}
	}
	return messages
}

func loadDBParts(db *sql.DB, messageID string) []ocPartData {
	rows, err := db.Query(`SELECT id, message_id, time_created, data FROM part WHERE message_id = ? ORDER BY time_created`, messageID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var parts []ocPartData
	for rows.Next() {
		var row dbPartRow
		if rows.Scan(&row.ID, &row.MessageID, &row.TimeCreated, &row.Data) != nil {
			continue
		}
		var p ocPartData
		if json.Unmarshal([]byte(row.Data), &p) == nil {
			parts = append(parts, p)
		}
	}
	return parts
}

func buildDetailFromDB(session dbSessionRow, messages []types.Message, subAgents []types.SubAgent, _ interface{}) *types.SessionDetail {
	if len(messages) == 0 {
		return nil
	}

	toolUsageMap := map[string]struct{ count int }{}
	inputPerMsg := []int{}
	outputPerMsg := []int{}
	cumulativeTokens := []int{}
	var totalInput, totalOutput, totalCacheRead, totalCacheCreation int
	var totalCost float64
	cumTotal := 0
	var model string

	for _, m := range messages {
		if m.Role == "assistant" {
			if m.Model != nil && model == "" {
				model = *m.Model
			}
			for _, tc := range m.ToolCalls {
				u := toolUsageMap[tc.Name]
				u.count++
				toolUsageMap[tc.Name] = u
			}
			if m.Tokens != nil {
				effectiveInput := m.Tokens.Input
				if m.Tokens.CacheCreation != nil {
					effectiveInput += *m.Tokens.CacheCreation
				}
				totalInput += effectiveInput
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
				inputPerMsg = append(inputPerMsg, effectiveInput)
				outputPerMsg = append(outputPerMsg, m.Tokens.Output)
				cumTotal += effectiveInput + m.Tokens.Output
				cumulativeTokens = append(cumulativeTokens, cumTotal)
			}
		} else if m.Role == "system" && m.SubAgentRef != nil && m.Tokens != nil {
			effectiveInput := m.Tokens.Input
			if m.Tokens.CacheCreation != nil {
				effectiveInput += *m.Tokens.CacheCreation
			}
			totalInput += effectiveInput
			totalOutput += m.Tokens.Output
			if m.Tokens.Cost != nil {
				totalCost += *m.Tokens.Cost
			}
			inputPerMsg = append(inputPerMsg, effectiveInput)
			outputPerMsg = append(outputPerMsg, m.Tokens.Output)
			cumTotal += effectiveInput + m.Tokens.Output
			cumulativeTokens = append(cumulativeTokens, cumTotal)
		}
	}

	var duration int64
	if len(messages) >= 2 {
		t0, _ := time.Parse(time.RFC3339, messages[0].Timestamp)
		t1, _ := time.Parse(time.RFC3339, messages[len(messages)-1].Timestamp)
		duration = t1.Sub(t0).Milliseconds()
	}

	userMsgs, assistantMsgs := 0, 0
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
		toolStats = append(toolStats, types.ToolStat{Name: name, Count: u.count, SuccessRate: 1})
		toolUsage = append(toolUsage, types.ToolUsageSummary{Name: name, Count: u.count, SuccessRate: 1})
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

	startTime := messages[0].Timestamp
	lastActivity := messages[len(messages)-1].Timestamp
	totalTok := totalInput + totalOutput
	var totalTokPtr *int
	if totalTok > 0 {
		totalTokPtr = &totalTok
	}
	var modelPtr *string
	if model != "" {
		modelPtr = &model
	}
	dir := session.Directory.String
	proj := filepath.Base(dir)
	if proj == "" || proj == "." {
		proj = session.ProjectID
	}

	var subAgentCount *int
	if len(subAgents) > 0 {
		n := len(subAgents)
		subAgentCount = &n
	}

	detail := &types.SessionDetail{
		SessionSummary: types.SessionSummary{
			ID:            session.ID,
			Source:        types.SourceOpenCode,
			Project:       proj,
			ProjectPath:   dir,
			StartTime:     startTime,
			LastActivity:  lastActivity,
			MessageCount:  len(messages),
			TotalTokens:   totalTokPtr,
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
// File mode (legacy JSON storage)
// ──────────────────────────────────────────────────────────

type ocFileSession struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectID"`
	Directory string `json:"directory"`
	ParentID  string `json:"parentID,omitempty"`
	Title     string `json:"title,omitempty"`
	Agent     string `json:"agent,omitempty"`
	Time      struct {
		Created int64 `json:"created"`
		Updated int64 `json:"updated"`
	} `json:"time"`
}

type ocFileMessage struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionID"`
	Role      string `json:"role"`
	ModelID   string `json:"modelID,omitempty"`
	ParentID  string `json:"parentID,omitempty"`
	Time      struct {
		Created   int64  `json:"created"`
		Completed *int64 `json:"completed,omitempty"`
	} `json:"time"`
	Tokens *struct {
		Input  int `json:"input"`
		Output int `json:"output"`
		Cache  struct {
			Read  int `json:"read"`
			Write int `json:"write"`
		} `json:"cache"`
	} `json:"tokens,omitempty"`
}

type ocFilePart struct {
	ID        string `json:"id"`
	MessageID string `json:"messageID"`
	Type      string `json:"type"`
	Text      string `json:"text,omitempty"`
	Tool      string `json:"tool,omitempty"`
	CallID    string `json:"callID,omitempty"`
	State     *struct {
		Status string      `json:"status"`
		Input  interface{} `json:"input,omitempty"`
		Output string      `json:"output,omitempty"`
	} `json:"state,omitempty"`
	Tokens *struct {
		Input  int `json:"input"`
		Output int `json:"output"`
		Cache  struct {
			Read  int `json:"read"`
			Write int `json:"write"`
		} `json:"cache"`
	} `json:"tokens,omitempty"`
}

func parseOpenCodeFileSession(filePath string) *types.SessionDetail {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}
	var session ocFileSession
	if json.Unmarshal(data, &session) != nil {
		return nil
	}

	storageRoot := filepath.Dir(filepath.Dir(filepath.Dir(filePath)))
	msgs := loadFileMessages(storageRoot, session.ID)
	if len(msgs) == 0 {
		return nil
	}

	// Build messages
	var messages []types.Message
	var totalInput, totalOutput, totalCacheRead, totalCacheCreation int
	var totalCost float64
	inputPerMsg := []int{}
	outputPerMsg := []int{}
	cumulativeTokens := []int{}
	cumTotal := 0
	var model string
	toolUsageMap := map[string]struct{ count int }{}

	for _, msg := range msgs {
		textContent := extractTextFromFileParts(storageRoot, msg.ID)
		toolCalls := extractToolCallsFromFileParts(storageRoot, msg.ID)
		stepTok := extractStepFinishFromFileParts(storageRoot, msg.ID)

		ts := msToISO(msg.Time.Created)
		parentID := (*string)(nil)
		if msg.ParentID != "" {
			parentID = &msg.ParentID
		}

		if msg.Role == "assistant" {
			if msg.ModelID != "" && model == "" {
				model = msg.ModelID
			}
			for _, tc := range toolCalls {
				u := toolUsageMap[tc.Name]
				u.count++
				toolUsageMap[tc.Name] = u
			}

			var rawInput, rawOutput, rawCacheRead, rawCacheWrite int
			if stepTok != nil {
				rawInput = stepTok.Input
				rawOutput = stepTok.Output
				rawCacheRead = stepTok.Cache.Read
				rawCacheWrite = stepTok.Cache.Write
			} else if msg.Tokens != nil {
				rawInput = msg.Tokens.Input
				rawOutput = msg.Tokens.Output
				rawCacheRead = msg.Tokens.Cache.Read
				rawCacheWrite = msg.Tokens.Cache.Write
			}

			var tok *types.Tokens
			if rawInput+rawOutput > 0 {
				p := pricing.GetPricing(msg.ModelID)
				isGPT := p != nil && p.CacheWrite == 0
				input := rawInput
				cacheCreation := rawCacheWrite
				if isGPT {
					input += rawCacheWrite
					cacheCreation = 0
				}
				c := pricing.CalculateCost(pricing.TokenCounts{
					Input:         input,
					Output:        rawOutput,
					CacheRead:     rawCacheRead,
					CacheCreation: cacheCreation,
				}, msg.ModelID)
				tok = &types.Tokens{
					Input:         input,
					Output:        rawOutput,
					CacheRead:     ptrInt(rawCacheRead),
					CacheCreation: ptrInt(cacheCreation),
					Cost:          &c,
				}
				effectiveInput := input + cacheCreation
				totalInput += effectiveInput
				totalOutput += rawOutput
				totalCacheRead += rawCacheRead
				totalCacheCreation += cacheCreation
				totalCost += c
				inputPerMsg = append(inputPerMsg, effectiveInput)
				outputPerMsg = append(outputPerMsg, rawOutput)
				cumTotal += effectiveInput + rawOutput
				cumulativeTokens = append(cumulativeTokens, cumTotal)
			}

			m := types.Message{
				ID:        msg.ID,
				ParentID:  parentID,
				Role:      "assistant",
				Content:   textContent,
				Timestamp: ts,
				Tokens:    tok,
			}
			if msg.ModelID != "" {
				m.Model = &msg.ModelID
			}
			if len(toolCalls) > 0 {
				m.ToolCalls = toolCalls
			}
			messages = append(messages, m)
		} else {
			messages = append(messages, types.Message{
				ID:        msg.ID,
				ParentID:  parentID,
				Role:      "user",
				Content:   textContent,
				Timestamp: ts,
			})
		}
	}

	// Load child sessions
	children := findFileChildSessions(storageRoot, session.ID)
	var subAgents []types.SubAgent
	for _, child := range children {
		childMsgs := loadFileMessages(storageRoot, child.ID)
		var childMsgBuilt []types.Message
		var childInput, childOutput, childCacheRead, childCacheCreation int
		var childModel string
		childToolCalls := 0
		var childEndTime string

		for _, cm := range childMsgs {
			textContent := extractTextFromFileParts(storageRoot, cm.ID)
			ctcs := extractToolCallsFromFileParts(storageRoot, cm.ID)
			stepTok := extractStepFinishFromFileParts(storageRoot, cm.ID)
			ts := msToISO(cm.Time.Created)

			if cm.ModelID != "" && childModel == "" {
				childModel = cm.ModelID
			}
			if ts > childEndTime {
				childEndTime = ts
			}
			childToolCalls += len(ctcs)

			parentID := (*string)(nil)
			if cm.ParentID != "" {
				parentID = &cm.ParentID
			}

			if cm.Role == "assistant" {
				var rawInput, rawOutput, rawCR, rawCW int
				if stepTok != nil {
					rawInput, rawOutput, rawCR, rawCW = stepTok.Input, stepTok.Output, stepTok.Cache.Read, stepTok.Cache.Write
				} else if cm.Tokens != nil {
					rawInput, rawOutput, rawCR, rawCW = cm.Tokens.Input, cm.Tokens.Output, cm.Tokens.Cache.Read, cm.Tokens.Cache.Write
				}
				p := pricing.GetPricing(cm.ModelID)
				isGPT := p != nil && p.CacheWrite == 0
				inp := rawInput
				cw := rawCW
				if isGPT {
					inp += rawCW
					cw = 0
				}
				c := pricing.CalculateCost(pricing.TokenCounts{Input: inp, Output: rawOutput, CacheRead: rawCR, CacheCreation: cw}, cm.ModelID)
				childInput += inp + cw
				childOutput += rawOutput
				childCacheRead += rawCR
				childCacheCreation += cw
				var tok *types.Tokens
				if inp+rawOutput > 0 {
					tok = &types.Tokens{Input: inp, Output: rawOutput, CacheRead: ptrInt(rawCR), CacheCreation: ptrInt(cw), Cost: &c}
				}
				m := types.Message{ID: cm.ID, ParentID: parentID, Role: "assistant", Content: textContent, Timestamp: ts, Tokens: tok}
				if cm.ModelID != "" {
					m.Model = &cm.ModelID
				}
				if len(ctcs) > 0 {
					m.ToolCalls = ctcs
				}
				childMsgBuilt = append(childMsgBuilt, m)
			} else {
				childMsgBuilt = append(childMsgBuilt, types.Message{ID: cm.ID, ParentID: parentID, Role: "user", Content: textContent, Timestamp: ts})
			}
		}

		childCost := pricing.CalculateCost(pricing.TokenCounts{Input: childInput, Output: childOutput, CacheRead: childCacheRead, CacheCreation: childCacheCreation}, childModel)
		childStart := msToISO(child.TimeCreated)
		childDuration := int64(0)
		if childEndTime != "" {
			t0 := time.UnixMilli(child.TimeCreated)
			t1, err := time.Parse(time.RFC3339, childEndTime)
			if err == nil {
				childDuration = t1.Sub(t0).Milliseconds()
			}
		}

		var promptStr, resultStr *string
		for _, m := range childMsgBuilt {
			if m.Role == "user" && promptStr == nil {
				c := m.Content
				promptStr = &c
			}
			if m.Role == "assistant" {
				c := m.Content
				resultStr = &c
			}
		}

		totalTok := childInput + childOutput + childCacheCreation
		tc := childToolCalls
		subAgents = append(subAgents, types.SubAgent{
			ID: child.ID, AgentID: child.ID, AgentType: child.Agent, AgentDisplayName: child.Title,
			Prompt: promptStr, Status: "completed", Result: resultStr, Model: ptrStr(childModel),
			TotalTokens: &totalTok, TotalToolCalls: &tc, DurationMs: &childDuration,
			StartTime: childStart, EndTime: ptrStr(childEndTime), Messages: childMsgBuilt,
		})

		effectiveIn := childInput + childCacheCreation
		label := fmt.Sprintf("[%s] %s", child.Agent, child.Title)
		detail := fmt.Sprintf("in=%s out=%s tokens, cost=$%.4f", commaInt(effectiveIn), commaInt(childOutput), childCost)
		messages = append(messages, types.Message{
			ID: fmt.Sprintf("subagent-summary-%s", child.ID), ParentID: nil, Role: "system",
			Content: label + " — " + detail, Timestamp: childStart, SubAgentRef: &child.ID,
			Tokens: &types.Tokens{Input: childInput, Output: childOutput, CacheRead: ptrInt(childCacheRead), CacheCreation: ptrInt(childCacheCreation), Cost: &childCost},
		})
	}

	sort.Slice(messages, func(i, j int) bool { return messages[i].Timestamp < messages[j].Timestamp })

	userMsgs, assistantMsgs := 0, 0
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

	var toolStats []types.ToolStat
	var toolUsage []types.ToolUsageSummary
	for name, u := range toolUsageMap {
		toolStats = append(toolStats, types.ToolStat{Name: name, Count: u.count, SuccessRate: 1})
		toolUsage = append(toolUsage, types.ToolUsageSummary{Name: name, Count: u.count, SuccessRate: 1})
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

	startTime := messages[0].Timestamp
	lastActivity := messages[len(messages)-1].Timestamp
	totalTok := totalInput + totalOutput
	var totalTokPtr *int
	if totalTok > 0 {
		totalTokPtr = &totalTok
	}
	var modelPtr *string
	if model != "" {
		modelPtr = &model
	}
	var subAgentCount *int
	if len(subAgents) > 0 {
		n := len(subAgents)
		subAgentCount = &n
	}

	proj := filepath.Base(session.Directory)
	if proj == "" || proj == "." {
		proj = session.ProjectID
	}

	detail := &types.SessionDetail{
		SessionSummary: types.SessionSummary{
			ID:            session.ID,
			Source:        types.SourceOpenCode,
			Project:       proj,
			ProjectPath:   session.Directory,
			StartTime:     startTime,
			LastActivity:  lastActivity,
			MessageCount:  len(messages),
			TotalTokens:   totalTokPtr,
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
// File-mode helpers
// ──────────────────────────────────────────────────────────

func loadFileMessages(storageRoot, sessionID string) []ocFileMessage {
	dir := filepath.Join(storageRoot, "message", sessionID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var msgs []ocFileMessage
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var m ocFileMessage
		if json.Unmarshal(data, &m) == nil {
			msgs = append(msgs, m)
		}
	}
	sort.Slice(msgs, func(i, j int) bool { return msgs[i].Time.Created < msgs[j].Time.Created })
	return msgs
}

func extractTextFromFileParts(storageRoot, messageID string) string {
	dir := filepath.Join(storageRoot, "part", messageID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	var texts []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var p ocFilePart
		if json.Unmarshal(data, &p) == nil && p.Type == "text" && p.Text != "" {
			texts = append(texts, p.Text)
		}
	}
	return strings.Join(texts, "\n")
}

func extractToolCallsFromFileParts(storageRoot, messageID string) []types.ToolCall {
	dir := filepath.Join(storageRoot, "part", messageID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var tcs []types.ToolCall
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var p ocFilePart
		if json.Unmarshal(data, &p) != nil || p.Type != "tool" || p.Tool == "" {
			continue
		}
		args := map[string]interface{}{}
		if p.State != nil && p.State.Input != nil {
			if m, ok := p.State.Input.(map[string]interface{}); ok {
				args = m
			}
		}
		callID := p.CallID
		if callID == "" {
			callID = p.ID
		}
		tcs = append(tcs, types.ToolCall{ID: callID, Name: p.Tool, Arguments: args})
	}
	return tcs
}

type stepTokens struct {
	Input  int
	Output int
	Cache  struct {
		Read  int
		Write int
	}
}

func extractStepFinishFromFileParts(storageRoot, messageID string) *stepTokens {
	dir := filepath.Join(storageRoot, "part", messageID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var p ocFilePart
		if json.Unmarshal(data, &p) == nil && p.Type == "step-finish" && p.Tokens != nil {
			return &stepTokens{
				Input:  p.Tokens.Input,
				Output: p.Tokens.Output,
				Cache: struct {
					Read  int
					Write int
				}{p.Tokens.Cache.Read, p.Tokens.Cache.Write},
			}
		}
	}
	return nil
}

type fileChildSession struct {
	ID          string
	Directory   string
	Agent       string
	Title       string
	TimeCreated int64
}

func findFileChildSessions(storageRoot, parentSessionID string) []fileChildSession {
	sessionRoot := filepath.Join(storageRoot, "session")
	var children []fileChildSession
	projectDirs, err := os.ReadDir(sessionRoot)
	if err != nil {
		return nil
	}
	for _, pd := range projectDirs {
		if !pd.IsDir() {
			continue
		}
		files, err := os.ReadDir(filepath.Join(sessionRoot, pd.Name()))
		if err != nil {
			continue
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".json") {
				continue
			}
			data, err := os.ReadFile(filepath.Join(sessionRoot, pd.Name(), f.Name()))
			if err != nil {
				continue
			}
			var s ocFileSession
			if json.Unmarshal(data, &s) == nil && s.ParentID == parentSessionID {
				children = append(children, fileChildSession{
					ID:          s.ID,
					Directory:   s.Directory,
					Agent:       s.Agent,
					Title:       s.Title,
					TimeCreated: s.Time.Created,
				})
			}
		}
	}
	return children
}

// ──────────────────────────────────────────────────────────
// Shared utilities
// ──────────────────────────────────────────────────────────

func parseModelString(ns sql.NullString) *string {
	if !ns.Valid || ns.String == "" {
		return nil
	}
	s := ns.String
	var obj struct {
		ID    string `json:"id"`
		Model string `json:"model"`
	}
	if json.Unmarshal([]byte(s), &obj) == nil {
		if obj.ID != "" {
			return &obj.ID
		}
		if obj.Model != "" {
			return &obj.Model
		}
	}
	return &s
}

func msToISO(ms int64) string {
	if ms == 0 {
		return ""
	}
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

func ptrInt(n int) *int {
	if n == 0 {
		return nil
	}
	return &n
}

func ptrStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func stringOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func commaInt(n int) string {
	s := fmt.Sprintf("%d", n)
	// Insert thousands separators
	result := []byte(s)
	j := len(result) % 3
	if j == 0 {
		j = 3
	}
	var parts []string
	for i := 0; i < len(result); i += 3 {
		if i == 0 {
			parts = append(parts, string(result[:j]))
			i = j - 3
		} else {
			end := i + 3
			if end > len(result) {
				end = len(result)
			}
			parts = append(parts, string(result[i:end]))
		}
	}
	_ = parts
	return s // Return plain integer for simplicity
}
