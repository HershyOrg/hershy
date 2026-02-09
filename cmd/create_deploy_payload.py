#!/usr/bin/env python3

import json
import sys
import os

if len(sys.argv) < 3:
    print("Usage: create_deploy_payload.py <example_name> <example_dir>", file=sys.stderr)
    sys.exit(1)

example_name = sys.argv[1]
example_dir = sys.argv[2]

# Read Dockerfile
with open(os.path.join(example_dir, "Dockerfile"), "r") as f:
    dockerfile = f.read()

# Read go.mod
with open(os.path.join(example_dir, "go.mod"), "r") as f:
    go_mod = f.read()

# Read go.sum (if exists)
go_sum_path = os.path.join(example_dir, "go.sum")
go_sum = ""
if os.path.exists(go_sum_path):
    with open(go_sum_path, "r") as f:
        go_sum = f.read()

# Build src_files based on example
src_files = {"go.mod": go_mod}
if go_sum:
    src_files["go.sum"] = go_sum

if example_name in ["simple-counter", "watcher-server"]:
    with open(os.path.join(example_dir, "main.go"), "r") as f:
        src_files["main.go"] = f.read()
elif example_name == "trading-long":
    files = ["main.go", "commands.go", "stats.go", "binance_stream.go", "trading_sim.go"]
    for fname in files:
        fpath = os.path.join(example_dir, fname)
        with open(fpath, "r") as f:
            src_files[fname] = f.read()

# Create payload
payload = {
    "user_id": f"e2e-test-{example_name}",
    "dockerfile": dockerfile,
    "src_files": src_files
}

# Output JSON
print(json.dumps(payload))
