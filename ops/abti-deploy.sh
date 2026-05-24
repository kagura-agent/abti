#!/bin/bash
# abti-deploy.sh — Pull latest master and conditionally restart the API.
#
# Safe for cron: uses ":(exclude)data/" so that git checkout
# never overwrites data/results.json (API submission store).
#
# Suggested crontab entry (every 5 minutes):
#   */5 * * * * /home/azureuser/abti/ops/abti-deploy.sh >> /var/log/abti-deploy.log 2>&1

set -euo pipefail
cd /home/azureuser/abti || exit 1

BEFORE=$(git rev-parse HEAD)

# Reset tracked files to match HEAD, but exclude the data/ directory
# so that runtime-written files (results.json) are never discarded.
git checkout -- . ":(exclude)data/" 2>/dev/null

git pull origin master --ff-only 2>/dev/null || exit 0

AFTER=$(git rev-parse HEAD)

# Restart the API service only when relevant server files changed.
if [ "$BEFORE" != "$AFTER" ]; then
  if git diff --name-only "$BEFORE" "$AFTER" | grep -q "api-server.js\|mcp/"; then
    sudo systemctl restart abti-api
  fi
fi
