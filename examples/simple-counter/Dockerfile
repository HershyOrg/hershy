FROM golang:1.24-alpine AS builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Copy go.mod and source
COPY go.mod .
COPY main.go .

# Copy hersh framework
COPY ../../hersh /build/hersh

# Build
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -o simple-counter main.go

# Runtime stage
FROM alpine:latest

RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy binary
COPY --from=builder /build/simple-counter /app/

# Create state directory
RUN mkdir -p /state

# WatcherAPI runs on :8080
EXPOSE 8080

CMD ["/app/simple-counter"]
