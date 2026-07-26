#!/bin/bash
set -e
# Q12 validation: 3 models × 3 runs
MODELS=("gpt-4.1" "claude-haiku-4-5" "gpt-4o-mini")
RUNS=(801 802 803)
OUTDIR="data/reliability"

for model in "${MODELS[@]}"; do
  for run in "${RUNS[@]}"; do
    outfile="${OUTDIR}/${model}-run-${run}.json"
    if [ -f "$outfile" ]; then
      echo "SKIP: $outfile exists"
      continue
    fi
    echo "Running: $model run $run..."
    node run-reliability-floway.js "$model" "$model" "$run" 2>&1 || echo "FAILED: $model run $run"
    echo ""
  done
done

echo ""
echo "=== Q12 Results (index 11, 0-based) ==="
for model in "${MODELS[@]}"; do
  echo "--- $model ---"
  for run in "${RUNS[@]}"; do
    f="${OUTDIR}/${model}-run-${run}.json"
    if [ -f "$f" ]; then
      q12=$(node -e "const d=require('./$f'); console.log(d.answers[11])")
      echo "  run-${run}: Q12=$q12"
    fi
  done
done

echo ""
echo "=== Q12 Summary ==="
A=0; B=0; TOTAL=0
for model in "${MODELS[@]}"; do
  for run in "${RUNS[@]}"; do
    f="${OUTDIR}/${model}-run-${run}.json"
    if [ -f "$f" ]; then
      ans=$(node -e "const d=require('./$f'); console.log(d.answers[11])")
      TOTAL=$((TOTAL+1))
      if [ "$ans" = "A" ]; then A=$((A+1)); fi
      if [ "$ans" = "B" ]; then B=$((B+1)); fi
    fi
  done
done
echo "Total: $TOTAL | A: $A ($(echo "scale=1; $A*100/$TOTAL" | bc)%) | B: $B ($(echo "scale=1; $B*100/$TOTAL" | bc)%)"
