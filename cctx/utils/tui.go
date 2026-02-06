package utils

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// PromptSelection prompts user to select an item from a list.
func PromptSelection[T any](
	items []T,
	title string,
	formatItem func(int, T) string,
	allowQuit bool,
) (T, bool) {
	var zero T
	if len(items) == 0 {
		DefaultLogger().Debugf("utils.PromptSelection: items empty")
		return zero, false
	}
	if len(items) == 1 {
		return items[0], true
	}

	if title == "" {
		DefaultLogger().Debugf("utils.PromptSelection: title empty, using default")
		title = "Select an option:"
	}

	fmt.Printf("\n%s\n", Bold(title))

	for i, item := range items {
		display := fmt.Sprint(item)
		if formatItem != nil {
			display = formatItem(i, item)
		}
		fmt.Printf("  %s - %s\n", Cyan(fmt.Sprintf("%d", i)), display)
	}
	if allowQuit {
		fmt.Printf("  %s - Quit\n", Cyan("q"))
	}

	reader := bufio.NewReader(os.Stdin)
	for {
		fmt.Printf("\n%s ", Bold("Enter choice:"))
		choice, err := readLine(reader)
		if err != nil {
			DefaultLogger().Debugf("utils.PromptSelection: readLine error: %v", err)
			return zero, false
		}
		choice = strings.ToLower(strings.TrimSpace(choice))
		if allowQuit && choice == "q" {
			return zero, false
		}
		index, ok := parseIndex(choice, len(items))
		if ok {
			return items[index], true
		}
		maxIdx := len(items) - 1
		quitMsg := ""
		if allowQuit {
			quitMsg = " or 'q'"
		}
		fmt.Printf("  Invalid. Enter 0-%d%s.\n", maxIdx, quitMsg)
	}
}

// PromptConfirm prompts user for yes/no confirmation.
func PromptConfirm(message string, defaultValue bool) bool {
	if message == "" {
		DefaultLogger().Debugf("utils.PromptConfirm: message empty")
	}
	suffix := "[y/N]"
	if defaultValue {
		suffix = "[Y/n]"
	}
	fmt.Printf("%s %s ", message, suffix)

	reader := bufio.NewReader(os.Stdin)
	response, err := readLine(reader)
	if err != nil {
		DefaultLogger().Debugf("utils.PromptConfirm: readLine error: %v", err)
		return false
	}
	response = strings.ToLower(strings.TrimSpace(response))
	if response == "" {
		return defaultValue
	}
	return response == "y" || response == "yes"
}

func readLine(reader *bufio.Reader) (string, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		if len(line) == 0 {
			DefaultLogger().Debugf("utils.readLine: read error with empty line: %v", err)
			return "", err
		}
	}
	if len(line) == 0 {
		DefaultLogger().Debugf("utils.readLine: line empty")
	}
	return strings.TrimRight(line, "\r\n"), nil
}

func parseIndex(value string, max int) (int, bool) {
	if value == "" {
		DefaultLogger().Debugf("utils.parseIndex: value empty")
		return 0, false
	}
	var idx int
	if _, err := fmt.Sscanf(value, "%d", &idx); err != nil {
		DefaultLogger().Debugf("utils.parseIndex: scan error for value=%q: %v", value, err)
		return 0, false
	}
	if idx < 0 || idx >= max {
		DefaultLogger().Debugf("utils.parseIndex: index out of range (idx=%d, max=%d)", idx, max)
		return 0, false
	}
	return idx, true
}
