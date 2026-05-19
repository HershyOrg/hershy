package main

import (
	"encoding/json"
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
		bundlePath         = flag.String("bundle", firstNonEmpty(os.Getenv("SCW_BUNDLE_PATH"), "/tmp/eth-scw-bundle.json"), "path to provisioning bundle")
		moduleAddress      = flag.String("module", firstNonEmpty(os.Getenv("SCW_RELAYER_MODULE_ADDRESS")), "deployed StrategyPolicyModule address")
		rpcURL             = flag.String("rpc-url", firstNonEmpty(os.Getenv("SCW_RELAYER_RPC_URL")), "RPC URL used by relayer")
		relayerPrivateKey  = flag.String("relayer-private-key", firstNonEmpty(os.Getenv("SCW_RELAYER_PRIVATE_KEY")), "relayer EOA private key")
		gasLimitMultiplier = flag.Uint64("gas-multiplier", parseUint64Env("SCW_RELAYER_GAS_MULTIPLIER", 1), "optional gas limit multiplier for module execute tx")
	)
	flag.Parse()

	bundle, err := loadBundle(strings.TrimSpace(*bundlePath))
	if err != nil {
		log.Fatalf("load bundle: %v", err)
	}
	if strings.TrimSpace(*moduleAddress) == "" {
		*moduleAddress = strings.TrimSpace(bundle.StrategyPolicyModuleAddress)
	}

	server := &relayer.Server{
		PolicyStore: relayer.StaticPolicyStore{Policies: []relayer.SCWExecutionPolicy{bundle.RelayerPolicy}},
		Submitter: relayer.RPCModuleExecutor{
			RPCURL:             strings.TrimSpace(*rpcURL),
			ModuleAddress:      strings.TrimSpace(*moduleAddress),
			RelayerPrivateKey:  strings.TrimSpace(*relayerPrivateKey),
			GasLimitMultiplier: *gasLimitMultiplier,
		},
		Now: time.Now,
	}

	log.Printf("SCW relayer listening on %s", strings.TrimSpace(*listenAddr))
	log.Printf("smart wallet=%s policy=%s module=%s", bundle.SmartWalletAddress, bundle.PolicyID, strings.TrimSpace(*moduleAddress))
	if err := http.ListenAndServe(strings.TrimSpace(*listenAddr), server); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

func loadBundle(path string) (scw.SafeProvisioningBundle, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return scw.SafeProvisioningBundle{}, err
	}
	var bundle scw.SafeProvisioningBundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		return scw.SafeProvisioningBundle{}, err
	}
	return bundle, nil
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
