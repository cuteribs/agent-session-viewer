package parsers

import (
	"agent-session-viewer/types"
)

// ParseSessionFile dispatches to the appropriate parser based on source.
func ParseSessionFile(filePath string, source types.SessionSource) *types.SessionDetail {
	switch source {
	case types.SourceClaude:
		return ParseClaudeSessionFile(filePath)
	case types.SourceCopilot:
		return ParseCopilotSessionFile(filePath)
	case types.SourceCodex:
		return ParseCodexSessionFile(filePath)
	case types.SourceOpenCode:
		return ParseOpenCodeSessionFile(filePath)
	case types.SourceVSCode:
		return ParseVSCodeSessionFile(filePath)
	default:
		return nil
	}
}

// GetSessionSummary extracts a SessionSummary from a SessionDetail.
func GetSessionSummary(d *types.SessionDetail) types.SessionSummary {
	return d.SessionSummary
}
