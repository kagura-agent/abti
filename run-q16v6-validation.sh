#!/bin/bash
# Run reliability tests for Q16 v6 redesign validation via Floway
# Acceptance: disc ≥ 0.6, A/B ratio 35-65%, across 6 models minimum
set -e
cd "$(dirname "$0")"

export FLOWAY_KEY="$(pass show openclaw/providers/default-llm-sg/apiKey)"
export https_proxy=http://127.0.0.1:1083
BASE_URL="https://floway.sg.kagura-agent.com"

# Models to test (diverse set for discriminability)
declare -A MODELS
MODELS[gpt-4o-mini]="q16v6-gpt-4o-mini"
MODELS[claude-haiku-4-5]="q16v6-claude-haiku-4-5"
MODELS[gpt-4.1]="q16v6-gpt-4-1"
MODELS[claude-sonnet-4-5]="q16v6-claude-sonnet-4-5"
MODELS[gemini-3.5-flash]="q16v6-gemini-3-5-flash"
MODELS[gpt-4o]="q16v6-gpt-4o"

RUNS_PER_MODEL=3

# Find next available run number (skip existing)
next_run() {
  local slug="$1"
  local n=1
  while [ -f "data/reliability/${slug}-run-${n}.json" ]; do
    n=$((n + 1))
  done
  echo "$n"
}

echo "=== Q16 v6 Redesign Validation Runs ==="
echo "Models: ${#MODELS[@]}, Runs/model: $RUNS_PER_MODEL"
echo "Provider: floway-sg, Inter-question wait: 10s"
echo "Started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""

TOTAL=0
FAILED=0

for MODEL in "${!MODELS[@]}"; do
  SLUG="${MODELS[$MODEL]}"
  
  # Check how many runs already exist
  EXISTING=0
  for n in $(seq 1 100); do
    if [ -f "data/reliability/${SLUG}-run-${n}.json" ]; then
      EXISTING=$((EXISTING + 1))
    fi
  done
  
  NEEDED=$((RUNS_PER_MODEL - EXISTING))
  if [ "$NEEDED" -le 0 ]; then
    echo "[$MODEL] Already has $EXISTING runs, skipping"
    continue
  fi
  
  echo "[$MODEL] Has $EXISTING runs, need $NEEDED more"
  
  for r in $(seq 1 $NEEDED); do
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
    
    # Brief pause between runs to avoid rate limits
    sleep 5
    echo ""
  done
done

echo "=== Complete: $TOTAL succeeded, $FAILED failed ==="
echo "Finished: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""

# Extract Q16 answers for quick summary
echo "=== Q16 v6 Answer Distribution ==="
for f in data/reliability/q16v6-*.json; do
  MODEL=$(basename "$f" | sed 's/q16v6-//' | sed 's/-run-.*//')
  RUN=$(basename "$f" | grep -o 'run-[0-9]*' | grep -o '[0-9]*')
  ANS=$(python3 -c "import json; print(json.load(open('$f'))['answers'][15])" 2>/dev/null || echo "?")
  echo "  $MODEL run-$RUN: $ANS"
done

# Count A vs B
A_COUNT=$(for f in data/reliability/q16v6-*.json; do python3 -c "import json; print(json.load(open('$f'))['answers'][15])" 2>/dev/null; done | grep -c "A" || true)
B_COUNT=$(for f in data/reliability/q16v6-*.json; do python3 -c "import json; print(json.load(open('$f'))['answers'][15])" 2>/dev/null; done | grep -c "B" || true)
TOTAL_ANS=$((A_COUNT + B_COUNT))
echo ""
echo "A: $A_COUNT / B: $B_COUNT (total: $TOTAL_ANS)"
if [ "$TOTAL_ANS" -gt 0 ]; then
  A_PCT=$((A_COUNT * 100 / TOTAL_ANS))
  echo "A%: ${A_PCT}% (target: 35-65%)"
fi
