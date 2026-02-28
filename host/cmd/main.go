package main

import (
	"context"
	"flag"
	"io"
	"os"
	"os/signal"
	"path/filepath"
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
	// Flags
	port := flag.Int("port", 9000, "Host API server port")
	storageRoot := flag.String("storage", "./host-storage", "Storage root directory")
	runtimeType := flag.String("runtime", "runc", "Container runtime (runc or runsc)")
	vectorCompose := flag.String("vector", "./host/vector/docker-compose.yml", "Path to vector docker-compose.yml")
	flag.Parse()

	// Logging setup
	logDir := filepath.Join(*storageRoot, "logs")
	os.MkdirAll(logDir, 0755)
	hostLogPath := filepath.Join(logDir, "host.log")
	log := logger.New("HostServer", io.Discard, hostLogPath)
  defer log.Close()
	log.SetDefaultLogType("HOST")

	log.Emit(logger.LogEntry{
  	Level:   "INFO",
    Msg:     "Starting Hershy Host Server",
    Vars: map[string]interface{}{
      "port":    *port,
      "storage": *storageRoot,
      "runtime": *runtimeType,
    },
  })

	// Initialize components
	reg := registry.NewRegistry()
	pm := proxy.NewProxyManager()
	stor := storage.NewManager(*storageRoot)
	comp := compose.NewBuilder()
	vec := vector.NewManager(*vectorCompose)

	dockerMgr, err := runtime.NewDockerManager()
	if err != nil {
		errMsg := err.Error()
		log.Emit(logger.LogEntry{
			Level:   "ERROR",
			Msg:     "Docker manager failed",
			Vars: map[string]interface{}{"error": errMsg},
  	})
	}
	defer dockerMgr.Close()

	// Create Host server
	server := api.NewHostServer(reg, pm, stor, comp, dockerMgr)
	server.SetDefaultRuntime(*runtimeType)

	// Set effect handler factory (enforces contracts)
	server.SetEffectHandlerFactory(func() program.EffectHandler {
		effectHandler := host.NewRealEffectHandler(stor, comp, dockerMgr)
		effectHandler.SetDefaultRuntime(*runtimeType)
		return effectHandler
	})


	log.Emit(logger.LogEntry{
  	Level:   "INFO",
    Msg:     "initialized : Contracts: Port 8080 blocked, /state:rw, read-only rootfs",
  })
	// Start HTTP server
	go func() {
			log.Emit(logger.LogEntry{
			Level:   "INFO",
			Msg:     "HTTP API Start",
			Vars: map[string]interface{}{
				"address" : "http://localhost:",
				"port":    *port,
    	},
		})
		if err := server.Start(*port); err != nil {
			errMsg := err.Error()
			log.Emit(logger.LogEntry{
				Level:   "ERROR",
				Msg:     "Server error",
				Vars: map[string]interface{}{"error": errMsg},
			})
		}
	}()
	vec.Start()

	// Wait for interrupt
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	vec.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server.Stop(ctx)

	log.Emit(logger.LogEntry{
  	Level:   "INFO",
    Msg:     "Host server stopped",
  })
}
