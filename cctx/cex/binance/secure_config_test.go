package binance

import (
	"encoding/base64"
	"testing"

	"github.com/HershyOrg/hershy/cctx/secureconfig"
)

func TestNewBinanceDecryptsEncryptedCredentials(t *testing.T) {
	key, err := secureconfig.ParseMasterKey(base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")))
	if err != nil {
		t.Fatalf("ParseMasterKey() error = %v", err)
	}
	cipher, err := secureconfig.NewCipher(key)
	if err != nil {
		t.Fatalf("NewCipher() error = %v", err)
	}
	encryptedAPIKey, err := cipher.EncryptString("api-key")
	if err != nil {
		t.Fatalf("EncryptString(api_key) error = %v", err)
	}
	encryptedAPISecret, err := cipher.EncryptString("api-secret")
	if err != nil {
		t.Fatalf("EncryptString(api_secret) error = %v", err)
	}

	t.Setenv(secureconfig.DefaultMasterKeyEnv, base64.StdEncoding.EncodeToString(key[:]))

	exchange, err := NewBinance(map[string]any{
		"api_key":    encryptedAPIKey,
		"api_secret": encryptedAPISecret,
	})
	if err != nil {
		t.Fatalf("NewBinance() error = %v", err)
	}
	binanceExchange := exchange.(*Binance)
	if binanceExchange.apiKey != "api-key" {
		t.Fatalf("apiKey = %q, want %q", binanceExchange.apiKey, "api-key")
	}
	if binanceExchange.apiSecret != "api-secret" {
		t.Fatalf("apiSecret = %q, want %q", binanceExchange.apiSecret, "api-secret")
	}
}
