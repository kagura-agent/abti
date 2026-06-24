#!/bin/bash
# abti-deploy.sh — Pull latest master and conditionally restart the API.
#
# The authoritative data source is git (PRs commit all test results).
# Runtime API submissions create local modifications to data/results.json,
# but these are always redundant with what PRs merge upstream.
# This script resets any local changes before pulling so deploys never stall.
#
# Suggested crontab entry (every 5 minutes):
#   */5 * * * * /home/azureuser/abti/ops/abti-deploy.sh >> /var/log/abti-deploy.log 2>&1

set -euo pipefail
cd /home/azureuser/abti || exit 1

BEFORE=$(git rev-parse HEAD)

# Discard ALL local modifications (including data/) so pull can fast-forward.
# This is safe because:
#   1. All test results are committed via PRs (the authoritative source)
#   2. Runtime API submissions are ephemeral until merged upstream
git checkout -- . 2>/dev/null || true
git clean -fd 2>/dev/null || true

git pull origin master --ff-only 2>/dev/null || exit 0

AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  exit 0
fi

# Restart the API when server code OR data changes
if git diff --name-only "$BEFORE" "$AFTER" | grep -qE "api-server\.js|mcp/|data/results\.json"; then
  sudo systemctl restart abti-api
fi
