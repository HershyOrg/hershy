FROM golang:1.24-alpine AS builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Copy go files
COPY go.mod ./
COPY *.go ./

# Download dependencies (hersh from Go proxy)
RUN go mod download

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -o trading-sim .

# Runtime stage
FROM alpine:latest

RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy binary
COPY --from=builder /build/trading-sim /app/

# Create state directory
RUN mkdir -p /state

# WatcherAPI port
EXPOSE 8080

CMD ["/app/trading-sim"]
