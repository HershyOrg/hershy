package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const (
	gammaMarketsBySlug = "https://gamma-api.polymarket.com/markets?slug="
	gammaUserAgent     = "Mozilla/5.0 (compatible; CodexBot/1.0)"
)

var (
	monthNames = []string{
		"",
		"january",
		"february",
		"march",
		"april",
		"may",
		"june",
		"july",
		"august",
		"september",
		"october",
		"november",
		"december",
	}
	slugTimeRE = regexp.MustCompile(`^(?P<prefix>.+)-(?P<month>january|february|march|april|may|june|july|august|september|october|november|december)-(?P<day>\d{1,2})-(?P<hour>\d{1,2})(?P<ampm>am|pm)-et$`)
)

func normalizeSlug(value string) string {
	marker := "polymarket.com/event/"
	if idx := strings.Index(value, marker); idx >= 0 {
		return strings.Trim(strings.TrimPrefix(value[idx:], marker), "/")
	}
	return value
}

func fetchMarketBySlug(slug string) (map[string]any, error) {
	slug = normalizeSlug(slug)
	u, err := url.Parse(gammaMarketsBySlug + url.QueryEscape(slug))
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", gammaUserAgent)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var data any
	if err := json.Unmarshal(payload, &data); err != nil {
		return nil, err
	}

	markets := []any{}
	switch v := data.(type) {
	case map[string]any:
		if raw, ok := v["markets"]; ok {
			markets = toSlice(raw)
		} else if raw, ok := v["data"]; ok {
			markets = toSlice(raw)
		}
	case []any:
		markets = v
	}
	if len(markets) == 0 {
		return nil, fmt.Errorf("no market found for slug: %s", slug)
	}
	row, ok := markets[0].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("unexpected market payload")
	}
	return row, nil
}

func inferSlugPrefix(slug string) string {
	slug = normalizeSlug(slug)
	match := slugTimeRE.FindStringSubmatch(slug)
	if match == nil {
		return ""
	}
	for i, name := range slugTimeRE.SubexpNames() {
		if name == "prefix" && i < len(match) {
			return match[i]
		}
	}
	return ""
}

func buildSlug(prefix string, whenET time.Time) string {
	month := monthNames[int(whenET.Month())]
	day := whenET.Day()
	hour24 := whenET.Hour()
	hour12 := hour24 % 12
	if hour12 == 0 {
		hour12 = 12
	}
	ampm := "am"
	if hour24 >= 12 {
		ampm = "pm"
	}
	return fmt.Sprintf("%s-%s-%d-%d%s-et", prefix, month, day, hour12, ampm)
}

func parseISODatetime(value string) *time.Time {
	if value == "" {
		return nil
	}
	if strings.HasSuffix(value, "Z") {
		value = strings.TrimSuffix(value, "Z") + "+00:00"
	}
	layouts := []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05-07:00", "2006-01-02T15:04:05"}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, value); err == nil {
			return &t
		}
	}
	return nil
}

func isOpenMarket(market map[string]any, nowUTC time.Time) bool {
	if v, ok := market["closed"]; ok {
		if b, ok := v.(bool); ok && b {
			return false
		}
	}
	if start := parseISODatetime(toString(market["startDate"])); start != nil {
		if nowUTC.Before(start.UTC()) {
			return false
		}
	}
	if end := parseISODatetime(toString(market["endDate"])); end != nil {
		if end.UTC().Before(nowUTC) {
			return false
		}
	}
	return true
}

func findActiveMarketByTime(prefix string, nowET time.Time, searchHours, stepHours int) (map[string]any, string, error) {
	if prefix == "" {
		return nil, "", fmt.Errorf("missing prefix")
	}
	base := time.Date(nowET.Year(), nowET.Month(), nowET.Day(), nowET.Hour(), 0, 0, 0, nowET.Location())
	nowUTC := nowET.UTC()

	offsets := []int{0}
	for h := stepHours; h <= searchHours; h += stepHours {
		offsets = append(offsets, h, -h)
	}

	var fallbackMarket map[string]any
	var fallbackSlug string
	for _, offset := range offsets {
		candidate := base.Add(time.Duration(offset) * time.Hour)
		slug := buildSlug(prefix, candidate)
		market, err := fetchMarketBySlug(slug)
		if err != nil {
			continue
		}
		if enable, ok := market["enableOrderBook"].(bool); ok && !enable {
			if fallbackMarket == nil {
				fallbackMarket = market
				fallbackSlug = slug
			}
			continue
		}
		if isOpenMarket(market, nowUTC) {
			return market, slug, nil
		}
		if fallbackMarket == nil {
			fallbackMarket = market
			fallbackSlug = slug
		}
	}

	if fallbackMarket != nil {
		return fallbackMarket, fallbackSlug, nil
	}
	return nil, "", fmt.Errorf("no market found for prefix: %s", prefix)
}

func resolveYesNoTokens(market map[string]any, slug string) (MarketTokens, error) {
	outcomes := normalizeListField(market["outcomes"])
	coerced := make([]string, 0, len(outcomes))
	for _, o := range outcomes {
		coerced = append(coerced, coerceOutcome(o))
	}
	tokenIDs := extractClobTokenIDs(market)
	if len(coerced) == 0 || len(tokenIDs) == 0 {
		return MarketTokens{}, fmt.Errorf("missing outcomes or clobTokenIds")
	}

	yesLike := map[string]bool{"yes": true, "true": true, "up": true}
	noLike := map[string]bool{"no": true, "false": true, "down": true}
	mapped := map[string]string{}
	for i, outcome := range coerced {
		norm := strings.ToLower(strings.TrimSpace(outcome))
		if yesLike[norm] {
			mapped["yes"] = tokenIDs[i]
		} else if noLike[norm] {
			mapped["no"] = tokenIDs[i]
		}
	}
	if mapped["yes"] == "" || mapped["no"] == "" {
		if len(tokenIDs) == 2 {
			if mapped["yes"] == "" {
				mapped["yes"] = tokenIDs[0]
			}
			if mapped["no"] == "" {
				mapped["no"] = tokenIDs[1]
			}
		} else {
			return MarketTokens{}, fmt.Errorf("could not map outcomes to yes/no")
		}
	}

	return MarketTokens{
		YesTokenID:      mapped["yes"],
		NoTokenID:       mapped["no"],
		Outcomes:        coerced,
		ClobTokenIDs:    tokenIDs,
		MarketID:        toString(market["id"]),
		Slug:            fallbackString(toString(market["slug"]), slug),
		EnableOrderbook: toBoolPtr(market["enableOrderBook"]),
		Closed:          toBoolPtr(market["closed"]),
		Active:          toBoolPtr(market["active"]),
		StartDate:       toString(market["startDate"]),
		EndDate:         toString(market["endDate"]),
	}, nil
}

func extractClobTokenIDs(market map[string]any) []string {
	items := normalizeListField(market["clobTokenIds"])
	out := make([]string, 0, len(items))
	for _, item := range items {
		if s := strings.TrimSpace(toString(item)); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func resolveMarketTokens(cfg TraderConfig, nowET time.Time) (MarketTokens, error) {
	slugValue := ""
	if cfg.Slug != "" {
		slugValue = normalizeSlug(cfg.Slug)
	}
	if cfg.TokenIDUp != "" && cfg.TokenIDDown != "" {
		return MarketTokens{
			YesTokenID: cfg.TokenIDUp,
			NoTokenID:  cfg.TokenIDDown,
			Slug:       slugValue,
		}, nil
	}

	autoSlug := cfg.AutoSlug
	if autoSlug {
		prefix := cfg.SlugPrefix
		if prefix == "" {
			prefix = inferSlugPrefix(slugValue)
		}
		if prefix == "" {
			return MarketTokens{}, fmt.Errorf("provide --slug-prefix or a slug with time suffix")
		}
		market, slug, err := findActiveMarketByTime(prefix, nowET, cfg.SearchHours, cfg.SearchStepHours)
		if err != nil {
			return MarketTokens{}, err
		}
		return resolveYesNoTokens(market, slug)
	}

	if slugValue == "" {
		return MarketTokens{}, fmt.Errorf("provide --slug or enable --auto-slug with --slug-prefix")
	}
	market, err := fetchMarketBySlug(slugValue)
	if err != nil {
		return MarketTokens{}, err
	}
	return resolveYesNoTokens(market, slugValue)
}

func normalizeListField(value any) []any {
	if value == nil {
		return nil
	}
	switch v := value.(type) {
	case []any:
		return v
	case []string:
		out := make([]any, 0, len(v))
		for _, s := range v {
			out = append(out, s)
		}
		return out
	case string:
		text := strings.TrimSpace(v)
		if text == "" {
			return nil
		}
		var parsed any
		if err := json.Unmarshal([]byte(text), &parsed); err == nil {
			if items, ok := parsed.([]any); ok {
				return items
			}
		}
		if strings.Contains(text, ",") {
			parts := strings.Split(text, ",")
			out := make([]any, 0, len(parts))
			for _, part := range parts {
				p := strings.TrimSpace(part)
				if p != "" {
					out = append(out, p)
				}
			}
			return out
		}
		return []any{text}
	default:
		return []any{v}
	}
}

func coerceOutcome(value any) string {
	if value == nil {
		return ""
	}
	if row, ok := value.(map[string]any); ok {
		for _, key := range []string{"title", "name", "label", "outcome"} {
			if raw, ok := row[key]; ok {
				return toString(raw)
			}
		}
	}
	return toString(value)
}

func toBoolPtr(value any) *bool {
	if value == nil {
		return nil
	}
	if b, ok := value.(bool); ok {
		return &b
	}
	return nil
}

func fallbackString(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func toString(value any) string {
	if value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return v
	case fmt.Stringer:
		return v.String()
	case []byte:
		return string(v)
	default:
		return fmt.Sprintf("%v", v)
	}
}

func toSlice(value any) []any {
	if value == nil {
		return nil
	}
	if v, ok := value.([]any); ok {
		return v
	}
	return nil
}
