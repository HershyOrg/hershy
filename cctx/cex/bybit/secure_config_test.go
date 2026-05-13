package bybit

import (
	"encoding/base64"
	"testing"

	"github.com/HershyOrg/hershy/cctx/secureconfig"
)

func TestNewBybitDecryptsEncryptedCredentials(t *testing.T) {
	key, err := secureconfig.ParseMasterKey(base64.StdEncoding.EncodeToString([]byte("fedcba9876543210fedcba9876543210")))
	if err != nil {
		t.Fatalf("ParseMasterKey() error = %v", err)
	}
	cipher, err := secureconfig.NewCipher(key)
	if err != nil {
		t.Fatalf("NewCipher() error = %v", err)
	}
	encryptedAPIKey, err := cipher.EncryptString("bybit-key")
	if err != nil {
		t.Fatalf("EncryptString(api_key) error = %v", err)
	}
	encryptedAPISecret, err := cipher.EncryptString("bybit-secret")
	if err != nil {
		t.Fatalf("EncryptString(api_secret) error = %v", err)
	}

	t.Setenv(secureconfig.DefaultMasterKeyEnv, base64.StdEncoding.EncodeToString(key[:]))

	exchange, err := NewBybit(map[string]any{
		"api_key":    encryptedAPIKey,
		"api_secret": encryptedAPISecret,
	})
	if err != nil {
		t.Fatalf("NewBybit() error = %v", err)
	}
	bybitExchange := exchange.(*Bybit)
	if bybitExchange.apiKey != "bybit-key" {
		t.Fatalf("apiKey = %q, want %q", bybitExchange.apiKey, "bybit-key")
	}
	if bybitExchange.apiSecret != "bybit-secret" {
		t.Fatalf("apiSecret = %q, want %q", bybitExchange.apiSecret, "bybit-secret")
	}
}
