package services

import (
	"encoding/json"
	"fmt"
	"strings"

	"agent-session-viewer/types"
)

// ExportToJSON returns the full SessionDetail as formatted JSON.
func ExportToJSON(session *types.SessionDetail) (string, error) {
	b, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ExportToCSV returns the session messages as CSV.
func ExportToCSV(session *types.SessionDetail) string {
	headers := []string{
		"timestamp", "role", "content",
		"input_tokens", "output_tokens", "cache_read", "cache_creation",
		"tool_name", "tool_success",
	}
	rows := [][]string{headers}
	for _, m := range session.Messages {
		toolName := ""
		if len(m.ToolCalls) > 0 {
			toolName = m.ToolCalls[0].Name
		} else if m.ToolResult != nil {
			toolName = m.ToolResult.ToolCallID
		}
		toolSuccess := ""
		if m.ToolResult != nil {
			if m.ToolResult.Success {
				toolSuccess = "true"
			} else {
				toolSuccess = "false"
			}
		}
		input, output, cacheRead, cacheCreation := 0, 0, 0, 0
		if m.Tokens != nil {
			input = m.Tokens.Input
			output = m.Tokens.Output
			if m.Tokens.CacheRead != nil {
				cacheRead = *m.Tokens.CacheRead
			}
			if m.Tokens.CacheCreation != nil {
				cacheCreation = *m.Tokens.CacheCreation
			}
		}
		rows = append(rows, []string{
			m.Timestamp,
			m.Role,
			escapeCSV(m.Content),
			fmt.Sprintf("%d", input),
			fmt.Sprintf("%d", output),
			fmt.Sprintf("%d", cacheRead),
			fmt.Sprintf("%d", cacheCreation),
			toolName,
			toolSuccess,
		})
	}
	var sb strings.Builder
	for _, row := range rows {
		sb.WriteString(strings.Join(row, ","))
		sb.WriteString("\n")
	}
	return sb.String()
}

// ExportSummaryToJSON returns a condensed summary of the session as JSON.
func ExportSummaryToJSON(session *types.SessionDetail) (string, error) {
	summary := struct {
		SessionID    string                   `json:"sessionId"`
		Source       types.SessionSource      `json:"source"`
		Project      string                   `json:"project"`
		ProjectPath  string                   `json:"projectPath"`
		StartTime    string                   `json:"startTime"`
		LastActivity string                   `json:"lastActivity"`
		MessageCount int                      `json:"messageCount"`
		TotalTokens  *int                     `json:"totalTokens,omitempty"`
		Model        *string                  `json:"model,omitempty"`
		Stats        types.SessionStats       `json:"stats"`
		ToolUsage    []types.ToolUsageSummary `json:"toolUsage"`
	}{
		SessionID:    session.ID,
		Source:       session.Source,
		Project:      session.Project,
		ProjectPath:  session.ProjectPath,
		StartTime:    session.StartTime,
		LastActivity: session.LastActivity,
		MessageCount: session.MessageCount,
		TotalTokens:  session.TotalTokens,
		Model:        session.Model,
		Stats:        session.Stats,
		ToolUsage:    session.ToolUsage,
	}
	b, err := json.MarshalIndent(summary, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func escapeCSV(value string) string {
	escaped := strings.ReplaceAll(value, "\n", " ")
	escaped = strings.ReplaceAll(escaped, `"`, `""`)
	if strings.ContainsAny(escaped, `,"`) {
		return `"` + escaped + `"`
	}
	return escaped
}
