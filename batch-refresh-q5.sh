#!/bin/bash
# Batch reliability refresh after Q5 redesign (issue #626)
# Phase 1: 10 diverse models to validate Q5 discriminability
set -e
cd "$(dirname "$0")"

export GITHUB_TOKEN=$(gh auth token)
export https_proxy=http://127.0.0.1:1083

LOG="batch-refresh-q5.log"
echo "=== Q5 Refresh started at $(date) ===" >> "$LOG"

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

# Phase 1: Core diverse models (10 models × 3 runs = 30 calls)
echo "--- Phase 1: Core models for Q5 discriminability ---" | tee -a "$LOG"

# GPT family (GitHub Models API)
for RUN in 1 2 3; do
  run_github_model "gpt-4o-mini" "gpt-4o-mini" "$RUN" || true
  sleep 30
done
sleep 60

for RUN in 1 2 3; do
  run_github_model "gpt-4o" "gpt-4o" "$RUN" || true
  sleep 30
done
sleep 60

for RUN in 1 2 3; do
  run_github_model "gpt-4.1" "gpt-4-1" "$RUN" || true
  sleep 30
done
sleep 60

for RUN in 1 2 3; do
  run_github_model "gpt-4.1-mini" "gpt-4-1-mini" "$RUN" || true
  sleep 30
done
sleep 60

# Claude family (Floway)
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

echo "=== Phase 1 complete at $(date) ===" | tee -a "$LOG"
echo "Run: node scripts/generate-discriminability.js" | tee -a "$LOG"
