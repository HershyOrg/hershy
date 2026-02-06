package base

// DrManhattanError is the base error type for the project.
type DrManhattanError struct {
	// Message is the error message.
	Message string
}

// Error returns the error message.
func (e DrManhattanError) Error() string {
	return e.Message
}

// ExchangeError represents exchange-specific errors.
type ExchangeError struct {
	// Message is the error message.
	Message string
}

// Error returns the error message.
func (e ExchangeError) Error() string {
	return e.Message
}

// NetworkError represents network connectivity errors.
type NetworkError struct {
	// Message is the error message.
	Message string
}

// Error returns the error message.
func (e NetworkError) Error() string {
	return e.Message
}

// RateLimitError represents rate limit errors.
type RateLimitError struct {
	// Message is the error message.
	Message string
}

// Error returns the error message.
func (e RateLimitError) Error() string {
	return e.Message
}

// AuthenticationError represents authentication failures.
type AuthenticationError struct {
	// Message is the error message.
	Message string
}

// Error returns the error message.
func (e AuthenticationError) Error() string {
	return e.Message
}

// InsufficientFunds represents insufficient funds errors.
type InsufficientFunds struct {
	// Message is the error message.
	Message string
}

// Error returns the error message.
func (e InsufficientFunds) Error() string {
	return e.Message
}

// InvalidOrder represents invalid order parameters.
type InvalidOrder struct {
	// Message is the error message.
	Message string
}

// Error returns the error message.
func (e InvalidOrder) Error() string {
	return e.Message
}

// MarketNotFound represents missing markets.
type MarketNotFound struct {
	// Message is the error message.
	Message string
}

// Error returns the error message.
func (e MarketNotFound) Error() string {
	return e.Message
}
