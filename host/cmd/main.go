package main

import (
	"context"
	"flag"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/HershyOrg/hershy/host"
	"github.com/HershyOrg/hershy/host/api"
	"github.com/HershyOrg/hershy/host/compose"
	"github.com/HershyOrg/hershy/host/logger"
	"github.com/HershyOrg/hershy/host/proxy"
	"github.com/HershyOrg/hershy/host/registry"
	"github.com/HershyOrg/hershy/host/runtime"
	"github.com/HershyOrg/hershy/host/storage"
	"github.com/HershyOrg/hershy/host/vector"
	"github.com/HershyOrg/hershy/program"
)

func main() {
	port := flag.Int("port", 9000, "Host API server port")
	bindAddr := flag.String("bind", "127.0.0.1", "Host API bind address (e.g. 127.0.0.1 or 100.x.x.x)")
	storageRoot := flag.String("storage", "./host-storage", "Storage root directory")
	runtimeType := flag.String("runtime", "runc", "Container runtime (runc or runsc)")
	vectorCompose := flag.String("vector", "./host/vector/docker-compose.yml", "Path to vector docker-compose.yml")
	apiTokenFlag := flag.String("api-token", "", "API token for /programs* endpoints (optional)")
	proxyAllowlistFlag := flag.String("proxy-allowlist", "", "Comma-separated allowlist for /programs/{id}/proxy/* paths (supports '*' suffix wildcard)")
	flag.Parse()

	logDir := filepath.Join(*storageRoot, "logs")
	_ = os.MkdirAll(logDir, 0o755)
	hostLogPath := filepath.Join(logDir, "host.log")
	log := logger.New("HostServer", io.Discard, hostLogPath)
	defer log.Close()
	log.SetDefaultLogType("HOST")

	log.Emit(logger.LogEntry{
		Level: "INFO",
		Msg:   "Starting Hershy Host Server",
		Vars: map[string]interface{}{
			"port":    *port,
			"bind":    *bindAddr,
			"storage": *storageRoot,
			"runtime": *runtimeType,
		},
	})

	reg := registry.NewRegistry()
	pm := proxy.NewProxyManager()
	stor := storage.NewManager(*storageRoot)
	comp := compose.NewBuilder()
	vec := vector.NewManager(*vectorCompose)

	dockerMgr, err := runtime.NewDockerManager()
	if err != nil {
		log.Emit(logger.LogEntry{
			Level: "ERROR",
			Msg:   "Docker manager failed",
			Vars: map[string]interface{}{"error": err.Error()},
		})
		return
	}
	defer dockerMgr.Close()

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
	}

	server.SetEffectHandlerFactory(func() program.EffectHandler {
		effectHandler := host.NewRealEffectHandler(stor, comp, dockerMgr)
		effectHandler.SetDefaultRuntime(*runtimeType)
		return effectHandler
	})

	log.Emit(logger.LogEntry{
		Level: "INFO",
		Msg:   "Host initialized",
		Vars: map[string]interface{}{
			"contracts_enforced": true,
			"api_token_enabled":  apiToken != "",
			"proxy_allowlisted":  proxyAllowlistRaw != "",
		},
	})

	go func() {
		log.Emit(logger.LogEntry{
			Level: "INFO",
			Msg:   "HTTP API Start",
			Vars: map[string]interface{}{
				"bind": *bindAddr,
				"port": *port,
			},
		})
		if err := server.Start(*port); err != nil {
			log.Emit(logger.LogEntry{
				Level: "ERROR",
				Msg:   "Server error",
				Vars: map[string]interface{}{"error": err.Error()},
			})
		}
	}()
	vec.Start()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	vec.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server.Stop(ctx)

	log.Emit(logger.LogEntry{
		Level: "INFO",
		Msg:   "Host server stopped",
	})
}
