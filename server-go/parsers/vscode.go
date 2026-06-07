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

// ParseVSCodeSessionFile parses a VS Code Copilot Chat session file.
// The file may be in JSONL (incremental log) or JSON (snapshot) format.
func ParseVSCodeSessionFile(filePath string) *types.SessionDetail {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}

	sessionID := strings.TrimSuffix(strings.TrimSuffix(filepath.Base(filePath), ".jsonl"), ".json")

	var parsedRequests []vsCodeRequest
	var modelName string
	var creationDate int64

	if strings.HasSuffix(filePath, ".jsonl") {
		state := parseJsonlLines(strings.Split(string(data), "\n"))
		modelName = extractModel(state.InputState)
		creationDate = state.CreationDate
		parsedRequests = extractRequestsFromState(state)
	} else {
		var snap vsCodeJSONSession
		if json.Unmarshal(data, &snap) != nil {
			return nil
		}
		modelName = extractModelFromJSON(snap.InputState)
		creationDate = snap.CreationDate
		parsedRequests = extractRequestsFromJSON(snap)
	}

	if len(parsedRequests) == 0 {
		return nil
	}

	// Determine project path from workspace.json
	sourcePath := filePath
	projectPath := resolveVSCodeProjectPath(filePath)

	// Debug-log tokens
	reqTimestamps := make([]int64, len(parsedRequests))
	for i, r := range parsedRequests {
		reqTimestamps[i] = r.Timestamp
	}
	debugTokens := readDebugLogTokens(sessionID, sourcePath, reqTimestamps)
	debugToolCalls := readDebugLogToolCalls(sessionID, sourcePath)

	return buildVSCodeSession(parsedRequests, sessionID, sourcePath, projectPath, modelName, creationDate, debugTokens, debugToolCalls)
}

// ──────────────────────────────────────────────────────────
// Session-file JSON types
// ──────────────────────────────────────────────────────────

type vsCodeModel struct {
	Identifier string `json:"identifier,omitempty"`
	Metadata   *struct {
		ID      string `json:"id,omitempty"`
		Vendor  string `json:"vendor,omitempty"`
		Name    string `json:"name,omitempty"`
		Family  string `json:"family,omitempty"`
		Version string `json:"version,omitempty"`
	} `json:"metadata,omitempty"`
}

type vsCodeInputState struct {
	SelectedModel *vsCodeModel `json:"selectedModel,omitempty"`
}

// JSONL format state
type vsCodeState struct {
	Version      int64             `json:"version,omitempty"`
	CreationDate int64             `json:"creationDate,omitempty"`
	SessionID    string            `json:"sessionId,omitempty"`
	InputState   *vsCodeInputState `json:"inputState,omitempty"`
	Requests     []vsCodeJSONLReq  `json:"requests,omitempty"`
}

type vsCodeJSONLReq struct {
	RequestID        string               `json:"requestId,omitempty"`
	Timestamp        int64                `json:"timestamp,omitempty"`
	Message          *vsCodeMessage       `json:"message,omitempty"`
	Response         []vsCodeResponsePart `json:"response,omitempty"`
	Result           *vsCodeResult        `json:"result,omitempty"`
	CompletionTokens *int                 `json:"completionTokens,omitempty"`
	ElapsedMs        *int64               `json:"elapsedMs,omitempty"`
}

type vsCodeMessage struct {
	Text  string          `json:"text,omitempty"`
	Parts []vsCodeMsgPart `json:"parts,omitempty"`
}

type vsCodeMsgPart struct {
	Text string `json:"text,omitempty"`
}

type vsCodeResponsePart struct {
	Value            interface{}          `json:"value,omitempty"`
	Kind             string               `json:"kind,omitempty"`
	ToolName         string               `json:"toolName,omitempty"`
	ToolID           string               `json:"toolId,omitempty"`
	InvocationMsg    interface{}          `json:"invocationMessage,omitempty"`
	PastTenseMsg     interface{}          `json:"pastTenseMessage,omitempty"`
	IsComplete       *bool                `json:"isComplete,omitempty"`
	ToolCallID       string               `json:"toolCallId,omitempty"`
	ResultText       string               `json:"resultText,omitempty"`
	ToolSpecificData *vsCodeToolSpecific  `json:"toolSpecificData,omitempty"`
	ResultDetails    []vsCodeResultDetail `json:"resultDetails,omitempty"`
	SubAgentInvID    string               `json:"subAgentInvocationId,omitempty"`
	Presentation     string               `json:"presentation,omitempty"`
}

type vsCodeToolSpecific struct {
	Kind        string `json:"kind,omitempty"`
	Description string `json:"description,omitempty"`
	Prompt      string `json:"prompt,omitempty"`
	ModelName   string `json:"modelName,omitempty"`
	Result      string `json:"result,omitempty"`
}

type vsCodeResultDetail struct {
	Scheme    string `json:"scheme,omitempty"`
	Authority string `json:"authority,omitempty"`
	Path      string `json:"path,omitempty"`
}

type vsCodeResult struct {
	Timings *struct {
		TotalElapsed *int64 `json:"totalElapsed,omitempty"`
	} `json:"timings,omitempty"`
	Metadata *struct {
		PromptTokens *int `json:"promptTokens,omitempty"`
		OutputTokens *int `json:"outputTokens,omitempty"`
		CachedTokens *int `json:"cachedTokens,omitempty"`
	} `json:"metadata,omitempty"`
	ResolvedModel string `json:"resolvedModel,omitempty"`
	ModelID       string `json:"modelId,omitempty"`
}

// JSON snapshot format
type vsCodeJSONSession struct {
	Version      int64             `json:"version,omitempty"`
	SessionID    string            `json:"sessionId,omitempty"`
	CreationDate int64             `json:"creationDate,omitempty"`
	InputState   *vsCodeInputState `json:"inputState,omitempty"`
	Requests     []vsCodeJSONReq   `json:"requests,omitempty"`
}

type vsCodeJSONReq struct {
	RequestID  string               `json:"requestId,omitempty"`
	Timestamp  int64                `json:"timestamp,omitempty"`
	Message    *vsCodeMessage       `json:"message,omitempty"`
	Response   []vsCodeResponsePart `json:"response,omitempty"`
	Result     *vsCodeResult        `json:"result,omitempty"`
	IsCanceled bool                 `json:"isCanceled,omitempty"`
}

// ──────────────────────────────────────────────────────────
// JSONL format parser (incremental log via kind=0/1/2)
// ──────────────────────────────────────────────────────────

type jsonlEvent struct {
	Kind int           `json:"kind"` // 0=snapshot, 1=set, 2=push
	V    interface{}   `json:"v,omitempty"`
	K    []interface{} `json:"k,omitempty"`
}

func parseJsonlLines(lines []string) vsCodeState {
	var state vsCodeState
	state.Requests = []vsCodeJSONLReq{}

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var ev jsonlEvent
		if json.Unmarshal([]byte(line), &ev) != nil {
			continue
		}
		switch ev.Kind {
		case 0:
			// Full snapshot — unmarshal directly
			b, _ := json.Marshal(ev.V)
			_ = json.Unmarshal(b, &state)
			if state.Requests == nil {
				state.Requests = []vsCodeJSONLReq{}
			}
		case 1:
			// Set path
			setNestedPath(&state, ev.K, ev.V)
		case 2:
			// Push to array at path
			pushNestedPath(&state, ev.K, ev.V)
		}
	}
	return state
}

// setNestedPath and pushNestedPath are simplified: we re-marshal state then
// apply the JSON path operation to a map, then re-unmarshal into state.
func setNestedPath(state *vsCodeState, path []interface{}, value interface{}) {
	if len(path) == 0 {
		return
	}
	var m interface{}
	b, _ := json.Marshal(state)
	json.Unmarshal(b, &m)
	setPath(m, path, value)
	b2, _ := json.Marshal(m)
	json.Unmarshal(b2, state)
}

func pushNestedPath(state *vsCodeState, path []interface{}, value interface{}) {
	if len(path) == 0 {
		return
	}
	var m interface{}
	b, _ := json.Marshal(state)
	json.Unmarshal(b, &m)
	pushPath(m, path, value)
	b2, _ := json.Marshal(m)
	json.Unmarshal(b2, state)
}

func setPath(obj interface{}, path []interface{}, value interface{}) {
	if len(path) == 0 {
		return
	}
	switch v := obj.(type) {
	case map[string]interface{}:
		key := fmt.Sprint(path[0])
		if len(path) == 1 {
			v[key] = value
		} else {
			if v[key] == nil {
				if _, isNum := path[1].(float64); isNum {
					v[key] = []interface{}{}
				} else {
					v[key] = map[string]interface{}{}
				}
			}
			setPath(v[key], path[1:], value)
		}
	case []interface{}:
		if idx, ok := path[0].(float64); ok {
			i := int(idx)
			for len(v) <= i {
				v = append(v, nil)
			}
			if len(path) == 1 {
				v[i] = value
			} else {
				setPath(v[i], path[1:], value)
			}
		}
	}
}

func pushPath(obj interface{}, path []interface{}, value interface{}) {
	if len(path) == 0 {
		return
	}
	switch v := obj.(type) {
	case map[string]interface{}:
		key := fmt.Sprint(path[0])
		if len(path) == 1 {
			arr, ok := v[key].([]interface{})
			if !ok {
				arr = []interface{}{}
			}
			if items, ok := value.([]interface{}); ok {
				arr = append(arr, items...)
			} else {
				arr = append(arr, value)
			}
			v[key] = arr
		} else {
			if v[key] == nil {
				v[key] = map[string]interface{}{}
			}
			pushPath(v[key], path[1:], value)
		}
	case []interface{}:
		if idx, ok := path[0].(float64); ok {
			i := int(idx)
			if i < len(v) {
				pushPath(v[i], path[1:], value)
			}
		}
	}
}

// ──────────────────────────────────────────────────────────
// Extract parsed requests from state/snapshot
// ──────────────────────────────────────────────────────────

type vsCodeRequest struct {
	RequestID     string
	Timestamp     int64
	UserText      string
	ResponseParts []vsCodeResponsePart
	ResolvedModel string
	PromptTokens  *int
	OutputTokens  *int
	CachedTokens  *int
}

func extractRequestsFromState(state vsCodeState) []vsCodeRequest {
	var out []vsCodeRequest
	for _, req := range state.Requests {
		userText := ""
		if req.Message != nil {
			userText = req.Message.Text
			if userText == "" {
				for _, p := range req.Message.Parts {
					userText += p.Text
				}
			}
		}
		var resolvedModel string
		var promptTokens, outputTokens, cachedTokens *int
		if req.Result != nil {
			resolvedModel = req.Result.ResolvedModel
			if resolvedModel == "" {
				resolvedModel = req.Result.ModelID
			}
			if req.Result.Metadata != nil {
				promptTokens = req.Result.Metadata.PromptTokens
				outputTokens = req.Result.Metadata.OutputTokens
				cachedTokens = req.Result.Metadata.CachedTokens
			}
		}
		out = append(out, vsCodeRequest{
			RequestID:     req.RequestID,
			Timestamp:     req.Timestamp,
			UserText:      userText,
			ResponseParts: req.Response,
			ResolvedModel: resolvedModel,
			PromptTokens:  promptTokens,
			OutputTokens:  outputTokens,
			CachedTokens:  cachedTokens,
		})
	}
	return out
}

func extractRequestsFromJSON(snap vsCodeJSONSession) []vsCodeRequest {
	var out []vsCodeRequest
	for _, req := range snap.Requests {
		if req.IsCanceled {
			continue
		}
		userText := ""
		if req.Message != nil {
			userText = req.Message.Text
			if userText == "" {
				for _, p := range req.Message.Parts {
					userText += p.Text
				}
			}
		}
		var resolvedModel string
		var promptTokens, outputTokens, cachedTokens *int
		if req.Result != nil {
			resolvedModel = req.Result.ResolvedModel
			if resolvedModel == "" {
				resolvedModel = req.Result.ModelID
			}
			if req.Result.Metadata != nil {
				promptTokens = req.Result.Metadata.PromptTokens
				outputTokens = req.Result.Metadata.OutputTokens
				cachedTokens = req.Result.Metadata.CachedTokens
			}
		}
		out = append(out, vsCodeRequest{
			RequestID:     req.RequestID,
			Timestamp:     req.Timestamp,
			UserText:      userText,
			ResponseParts: req.Response,
			ResolvedModel: resolvedModel,
			PromptTokens:  promptTokens,
			OutputTokens:  outputTokens,
			CachedTokens:  cachedTokens,
		})
	}
	return out
}

// ──────────────────────────────────────────────────────────
// Debug-log token extraction
// ──────────────────────────────────────────────────────────

type debugRequestTokens struct {
	InputTokens  int
	OutputTokens int
	CachedTokens int
	RoundCount   int
	Model        string
}

type debugLogTokens struct {
	PerRequest  []debugRequestTokens
	PerSubagent map[string]debugRequestTokens // keyed by toolCallId
}

func readDebugLogTokens(sessionID, chatSessionsPath string, requestTimestamps []int64) *debugLogTokens {
	chatDir := filepath.Dir(chatSessionsPath)
	workspaceDir := filepath.Dir(chatDir)
	debugLogDir := filepath.Join(workspaceDir, "GitHub.copilot-chat", "debug-logs", sessionID)

	if _, err := os.Stat(debugLogDir); err != nil {
		return nil
	}

	mainPath := filepath.Join(debugLogDir, "main.jsonl")
	if _, err := os.Stat(mainPath); err != nil {
		return nil
	}

	type llmSpan struct {
		TS           int64
		InputTokens  int
		OutputTokens int
		CachedTokens int
		Model        string
	}

	var mainCalls []llmSpan
	f, err := os.Open(mainPath)
	if err == nil {
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 2*1024*1024), 2*1024*1024)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			var ev struct {
				Type  string                 `json:"type"`
				TS    int64                  `json:"ts"`
				Attrs map[string]interface{} `json:"attrs"`
			}
			if json.Unmarshal([]byte(line), &ev) != nil || ev.Type != "llm_request" {
				continue
			}
			model, _ := ev.Attrs["model"].(string)
			if strings.Contains(strings.ToLower(model), "gpt-4o-mini") {
				continue // Skip title-generation calls
			}
			mainCalls = append(mainCalls, llmSpan{
				TS:           ev.TS,
				InputTokens:  toInt(ev.Attrs["inputTokens"]),
				OutputTokens: toInt(ev.Attrs["outputTokens"]),
				CachedTokens: toInt(ev.Attrs["cachedTokens"]),
				Model:        model,
			})
		}
		f.Close()
	}

	perRequest := make([]debugRequestTokens, len(requestTimestamps))
	for _, call := range mainCalls {
		bucket := 0
		for i, ts := range requestTimestamps {
			if call.TS >= ts {
				bucket = i
			}
		}
		perRequest[bucket].InputTokens += call.InputTokens
		perRequest[bucket].OutputTokens += call.OutputTokens
		perRequest[bucket].CachedTokens += call.CachedTokens
		perRequest[bucket].RoundCount++
		perRequest[bucket].Model = call.Model
	}

	perSubagent := map[string]debugRequestTokens{}
	entries, err := os.ReadDir(debugLogDir)
	if err == nil {
		for _, entry := range entries {
			m := extractSubagentToolCallID(entry.Name())
			if m == "" {
				continue
			}
			agg := debugRequestTokens{}
			sf, err := os.Open(filepath.Join(debugLogDir, entry.Name()))
			if err != nil {
				continue
			}
			sc := bufio.NewScanner(sf)
			sc.Buffer(make([]byte, 2*1024*1024), 2*1024*1024)
			for sc.Scan() {
				line := strings.TrimSpace(sc.Text())
				if line == "" {
					continue
				}
				var ev struct {
					Type  string                 `json:"type"`
					Attrs map[string]interface{} `json:"attrs"`
				}
				if json.Unmarshal([]byte(line), &ev) != nil || ev.Type != "llm_request" {
					continue
				}
				agg.InputTokens += toInt(ev.Attrs["inputTokens"])
				agg.OutputTokens += toInt(ev.Attrs["outputTokens"])
				agg.CachedTokens += toInt(ev.Attrs["cachedTokens"])
				agg.RoundCount++
				if s, ok := ev.Attrs["model"].(string); ok {
					agg.Model = s
				}
			}
			sf.Close()
			if agg.RoundCount > 0 {
				perSubagent[m] = agg
			}
		}
	}

	return &debugLogTokens{PerRequest: perRequest, PerSubagent: perSubagent}
}

func extractSubagentToolCallID(fname string) string {
	const prefix = "runSubagent-default-"
	const suffix = ".jsonl"
	if strings.HasPrefix(fname, prefix) && strings.HasSuffix(fname, suffix) {
		return strings.TrimSuffix(strings.TrimPrefix(fname, prefix), suffix)
	}
	return ""
}

// ──────────────────────────────────────────────────────────
// Debug-log tool-call extraction
// ──────────────────────────────────────────────────────────

type debugToolCall struct {
	Name   string
	Args   string
	Result string
	TS     int64
}

type debugToolCalls struct {
	Main        map[string][]debugToolCall
	PerSubagent map[string]map[string][]debugToolCall
}

var debugToolNameAliases = map[string]string{
	"copilot_readFile":             "read_file",
	"copilot_findTextInFiles":      "grep_search",
	"copilot_findFiles":            "file_search",
	"copilot_listDirectory":        "list_dir",
	"copilot_applyPatch":           "apply_patch",
	"copilot_fetchWebPage":         "fetch_webpage",
	"vscode_fetchWebPage_internal": "fetch_webpage",
}

func readDebugLogToolCalls(sessionID, chatSessionsPath string) *debugToolCalls {
	chatDir := filepath.Dir(chatSessionsPath)
	workspaceDir := filepath.Dir(chatDir)
	debugLogDir := filepath.Join(workspaceDir, "GitHub.copilot-chat", "debug-logs", sessionID)

	result := &debugToolCalls{
		Main:        parseDebugToolCallFile(filepath.Join(debugLogDir, "main.jsonl")),
		PerSubagent: map[string]map[string][]debugToolCall{},
	}

	entries, err := os.ReadDir(debugLogDir)
	if err != nil {
		return result
	}
	for _, entry := range entries {
		id := extractSubagentToolCallID(entry.Name())
		if id == "" {
			continue
		}
		result.PerSubagent[id] = parseDebugToolCallFile(filepath.Join(debugLogDir, entry.Name()))
	}
	return result
}

func parseDebugToolCallFile(filePath string) map[string][]debugToolCall {
	byName := map[string][]debugToolCall{}
	f, err := os.Open(filePath)
	if err != nil {
		return byName
	}
	defer f.Close()

	var spans []debugToolCall
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 2*1024*1024), 2*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var ev struct {
			Type  string                 `json:"type"`
			Name  string                 `json:"name"`
			TS    int64                  `json:"ts"`
			Attrs map[string]interface{} `json:"attrs"`
		}
		if json.Unmarshal([]byte(line), &ev) != nil || ev.Type != "tool_call" || ev.Name == "" {
			continue
		}
		toStr := func(v interface{}) string {
			if v == nil {
				return ""
			}
			if s, ok := v.(string); ok {
				return s
			}
			b, _ := json.Marshal(v)
			return string(b)
		}
		spans = append(spans, debugToolCall{
			Name:   ev.Name,
			Args:   toStr(ev.Attrs["args"]),
			Result: toStr(ev.Attrs["result"]),
			TS:     ev.TS,
		})
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].TS < spans[j].TS })
	for _, s := range spans {
		byName[s.Name] = append(byName[s.Name], s)
	}
	return byName
}

func consumeDebugToolCall(queues map[string][]debugToolCall, name string) *debugToolCall {
	debugName, ok := debugToolNameAliases[name]
	if !ok {
		debugName = name
	}
	q := queues[debugName]
	if len(q) == 0 {
		return nil
	}
	tc := q[0]
	queues[debugName] = q[1:]
	return &tc
}

// ──────────────────────────────────────────────────────────
// Build session from parsed requests
// ──────────────────────────────────────────────────────────

func buildVSCodeSession(
	requests []vsCodeRequest,
	sessionID, sourcePath, projectPath, modelName string,
	creationDate int64,
	debugTokens *debugLogTokens,
	debugTCs *debugToolCalls,
) *types.SessionDetail {
	if len(requests) == 0 {
		return nil
	}

	var messages []types.Message
	toolUsageMap := map[string]struct{ count int }{}
	inputPerMsg := []int{}
	outputPerMsg := []int{}
	cumulativeTokens := []int{}
	cumTotal := 0
	var totalInput, totalOutput, totalCacheRead int
	var totalCost float64
	subAgentMap := map[string]*types.SubAgent{}

	modelAgg := map[string]struct {
		input, output, cacheRead int
		count                    int
	}{}

	reqIdx := -1
	for _, req := range requests {
		if req.UserText == "" && len(req.ResponseParts) == 0 {
			continue
		}
		reqIdx++

		ts := msToISO(req.Timestamp)
		if req.UserText != "" {
			msgID := "user-" + req.RequestID
			if msgID == "user-" {
				msgID = fmt.Sprintf("user-%d", req.Timestamp)
			}
			messages = append(messages, types.Message{
				ID:        msgID,
				ParentID:  nil,
				Role:      "user",
				Content:   req.UserText,
				Timestamp: ts,
			})
		}

		// Resolve model for this request
		reqModel := req.ResolvedModel
		if reqModel == "" {
			reqModel = modelName
		}

		// Token data: prefer debug-log over chatSessions metadata
		var inputTok, outputTok, cachedTok int
		if debugTokens != nil && reqIdx < len(debugTokens.PerRequest) {
			dr := debugTokens.PerRequest[reqIdx]
			if dr.RoundCount > 0 {
				inputTok = dr.InputTokens
				outputTok = dr.OutputTokens
				cachedTok = dr.CachedTokens
				if dr.Model != "" {
					reqModel = dr.Model
				}
			}
		}
		if inputTok == 0 && req.PromptTokens != nil {
			inputTok = *req.PromptTokens
		}
		if outputTok == 0 && req.OutputTokens != nil {
			outputTok = *req.OutputTokens
		}
		if cachedTok == 0 && req.CachedTokens != nil {
			cachedTok = *req.CachedTokens
		}

		// Build assistant response
		var contentParts []string
		var toolCalls []types.ToolCall

		// Dedup response parts by toolCallId
		deduped := deduplicateResponseParts(req.ResponseParts)
		mainQueues := map[string][]debugToolCall{}
		if debugTCs != nil {
			// Copy queues to avoid mutating original
			for k, v := range debugTCs.Main {
				mainQueues[k] = append([]debugToolCall{}, v...)
			}
		}

		for _, part := range deduped {
			if part.Kind == "toolInvocationSerialized" {
				toolName := part.ToolID
				if toolName == "" {
					toolName = part.ToolName
				}
				if toolName == "" {
					toolName = "unknown"
				}

				// Track subagents
				tsd := part.ToolSpecificData
				if tsd != nil && tsd.Kind == "subagent" && part.ToolCallID != "" {
					if _, exists := subAgentMap[part.ToolCallID]; !exists {
						desc := (*string)(nil)
						prompt := (*string)(nil)
						result := (*string)(nil)
						if tsd.Description != "" {
							desc = &tsd.Description
						}
						if tsd.Prompt != "" {
							prompt = &tsd.Prompt
						}
						if tsd.Result != "" {
							result = &tsd.Result
						}
						status := "started"
						if part.IsComplete != nil && *part.IsComplete {
							status = "completed"
						}
						subAgentMap[part.ToolCallID] = &types.SubAgent{
							ID:               part.ToolCallID,
							AgentID:          "runSubagent",
							AgentType:        "runSubagent",
							AgentDisplayName: tsd.Description,
							Description:      desc,
							Prompt:           prompt,
							Status:           status,
							Result:           result,
							StartTime:        ts,
						}
						if status == "completed" {
							subAgentMap[part.ToolCallID].EndTime = &ts
						}
						if tsd.ModelName != "" {
							subAgentMap[part.ToolCallID].Model = &tsd.ModelName
						}
						// Attach debug tokens for this subagent
						if debugTokens != nil {
							if dt, ok := debugTokens.PerSubagent[part.ToolCallID]; ok && dt.RoundCount > 0 {
								t := dt.InputTokens + dt.OutputTokens
								subAgentMap[part.ToolCallID].TotalTokens = &t
							}
						}
					}
				}

				// Build tool call args from debug log
				debugTC := consumeDebugToolCall(mainQueues, toolName)
				args := map[string]interface{}{}
				if debugTC != nil && debugTC.Args != "" {
					json.Unmarshal([]byte(debugTC.Args), &args)
				} else {
					// Use invocation/past-tense text as a readable description
					text := extractInvocationText(part.InvocationMsg)
					if text == "" {
						text = extractInvocationText(part.PastTenseMsg)
					}
					if tsd != nil && tsd.Description != "" && text == "" {
						text = tsd.Description
					}
					if text != "" {
						args["input"] = text
					}
				}

				result := (*string)(nil)
				if debugTC != nil && debugTC.Result != "" {
					r := debugTC.Result
					result = &r
				}

				if part.Presentation != "hidden" {
					toolCalls = append(toolCalls, types.ToolCall{
						ID:        part.ToolCallID,
						Name:      toolName,
						Arguments: args,
						Result:    result,
					})
					u := toolUsageMap[toolName]
					u.count++
					toolUsageMap[toolName] = u
				}
			} else if part.Kind == "" || part.Kind == "text" {
				if s, ok := part.Value.(string); ok && s != "" {
					contentParts = append(contentParts, s)
				}
			}
		}

		content := strings.Join(contentParts, "")
		if content == "" && len(toolCalls) > 0 {
			content = pluralise("Performed %d tool call", len(toolCalls))
		}

		if content != "" || len(toolCalls) > 0 {
			var tok *types.Tokens
			if inputTok+outputTok > 0 {
				c := pricing.CalculateCost(pricing.TokenCounts{
					Input:     inputTok,
					Output:    outputTok,
					CacheRead: cachedTok,
				}, reqModel)
				tok = &types.Tokens{
					Input:     inputTok,
					Output:    outputTok,
					CacheRead: ptrInt(cachedTok),
					Cost:      &c,
				}
				inputPerMsg = append(inputPerMsg, inputTok)
				outputPerMsg = append(outputPerMsg, outputTok)
				cumTotal += inputTok + outputTok
				cumulativeTokens = append(cumulativeTokens, cumTotal)
				totalInput += inputTok
				totalOutput += outputTok
				totalCacheRead += cachedTok
				totalCost += c

				if reqModel != "" {
					agg := modelAgg[reqModel]
					agg.input += inputTok
					agg.output += outputTok
					agg.cacheRead += cachedTok
					agg.count++
					modelAgg[reqModel] = agg
				}
			}

			m := types.Message{
				ID:        "assistant-" + req.RequestID,
				ParentID:  nil,
				Role:      "assistant",
				Content:   content,
				Timestamp: ts,
				Tokens:    tok,
			}
			if reqModel != "" {
				m.Model = &reqModel
			}
			if len(toolCalls) > 0 {
				m.ToolCalls = toolCalls
			}
			messages = append(messages, m)
		}
	}

	// Build tool summaries
	var toolStats []types.ToolStat
	var toolUsage []types.ToolUsageSummary
	for name, u := range toolUsageMap {
		toolStats = append(toolStats, types.ToolStat{Name: name, Count: u.count, SuccessRate: 1})
		toolUsage = append(toolUsage, types.ToolUsageSummary{Name: name, Count: u.count, SuccessRate: 1})
	}
	sort.Slice(toolStats, func(i, j int) bool { return toolStats[i].Count > toolStats[j].Count })
	sort.Slice(toolUsage, func(i, j int) bool { return toolUsage[i].Count > toolUsage[j].Count })

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

	var tokenStats *types.TokenStats
	if len(inputPerMsg) > 0 {
		tc := totalCost
		tokenStats = &types.TokenStats{
			TotalInput:       totalInput,
			TotalOutput:      totalOutput,
			TotalCacheRead:   totalCacheRead,
			TotalCost:        &tc,
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
	if creationDate > 0 {
		startTime = msToISO(creationDate)
	}
	lastActivity := startTime
	if len(messages) > 0 {
		if creationDate == 0 {
			startTime = messages[0].Timestamp
		}
		lastActivity = messages[len(messages)-1].Timestamp
	}

	totalTok := totalInput + totalOutput
	var totalTokPtr *int
	if totalTok > 0 {
		totalTokPtr = &totalTok
	}
	var modelPtr *string
	if modelName != "" {
		modelPtr = &modelName
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

	project := filepath.Base(projectPath)
	if project == "" || project == "." {
		project = sessionID
	}

	detail := &types.SessionDetail{
		SessionSummary: types.SessionSummary{
			ID:            sessionID,
			Source:        types.SourceVSCode,
			Project:       project,
			ProjectPath:   projectPath,
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
	if len(subAgentSlice) > 0 {
		detail.SubAgents = subAgentSlice
	}
	return detail
}

// ──────────────────────────────────────────────────────────
// VS Code helpers
// ──────────────────────────────────────────────────────────

func extractModel(is *vsCodeInputState) string {
	if is == nil || is.SelectedModel == nil {
		return ""
	}
	m := is.SelectedModel
	if m.Metadata != nil && m.Metadata.ID != "" {
		return m.Metadata.ID
	}
	if m.Identifier != "" {
		return m.Identifier
	}
	return ""
}

func extractModelFromJSON(is *vsCodeInputState) string {
	return extractModel(is)
}

func resolveVSCodeProjectPath(filePath string) string {
	// chatSessions is inside workspaceStorage/<hash>/
	// workspace.json is at workspaceStorage/<hash>/workspace.json
	dir := filepath.Dir(filePath) // chatSessions dir or emptyWindowChatSessions dir
	wsDir := filepath.Dir(dir)    // workspaceStorage/<hash>
	wsFile := filepath.Join(wsDir, "workspace.json")
	data, err := os.ReadFile(wsFile)
	if err != nil {
		return wsDir
	}
	var ws struct {
		Folder string `json:"folder"`
	}
	if json.Unmarshal(data, &ws) == nil && ws.Folder != "" {
		// folder may be a file:// URI
		folder := ws.Folder
		folder = strings.TrimPrefix(folder, "file://")
		return folder
	}
	return wsDir
}

func extractInvocationText(v interface{}) string {
	if v == nil {
		return ""
	}
	var raw string
	switch t := v.(type) {
	case string:
		raw = t
	case map[string]interface{}:
		if s, ok := t["value"].(string); ok {
			raw = s
		}
	}
	if raw == "" {
		return ""
	}
	// Clean VSCode markdown link syntax: [label](url) → label or filename
	result := vsCodeLinkRegexp(raw)
	return strings.TrimSpace(result)
}

func vsCodeLinkRegexp(s string) string {
	// Simple replacement for [label](url) → label (or filename when label is empty)
	out := []byte{}
	i := 0
	for i < len(s) {
		if s[i] == '[' {
			j := strings.Index(s[i+1:], "](")
			if j >= 0 {
				label := s[i+1 : i+1+j]
				rest := s[i+1+j+2:]
				k := strings.Index(rest, ")")
				if k >= 0 {
					if strings.TrimSpace(label) != "" {
						out = append(out, strings.TrimSpace(label)...)
					} else {
						url := rest[:k]
						parts := strings.Split(strings.TrimRight(url, "/"), "/")
						if len(parts) > 0 {
							out = append(out, parts[len(parts)-1]...)
						}
					}
					i = i + 1 + j + 2 + k + 1
					continue
				}
			}
		}
		out = append(out, s[i])
		i++
	}
	return string(out)
}

func deduplicateResponseParts(parts []vsCodeResponsePart) []vsCodeResponsePart {
	seen := map[string]bool{}
	keepIdx := map[int]bool{}
	// Scan reversed: keep the last occurrence of each toolCallId
	for i := len(parts) - 1; i >= 0; i-- {
		p := parts[i]
		if p.Kind == "toolInvocationSerialized" && p.ToolCallID != "" {
			if !seen[p.ToolCallID] {
				seen[p.ToolCallID] = true
				keepIdx[i] = true
			}
		} else {
			keepIdx[i] = true
		}
	}
	var out []vsCodeResponsePart
	for i, p := range parts {
		if keepIdx[i] {
			out = append(out, p)
		}
	}
	return out
}

func toInt(v interface{}) int {
	if v == nil {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}
