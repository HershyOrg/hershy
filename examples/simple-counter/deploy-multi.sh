#!/bin/bash
set -e

HOST="localhost:9000"

echo "📦 Deploying 3 simple-counter instances..."
echo ""

for i in 1 2 3; do
    echo "🚀 Deploying instance $i..."
    
    payload=$(jq -n \
        --arg user "test-user-$i" \
        --arg dockerfile "$(cat Dockerfile)" \
        --arg main "$(cat main.go)" \
        --arg gomod "$(cat go.mod)" \
        --arg gosum "$(cat go.sum)" \
        '{
            UserID: $user,
            Files: {
                "Dockerfile": $dockerfile,
                "main.go": $main,
                "go.mod": $gomod,
                "go.sum": $gosum
            }
        }')
    
    response=$(curl -s -X POST "$HOST/programs" \
        -H "Content-Type: application/json" \
        -d "$payload")
    
    program_id=$(echo "$response" | jq -r '.ProgramID')
    echo "   Program ID: $program_id"
    echo "$program_id" > ".program-id-$i"
    echo ""
done

echo "✅ All 3 instances deployed!"
echo ""
echo "🔍 Checking program states..."
curl -s "$HOST/programs" | jq '.'
