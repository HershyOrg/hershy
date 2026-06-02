package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/HershyOrg/hershy/cctx/base"
	"github.com/HershyOrg/hershy/cctx/relayer"
	"github.com/HershyOrg/hershy/cctx/scw"
)

type outputEnvelope struct {
	Request   base.SCWRelayRequest        `json:"request"`
	Validated relayer.SCWValidatedRequest `json:"validated"`
}

func main() {
	var (
		bundlePath           = flag.String("bundle", firstNonEmpty(os.Getenv("SCW_BUNDLE_PATH"), "/tmp/eth-scw-bundle.json"), "path to SCW provisioning bundle JSON")
		chain                = flag.String("chain", firstNonEmpty(os.Getenv("SCW_RELAY_CHAIN")), "optional normalized chain slug")
		strategyID           = flag.String("strategy-id", firstNonEmpty(os.Getenv("SCW_RELAY_STRATEGY_ID"), "strategy-smoke-test"), "optional strategy identifier")
		targetContract       = flag.String("target", firstNonEmpty(os.Getenv("SCW_RELAY_TARGET")), "target contract/address")
		calldata             = flag.String("calldata", firstNonEmpty(os.Getenv("SCW_RELAY_CALLDATA"), "0x"), "target calldata")
		value                = flag.String("value", firstNonEmpty(os.Getenv("SCW_RELAY_VALUE"), "0"), "native token amount in wei")
		gasLimit             = flag.Uint64("gas-limit", parseUint64Env("SCW_RELAY_GAS_LIMIT", 21000), "relay gas limit")
		maxFeePerGas         = flag.String("max-fee-per-gas", firstNonEmpty(os.Getenv("SCW_RELAY_MAX_FEE_PER_GAS")), "optional max fee per gas in wei")
		maxPriorityFeePerGas = flag.String("max-priority-fee-per-gas", firstNonEmpty(os.Getenv("SCW_RELAY_MAX_PRIORITY_FEE_PER_GAS")), "optional max priority fee per gas in wei")
		nonce                = flag.String("nonce", firstNonEmpty(os.Getenv("SCW_RELAY_NONCE")), "optional relayer nonce/domain")
		deadlineSeconds      = flag.Int64("deadline-seconds", parseInt64Env("SCW_RELAY_DEADLINE_SECONDS", 300), "seconds from now until relay deadline")
		functionName         = flag.String("function-name", firstNonEmpty(os.Getenv("SCW_RELAY_FUNCTION_NAME")), "optional function label")
		stateMutability      = flag.String("state-mutability", firstNonEmpty(os.Getenv("SCW_RELAY_STATE_MUTABILITY")), "optional mutability label")
	)
	flag.Parse()

	bundle, err := scw.LoadBundleFile(strings.TrimSpace(*bundlePath))
	if err != nil {
		log.Fatalf("load bundle: %v", err)
	}
	if strings.TrimSpace(bundle.SmartWalletAddress) == "" {
		log.Fatal("bundle missing smart_wallet_address; update the bundle after SCW deployment")
	}

	contractAddress := strings.TrimSpace(*targetContract)
	if contractAddress == "" {
		contractAddress = bundle.OwnerAddress
	}

	request := base.SCWRelayRequest{
		Chain:                strings.TrimSpace(*chain),
		ChainID:              bundle.ChainID,
		SmartWalletAddress:   bundle.SmartWalletAddress,
		SessionKeyAddress:    bundle.SessionKeyAddress,
		PolicyID:             bundle.PolicyID,
		StrategyID:           strings.TrimSpace(*strategyID),
		ContractAddress:      contractAddress,
		Calldata:             strings.TrimSpace(*calldata),
		Value:                strings.TrimSpace(*value),
		GasLimit:             *gasLimit,
		MaxFeePerGas:         strings.TrimSpace(*maxFeePerGas),
		MaxPriorityFeePerGas: strings.TrimSpace(*maxPriorityFeePerGas),
		FunctionName:         strings.TrimSpace(*functionName),
		StateMutability:      strings.TrimSpace(*stateMutability),
		Nonce:                strings.TrimSpace(*nonce),
		DeadlineUnix:         time.Now().Add(time.Duration(*deadlineSeconds) * time.Second).Unix(),
	}

	signature, err := signRequest(bundle.SessionPrivateKey, request)
	if err != nil {
		log.Fatalf("sign request: %v", err)
	}
	request.Signature = signature

	validated, err := relayer.ValidateSCWRelayRequest(request, bundle.RelayerPolicy, time.Now())
	if err != nil {
		log.Fatalf("validate relay request: %v", err)
	}

	output, err := json.MarshalIndent(outputEnvelope{
		Request:   request,
		Validated: validated,
	}, "", "  ")
	if err != nil {
		log.Fatalf("marshal output: %v", err)
	}
	fmt.Println(string(output))
}

func signRequest(sessionPrivateKey string, request base.SCWRelayRequest) (string, error) {
	privateKey := strings.TrimPrefix(strings.TrimSpace(sessionPrivateKey), "0x")
	signer, err := crypto.HexToECDSA(privateKey)
	if err != nil {
		return "", err
	}
	return base.SignSCWRelayRequest(request, signer)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func parseInt64Env(key string, fallback int64) int64 {
	text := strings.TrimSpace(os.Getenv(key))
	if text == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseUint64Env(key string, fallback uint64) uint64 {
	text := strings.TrimSpace(os.Getenv(key))
	if text == "" {
		return fallback
	}
	parsed, err := strconv.ParseUint(text, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}
