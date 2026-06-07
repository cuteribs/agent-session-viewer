// Package pricing provides per-token USD cost lookup loaded from
// the canonical pricing.json at the repository root.
package pricing

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed pricing.json
var pricingJSON []byte

// ModelPricing holds per-million-token USD prices for a model.
type ModelPricing struct {
	Input       float64 `json:"input"`
	CachedInput float64 `json:"cachedInput"`
	CacheWrite  float64 `json:"cacheWrite"`
	Output      float64 `json:"output"`
}

type aliasRule struct {
	Match     string `json:"match"`     // "exact" | "prefix" | "contains"
	Value     string `json:"value"`
	Canonical string `json:"canonical"`
}

type pricingFile struct {
	Models  map[string]ModelPricing `json:"models"`
	Aliases []aliasRule             `json:"aliases"`
}

var (
	pricingTable map[string]ModelPricing
	aliasRules   []aliasRule
)

func init() {
	var f pricingFile
	if err := json.Unmarshal(pricingJSON, &f); err != nil {
		panic("pricing: failed to parse pricing.json: " + err.Error())
	}
	pricingTable = f.Models
	aliasRules = f.Aliases
}

// normalise maps a raw model string to a canonical pricing table key.
// Returns "" when no match can be found.
func normalise(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	if _, ok := pricingTable[s]; ok {
		return s
	}
	for _, rule := range aliasRules {
		v := rule.Value
		switch rule.Match {
		case "exact":
			if s == v {
				return rule.Canonical
			}
		case "prefix":
			if strings.HasPrefix(s, v) {
				return rule.Canonical
			}
		case "contains":
			if strings.Contains(s, v) {
				return rule.Canonical
			}
		}
	}
	return ""
}

// GetPricing returns the pricing entry for the given model name, or nil.
func GetPricing(model string) *ModelPricing {
	if model == "" {
		return nil
	}
	key := normalise(model)
	if key == "" {
		return nil
	}
	p := pricingTable[key]
	return &p
}

// TokenCounts holds the token breakdown for one API call.
type TokenCounts struct {
	Input         int
	Output        int
	CacheRead     int
	CacheCreation int
}

// CalculateCost returns the USD cost for a single API call.
// Returns 0 when the model is unknown.
func CalculateCost(t TokenCounts, model string) float64 {
	p := GetPricing(model)
	if p == nil {
		return 0
	}
	const M = 1_000_000.0
	return (float64(t.Input)/M)*p.Input +
		(float64(t.Output)/M)*p.Output +
		(float64(t.CacheRead)/M)*p.CachedInput +
		(float64(t.CacheCreation)/M)*p.CacheWrite
}
