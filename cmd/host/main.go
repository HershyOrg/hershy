package main

import (
	"context"
	"flag"
	"io"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/HershyOrg/hershy/host"
	"github.com/HershyOrg/hershy/host/api"
	"github.com/HershyOrg/hershy/host/compose"
	"github.com/HershyOrg/hershy/host/proxy"
	"github.com/HershyOrg/hershy/host/registry"
	"github.com/HershyOrg/hershy/host/runtime"
	"github.com/HershyOrg/hershy/host/storage"
	"github.com/HershyOrg/hershy/program"
)

func main() {
	// Flags
	port := flag.Int("port", 9000, "Host API server port")
	bindAddr := flag.String("bind", "127.0.0.1", "Host API bind address (e.g. 127.0.0.1 or 100.x.x.x)")
	storageRoot := flag.String("storage", "./host-storage", "Storage root directory")
	runtimeType := flag.String("runtime", "runc", "Container runtime (runc or runsc)")
	apiTokenFlag := flag.String("api-token", "", "API token for /programs* endpoints (optional)")
	proxyAllowlistFlag := flag.String("proxy-allowlist", "", "Comma-separated allowlist for /programs/{id}/proxy/* paths (supports '*' suffix wildcard)")
	flag.Parse()

	// Logging setup
	logDir := filepath.Join(*storageRoot, "logs")
	os.MkdirAll(logDir, 0755)
	logFile, err := os.Create(filepath.Join(logDir, "host.log"))
	if err != nil {
		log.Fatalf("Failed to create log file: %v", err)
	}
	defer logFile.Close()
	logger := log.New(io.MultiWriter(os.Stdout, logFile), "[HOST] ", log.LstdFlags)

	logger.Println("🚀 Starting Hersh Host Server")
	logger.Printf("   Port: %d", *port)
	logger.Printf("   Bind: %s", *bindAddr)
	logger.Printf("   Storage: %s", *storageRoot)
	logger.Printf("   Runtime: %s (contracts enforced)", *runtimeType)

	// Initialize components
	reg := registry.NewRegistry()
	pm := proxy.NewProxyManager()
	stor := storage.NewManager(*storageRoot)
	comp := compose.NewBuilder()

	dockerMgr, err := runtime.NewDockerManager()
	if err != nil {
		logger.Fatalf("❌ Docker manager failed: %v", err)
	}
	defer dockerMgr.Close()

	// Create Host server
	server := api.NewHostServer(reg, pm, stor, comp, dockerMgr)
	server.SetDefaultRuntime(*runtimeType)
	server.SetListenAddr(*bindAddr)

	apiToken := strings.TrimSpace(*apiTokenFlag)
	if apiToken == "" {
		apiToken = strings.TrimSpace(os.Getenv("HERSHY_HOST_API_TOKEN"))
	}
	server.SetAPIToken(apiToken)

	proxyAllowlistRaw := strings.TrimSpace(*proxyAllowlistFlag)
	if proxyAllowlistRaw == "" {
		proxyAllowlistRaw = strings.TrimSpace(os.Getenv("HERSHY_PROXY_ALLOWLIST"))
	}
	if proxyAllowlistRaw != "" {
		parts := strings.Split(proxyAllowlistRaw, ",")
		allowlist := make([]string, 0, len(parts))
		for _, part := range parts {
			path := strings.TrimSpace(part)
			if path == "" {
				continue
			}
			allowlist = append(allowlist, path)
		}
		server.SetProxyPathAllowlist(allowlist)
		if len(allowlist) > 0 {
			logger.Printf("   🔐 Proxy allowlist: %s", strings.Join(allowlist, ", "))
		}
	}

	// Set effect handler factory (enforces contracts)
	server.SetEffectHandlerFactory(func() program.EffectHandler {
		effectHandler := host.NewRealEffectHandler(stor, comp, dockerMgr)
		effectHandler.SetDefaultRuntime(*runtimeType)
		return effectHandler
	})

	logger.Println("✅ Host initialized")
	logger.Println("   🔒 Contracts: Port 8080 blocked, /state:rw, read-only rootfs")
	if apiToken != "" {
		logger.Println("   🔐 API token auth: enabled for /programs*")
	}

	// Start HTTP server
	go func() {
		logger.Printf("🌐 HTTP API bind: %s:%d", *bindAddr, *port)
		if err := server.Start(*port); err != nil {
			logger.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for interrupt
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	logger.Println("\n⏰ Shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server.Stop(ctx)

	logger.Println("👋 Host server stopped")
}
