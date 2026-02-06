#!/bin/bash
program_id=$(cat .last-program-id)
echo "📊 Monitoring program: $program_id"
echo ""

for i in {1..30}; do
    response=$(curl -s "localhost:9000/programs/${program_id}")
    state=$(echo "$response" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)
    
    echo "[Attempt $i/30] State: $state"
    
    if [ "$state" = "Ready" ]; then
        echo ""
        echo "✅ Program reached Ready state!"
        container_id=$(echo "$response" | grep -o '"container_id":"[^"]*"' | cut -d'"' -f4)
        echo "   Container ID: $container_id"
        exit 0
    elif [ "$state" = "Error" ]; then
        error_msg=$(echo "$response" | grep -o '"error_msg":"[^"]*"' | cut -d'"' -f4)
        echo ""
        echo "❌ Program failed: $error_msg"
        exit 1
    fi
    
    sleep 2
done

echo ""
echo "⏰ Timeout"
