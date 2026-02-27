FROM golang:1.21-alpine AS build
WORKDIR /src

# copy only module and go files to avoid .dockerignore surprises
COPY go.mod ./
COPY main.go ./

RUN apk add --no-cache git && \
    mkdir -p /out && \
    CGO_ENABLED=0 GOOS=linux go build -mod=mod -ldflags="-s -w" -o /out/watcher-poller main.go

FROM alpine:3.18
RUN apk add --no-cache ca-certificates

COPY --from=build /out/watcher-poller /usr/local/bin/watcher-poller

RUN addgroup -S watcher && adduser -S watcher -G watcher
USER watcher
WORKDIR /var/log/watcher

ENTRYPOINT ["/usr/local/bin/watcher-poller"]
CMD ["--host","http://host.docker.internal:9000","--out","/var/log/watcher","--interval","5","--discover"]
