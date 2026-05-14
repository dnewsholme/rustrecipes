#!/bin/bash
set -e

# Pull Gemini API Key from file if it exists
if [ -f "geminiapikey.txt" ]; then
    export GEMINI_API_KEY=$(cat geminiapikey.txt | tr -d '\r\n')
    echo "🔑 Gemini API Key loaded (length: ${#GEMINI_API_KEY})."
else
    echo "⚠️ GEMINI_API_KEY not found. Skipping tests that require AI."
fi

# Configuration
export ADMIN_PASSWORD=${ADMIN_PASSWORD:-"admin"}
export SESSION_SECRET=${SESSION_SECRET:-"dev_secret_key_for_testing_only"}
export API_TOKEN=${API_TOKEN:-"test-token"}
# APP_BASE should be the subpath prefix (e.g. "" or "/recipes"), NOT the full URL
export APP_BASE=${APP_BASE:-""}
export ALLOW_YOUTUBE_TESTS=true

# Enable BuildKit for faster, modern builds
# If this fails on your system due to missing buildx, uncomment the next line
# export DOCKER_BUILDKIT=0
export DOCKER_BUILDKIT=1

echo "🐳 Building Docker test image..."
docker build -t recipemanager-test -f Dockerfile.test .

echo "🚀 Running tests in Docker container..."
# Ensure report directories exist so they can be mounted
mkdir -p playwright-report test-results

docker run --rm \
    -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    -e SESSION_SECRET="$SESSION_SECRET" \
    -e APP_BASE="$APP_BASE" \
    -e GEMINI_API_KEY="$GEMINI_API_KEY" \
    -e API_TOKEN="$API_TOKEN" \
    -e ALLOW_YOUTUBE_TESTS="$ALLOW_YOUTUBE_TESTS" \
    -v "$(pwd)/playwright-report:/app/playwright-report" \
    -v "$(pwd)/test-results:/app/test-results" \
    recipemanager-test

echo "✅ Tests complete. Reports exported to playwright-report/"
