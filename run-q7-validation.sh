#!/bin/bash
# Run reliability tests for Q7 redesign validation via Floway
# Uses resume-reliability-fast.sh (10s inter-question wait)
set -e
cd "$(dirname "$0")"

export FLOWAY_KEY="$(pass show openclaw/providers/default-llm-sg/apiKey)"
export https_proxy=http://127.0.0.1:1083
BASE_URL="https://floway.sg.kagura-agent.com"

# Models to test (diverse set for discriminability)
declare -A MODELS
MODELS[gpt-4o-mini]="gpt-4o-mini"
MODELS[claude-haiku-4-5]="claude-haiku-4-5"
MODELS[gpt-4.1]="gpt-4-1"
MODELS[claude-sonnet-4-5]="claude-sonnet-4-5"
MODELS[gemini-2.5-pro]="gemini-2-5-pro"
MODELS[gpt-4o]="gpt-4o"

RUNS_PER_MODEL=3

# Find next available run number (skip existing)
next_run() {
  local slug="$1"
  local n=30
  while [ -f "data/reliability/${slug}-run-${n}.json" ]; do
    n=$((n + 1))
  done
  echo "$n"
}

echo "=== Q7 Redesign Validation Runs ==="
echo "Models: ${#MODELS[@]}, Runs/model: $RUNS_PER_MODEL"
echo "Provider: floway-sg, Inter-question wait: 10s"
echo "Started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""

TOTAL=0
FAILED=0

for MODEL in "${!MODELS[@]}"; do
  SLUG="${MODELS[$MODEL]}"
  
  for r in $(seq 1 $RUNS_PER_MODEL); do
    RUN=$(next_run "$SLUG")
    OUTFILE="data/reliability/${SLUG}-run-${RUN}.json"
    
    echo "--- [$MODEL] run $RUN ($(date '+%H:%M:%S')) ---"
    
    if bash resume-reliability-fast.sh --provider floway --api-key "$FLOWAY_KEY" --base-url "$BASE_URL" --fresh "$MODEL" "$SLUG" "$RUN"; then
      TOTAL=$((TOTAL + 1))
      echo "  ✓ Saved: $OUTFILE"
    else
      FAILED=$((FAILED + 1))
      echo "  ✗ Failed, continuing..."
    fi
    echo ""
  done
done

echo "=== Complete: $TOTAL succeeded, $FAILED failed ==="
echo "Finished: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""

if [ "$TOTAL" -gt 0 ]; then
  echo "Regenerating discriminability..."
  node scripts/generate-discriminability.js
fi
