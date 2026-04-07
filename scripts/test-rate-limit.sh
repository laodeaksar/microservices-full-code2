#!/bin/bash

# Test rate limiting on product service
BASE_URL="http://localhost:8000"
ENDPOINT="/products"
MAX_REQUESTS=105  # Slightly over the 100 req/min limit

echo "Testing rate limiting on ${BASE_URL}${ENDPOINT}"
echo "Sending ${MAX_REQUESTS} requests..."

success_count=0
rejected_count=0

for i in $(seq 1 $MAX_REQUESTS); do
  response=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${ENDPOINT}")
  
  if [ "$response" = "200" ]; then
    success_count=$((success_count + 1))
  elif [ "$response" = "429" ]; then
    rejected_count=$((rejected_count + 1))
  fi
  
  # Print progress every 10 requests
  if [ $((i % 10)) -eq 0 ]; then
    echo "Progress: ${i}/${MAX_REQUESTS} - Success: ${success_count}, Rejected: ${rejected_count}"
  fi
done

echo ""
echo "=== Results ==="
echo "Successful requests: ${success_count}"
echo "Rejected requests: ${rejected_count}"

if [ $rejected_count -gt 0 ]; then
  echo "✅ Rate limiting is working correctly"
else
  echo "❌ Rate limiting may not be configured correctly"
fi
