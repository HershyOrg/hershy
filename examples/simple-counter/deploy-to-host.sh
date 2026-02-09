#!/bin/bash

HOST_URL="http://localhost:9000"
TEST_USER="test-user-$(date +%s)"

echo "📦 Preparing simple-counter deployment..."

# Read source files and convert to JSON strings using jq
DOCKERFILE=$(cat Dockerfile | jq -Rs .)
MAIN_GO=$(cat main.go | jq -Rs .)
GO_MOD=$(cat go.mod | jq -Rs .)
GO_SUM=$(cat go.sum | jq -Rs .)

# Create payload
payload=$(cat <<EOF
{
    "user_id": "$TEST_USER",
    "dockerfile": $DOCKERFILE,
    "src_files": {
        "main.go": $MAIN_GO,
        "go.mod": $GO_MOD,
        "go.sum": $GO_SUM
    }
}
EOF
)

echo "🚀 Creating program..."
response=$(curl -s -X POST "${HOST_URL}/programs" \
    -H "Content-Type: application/json" \
    -d "$payload")

echo "$response" | python3 -m json.tool 2>/dev/null || echo "$response"

# Extract program ID
program_id=$(echo "$response" | grep -o '"program_id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$program_id" ]; then
    echo "❌ Failed to create program"
    exit 1
fi

echo ""
echo "✅ Program created: $program_id"
echo ""
echo "📊 Starting program..."

# Start program
start_response=$(curl -s -X POST "${HOST_URL}/programs/${program_id}/start")
echo "$start_response" | python3 -m json.tool 2>/dev/null || echo "$start_response"

echo ""
echo "⏳ Monitor progress:"
echo "   curl localhost:9000/programs/${program_id}"
echo ""
echo "🔗 Access WatcherAPI (once Ready):"
echo "   curl localhost:9000/programs/${program_id}/proxy/watcher/status"
echo ""

# Save program ID for later
echo "$program_id" > .last-program-id
echo "💾 Program ID saved to .last-program-id"
