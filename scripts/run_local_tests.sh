#!/bin/bash

# Pull Gemini API Key from file if it exists
if [ -f "geminiapikey.txt" ]; then
    export GEMINI_API_KEY=$(cat geminiapikey.txt)
fi

# Configuration
export ADMIN_PASSWORD=${ADMIN_PASSWORD:-"admin"}
export SESSION_SECRET=${SESSION_SECRET:-"dev_secret_key_for_testing_only"}
export APP_BASE=${APP_BASE:-"http://localhost:3000"}

# If GEMINI_API_KEY is not set, YouTube imports will fail, but other tests will pass.
# export GEMINI_API_KEY="your_key_here"

# Generate a hash for the admin password if not provided
# Using a valid hash for "admin"
export ADMIN_PASSWORD_HASH=${ADMIN_PASSWORD_HASH:-'$2b$12$xU63w1/.HZtlvUU1CFjzeejLtcHV0AcP7QUrVyCgsSQ2suC2rs3pK'}

echo "🚀 Preparing local UI tests..."

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing Node dependencies..."
    npm install
fi

# Build the server once
echo "🦀 Building Rust server..."
cargo build --bin recipemanager

# Set USE_BINARY=1 so Playwright uses the built binary directly
export USE_BINARY=1

# Run the tests
echo "🎭 Running Playwright tests..."
npx playwright test "$@"
