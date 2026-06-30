#!/bin/bash
# Batch reliability runs for v5.4-beta refresh (issue #613)
# Runs sequentially WITHOUT pre-quota-check (rely on built-in retry logic)
set -e
cd "$(dirname "$0")"

export GITHUB_TOKEN=$(gh auth token)
export https_proxy=http://127.0.0.1:1083

LOG="batch-reliability-v54.log"
echo "=== Batch started at $(date) ===" >> "$LOG"

run_model() {
  local MODEL="$1"
  local SLUG="$2"
  local RUN="$3"
  
  local OUTFILE="data/reliability/${SLUG}-run-${RUN}.json"
  if [ -f "$OUTFILE" ]; then
    echo "[SKIP] $SLUG run $RUN already exists" | tee -a "$LOG"
    return 0
  fi
  
  echo "[START] $SLUG run $RUN at $(date)" | tee -a "$LOG"
  
  # Run directly — resume-reliability.sh has built-in retry/wait logic
  if bash resume-reliability.sh --fresh "$MODEL" "$SLUG" "$RUN" 2>&1 | tee -a "$LOG"; then
    echo "[DONE] $SLUG run $RUN at $(date)" | tee -a "$LOG"
    return 0
  else
    echo "[FAIL] $SLUG run $RUN (exit $?) at $(date)" | tee -a "$LOG"
    return 1
  fi
}

# Phase 1: Complete incomplete models (need run 3)
echo "--- Phase 1: Complete incomplete models ---" | tee -a "$LOG"
run_model "gpt-4o" "gpt-4o" "3" || true
sleep 120  # Long pause between models to avoid generic rate limit
run_model "Llama-4-Maverick-17B-128E-Instruct-FP8" "Llama-4-Maverick-17B-128E-Instruct-FP8" "3" || true
sleep 120
run_model "Llama-4-Scout-17B-16E-Instruct" "Llama-4-Scout-17B-16E-Instruct" "3" || true
sleep 120

# Phase 2: Fresh runs for GitHub Models API models (3 runs each)
echo "--- Phase 2: Fresh runs for new models ---" | tee -a "$LOG"

GITHUB_MODELS=(
  "DeepSeek-R1-0528"
  "DeepSeek-R1"
  "DeepSeek-V3-0324"
  "Cohere-command-r-08-2024"
  "Cohere-command-r-plus-08-2024"
  "Meta-Llama-3.1-405B-Instruct"
  "Meta-Llama-3.1-8B-Instruct"
  "Llama-3.2-11B-Vision-Instruct"
  "Llama-3.2-90B-Vision-Instruct"
  "Phi-4"
)

for MODEL in "${GITHUB_MODELS[@]}"; do
  for RUN in 1 2 3; do
    run_model "$MODEL" "$MODEL" "$RUN" || { echo "[SKIP-ALL] $MODEL failed, moving to next model" | tee -a "$LOG"; break; }
    # No extra wait needed — resume-reliability.sh already waits 65s between questions
    # Just a small buffer between runs
    sleep 30
  done
  sleep 120  # Pause between different models
done

echo "=== Batch finished at $(date) ===" | tee -a "$LOG"
ls data/reliability/ | wc -l | xargs -I{} echo "Total reliability files: {}" | tee -a "$LOG"
