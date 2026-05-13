package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/HershyOrg/hershy/cctx/secureconfig"
)

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		printUsage(stderr)
		return errors.New("command required")
	}

	switch args[0] {
	case "generate-key":
		return runGenerateKey(args[1:], stdout)
	case "encrypt":
		return runEncrypt(args[1:], stdout)
	case "decrypt":
		return runDecrypt(args[1:], stdout)
	case "roundtrip":
		return runRoundTrip(args[1:], stdout)
	case "-h", "--help", "help":
		printUsage(stdout)
		return nil
	default:
		printUsage(stderr)
		return fmt.Errorf("unknown command: %s", args[0])
	}
}

func runGenerateKey(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("generate-key", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	format := fs.String("format", "base64", "output format: base64 or hex")
	if err := fs.Parse(args); err != nil {
		return err
	}

	var raw [32]byte
	if _, err := io.ReadFull(rand.Reader, raw[:]); err != nil {
		return err
	}

	switch strings.ToLower(strings.TrimSpace(*format)) {
	case "base64":
		_, err := fmt.Fprintln(stdout, base64.StdEncoding.EncodeToString(raw[:]))
		return err
	case "hex":
		_, err := fmt.Fprintln(stdout, fmt.Sprintf("%x", raw[:]))
		return err
	default:
		return fmt.Errorf("unsupported format: %s", *format)
	}
}

func runEncrypt(args []string, stdout io.Writer) error {
	value, err := parseValueArgs("encrypt", args)
	if err != nil {
		return err
	}
	cipher, err := loadCipherFromEnv()
	if err != nil {
		return err
	}
	encrypted, err := cipher.EncryptString(value)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(stdout, encrypted)
	return err
}

func runDecrypt(args []string, stdout io.Writer) error {
	value, err := parseValueArgs("decrypt", args)
	if err != nil {
		return err
	}
	cipher, err := loadCipherFromEnv()
	if err != nil {
		return err
	}
	decrypted, err := cipher.DecryptString(value)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(stdout, decrypted)
	return err
}

func runRoundTrip(args []string, stdout io.Writer) error {
	value, err := parseValueArgs("roundtrip", args)
	if err != nil {
		return err
	}
	cipher, err := loadCipherFromEnv()
	if err != nil {
		return err
	}
	encrypted, err := cipher.EncryptString(value)
	if err != nil {
		return err
	}
	decrypted, err := cipher.DecryptString(encrypted)
	if err != nil {
		return err
	}

	if _, err := fmt.Fprintf(stdout, "encrypted=%s\n", encrypted); err != nil {
		return err
	}
	_, err = fmt.Fprintf(stdout, "decrypted=%s\n", decrypted)
	return err
}

func parseValueArgs(name string, args []string) (string, error) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	value := fs.String("value", "", "literal value")
	readStdin := fs.Bool("stdin", false, "read value from stdin")
	if err := fs.Parse(args); err != nil {
		return "", err
	}

	switch {
	case *readStdin && strings.TrimSpace(*value) != "":
		return "", errors.New("use either --value or --stdin, not both")
	case *readStdin:
		return readSingleValue(os.Stdin)
	case strings.TrimSpace(*value) != "":
		return *value, nil
	default:
		return "", errors.New("value required: use --value or --stdin")
	}
}

func readSingleValue(reader io.Reader) (string, error) {
	scanner := bufio.NewScanner(reader)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return "", err
		}
		return "", errors.New("stdin is empty")
	}
	return scanner.Text(), nil
}

func loadCipherFromEnv() (*secureconfig.Cipher, error) {
	key, err := secureconfig.MasterKeyFromEnv()
	if err != nil {
		return nil, err
	}
	return secureconfig.NewCipher(key)
}

func printUsage(w io.Writer) {
	fmt.Fprintln(w, "usage:")
	fmt.Fprintln(w, "  go run ./cmd/secureconfig generate-key [--format base64|hex]")
	fmt.Fprintln(w, "  go run ./cmd/secureconfig encrypt --value <plain>")
	fmt.Fprintln(w, "  go run ./cmd/secureconfig encrypt --stdin")
	fmt.Fprintln(w, "  go run ./cmd/secureconfig decrypt --value <enc:v1:...>")
	fmt.Fprintln(w, "  go run ./cmd/secureconfig roundtrip --value <plain>")
	fmt.Fprintln(w, "")
	fmt.Fprintf(w, "requires %s for encrypt/decrypt/roundtrip\n", secureconfig.DefaultMasterKeyEnv)
}
