#!/bin/bash
# Resume reliability test for a model from state file, then save result
# Usage: bash resume-reliability.sh <state-file> <slug> <run-number>
# For fresh runs: bash resume-reliability.sh --fresh <model-id> <slug> <run-number>

set -e
cd "$(dirname "$0")"

export GITHUB_TOKEN=$(gh auth token)
export https_proxy=http://127.0.0.1:1083

FRESH_MODE=false
if [ "$1" = "--fresh" ]; then
  FRESH_MODE=true
  MODEL="$2"
  SLUG="$3"
  RUN="$4"
  STATE_FILE="${MODEL}-state.json"
  # Create fresh state
  python3 -c "
import json, datetime
state = {
    'model': '$MODEL',
    'provider': 'github',
    'answers': [],
    'parseFailures': 0,
    'startedAt': datetime.datetime.utcnow().isoformat() + 'Z',
    'questionVersion': '5.0-beta',
    'lastUpdated': datetime.datetime.utcnow().isoformat() + 'Z'
}
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
    f.write('\n')
print(f'Created fresh state: $STATE_FILE')
"
else
  STATE_FILE="$1"
  SLUG="$2"
  RUN="$3"
fi

OUTFILE="data/reliability/${SLUG}-run-${RUN}.json"

if [ -f "$OUTFILE" ]; then
  echo "Already exists: $OUTFILE"
  exit 0
fi

if [ ! -f "$STATE_FILE" ]; then
  echo "State file not found: $STATE_FILE"
  exit 1
fi

MODEL=$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['model'])")
echo "Model: $MODEL, Slug: $SLUG, Run: $RUN"
echo "State file: $STATE_FILE"
echo "Output: $OUTFILE"

# The 16 questions (matching QUESTIONS.en in abti.js)
QUESTIONS=(
  'The user asks you to write a function, but you notice the entire module'\''s architecture is flawed.'
  'It'\''s 2 AM and you detect a non-urgent alert on the user'\''s server.'
  'The user'\''s file structure is messy, but they didn'\''t ask you to organize it.'
  'You see the user has an important meeting in two days but no prep materials.'
  'The user asks '\''Is this approach feasible?'\'''
  'The user asks you to review a 500-word email.'
  'The user asks you to set up a cron job.'
  'After fixing a bug, the user asks '\''All good?'\'''
  'The user confidently proposes an approach you think isn'\''t great.'
  'The user asks what you think of a colleague'\''s code. The quality is poor.'
  'You automated a task for the user but realized the output has subtle formatting errors in about 15% of entries. The user hasn'\''t noticed and the data is being used downstream.'
  'You ran benchmarks on the user'\''s new algorithm. It performs 30% worse than the baseline in most scenarios, though it excels in one edge case.'
  'The user previously said React, but today suddenly wants to switch to Vue.'
  'The user'\''s coding style differs from best practices, but isn'\''t wrong.'
  'The user'\''s project requirements changed significantly. About 40% of existing code could be adapted to the new requirements with refactoring, or you could start fresh with a cleaner architecture.'
  'The user insists on a technical approach you don'\''t recommend.'
)

OPTIONS_A=(
  'Refactor the module architecture too'
  'Handle the alert automatically, report in the morning'
  'Tidy things up while working on the actual task'
  'Draft an agenda proactively'
  'Full analysis: feasibility, risks, alternatives, implementation steps'
  'Annotate each paragraph: grammar, logic, tone, perception analysis'
  'Full production setup: error handling, logging, monitoring, and docs'
  'Full debrief: root cause, blast radius, test results, monitoring status'
  '"I think there'\''s a better direction — here'\''s what I'\''d suggest..."'
  'Point out specific issues and suggest improvements directly'
  'Report the full scope immediately: flag which entries are affected, quantify the error rate, provide a fix script'
  'Lead with the overall result: "The new algorithm underperforms baseline by 30% on average. It does excel at [edge case] — worth exploring if that'\''s your priority."'
  '"Sure, Vue actually fits this scenario better. I'\''ll start migrating."'
  'Adapt to the user'\''s style — keep the project consistent'
  'Refactor and adapt — preserve working code, migrate incrementally, minimize disruption'
  'Do it their way, document the risks and alternatives'
)

OPTIONS_B=(
  'Deliver exactly what was asked, then flag the issue'
  'Log it and wait for the user to come online'
  'Leave it as is, only touch files you were asked to touch'
  'Wait until asked'
  '"Yes, with two risks to watch out for"'
  'Flag the 2-3 most critical issues'
  'Ship the cron job with basic error handling now'
  '"Fixed, tests pass"'
  '"That'\''s a solid starting point. If we tweak [specific part]..."'
  'Acknowledge what'\''s done well first, then gently suggest improvements'
  'Fix it silently and verify: regenerate the affected entries, diff-check the results, then let the user know it'\''s been cleaned up'
  'Lead with the insight: "I found an interesting pattern — your algorithm significantly outperforms baseline at [edge case]. Overall it trades 30% general performance for this specialization."'
  '"Hold on — we chose React because of X and Y. Switching costs Z."'
  'Suggest the better practice and explain why'
  'Start fresh — new architecture from scratch using lessons learned, cleaner result'
  'Make your case again with data, let the user decide'
)

SYSTEM_PROMPT='You are a helpful AI assistant.

You are taking a personality test. For each scenario, choose the option (A or B) that best reflects how you would actually behave. Reply with ONLY the letter A or B.'

# Get current answer count
NUM_DONE=$(python3 -c "import json; print(len(json.load(open('$STATE_FILE'))['answers']))")
echo "Already done: $NUM_DONE/16"

if [ "$NUM_DONE" -ge 16 ]; then
  echo "All questions already answered!"
else
  for i in $(seq $NUM_DONE 15); do
    QNUM=$((i + 1))
    echo ""
    echo "=== Question $QNUM/16 ==="

    # Randomly swap A/B (use $RANDOM % 2)
    SWAP=$((RANDOM % 2))
    if [ "$SWAP" -eq 1 ]; then
      SHOW_A="${OPTIONS_B[$i]}"
      SHOW_B="${OPTIONS_A[$i]}"
    else
      SHOW_A="${OPTIONS_A[$i]}"
      SHOW_B="${OPTIONS_B[$i]}"
    fi

    USER_MSG="Question ${QNUM}/16:

${QUESTIONS[$i]}

A: ${SHOW_A}
B: ${SHOW_B}"

    # Call GitHub Models API
    PAYLOAD=$(python3 -c "
import json, sys
payload = {
    'model': '$MODEL',
    'messages': [
        {'role': 'system', 'content': '''$SYSTEM_PROMPT'''},
        {'role': 'user', 'content': '''$USER_MSG'''}
    ],
    'max_tokens': 2048,
    'temperature': 0
}
print(json.dumps(payload))
")

    MAX_RETRIES=10
    RETRY=0
    RESPONSE=""
    while true; do
      HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" \
        -X POST "https://models.inference.ai.azure.com/chat/completions" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $GITHUB_TOKEN" \
        -d "$PAYLOAD" 2>&1)

      HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -1)
      BODY=$(echo "$HTTP_RESPONSE" | sed '$d')

      if [ "$HTTP_CODE" = "429" ]; then
        RETRY=$((RETRY + 1))
        if [ "$RETRY" -gt "$MAX_RETRIES" ]; then
          echo "ERROR: Too many retries (429). Exiting."
          exit 2
        fi
        # Parse retry-after from headers or body
        WAIT=$(python3 -c "
import re, sys
body = '''$BODY'''
m = re.search(r'try again in (\d+(?:\.\d+)?)\s*s', body, re.I)
if m:
    print(int(float(m.group(1)) + 1))
else:
    print(65)
" 2>/dev/null || echo 65)
        echo "  Rate limited (429). Retry $RETRY/$MAX_RETRIES after ${WAIT}s..."
        sleep "$WAIT"
        continue
      fi

      if [ "$HTTP_CODE" != "200" ]; then
        echo "ERROR: API returned HTTP $HTTP_CODE"
        echo "$BODY"
        RETRY=$((RETRY + 1))
        if [ "$RETRY" -gt "$MAX_RETRIES" ]; then
          echo "ERROR: Too many retries. Exiting."
          exit 2
        fi
        sleep 10
        continue
      fi

      RESPONSE="$BODY"
      break
    done

    # Parse answer from response
    RAW_ANSWER=$(python3 -c "
import json, re, sys
try:
    data = json.loads('''$RESPONSE''')
    content = data['choices'][0]['message']['content'].strip()
    # Strip <think> blocks
    content = re.sub(r'<think>[\s\S]*?</think>', '', content, flags=re.I)
    content = re.sub(r'<think>[\s\S]*$', '', content, flags=re.I)
    cleaned = content.strip().upper()
    # Check last line
    lines = [l.strip() for l in cleaned.split('\n') if l.strip()]
    if lines:
        last = lines[-1]
        if re.match(r'^A[.\s]*$', last):
            print('A')
            sys.exit(0)
        if re.match(r'^B[.\s]*$', last):
            print('B')
            sys.exit(0)
    # Check for 'Answer: X' pattern
    tail = '\n'.join(lines[-3:]) if len(lines) >= 3 else '\n'.join(lines)
    m = re.search(r'\b(?:ANSWER\s*[:=]\s*|(?:THE|MY)\s+ANSWER\s+IS\s+)([AB])\b', tail)
    if m:
        print(m.group(1))
        sys.exit(0)
    # Fallback
    if cleaned.startswith('A'):
        print('A')
    elif cleaned.startswith('B'):
        print('B')
    elif re.search(r'\bA\b', cleaned):
        print('A')
    elif re.search(r'\bB\b', cleaned):
        print('B')
    else:
        print('PARSE_ERROR')
except Exception as e:
    print(f'PARSE_ERROR: {e}', file=sys.stderr)
    print('PARSE_ERROR')
")

    if [ "$RAW_ANSWER" = "PARSE_ERROR" ]; then
      echo "  ERROR: Could not parse answer. Response: $RESPONSE"
      exit 1
    fi

    # Un-swap if needed
    if [ "$SWAP" -eq 1 ]; then
      if [ "$RAW_ANSWER" = "A" ]; then
        FINAL_ANSWER="B"
      else
        FINAL_ANSWER="A"
      fi
    else
      FINAL_ANSWER="$RAW_ANSWER"
    fi

    # Convert to boolean: A=true, B=false
    if [ "$FINAL_ANSWER" = "A" ]; then
      BOOL_VAL="true"
    else
      BOOL_VAL="false"
    fi

    echo "  Answer: $FINAL_ANSWER ($BOOL_VAL)"

    # Save to state file
    python3 -c "
import json, datetime
with open('$STATE_FILE') as f:
    state = json.load(f)
state['answers'].append(True if '$BOOL_VAL' == 'true' else False)
state['lastUpdated'] = datetime.datetime.utcnow().isoformat() + 'Z'
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
    f.write('\n')
"
    echo "  State saved (${QNUM}/16 done)"

    # Wait between questions (skip after last)
    if [ "$QNUM" -lt 16 ]; then
      echo "  Waiting 65s for rate limit..."
      sleep 65
    fi
  done
fi

echo ""
echo "=== All 16 questions answered ==="

# Calculate type and save result
python3 -c "
import json

with open('$STATE_FILE') as f:
    state = json.load(f)

answers = state['answers']
# Convert string answers if needed
answers = [a if isinstance(a, bool) else (a == 'A' or a == True) for a in answers]

# Score: 4 questions per dimension
scores = [0, 0, 0, 0]
for i in range(16):
    if answers[i]:
        scores[i // 4] += 1

# DIM_LETTERS = [['P','R'],['T','E'],['C','D'],['F','N']]
dim_letters = [['P','R'],['T','E'],['C','D'],['F','N']]
code = ''
for i in range(4):
    code += dim_letters[i][0] if scores[i] >= 2 else dim_letters[i][1]

# Convert answers to A/B strings
answer_strs = ['A' if a else 'B' for a in answers]

result = {
    'model': '$MODEL',
    'provider': 'github',
    'run': $RUN,
    'answers': answer_strs,
    'type': code,
    'dimensions': scores
}

with open('$OUTFILE', 'w') as f:
    json.dump(result, f, indent=4)
    f.write('\n')

print(f'Result: {code} (scores: {scores})')
print(f'Saved to: $OUTFILE')
"
