package secureconfig

import (
	"encoding/base64"
	"errors"
	"testing"
)

func TestResolveStringRoundTrip(t *testing.T) {
	key, err := ParseMasterKey(base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")))
	if err != nil {
		t.Fatalf("ParseMasterKey() error = %v", err)
	}
	cipher, err := NewCipher(key)
	if err != nil {
		t.Fatalf("NewCipher() error = %v", err)
	}
	encrypted, err := cipher.EncryptString("binance-secret")
	if err != nil {
		t.Fatalf("EncryptString() error = %v", err)
	}

	t.Setenv(DefaultMasterKeyEnv, base64.StdEncoding.EncodeToString(key[:]))
	resolved, err := ResolveString(encrypted)
	if err != nil {
		t.Fatalf("ResolveString() error = %v", err)
	}
	if resolved != "binance-secret" {
		t.Fatalf("ResolveString() = %q, want %q", resolved, "binance-secret")
	}
}

func TestResolveMapDecryptsNestedValues(t *testing.T) {
	key, err := ParseMasterKey(base64.StdEncoding.EncodeToString([]byte("fedcba9876543210fedcba9876543210")))
	if err != nil {
		t.Fatalf("ParseMasterKey() error = %v", err)
	}
	cipher, err := NewCipher(key)
	if err != nil {
		t.Fatalf("NewCipher() error = %v", err)
	}
	apiSecret, err := cipher.EncryptString("secret-123")
	if err != nil {
		t.Fatalf("EncryptString() error = %v", err)
	}
	privateKey, err := cipher.EncryptString("0xabc")
	if err != nil {
		t.Fatalf("EncryptString() error = %v", err)
	}

	t.Setenv(DefaultMasterKeyEnv, base64.StdEncoding.EncodeToString(key[:]))
	config := map[string]any{
		"api_key": apiSecret,
		"nested": map[string]any{
			"private_key": privateKey,
		},
		"labels": []string{"plain", privateKey},
	}

	resolved, err := ResolveMap(config)
	if err != nil {
		t.Fatalf("ResolveMap() error = %v", err)
	}

	if got := resolved["api_key"]; got != "secret-123" {
		t.Fatalf("resolved api_key = %#v, want %q", got, "secret-123")
	}
	nested := resolved["nested"].(map[string]any)
	if got := nested["private_key"]; got != "0xabc" {
		t.Fatalf("resolved nested private_key = %#v, want %q", got, "0xabc")
	}
	labels := resolved["labels"].([]string)
	if labels[1] != "0xabc" {
		t.Fatalf("resolved labels[1] = %q, want %q", labels[1], "0xabc")
	}
}

func TestResolveStringRequiresConfiguredMasterKey(t *testing.T) {
	if _, err := ResolveString("enc:v1:nonce:ciphertext"); !errors.Is(err, ErrMasterKeyNotConfigured) {
		t.Fatalf("ResolveString() error = %v, want %v", err, ErrMasterKeyNotConfigured)
	}
}
