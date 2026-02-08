FROM golang:1.24-alpine AS builder

WORKDIR /build

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum ./
COPY main.go .

RUN go mod download

RUN CGO_ENABLED=0 GOOS=linux go build -o simple-counter main.go

FROM alpine:latest

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /build/simple-counter /app/

RUN mkdir -p /state

EXPOSE 8080

CMD ["/app/simple-counter"]