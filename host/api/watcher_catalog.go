package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/HershyOrg/hershy/program"
)

type watcherEndpointCatalog struct {
	mu      sync.RWMutex
	entries map[program.ProgramID]WatcherEndpointDescriptor
}

func newWatcherEndpointCatalog() *watcherEndpointCatalog {
	return &watcherEndpointCatalog{
		entries: make(map[program.ProgramID]WatcherEndpointDescriptor),
	}
}

func (c *watcherEndpointCatalog) upsert(entry WatcherEndpointDescriptor) {
	c.mu.Lock()
	defer c.mu.Unlock()

	copied := WatcherEndpointDescriptor{
		ProgramID:                entry.ProgramID,
		ProgramState:             entry.ProgramState,
		ProxyBase:                entry.ProxyBase,
		WatchingStateEndpoint:    entry.WatchingStateEndpoint,
		VarStateEndpointTemplate: entry.VarStateEndpointTemplate,
		WatchedCount:             entry.WatchedCount,
		WatcherTimestamp:         entry.WatcherTimestamp,
		CatalogUpdatedAt:         entry.CatalogUpdatedAt,
	}
	if len(entry.WatchedVars) > 0 {
		copied.WatchedVars = append([]string(nil), entry.WatchedVars...)
	}
	if len(entry.VarStateEndpoints) > 0 {
		copied.VarStateEndpoints = make(map[string]string, len(entry.VarStateEndpoints))
		for name, endpoint := range entry.VarStateEndpoints {
			copied.VarStateEndpoints[name] = endpoint
		}
	}

	c.entries[entry.ProgramID] = copied
}

func (c *watcherEndpointCatalog) remove(programID program.ProgramID) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, programID)
}

func (c *watcherEndpointCatalog) get(programID program.ProgramID) (WatcherEndpointDescriptor, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[programID]
	if !ok {
		return WatcherEndpointDescriptor{}, false
	}

	copied := WatcherEndpointDescriptor{
		ProgramID:                entry.ProgramID,
		ProgramState:             entry.ProgramState,
		ProxyBase:                entry.ProxyBase,
		WatchingStateEndpoint:    entry.WatchingStateEndpoint,
		VarStateEndpointTemplate: entry.VarStateEndpointTemplate,
		WatchedCount:             entry.WatchedCount,
		WatcherTimestamp:         entry.WatcherTimestamp,
		CatalogUpdatedAt:         entry.CatalogUpdatedAt,
	}
	if len(entry.WatchedVars) > 0 {
		copied.WatchedVars = append([]string(nil), entry.WatchedVars...)
	}
	if len(entry.VarStateEndpoints) > 0 {
		copied.VarStateEndpoints = make(map[string]string, len(entry.VarStateEndpoints))
		for name, endpoint := range entry.VarStateEndpoints {
			copied.VarStateEndpoints[name] = endpoint
		}
	}

	return copied, true
}

func (c *watcherEndpointCatalog) list() []WatcherEndpointDescriptor {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entries := make([]WatcherEndpointDescriptor, 0, len(c.entries))
	for _, entry := range c.entries {
		copied := WatcherEndpointDescriptor{
			ProgramID:                entry.ProgramID,
			ProgramState:             entry.ProgramState,
			ProxyBase:                entry.ProxyBase,
			WatchingStateEndpoint:    entry.WatchingStateEndpoint,
			VarStateEndpointTemplate: entry.VarStateEndpointTemplate,
			WatchedCount:             entry.WatchedCount,
			WatcherTimestamp:         entry.WatcherTimestamp,
			CatalogUpdatedAt:         entry.CatalogUpdatedAt,
		}
		if len(entry.WatchedVars) > 0 {
			copied.WatchedVars = append([]string(nil), entry.WatchedVars...)
		}
		if len(entry.VarStateEndpoints) > 0 {
			copied.VarStateEndpoints = make(map[string]string, len(entry.VarStateEndpoints))
			for name, endpoint := range entry.VarStateEndpoints {
				copied.VarStateEndpoints[name] = endpoint
			}
		}
		entries = append(entries, copied)
	}

	sort.Slice(entries, func(i, j int) bool {
		return string(entries[i].ProgramID) < string(entries[j].ProgramID)
	})
	return entries
}

func buildWatcherEndpointDescriptor(
	programID program.ProgramID,
	programState string,
	watching WatcherWatchingResponse,
) WatcherEndpointDescriptor {
	proxyBase := fmt.Sprintf("/programs/%s/proxy", programID)
	watchedVars := append([]string(nil), watching.WatchedVars...)
	sort.Strings(watchedVars)

	varStateEndpoints := make(map[string]string, len(watchedVars))
	for _, varName := range watchedVars {
		escapedVar := url.PathEscape(varName)
		varStateEndpoints[varName] = fmt.Sprintf("%s/watcher/varState/%s", proxyBase, escapedVar)
	}

	return WatcherEndpointDescriptor{
		ProgramID:                programID,
		ProgramState:             programState,
		ProxyBase:                proxyBase,
		WatchingStateEndpoint:    fmt.Sprintf("%s/watcher/watching-state", proxyBase),
		VarStateEndpointTemplate: fmt.Sprintf("%s/watcher/varState/{var_name}", proxyBase),
		VarStateEndpoints:        varStateEndpoints,
		WatchedVars:              watchedVars,
		WatchedCount:             len(watchedVars),
		WatcherTimestamp:         watching.Timestamp,
		CatalogUpdatedAt:         time.Now().Format(time.RFC3339),
	}
}

func (hs *HostServer) syncWatcherEndpointDescriptor(
	ctx context.Context,
	programID program.ProgramID,
	publishPort int,
	programState string,
) error {
	client := &http.Client{Timeout: 3 * time.Second}
	watchingURL := fmt.Sprintf("http://localhost:%d/watcher/watching", publishPort)

	var watching WatcherWatchingResponse
	if err := hs.fetchWatcherJSON(ctx, client, watchingURL, &watching); err != nil {
		hs.watcherCatalog.remove(programID)
		return err
	}

	entry := buildWatcherEndpointDescriptor(programID, programState, watching)
	hs.watcherCatalog.upsert(entry)
	return nil
}

func (hs *HostServer) handleWatcherEndpoints(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		hs.sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/watcher/endpoints")
	path = strings.TrimPrefix(path, "/")
	if path == "" {
		entries := hs.watcherCatalog.list()
		response := WatcherEndpointCatalogResponse{
			Endpoints: entries,
			Count:     len(entries),
			Timestamp: time.Now().Format(time.RFC3339),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}
	if strings.Contains(path, "/") {
		hs.sendError(w, http.StatusNotFound, "not found")
		return
	}

	programID := program.ProgramID(path)
	entry, ok := hs.watcherCatalog.get(programID)
	if !ok {
		hs.sendError(w, http.StatusNotFound, fmt.Sprintf("watcher endpoints not found: %s", programID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entry)
}
