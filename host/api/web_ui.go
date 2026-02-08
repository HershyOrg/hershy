package api

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed web/dist
var webUI embed.FS

// setupWebUI sets up the web UI routes
func setupWebUI(mux *http.ServeMux) error {
	// Get the dist directory from embedded files
	distFS, err := fs.Sub(webUI, "web/dist")
	if err != nil {
		return err
	}

	// Serve static files (JS, CSS, assets)
	fileServer := http.FileServer(http.FS(distFS))

	// Handle /ui/programs/* routes - serve index.html for all paths (SPA routing)
	mux.HandleFunc("/ui/programs", func(w http.ResponseWriter, r *http.Request) {
		// Remove query string for path checking
		path := r.URL.Path

		// If requesting a static asset (has extension), serve it directly
		if strings.Contains(path, ".") {
			// Strip /ui/programs prefix for file serving
			r.URL.Path = strings.TrimPrefix(path, "/ui/programs")
			fileServer.ServeHTTP(w, r)
			return
		}

		// For all other routes, serve index.html (SPA routing)
		indexData, err := fs.ReadFile(distFS, "index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexData)
	})

	// Handle /ui/programs/* (with trailing slash and sub-paths)
	mux.HandleFunc("/ui/programs/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// If requesting a static asset (has extension), serve it directly
		if strings.Contains(path, ".") {
			// Strip /ui/programs prefix for file serving
			r.URL.Path = strings.TrimPrefix(path, "/ui/programs")
			fileServer.ServeHTTP(w, r)
			return
		}

		// For all other routes, serve index.html (SPA routing)
		indexData, err := fs.ReadFile(distFS, "index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexData)
	})

	return nil
}
