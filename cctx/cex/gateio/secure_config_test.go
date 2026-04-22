package gateio

import (
	"encoding/base64"
	"testing"

	"github.com/HershyOrg/hershy/cctx/secureconfig"
)

func TestNewGateIODecryptsEncryptedCredentials(t *testing.T) {
	key, err := secureconfig.ParseMasterKey(base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")))
	if err != nil {
		t.Fatalf("ParseMasterKey() error = %v", err)
	}
	cipher, err := secureconfig.NewCipher(key)
	if err != nil {
		t.Fatalf("NewCipher() error = %v", err)
	}
	encryptedAPIKey, err := cipher.EncryptString("gate-key")
	if err != nil {
		t.Fatalf("EncryptString(api_key) error = %v", err)
	}
	encryptedAPISecret, err := cipher.EncryptString("gate-secret")
	if err != nil {
		t.Fatalf("EncryptString(api_secret) error = %v", err)
	}

	t.Setenv(secureconfig.DefaultMasterKeyEnv, base64.StdEncoding.EncodeToString(key[:]))

	exchange, err := NewGateIO(map[string]any{
		"api_key":    encryptedAPIKey,
		"api_secret": encryptedAPISecret,
	})
	if err != nil {
		t.Fatalf("NewGateIO() error = %v", err)
	}
	gateExchange := exchange.(*GateIO)
	if gateExchange.apiKey != "gate-key" {
		t.Fatalf("apiKey = %q, want %q", gateExchange.apiKey, "gate-key")
	}
	if gateExchange.apiSecret != "gate-secret" {
		t.Fatalf("apiSecret = %q, want %q", gateExchange.apiSecret, "gate-secret")
	}
}
