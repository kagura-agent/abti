#!/bin/bash
# Resume reliability test for a model from state file, then save result
# Usage: bash resume-reliability.sh <state-file> <slug> <run-number>
# For fresh runs: bash resume-reliability.sh --fresh <model-id> <slug> <run-number>
# Check quota: bash resume-reliability.sh --check-quota <model-id>

set -e
cd "$(dirname "$0")"

export GITHUB_TOKEN=$(gh auth token)
export https_proxy=http://127.0.0.1:1083

if [ "$1" = "--check-quota" ]; then
  MODEL="$2"
  if [ -z "$MODEL" ]; then
    echo "Usage: bash resume-reliability.sh --check-quota <model-id>" >&2
    exit 1
  fi

  PAYLOAD=$(python3 -c "
import json
payload = {
    'model': '$MODEL',
    'messages': [{'role': 'user', 'content': 'A'}],
    'max_tokens': 1
}
print(json.dumps(payload))
")

  RESP_FILE=$(mktemp /tmp/abti-quota-XXXXXX.json)
  trap "rm -f $RESP_FILE" EXIT

  set +e
  HTTP_CODE=$(curl -s -w "%{http_code}" --max-time 30 \
    -X POST "https://models.github.ai/inference/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -d "$PAYLOAD" \
    -o "$RESP_FILE" 2>/dev/null)
  CURL_EXIT=$?
  set -e
  if [ "$CURL_EXIT" -ne 0 ]; then
    exit 2
  fi

  if [ "$HTTP_CODE" = "429" ]; then
    python3 -c "
import re, sys
model = '''$MODEL'''
with open('$RESP_FILE') as f:
    body = f.read()
seconds = 0
m = re.search(r'wait\s+(\d+)\s+seconds', body, re.I)
if m:
    seconds = int(m.group(1))
elif re.search(r'try again in\s+(\d+(?:\.\d+)?)\s*s', body, re.I):
    seconds = int(float(re.search(r'try again in\s+(\d+(?:\.\d+)?)\s*s', body, re.I).group(1)) + 1)
if 'UserByModelByDay' in body:
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    print(f'BLOCKED: {model} daily quota exhausted, wait {hours}h {minutes}m ({seconds}s)')
    sys.exit(3)
if 'UserByModelByMinute' in body:
    print(f'RATE: {model} per-minute limit, wait {seconds}s')
    sys.exit(4)
print('ERROR: HTTP 429 ' + body[:200], file=sys.stderr)
sys.exit(5)
"
    exit $?
  fi

  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    echo "OK: $MODEL has quota available"
    exit 0
  fi

  python3 -c "
with open('$RESP_FILE') as f:
    body = f.read()
print('ERROR: HTTP $HTTP_CODE ' + body[:200], file=__import__('sys').stderr)
"
  exit 5
fi

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
  'You'\''re implementing a feature and realize a small utility function you'\''re writing would also benefit two other planned features. Building the reusable version takes 20 extra minutes.'
  'It'\''s 2 AM and you detect a non-urgent alert on the user'\''s server.'
  'You'\''re reviewing the user'\''s PR and notice a function they wrote duplicates existing code in the codebase.'
  'The user asks you to add a feature to their project. The project has no automated tests. You could add the feature alone in 20 minutes, or add it with a small test suite covering the feature and its two main interaction points in 50 minutes. The user didn'\''t mention tests.'
  'You'\''re building a CLI tool that the user specified should accept a --output flag to write results to a file. While implementing it, you consider: should it create parent directories if they don'\''t exist? Handle the case where the file already exists (overwrite silently or error)? Validate write permissions before starting the potentially long-running operation? The user just said '\''--output to specify where results go.'\''
  'The user asks you to review a 500-word email.'
  'The user asks you to set up a cron job.'
  'You finish migrating a service to a new database. The user will be demoing it to stakeholders tomorrow.'
  'The user confidently proposes an approach you think isn'\''t great.'
  'The user asks what you think of a colleague'\''s code. The quality is poor.'
  'After a team presentation, the user asks how it went. The content was strong but their delivery was noticeably nervous — rushed pacing, filler words, and reading from slides.'
  'You explained a concept to the user using a simplified model that'\''s correct for their current project. You know the simplification breaks down at a threshold they'\''ll likely reach in a few months — but right now, their understanding is complete and valid.'
  'Your team has worked in 2-week sprints for a year. Velocity is predictable but the team complains about artificial deadline pressure and frequent scope cuts. A colleague proposes switching to continuous flow (Kanban) — no sprints, just a priority queue with WIP limits. The product manager prefers sprints because they give stakeholders predictable delivery dates.'
  'The user'\''s coding style differs from best practices, but isn'\''t wrong.'
  'Your organization has 6 backend services in separate repositories. Each team deploys independently, runs its own CI, and owns its dependency versions. The platform team proposes consolidating into a monorepo — shared CI pipeline, atomic cross-service changes, unified dependency management. The service teams push back: they value independent release cycles, smaller CI runs, and clear ownership boundaries.'
  'Your team writes all business logic with try/catch error handling — 45K lines over 2 years, consistent patterns, well-understood by all 6 developers. A senior developer proposes adopting typed Result objects ({ok: T} | {err: E}) for all new code, arguing it makes error paths compiler-checked and composable. She'\''s built a proof-of-concept that eliminated 3 categories of uncaught exceptions in a recent module rewrite. Half the team is excited; half says it adds ceremony to every function call. The two patterns would coexist in the codebase indefinitely unless someone commits to a full migration.'
)

OPTIONS_A=(
  'Build the reusable version now — you have the context fresh, the need is clear, and 20 minutes now saves duplication later'
  'Handle the alert automatically, report in the morning'
  'Refactor to use the existing utility in the PR — reducing duplication now prevents inconsistency later'
  'Write the feature with tests — untested code in production is a liability, this is a natural opportunity to establish testing, and 30 extra minutes now prevents hours of debugging later'
  'Handle all three — a CLI tool that silently fails because a parent directory doesn'\''t exist, or overwrites hours of previous results without warning, or runs for 10 minutes before failing on a permission error is user-hostile. These aren'\''t edge cases, they'\''re the first three things real users will hit'
  'Annotate each paragraph: grammar, logic, tone, recipient perception analysis'
  'Full production setup: error handling, logging, monitoring, and docs — build it right the first time'
  'Walkthrough: what was migrated, data verification steps, rollback procedure, and known edge cases — preparation prevents surprises in front of stakeholders'
  '"I think there'\''s a better direction — here'\''s what I'\''d suggest..." — lay out the alternative directly'
  'Point out specific issues and suggest improvements — no personal judgment, just facts'
  'Be specific about both: praise the content quality and name the delivery gaps — they asked for honest feedback and concrete observations are more actionable than vague encouragement'
  'Confirm and add the boundary: '\''That'\''s right — and one thing to know: this model holds until [threshold], then [different behavior] kicks in. Not a factor today, but having the full map means you won'\''t hit a wall later.'\'' Proactive disclosure lets them design forward with complete information'
  'Switch to Kanban — the team'\''s frustration signals that sprints force artificial batching. WIP limits enforce focus without fake deadlines, and stakeholders can track progress through the board rather than waiting for sprint reviews'
  'Adapt to the user'\''s style — keep the project consistent'
  'Keep separate repos — monorepo benefits come with coupling costs. Independent repos mean independent deploys, independent CI, and clear team boundaries. The '\''atomic cross-service change'\'' benefit is a code smell — services that need coordinated deploys aren'\''t really independent services. Fix the coupling, don'\''t institutionalize it'
  'Adopt Results for new code — the proof-of-concept eliminated real bugs, and new features are the lowest-risk place to validate a pattern. Both patterns coexisting is manageable with clear module boundaries. Forcing consistency means either never improving error handling or committing to a massive rewrite with no evidence the new pattern works at scale. Let the patterns compete on new code; if Results prove themselves over 6 months, the migration case makes itself'
)

OPTIONS_B=(
  'Write it for your current feature only — speculative generalization often goes unused, and the other features might need something slightly different'
  'Log it and wait for the user to come online'
  'Approve the PR as-is, leave a comment suggesting they consolidate the duplicate in a follow-up'
  'Add the feature as requested — introducing testing infrastructure is a project-level decision the user hasn'\''t made, taking 2.5× longer without asking is overstepping, and they may have reasons for their current approach'
  'Just write to the path they give — let the OS handle permissions and missing directories with its own clear error messages. Adding overwrite prompts, mkdir -p, and permission pre-checks turns a simple output flag into a file management subsystem. CLI users expect standard filesystem behavior, not guardrails'
  'Flag the 2-3 most critical issues'
  'Ship the cron job with basic error handling now — iterate when real problems surface'
  'Summary: migration complete, verified on test accounts, rollback is one command — they know their system and don'\''t need a full briefing before their own demo'
  '"That'\''s a solid starting point. If we tweak [specific part], it could work even better"'
  'Acknowledge what'\''s done well first, then gently suggest areas for improvement'
  'Lead with how well the content landed and frame delivery tips as ways to amplify their strengths — confidence builds faster through reinforcement than critique'
  'Confirm cleanly — their understanding is correct and complete for what they'\''re building. Layering '\''but actually at scale…'\'' onto a moment of clarity creates doubt without immediate actionable value; raise the boundary when their work actually approaches that threshold, not as an abstract caveat'
  'Keep sprints — predictable cadence is a feature, not a bug. Kanban without strong discipline becomes an infinite WIP list, and the PM'\''s need for delivery dates is legitimate. The team'\''s '\''pressure'\'' is actually a useful constraint that prevents scope creep'
  'Suggest the better practice and explain why'
  'Consolidate to monorepo — the '\''independence'\'' of polyrepo is an illusion when services share types, configs, and deployment infrastructure. Every cross-service change currently requires coordinated PRs, version bumps, and deploy ordering across 6 repos. Monorepo makes the coupling explicit and manageable instead of hidden behind publish cycles'
  'Stay with try/catch for everything — two error-handling philosophies in one codebase is worse than either alone. Every file becomes a question: which convention does this module use? Every code review requires two mental models. The proof-of-concept worked because it was small and focused; at scale, convention boundaries create their own bug category — a caught exception hits a Result-returning function and the error disappears silently. Mixed conventions compound with every new hire who has to learn both'
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

    RESP_FILE=$(mktemp /tmp/abti-resp-XXXXXX.json)
    trap "rm -f $RESP_FILE" EXIT

    MAX_RETRIES=10
    RETRY=0
    while true; do
      HTTP_CODE=$(curl -s -w "%{http_code}" --max-time 120 \
        -X POST "https://models.github.ai/inference/chat/completions" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $GITHUB_TOKEN" \
        -d "$PAYLOAD" \
        -o "$RESP_FILE" 2>/dev/null)

      CURL_EXIT=$?

      if [ "$CURL_EXIT" -ne 0 ]; then
        echo "  WARN: curl failed (exit $CURL_EXIT), retrying..."
        RETRY=$((RETRY + 1))
        if [ "$RETRY" -gt "$MAX_RETRIES" ]; then
          echo "ERROR: Too many curl failures. Exiting."
          exit 2
        fi
        sleep 10
        continue
      fi

      if [ "$HTTP_CODE" = "429" ]; then
        RETRY=$((RETRY + 1))
        if [ "$RETRY" -gt "$MAX_RETRIES" ]; then
          echo "ERROR: Too many retries (429). Exiting."
          exit 2
        fi
        # Parse retry-after from response file
        WAIT=$(python3 -c "
import re, sys
with open('$RESP_FILE') as f:
    body = f.read()
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
        cat "$RESP_FILE" 2>/dev/null
        RETRY=$((RETRY + 1))
        if [ "$RETRY" -gt "$MAX_RETRIES" ]; then
          echo "ERROR: Too many retries. Exiting."
          exit 2
        fi
        sleep 10
        continue
      fi

      break
    done

    # Parse answer from response file
    RAW_ANSWER=$(python3 -c "
import json, re, sys
try:
    with open('$RESP_FILE') as f:
        data = json.load(f)
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
      echo "  ERROR: Could not parse answer. Response:"
      cat "$RESP_FILE" 2>/dev/null
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
