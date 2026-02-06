package main

import (
	"context"
	"flag"
	"io"
	"log"
	"os"
	"os/signal"
	"path/filepath"
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
	storageRoot := flag.String("storage", "./host-storage", "Storage root directory")
	runtimeType := flag.String("runtime", "runc", "Container runtime (runc or runsc)")
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

	// Set effect handler factory (enforces contracts)
	server.SetEffectHandlerFactory(func() program.EffectHandler {
		effectHandler := host.NewRealEffectHandler(stor, comp, dockerMgr)
		effectHandler.SetDefaultRuntime(*runtimeType)
		return effectHandler
	})

	logger.Println("✅ Host initialized")
	logger.Println("   🔒 Contracts: Port 8080 blocked, /state:rw, read-only rootfs")

	// Start HTTP server
	go func() {
		logger.Printf("🌐 HTTP API: http://localhost:%d", *port)
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
