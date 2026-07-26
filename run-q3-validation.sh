#!/bin/bash
set -e
# Quick Q3 validation: run 3 models × 3 runs, check Q3 distribution
MODELS=("gpt-4.1" "claude-haiku-4-5" "gpt-4o-mini")
RUNS=(501 502 503)

for model in "${MODELS[@]}"; do
  for run in "${RUNS[@]}"; do
    outfile="data/reliability-q3-test/${model}-run-${run}.json"
    if [ -f "$outfile" ]; then
      echo "SKIP: $outfile exists"
      continue
    fi
    echo "Running: $model run $run..."
    node run-reliability-floway.js "$model" "$model" "$run" 2>&1 || echo "FAILED: $model run $run"
    # move to test dir
    src="data/reliability/${model}-run-${run}.json"
    if [ -f "$src" ]; then
      mv "$src" "$outfile"
      echo "  -> saved to $outfile"
    fi
  done
done

echo ""
echo "=== Q3 Results ==="
for f in data/reliability-q3-test/*.json; do
  model=$(basename "$f" | sed 's/-run-[0-9]*.json//')
  q3=$(python3 -c "import json; d=json.load(open('$f')); print(d.get('answers',d.get('results',{}))[2] if isinstance(d.get('answers',d.get('results',{})), list) else 'ERR')" 2>/dev/null || echo "ERR")
  echo "  $model: Q3=$q3"
done
