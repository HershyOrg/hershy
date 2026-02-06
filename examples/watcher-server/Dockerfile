FROM golang:1.21-alpine AS builder

WORKDIR /build

# Copy go.mod and source
COPY go.mod .
COPY main.go .

# Copy hersh framework
COPY hersh /build/hersh

# Build
RUN go mod download
RUN go build -o watcher-server main.go

FROM alpine:latest

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /build/watcher-server /app/

# WatcherAPI runs on :8080
EXPOSE 8080

CMD ["/app/watcher-server"]
