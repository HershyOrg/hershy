FROM golang:1.24-alpine AS builder

# Install git for go mod download
RUN apk add --no-cache git

WORKDIR /build

# Copy go.mod, go.sum and source
COPY go.mod go.sum ./
COPY main.go .

# Download dependencies (hersh framework from GitHub)
# Use direct proxy and skip checksum verification for private/new modules
RUN GOPROXY=direct GOSUMDB=off go mod download

# Build (skip checksum verification)
RUN GOSUMDB=off go build -o watcher-server main.go

FROM alpine:latest

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /build/watcher-server /app/

# WatcherAPI runs on :8080
EXPOSE 8080

CMD ["/app/watcher-server"]
