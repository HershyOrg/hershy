FROM golang:1.24-alpine AS builder
RUN apk add --no-cache git
WORKDIR /src

# monitor 폴더가 빌드 컨텍스트이므로 go.mod/go.sum은 ./에 존재해야 함
COPY go.mod go.sum ./
RUN go env -w GOPROXY=https://proxy.golang.org,direct && go mod download

COPY . /src
# cron 패키지(./cron)를 빌드
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/cron ./cron

FROM alpine:3.18
RUN apk add --no-cache ca-certificates tzdata
# 빌드 컨텍스트가 ./monitor 이므로 경로는 cron/jobs.crontab
COPY cron/jobs.crontab /etc/crontabs/root
COPY --from=builder /app/cron /app/cron
RUN chmod +x /app/cron
CMD ["crond", "-f", "-l", "2"]