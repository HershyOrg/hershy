# Simple Hersh Program Dockerfile
# This Dockerfile is used by Program to build the container image.

FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy hersh library (injected by Program during build)
COPY . .

# Build the program
RUN go mod download
RUN go build -o simple main.go

# Runtime stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy binary from builder
COPY --from=builder /app/simple .

# Expose WatcherServer port
EXPOSE 8080

# Run the program
CMD ["./simple"]
