#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "=== Step 1: Accept Xcode license (you may need to enter your password) ==="
sudo xcodebuild -license accept

echo ""
echo "=== Step 2: Install cmake and libwebsockets via Homebrew ==="
brew install cmake libwebsockets

echo ""
echo "=== Step 3: Build UltraleapTrackingWebSocket ==="
npm run setup-leap-bridge

echo ""
echo "Done! Run 'npm run dev' to start the app with Leap Motion."
