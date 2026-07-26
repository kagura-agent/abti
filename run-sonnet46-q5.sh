#!/bin/bash
set -e
cd "$(dirname "$0")"

export FLOWAY_KEY="$(pass show openclaw/providers/default-llm-sg/apiKey)"
export https_proxy=http://127.0.0.1:1083
BASE_URL="https://floway.sg.kagura-agent.com"

echo "=== Q5 Validation: claude-sonnet-4-6 (substitute for unavailable claude-sonnet-4-5) ==="
echo "Started: $(date '+%Y-%m-%d %H:%M:%S %Z')"

TOTAL=0
FAILED=0

for r in 1 2 3; do
  # Find next run number
  n=301
  while [ -f "data/reliability/claude-sonnet-4-6-run-${n}.json" ]; do
    n=$((n + 1))
  done
  
  echo "--- [claude-sonnet-4-6] run $n ($(date '+%H:%M:%S')) ---"
  
  if bash resume-reliability-fast.sh --provider floway --api-key "$FLOWAY_KEY" --base-url "$BASE_URL" --fresh claude-sonnet-4-6 claude-sonnet-4-6 "$n"; then
    TOTAL=$((TOTAL + 1))
    echo "  ✓ Saved: data/reliability/claude-sonnet-4-6-run-${n}.json"
  else
    FAILED=$((FAILED + 1))
    echo "  ✗ Failed"
  fi
done

echo ""
echo "=== claude-sonnet-4-6 complete: $TOTAL succeeded, $FAILED failed ==="
echo "Finished: $(date '+%Y-%m-%d %H:%M:%S %Z')"

# If all succeeded, commit everything
if [ "$TOTAL" -eq 3 ] && [ "$FAILED" -eq 0 ]; then
  echo ""
  echo "=== All 18 Q5 validation runs complete. Committing... ==="
  
  git add data/reliability/claude-haiku-4-5-run-30{4,5,6}.json \
          data/reliability/gemini-2-5-pro-run-30{1,2,3}.json \
          data/reliability/gpt-4-1-run-30{1,2,3}.json \
          data/reliability/gpt-4o-mini-run-30{4,5,6}.json \
          data/reliability/gpt-4o-run-30{1,2,3}.json \
          data/reliability/claude-sonnet-4-6-run-30{1,2,3}.json 2>/dev/null || true
  
  git commit -m "data: Q5 redesign validation runs (6 models × 3 runs) (#802)

Models tested: gpt-4o-mini, claude-haiku-4-5, gpt-4-1, gemini-2-5-pro, gpt-4o, claude-sonnet-4-6
(claude-sonnet-4-6 substituted for claude-sonnet-4-5 which is unavailable on floway-sg)
3 runs per model = 18 total runs via floway-sg provider"

  git push origin question-redesign-q5
  
  echo "=== Committed and pushed ==="
  
  # Run discriminability analysis
  echo ""
  echo "=== Running discriminability analysis ==="
  node scripts/generate-discriminability.js 2>&1 || echo "Discriminability script failed"
fi
