package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/HershyOrg/hershy/cctx/relayer"
	"github.com/HershyOrg/hershy/cctx/scw"
)

func main() {
	var (
		listenAddr         = flag.String("listen", firstNonEmpty(os.Getenv("SCW_RELAYER_LISTEN_ADDR"), ":18080"), "HTTP listen address")
		bundlePath         = flag.String("bundle", firstNonEmpty(os.Getenv("SCW_BUNDLE_PATH")), "path to one provisioning bundle")
		bundleStore        = flag.String("bundle-store", firstNonEmpty(os.Getenv("SCW_BUNDLE_STORE")), "root directory containing provisioning bundles")
		moduleAddress      = flag.String("module", firstNonEmpty(os.Getenv("SCW_RELAYER_MODULE_ADDRESS")), "deployed StrategyPolicyModule address")
		rpcURL             = flag.String("rpc-url", firstNonEmpty(os.Getenv("SCW_RELAYER_RPC_URL")), "RPC URL used by relayer")
		relayerPrivateKey  = flag.String("relayer-private-key", firstNonEmpty(os.Getenv("SCW_RELAYER_PRIVATE_KEY")), "relayer EOA private key")
		gasLimitMultiplier = flag.Uint64("gas-multiplier", parseUint64Env("SCW_RELAYER_GAS_MULTIPLIER", 1), "optional gas limit multiplier for module execute tx")
		requireReady       = flag.Bool("require-ready", parseBoolEnv("SCW_RELAYER_REQUIRE_READY", false), "check SCW/module/session readiness before relay")
		executionLogDir    = flag.String("execution-log-dir", firstNonEmpty(os.Getenv("SCW_RELAYER_EXECUTION_LOG_DIR")), "optional JSONL execution log root")
	)
	flag.Parse()

	var policyStore relayer.PolicyStore
	if strings.TrimSpace(*bundleStore) != "" {
		policyStore = relayer.BundlePolicyStore{RootDir: strings.TrimSpace(*bundleStore)}
	} else {
		if strings.TrimSpace(*bundlePath) == "" {
			log.Fatal("either --bundle or --bundle-store is required")
		}
		bundle, err := scw.LoadBundleFile(strings.TrimSpace(*bundlePath))
		if err != nil {
			log.Fatalf("load bundle: %v", err)
		}
		if strings.TrimSpace(bundle.SmartWalletAddress) == "" {
			log.Fatal("bundle missing smart_wallet_address; update the bundle after SCW deployment")
		}
		if strings.TrimSpace(*moduleAddress) == "" {
			*moduleAddress = strings.TrimSpace(bundle.StrategyPolicyModuleAddress)
		}
		policy := bundle.RelayerPolicy
		if strings.TrimSpace(policy.StrategyPolicyModule) == "" {
			policy.StrategyPolicyModule = strings.TrimSpace(bundle.StrategyPolicyModuleAddress)
		}
		policyStore = relayer.StaticPolicyStore{Policies: []relayer.SCWExecutionPolicy{policy}}
	}

	server := &relayer.Server{
		PolicyStore: policyStore,
		Submitter: relayer.RPCModuleExecutor{
			RPCURL:             strings.TrimSpace(*rpcURL),
			ModuleAddress:      strings.TrimSpace(*moduleAddress),
			RelayerPrivateKey:  strings.TrimSpace(*relayerPrivateKey),
			GasLimitMultiplier: *gasLimitMultiplier,
		},
		Now: time.Now,
	}
	if *requireReady {
		server.ReadinessChecker = relayer.RPCReadinessChecker{
			RPCURL:        strings.TrimSpace(*rpcURL),
			ModuleAddress: strings.TrimSpace(*moduleAddress),
			Now:           time.Now,
		}
	}
	if strings.TrimSpace(*executionLogDir) != "" {
		server.Recorder = relayer.FileExecutionRecorder{RootDir: strings.TrimSpace(*executionLogDir)}
	}

	log.Printf("SCW relayer listening on %s", strings.TrimSpace(*listenAddr))
	log.Printf("bundle=%s bundle_store=%s module=%s require_ready=%t execution_log_dir=%s", strings.TrimSpace(*bundlePath), strings.TrimSpace(*bundleStore), strings.TrimSpace(*moduleAddress), *requireReady, strings.TrimSpace(*executionLogDir))
	if err := http.ListenAndServe(strings.TrimSpace(*listenAddr), server); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func parseUint64Env(key string, fallback uint64) uint64 {
	text := strings.TrimSpace(os.Getenv(key))
	if text == "" {
		return fallback
	}
	value, err := strconv.ParseUint(text, 10, 64)
	if err != nil {
		return fallback
	}
	return value
}

func parseBoolEnv(key string, fallback bool) bool {
	text := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if text == "" {
		return fallback
	}
	switch text {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return fallback
	}
}
