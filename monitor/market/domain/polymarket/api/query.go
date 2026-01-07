package api

import (
	"fmt"
	"net/url"
)
type MarketQuery struct {
	Active    *bool
	Closed    *bool
	Limit     int
	Offset    int
	TagID     *int
	Order     string
	Ascending bool
	UpdatedAfter *string
}
func (q MarketQuery) ToURL() string {
	params := url.Values{}

	if q.Active != nil {
		params.Set("active", fmt.Sprint(*q.Active))
	}
	if q.Closed != nil {
		params.Set("closed", fmt.Sprint(*q.Closed))
	}
	if q.Limit > 0 {
		params.Set("limit", fmt.Sprint(q.Limit))
	}
	if q.UpdatedAfter != nil {
		params.Set("updatedAfter", *q.UpdatedAfter)
	}
	params.Set("offset", fmt.Sprint(q.Offset))

	if q.TagID != nil {
		params.Set("tag_id", fmt.Sprint(*q.TagID))
	}
	if q.Order != "" {
		params.Set("order", q.Order)
	}
	params.Set("ascending", fmt.Sprint(q.Ascending))

	return baseURL + "?" + params.Encode()
}
