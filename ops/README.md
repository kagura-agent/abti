# ABTI Ops Guide

## Install the systemd service

```bash
sudo cp ops/abti-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable abti-api
sudo systemctl start abti-api
```

## Restart / manage

```bash
sudo systemctl restart abti-api
sudo systemctl status abti-api
sudo journalctl -u abti-api -f
```

**Always use `systemctl` to start/stop the service. Never use `nohup node api-server.js &`.**

Manual `nohup` creates orphan processes that hold port 3300, causing systemd `EADDRINUSE` crash loops on restart.

## Deploy Cron

`ops/abti-deploy.sh` pulls the latest master every few minutes and conditionally restarts the API service.

### Setup

```bash
chmod +x /home/azureuser/abti/ops/abti-deploy.sh

# Add to crontab (every 5 minutes)
crontab -e
*/5 * * * * /home/azureuser/abti/ops/abti-deploy.sh >> /var/log/abti-deploy.log 2>&1
```

### Data persistence

The script uses `git checkout -- . ":(exclude)data/"` instead of a bare `git checkout -- .` so that `data/results.json` (the API submission store) is never overwritten by deploys. Runtime data in `data/` is preserved across every pull.

## How the safety net works

The service unit includes `ExecStartPre=fuser -k 3300/tcp || true`, which kills any process holding port 3300 before starting. This ensures the service can always bind the port, even if an orphan process was left behind.
