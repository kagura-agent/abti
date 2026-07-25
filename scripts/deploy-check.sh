#!/usr/bin/env bash
set -euo pipefail

SSH_USER="azureuser"
SSH_HOST="74.226.216.75"
SSH_KEY="${VM1_SSH_KEY:-$HOME/.ssh/vm1.pem}"
REMOTE_DIR="/home/azureuser/abti"
REPO="git@github.com:kagura-agent/abti.git"

ssh_cmd() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "${SSH_USER}@${SSH_HOST}" "$@"
}

echo "Fetching deployed commit from VM1..."
deployed=$(ssh_cmd "cd ${REMOTE_DIR} && git rev-parse HEAD") || {
  echo "ERROR: SSH to VM1 failed"
  exit 1
}
echo "Deployed: ${deployed:0:12}"

echo "Fetching latest origin/master..."
latest=$(git ls-remote "$REPO" refs/heads/master | cut -f1)
echo "Latest:   ${latest:0:12}"

if [ "$deployed" = "$latest" ]; then
  echo "Production is in sync."
  exit 0
fi

echo "Production is behind — deploying..."
ssh_cmd "cd ${REMOTE_DIR} && git pull origin master && sudo systemctl restart abti-api" || {
  echo "ERROR: deploy failed"
  exit 1
}

echo "Deployed ${latest:0:12} successfully."
