package okx

import (
	"encoding/base64"
	"testing"

	"github.com/HershyOrg/hershy/cctx/secureconfig"
)

func TestNewOKXDecryptsEncryptedCredentials(t *testing.T) {
	key, err := secureconfig.ParseMasterKey(base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")))
	if err != nil {
		t.Fatalf("ParseMasterKey() error = %v", err)
	}
	cipher, err := secureconfig.NewCipher(key)
	if err != nil {
		t.Fatalf("NewCipher() error = %v", err)
	}
	encryptedAPIKey, err := cipher.EncryptString("okx-key")
	if err != nil {
		t.Fatalf("EncryptString(api_key) error = %v", err)
	}
	encryptedAPISecret, err := cipher.EncryptString("okx-secret")
	if err != nil {
		t.Fatalf("EncryptString(api_secret) error = %v", err)
	}
	encryptedPassphrase, err := cipher.EncryptString("okx-passphrase")
	if err != nil {
		t.Fatalf("EncryptString(api_passphrase) error = %v", err)
	}

	t.Setenv(secureconfig.DefaultMasterKeyEnv, base64.StdEncoding.EncodeToString(key[:]))

	exchange, err := NewOKX(map[string]any{
		"api_key":        encryptedAPIKey,
		"api_secret":     encryptedAPISecret,
		"api_passphrase": encryptedPassphrase,
	})
	if err != nil {
		t.Fatalf("NewOKX() error = %v", err)
	}
	okxExchange := exchange.(*OKX)
	if okxExchange.apiKey != "okx-key" {
		t.Fatalf("apiKey = %q, want %q", okxExchange.apiKey, "okx-key")
	}
	if okxExchange.apiSecret != "okx-secret" {
		t.Fatalf("apiSecret = %q, want %q", okxExchange.apiSecret, "okx-secret")
	}
	if okxExchange.apiPassphrase != "okx-passphrase" {
		t.Fatalf("apiPassphrase = %q, want %q", okxExchange.apiPassphrase, "okx-passphrase")
	}
}
