#!/bin/bash
# Stop old server
lsof -ti:9000 | xargs -r kill -9 2>/dev/null

# Rebuild and start
cd /home/rlaaudgjs5638/hersh/cmd/host
go build -o host-server main.go && \
./host-server > host-server.log 2>&1 &

echo "Host server PID: $!"
sleep 2
tail -10 host-server.log
