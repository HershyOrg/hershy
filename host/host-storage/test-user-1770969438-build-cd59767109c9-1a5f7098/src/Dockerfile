FROM golang:1.24-alpine AS builder

WORKDIR /build

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum ./
COPY *.go ./
COPY cctx.tgz.b64 ./

RUN mkdir -p /build/cctx     && base64 -d cctx.tgz.b64 | tar -xz -C /build/cctx

RUN go mod edit -replace github.com/HershyOrg/hershy/cctx=./cctx
RUN go mod download

RUN CGO_ENABLED=0 GOOS=linux go build -o polymarket-trader .

FROM alpine:latest

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /build/polymarket-trader /app/
COPY prob_model_logit_all.json /app/

EXPOSE 8080

CMD ["/app/polymarket-trader", "--model-path", "/app/prob_model_logit_all.json", "--slug", "test-market", "--paper", "--signals-only", "--token-id-up", "1", "--token-id-down", "2"]
