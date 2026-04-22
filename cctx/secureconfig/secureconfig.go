package secureconfig

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

const (
	// DefaultMasterKeyEnv is the environment variable used for secure config decryption.
	DefaultMasterKeyEnv = "CCTX_MASTER_KEY"
	envelopePrefix      = "enc:v1:"
)

var (
	// ErrMasterKeyNotConfigured is returned when decryption is requested without a configured master key.
	ErrMasterKeyNotConfigured = errors.New("secureconfig: master key not configured")
	// ErrInvalidMasterKey is returned when the configured master key cannot be parsed.
	ErrInvalidMasterKey = errors.New("secureconfig: invalid master key")
	// ErrInvalidEncryptedValue is returned when an encrypted envelope cannot be parsed.
	ErrInvalidEncryptedValue = errors.New("secureconfig: invalid encrypted value")
)

// MasterKey is the 32-byte AES-256 key used for config encryption.
type MasterKey [32]byte

// Cipher encrypts and decrypts config secrets using AES-256-GCM.
type Cipher struct {
	aead cipher.AEAD
}

// ParseMasterKey parses a 32-byte key from base64, base64url, hex, or raw text.
func ParseMasterKey(raw string) (MasterKey, error) {
	var key MasterKey
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return key, ErrMasterKeyNotConfigured
	}

	decoded, err := decodeKeyMaterial(trimmed)
	if err != nil {
		return key, fmt.Errorf("%w: %v", ErrInvalidMasterKey, err)
	}
	if len(decoded) != len(key) {
		return key, fmt.Errorf("%w: expected 32 bytes, got %d", ErrInvalidMasterKey, len(decoded))
	}
	copy(key[:], decoded)
	return key, nil
}

// MasterKeyFromEnv parses the configured master key from DefaultMasterKeyEnv.
func MasterKeyFromEnv() (MasterKey, error) {
	return ParseMasterKey(strings.TrimSpace(getenv(DefaultMasterKeyEnv)))
}

// NewCipher constructs a Cipher for the provided master key.
func NewCipher(key MasterKey) (*Cipher, error) {
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{aead: aead}, nil
}

// EncryptString encrypts plaintext into an enc:v1 envelope.
func (c *Cipher) EncryptString(plaintext string) (string, error) {
	if c == nil || c.aead == nil {
		return "", errors.New("secureconfig: cipher is nil")
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := c.aead.Seal(nil, nonce, []byte(plaintext), nil)
	return envelopePrefix +
		base64.RawURLEncoding.EncodeToString(nonce) + ":" +
		base64.RawURLEncoding.EncodeToString(ciphertext), nil
}

// DecryptString decrypts an enc:v1 envelope into plaintext.
func (c *Cipher) DecryptString(value string) (string, error) {
	if !IsEncryptedString(value) {
		return value, nil
	}
	if c == nil || c.aead == nil {
		return "", errors.New("secureconfig: cipher is nil")
	}

	parts := strings.Split(strings.TrimPrefix(value, envelopePrefix), ":")
	if len(parts) != 2 {
		return "", ErrInvalidEncryptedValue
	}
	nonce, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", fmt.Errorf("%w: decode nonce: %v", ErrInvalidEncryptedValue, err)
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("%w: decode ciphertext: %v", ErrInvalidEncryptedValue, err)
	}
	plaintext, err := c.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidEncryptedValue, err)
	}
	return string(plaintext), nil
}

// IsEncryptedString reports whether the value uses the supported enc:v1 envelope.
func IsEncryptedString(value string) bool {
	return strings.HasPrefix(strings.TrimSpace(value), envelopePrefix)
}

// ResolveString returns plaintext for both plain and encrypted values.
func ResolveString(value string) (string, error) {
	if !IsEncryptedString(value) {
		return value, nil
	}
	key, err := MasterKeyFromEnv()
	if err != nil {
		return "", err
	}
	cipher, err := NewCipher(key)
	if err != nil {
		return "", err
	}
	return cipher.DecryptString(value)
}

// ResolveMap deep-copies config while decrypting any enc:v1 strings it contains.
func ResolveMap(config map[string]any) (map[string]any, error) {
	if config == nil {
		return nil, nil
	}
	resolved, err := resolveValue(config)
	if err != nil {
		return nil, err
	}
	out, ok := resolved.(map[string]any)
	if !ok {
		return nil, errors.New("secureconfig: resolved config is not a map")
	}
	return out, nil
}

func resolveValue(value any) (any, error) {
	switch typed := value.(type) {
	case string:
		return ResolveString(typed)
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, inner := range typed {
			resolved, err := resolveValue(inner)
			if err != nil {
				return nil, err
			}
			out[key] = resolved
		}
		return out, nil
	case map[string]string:
		out := make(map[string]string, len(typed))
		for key, inner := range typed {
			resolved, err := ResolveString(inner)
			if err != nil {
				return nil, err
			}
			out[key] = resolved
		}
		return out, nil
	case []any:
		out := make([]any, len(typed))
		for i, inner := range typed {
			resolved, err := resolveValue(inner)
			if err != nil {
				return nil, err
			}
			out[i] = resolved
		}
		return out, nil
	case []string:
		out := make([]string, len(typed))
		for i, inner := range typed {
			resolved, err := ResolveString(inner)
			if err != nil {
				return nil, err
			}
			out[i] = resolved
		}
		return out, nil
	default:
		return value, nil
	}
}

func decodeKeyMaterial(raw string) ([]byte, error) {
	tryDecode := []func(string) ([]byte, error){
		base64.StdEncoding.DecodeString,
		base64.RawStdEncoding.DecodeString,
		base64.URLEncoding.DecodeString,
		base64.RawURLEncoding.DecodeString,
		hex.DecodeString,
	}
	for _, decoder := range tryDecode {
		decoded, err := decoder(raw)
		if err == nil {
			return decoded, nil
		}
	}
	if len(raw) == 32 {
		return []byte(raw), nil
	}
	return nil, errors.New("supported encodings are base64, base64url, hex, or raw 32-byte strings")
}

var getenv = os.Getenv
