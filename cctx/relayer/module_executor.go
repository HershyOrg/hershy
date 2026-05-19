package relayer

import (
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/HershyOrg/hershy/cctx/base"
)

var strategyPolicyModuleExecuteABI = mustParseABI(`[
  {
    "inputs":[
      {"internalType":"address","name":"safe","type":"address"},
      {"internalType":"address","name":"target","type":"address"},
      {"internalType":"bytes","name":"callData","type":"bytes"},
      {"internalType":"uint256","name":"valueWei","type":"uint256"},
      {"internalType":"uint256","name":"gasLimit","type":"uint256"},
      {"internalType":"bytes32","name":"nonceHash","type":"bytes32"},
      {"internalType":"bytes32","name":"policyIdHash","type":"bytes32"},
      {"internalType":"uint256","name":"deadlineUnix","type":"uint256"},
      {"internalType":"bytes","name":"signature","type":"bytes"}
    ],
    "name":"execute",
    "outputs":[{"internalType":"bool","name":"success","type":"bool"}],
    "stateMutability":"nonpayable",
    "type":"function"
  }
]`)

type RPCModuleExecutor struct {
	RPCURL             string
	ModuleAddress      string
	RelayerPrivateKey  string
	GasLimitMultiplier uint64
}

func (e RPCModuleExecutor) SubmitModuleExecute(ctx context.Context, request base.SCWRelayRequest) (string, error) {
	client, err := ethclient.DialContext(ctx, strings.TrimSpace(e.RPCURL))
	if err != nil {
		return "", fmt.Errorf("dial rpc: %w", err)
	}
	defer client.Close()

	moduleAddress := common.HexToAddress(strings.TrimSpace(e.ModuleAddress))
	signer, err := crypto.HexToECDSA(strings.TrimPrefix(strings.TrimSpace(e.RelayerPrivateKey), "0x"))
	if err != nil {
		return "", fmt.Errorf("invalid relayer private key: %w", err)
	}
	from := crypto.PubkeyToAddress(signer.PublicKey)

	callData, err := base.NormalizeSCWRelayCalldata(request.Calldata)
	if err != nil {
		return "", fmt.Errorf("invalid relay calldata: %w", err)
	}
	valueWei, err := base.ParseSCWRelayWeiValue(request.Value)
	if err != nil {
		return "", fmt.Errorf("invalid relay value: %w", err)
	}
	signature := common.FromHex(request.Signature)
	if len(signature) != crypto.SignatureLength {
		return "", fmt.Errorf("invalid relay signature length")
	}
	payload, err := strategyPolicyModuleExecuteABI.Pack(
		"execute",
		common.HexToAddress(request.SmartWalletAddress),
		common.HexToAddress(request.ContractAddress),
		callData,
		valueWei,
		new(big.Int).SetUint64(request.GasLimit),
		base.RelayStringHash(request.Nonce),
		base.RelayStringHash(request.PolicyID),
		big.NewInt(request.DeadlineUnix),
		signature,
	)
	if err != nil {
		return "", fmt.Errorf("pack module execute calldata: %w", err)
	}

	chainID, err := client.ChainID(ctx)
	if err != nil {
		return "", fmt.Errorf("fetch chain id: %w", err)
	}
	nonce, err := client.PendingNonceAt(ctx, from)
	if err != nil {
		return "", fmt.Errorf("fetch relayer nonce: %w", err)
	}

	gasLimit, err := estimateModuleExecuteGas(ctx, client, from, moduleAddress, payload)
	if err != nil {
		return "", err
	}
	if e.GasLimitMultiplier > 1 {
		gasLimit *= e.GasLimitMultiplier
	}

	latestHeader, err := client.HeaderByNumber(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("fetch latest header: %w", err)
	}
	tipCap, err := client.SuggestGasTipCap(ctx)
	if err != nil {
		return "", fmt.Errorf("suggest gas tip cap: %w", err)
	}

	var signedTx *types.Transaction
	if latestHeader != nil && latestHeader.BaseFee != nil {
		maxFeePerGas := new(big.Int).Add(new(big.Int).Mul(latestHeader.BaseFee, big.NewInt(2)), tipCap)
		tx := types.NewTx(&types.DynamicFeeTx{
			ChainID:   chainID,
			Nonce:     nonce,
			To:        &moduleAddress,
			Value:     big.NewInt(0),
			Gas:       gasLimit,
			GasFeeCap: maxFeePerGas,
			GasTipCap: tipCap,
			Data:      payload,
		})
		signedTx, err = types.SignTx(tx, types.LatestSignerForChainID(chainID), signer)
	} else {
		gasPrice, gasErr := client.SuggestGasPrice(ctx)
		if gasErr != nil {
			return "", fmt.Errorf("suggest gas price: %w", gasErr)
		}
		tx := types.NewTx(&types.LegacyTx{
			Nonce:    nonce,
			To:       &moduleAddress,
			Value:    big.NewInt(0),
			Gas:      gasLimit,
			GasPrice: gasPrice,
			Data:     payload,
		})
		signedTx, err = types.SignTx(tx, types.LatestSignerForChainID(chainID), signer)
	}
	if err != nil {
		return "", fmt.Errorf("sign module execute tx: %w", err)
	}
	if err := client.SendTransaction(ctx, signedTx); err != nil {
		return "", fmt.Errorf("send module execute tx: %w", err)
	}
	return signedTx.Hash().Hex(), nil
}

func estimateModuleExecuteGas(ctx context.Context, client *ethclient.Client, from common.Address, moduleAddress common.Address, payload []byte) (uint64, error) {
	estimated, err := client.EstimateGas(ctx, ethereum.CallMsg{
		From: from,
		To:   &moduleAddress,
		Data: payload,
	})
	if err != nil {
		return 0, fmt.Errorf("estimate module execute gas: %w", err)
	}
	if estimated == 0 {
		return 0, fmt.Errorf("estimated module execute gas is zero")
	}
	return estimated + estimated/5, nil
}

func mustParseABI(raw string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(raw))
	if err != nil {
		panic(err)
	}
	return parsed
}
