#!/bin/bash
set -e
cd "$(dirname "$0")"

export FLOWAY_KEY="$(pass show openclaw/providers/default-llm-sg/apiKey)"
export https_proxy=http://127.0.0.1:1083
BASE_URL="https://floway.sg.kagura-agent.com"

declare -A MODELS
MODELS[gpt-4o-mini]="q11v3-gpt-4o-mini"
MODELS[claude-haiku-4-5]="q11v3-claude-haiku-4-5"
MODELS[gpt-4.1]="q11v3-gpt-4-1"
MODELS[claude-sonnet-4-5]="q11v3-claude-sonnet-4-5"
MODELS[gemini-3.5-flash]="q11v3-gemini-3-5-flash"
MODELS[gpt-4o]="q11v3-gpt-4o"

RUNS_PER_MODEL=3
Q_INDEX=10

echo "=== Q11 v3 Validation (UUID vs Integer PK) ==="
echo "Models: ${#MODELS[@]}, Runs/model: $RUNS_PER_MODEL"
echo "Started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""

TOTAL=0
FAILED=0

for MODEL in "${!MODELS[@]}"; do
  SLUG="${MODELS[$MODEL]}"
  EXISTING=0
  for n in $(seq 1 100); do
    [ -f "data/reliability/${SLUG}-run-${n}.json" ] && EXISTING=$((EXISTING + 1))
  done
  
  NEEDED=$((RUNS_PER_MODEL - EXISTING))
  [ "$NEEDED" -le 0 ] && echo "[$MODEL] Already has $EXISTING runs, skip" && continue
  
  echo "[$MODEL] Need $NEEDED runs"
  for r in $(seq 1 $NEEDED); do
    RUN=$((EXISTING + r))
    echo "--- [$MODEL] run $RUN ($(date '+%H:%M:%S')) ---"
    if bash resume-reliability-fast.sh --provider floway --api-key "$FLOWAY_KEY" --base-url "$BASE_URL" --fresh "$MODEL" "$SLUG" "$RUN"; then
      TOTAL=$((TOTAL + 1))
      echo "  ✓ Done"
    else
      FAILED=$((FAILED + 1))
      echo "  ✗ Failed"
    fi
    sleep 3
  done
done

echo ""
echo "=== Complete: $TOTAL ok, $FAILED failed ==="

# Summary
echo ""
echo "=== Q11 v3 Answer Distribution ==="
A=0; B=0; C=0
for f in data/reliability/q11v3-*.json; do
  [ -f "$f" ] || continue
  ANS=$(python3 -c "import json; print(json.load(open('$f'))[$Q_INDEX])" 2>/dev/null || echo "?")
  M=$(basename "$f" | sed 's/q11v3-//' | sed 's/-run-.*//')
  R=$(basename "$f" | grep -o 'run-[0-9]*')
  echo "  $M $R: $ANS"
  [ "$ANS" = "A" ] && A=$((A+1))
  [ "$ANS" = "B" ] && B=$((B+1))
  [ "$ANS" = "C" ] && C=$((C+1))
done
T=$((A+B+C))
echo ""
echo "A=$A B=$B C=$C total=$T"
[ "$T" -gt 0 ] && echo "A%=$((A*100/T))% (target: 35-65%)"
