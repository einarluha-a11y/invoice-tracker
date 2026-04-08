#!/bin/bash
# Deploy to Railway without HOME scanning issues
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Railway IDs from ~/.railway/config.json
PROJECT_ID="b1508c78-0c04-4474-8933-e76505a593cd"
SERVICE="invoice-tracker-backend"
ENV="production"

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "📋 Creating clean copy from git..."
git archive HEAD | tar -x -C "$TMPDIR"

echo "🚀 Deploying to Railway..."
cd "$TMPDIR"
railway up -d -p "$PROJECT_ID" -s "$SERVICE" -e "$ENV"

echo "✅ Deployed"
