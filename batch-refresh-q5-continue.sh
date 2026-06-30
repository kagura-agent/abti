#!/bin/bash
# Continue Q5 reliability refresh from where batch-refresh-q5.sh left off
# Picks up after gpt-4-1 run 1 completed
set -e
cd "$(dirname "$0")"

export GITHUB_TOKEN=$(gh auth token)
export https_proxy=http://127.0.0.1:1083

LOG="batch-refresh-q5.log"
echo "=== Q5 Refresh CONTINUED at $(date) ===" >> "$LOG"

run_github_model() {
  local MODEL="$1"
  local SLUG="$2"
  local RUN="$3"
  
  local OUTFILE="data/reliability/${SLUG}-run-${RUN}.json"
  if [ -f "$OUTFILE" ]; then
    echo "[SKIP] $SLUG run $RUN already exists" | tee -a "$LOG"
    return 0
  fi
  
  echo "[START] $SLUG run $RUN at $(date)" | tee -a "$LOG"
  if bash resume-reliability.sh --fresh "$MODEL" "$SLUG" "$RUN" 2>&1 | tee -a "$LOG"; then
    echo "[DONE] $SLUG run $RUN at $(date)" | tee -a "$LOG"
    return 0
  else
    echo "[FAIL] $SLUG run $RUN (exit $?) at $(date)" | tee -a "$LOG"
    return 1
  fi
}

run_floway_model() {
  local MODEL="$1"
  local SLUG="$2"
  local RUN="$3"
  
  local OUTFILE="data/reliability/${SLUG}-run-${RUN}.json"
  if [ -f "$OUTFILE" ]; then
    echo "[SKIP] $SLUG run $RUN already exists" | tee -a "$LOG"
    return 0
  fi
  
  echo "[START] $SLUG run $RUN at $(date)" | tee -a "$LOG"
  if node run-reliability-floway.js "$MODEL" "$SLUG" "$RUN" 2>&1 | tee -a "$LOG"; then
    echo "[DONE] $SLUG run $RUN at $(date)" | tee -a "$LOG"
    return 0
  else
    echo "[FAIL] $SLUG run $RUN (exit $?) at $(date)" | tee -a "$LOG"
    return 1
  fi
}

# Continue gpt-4-1 runs 2,3
for RUN in 2 3; do
  run_github_model "gpt-4.1" "gpt-4-1" "$RUN" || true
  sleep 30
done
sleep 60

# gpt-4-1-mini: all 3 runs
for RUN in 1 2 3; do
  run_github_model "gpt-4.1-mini" "gpt-4-1-mini" "$RUN" || true
  sleep 30
done
sleep 60

# Claude family (Floway) — faster, less rate limiting
for RUN in 1 2 3; do
  run_floway_model "claude-haiku-4-5" "claude-haiku-4-5" "$RUN" || true
  sleep 10
done
sleep 30

for RUN in 1 2 3; do
  run_floway_model "claude-sonnet-4-5" "claude-sonnet-4-5" "$RUN" || true
  sleep 10
done
sleep 30

for RUN in 1 2 3; do
  run_floway_model "claude-opus-4-7" "claude-opus-4-7" "$RUN" || true
  sleep 10
done
sleep 30

# Gemini (GitHub Models API)
for RUN in 1 2 3; do
  run_github_model "Gemini-2.5-Pro" "gemini-2-5-pro" "$RUN" || true
  sleep 30
done
sleep 60

# Llama (GitHub Models API)
for RUN in 1 2 3; do
  run_github_model "Meta-Llama-3.3-70B-Instruct" "llama-3-3-70b" "$RUN" || true
  sleep 30
done
sleep 60

# Small model (GitHub Models API)
for RUN in 1 2 3; do
  run_github_model "Phi-4" "phi-4" "$RUN" || true
  sleep 30
done

echo "=== All Phase 1 runs complete at $(date) ===" | tee -a "$LOG"

# Generate discriminability
echo "Generating discriminability.json..." | tee -a "$LOG"
node scripts/generate-discriminability.js 2>&1 | tee -a "$LOG"

echo "=== BATCH COMPLETE at $(date) ===" | tee -a "$LOG"
