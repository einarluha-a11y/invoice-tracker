#!/bin/bash
# wait_deploy.sh — wait for a specific commit to be live on Railway.
#
# Railway auto-deploys on push to main, but the full build (npm install +
# vite build + container boot) takes 3-5 minutes. Staring at `railway logs`
# during that time is misleading because old PM2 processes keep heartbeating
# until the new container replaces them.
#
# This script polls /health until the commitShort field matches the commit
# we're waiting for, then exits 0. Use after `git push` or PR merge instead
# of `sleep 60 && railway logs`.
#
# Usage:
#   scripts/wait_deploy.sh                  # wait for current HEAD
#   scripts/wait_deploy.sh <commit_sha>     # wait for specific commit
#
# Environment:
#   HEALTH_URL   — override the health endpoint (default: Railway URL)
#   MAX_WAIT_SEC — timeout in seconds (default: 420 = 7 min)
#   POLL_SEC     — poll interval (default: 10 s)
#
# Exit codes:
#   0  target commit is live
#   1  timeout
#   2  curl/parse error

set -eu

HEALTH_URL="${HEALTH_URL:-https://invoice-tracker-backend-production.up.railway.app/health}"
MAX_WAIT_SEC="${MAX_WAIT_SEC:-420}"
POLL_SEC="${POLL_SEC:-10}"

# Determine target commit: arg 1, or origin/main (the branch Railway deploys).
# Using worktree HEAD is wrong — the worktree branch drifts ahead of main
# while a PR is open, and the deploy is only triggered once the PR is
# merged to main. Always ask git what origin/main points at, falling back
# to local HEAD only if there's no remote tracking info.
if [ "${1:-}" != "" ]; then
    TARGET="$1"
else
    # Fetch silently so we see the post-merge commit that Railway is about
    # to build. Non-fatal on offline — we fall back to the cached ref.
    git fetch origin main --quiet 2>/dev/null || true
    TARGET=$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD 2>/dev/null || true)
fi

if [ -z "$TARGET" ]; then
    echo "ERROR: no target commit specified and not in a git repo" >&2
    exit 2
fi

TARGET_SHORT=$(echo "$TARGET" | cut -c1-8)

echo "▶ Waiting for commit $TARGET_SHORT to deploy to Railway..."
echo "  Polling: $HEALTH_URL"
echo "  Timeout: ${MAX_WAIT_SEC}s"
echo ""

START=$(date +%s)
LAST_SEEN=""

while true; do
    NOW=$(date +%s)
    ELAPSED=$((NOW - START))

    if [ "$ELAPSED" -ge "$MAX_WAIT_SEC" ]; then
        echo ""
        echo "✗ Timeout after ${ELAPSED}s — target $TARGET_SHORT never went live." >&2
        echo "  Last seen live commit: ${LAST_SEEN:-none}" >&2
        exit 1
    fi

    # Fetch /health; tolerate transient 502s during container swap
    RESPONSE=$(curl -s --max-time 5 "$HEALTH_URL" 2>/dev/null || true)

    if [ -z "$RESPONSE" ]; then
        printf "  [%3ds] no response (container swapping?)\n" "$ELAPSED"
    else
        # Pull commitShort out of JSON. No jq dependency — cheap grep.
        LIVE_SHORT=$(echo "$RESPONSE" | grep -o '"commitShort":"[^"]*"' | sed 's/"commitShort":"\(.*\)"/\1/')

        if [ -z "$LIVE_SHORT" ] || [ "$LIVE_SHORT" = "unknown" ]; then
            printf "  [%3ds] /health up but no commit info yet (old code?)\n" "$ELAPSED"
        elif [ "$LIVE_SHORT" = "$TARGET_SHORT" ]; then
            echo ""
            echo "✓ $TARGET_SHORT is live after ${ELAPSED}s."
            exit 0
        else
            if [ "$LIVE_SHORT" != "$LAST_SEEN" ]; then
                printf "  [%3ds] live: %s (waiting for %s)\n" "$ELAPSED" "$LIVE_SHORT" "$TARGET_SHORT"
                LAST_SEEN="$LIVE_SHORT"
            else
                printf "  [%3ds] still %s...\n" "$ELAPSED" "$LIVE_SHORT"
            fi
        fi
    fi

    sleep "$POLL_SEC"
done
