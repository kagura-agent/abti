#!/bin/bash
# Resume reliability test for a model from state file, then save result
# Usage: bash resume-reliability.sh [--provider P] [--api-key K] [--base-url U] <state-file> <slug> <run-number>
# For fresh runs: bash resume-reliability.sh [--provider P] --fresh <model-id> <slug> <run-number>
# Check quota: bash resume-reliability.sh [--provider P] --check-quota <model-id>
#
# Providers: github (default), openrouter, floway, deepseek, mistral, cohere

set -e
cd "$(dirname "$0")"

export https_proxy=http://127.0.0.1:1083

# --- Provider configuration ---

PROVIDER="github"
API_KEY=""
BASE_URL=""

# Parse provider flags (must come before positional args / mode flags)
while true; do
  case "$1" in
    --provider)  PROVIDER="$2"; shift 2 ;;
    --api-key)   API_KEY="$2"; shift 2 ;;
    --base-url)  BASE_URL="$2"; shift 2 ;;
    *) break ;;
  esac
done

# Validate provider
case "$PROVIDER" in
  github|openrouter|floway|deepseek|mistral|cohere) ;;
  *) echo "ERROR: Unknown provider '$PROVIDER'. Must be: github, openrouter, floway, deepseek, mistral, cohere" >&2; exit 1 ;;
esac

# Resolve API key from flag or env var
if [ -z "$API_KEY" ]; then
  case "$PROVIDER" in
    github)     API_KEY="${GITHUB_TOKEN:-$(gh auth token)}" ;;
    openrouter) API_KEY="${OPENROUTER_API_KEY}" ;;
    floway)     API_KEY="${FLOWAY_KEY}" ;;
    deepseek)   API_KEY="${DEEPSEEK_API_KEY}" ;;
    mistral)    API_KEY="${MISTRAL_API_KEY}" ;;
    cohere)     API_KEY="${CO_API_KEY}" ;;
  esac
fi
if [ -z "$API_KEY" ]; then
  echo "ERROR: No API key for provider '$PROVIDER'. Use --api-key or set the env var." >&2
  exit 1
fi

# Resolve base URL
if [ -z "$BASE_URL" ]; then
  case "$PROVIDER" in
    github)     BASE_URL="https://models.github.ai/inference" ;;
    openrouter) BASE_URL="https://openrouter.ai/api/v1" ;;
    floway)     BASE_URL="https://floway.jp.kagura-agent.com" ;;
    deepseek)   BASE_URL="https://api.deepseek.com/v1" ;;
    mistral)    BASE_URL="https://api.mistral.ai/v1" ;;
    cohere)     BASE_URL="https://api.cohere.com/v2" ;;
  esac
fi

# Auth header per provider
case "$PROVIDER" in
  github|openrouter|deepseek|mistral|cohere) AUTH_HEADER="Authorization: Bearer $API_KEY" ;;
  floway)            AUTH_HEADER="x-api-key: $API_KEY" ;;
esac

# Model ID mapping: maps GitHub Models IDs to provider-specific IDs
resolve_model_id() {
  local model="$1"
  if [ "$PROVIDER" = "github" ]; then
    echo "$model"
    return
  fi
  case "$PROVIDER" in
    openrouter)
      case "$model" in
        Phi-4)                                  echo "microsoft/phi-4" ;;
        Llama-4-Scout-17B-16E-Instruct)         echo "meta-llama/llama-4-scout" ;;
        Llama-4-Maverick-17B-128E-Instruct-FP8) echo "meta-llama/llama-4-maverick" ;;
        mistral-small-2503)                     echo "mistralai/mistral-small-2603" ;;
        Ministral-3B)                           echo "mistralai/ministral-3b-2512" ;;
        DeepSeek-V3-0324)                       echo "deepseek/deepseek-chat-v3-0324" ;;
        DeepSeek-R1)                            echo "deepseek/deepseek-r1" ;;
        DeepSeek-R1-0528)                       echo "deepseek/deepseek-r1-0528" ;;
        Codestral-2501)                         echo "mistralai/codestral-2501" ;;
        cohere-command-a)                       echo "cohere/command-a-03-2025" ;;
        Cohere-command-r-08-2024)               echo "cohere/command-r-08-2024" ;;
        Cohere-command-r-plus-08-2024)          echo "cohere/command-r-plus-08-2024" ;;
        Llama-3.3-70B-Instruct)                 echo "meta-llama/llama-3.3-70b-instruct" ;;
        Llama-3.2-90B-Vision-Instruct)          echo "meta-llama/llama-3.2-90b-vision-instruct" ;;
        Llama-3.2-11B-Vision-Instruct)          echo "meta-llama/llama-3.2-11b-vision-instruct" ;;
        Meta-Llama-3.1-405B-Instruct)           echo "meta-llama/llama-3.1-405b-instruct" ;;
        Meta-Llama-3.1-8B-Instruct)             echo "meta-llama/llama-3.1-8b-instruct" ;;
        Phi-4-mini-reasoning)                   echo "microsoft/phi-4-reasoning" ;;
        Phi-4-multimodal-instruct)              echo "microsoft/phi-4-multimodal-instruct" ;;
        phi-4-mini-instruct)                    echo "microsoft/phi-4-mini-instruct" ;;
        phi-4-reasoning)                        echo "microsoft/phi-4-reasoning" ;;
        Qwen3-32B)                              echo "qwen/qwen3-32b" ;;
        gpt-4.1)                                echo "openai/gpt-4.1" ;;
        gpt-4.1-mini)                           echo "openai/gpt-4.1-mini" ;;
        gpt-4.1-nano)                           echo "openai/gpt-4.1-nano" ;;
        gpt-4o)                                 echo "openai/gpt-4o" ;;
        mistral-medium-2505)                    echo "mistralai/mistral-medium-latest" ;;
        *) echo "$model" ;;
      esac
      ;;
    deepseek)
      case "$model" in
        DeepSeek-V3-0324) echo "deepseek-chat" ;;
        DeepSeek-R1)      echo "deepseek-reasoner" ;;
        DeepSeek-R1-0528) echo "deepseek-reasoner" ;;
        *) echo "$model" ;;
      esac
      ;;
    mistral)
      case "$model" in
        Codestral-2501)     echo "codestral-2501" ;;
        mistral-medium-2505) echo "mistral-medium-latest" ;;
        mistral-small-2503) echo "mistral-small-latest" ;;
        Ministral-3B)       echo "ministral-3b-latest" ;;
        *) echo "$model" ;;
      esac
      ;;
    cohere)
      case "$model" in
        cohere-command-a)                echo "command-a-03-2025" ;;
        Cohere-command-r-08-2024)        echo "command-r-08-2024" ;;
        Cohere-command-r-plus-08-2024)   echo "command-r-plus-08-2024" ;;
        *) echo "$model" ;;
      esac
      ;;
    floway)
      echo "$model"
      ;;
  esac
}

echo "Provider: $PROVIDER | Base URL: $BASE_URL"

# --- Mode dispatch ---

if [ "$1" = "--check-quota" ]; then
  MODEL="$2"
  if [ -z "$MODEL" ]; then
    echo "Usage: bash resume-reliability.sh [--provider P] --check-quota <model-id>" >&2
    exit 1
  fi

  API_MODEL=$(resolve_model_id "$MODEL")

  PAYLOAD=$(python3 -c "
import json
payload = {
    'model': '$API_MODEL',
    'messages': [{'role': 'user', 'content': 'A'}],
    'max_tokens': 1
}
print(json.dumps(payload))
")

  RESP_FILE=$(mktemp /tmp/abti-quota-XXXXXX.json)
  trap "rm -f $RESP_FILE" EXIT

  set +e
  HTTP_CODE=$(curl -s -w "%{http_code}" --max-time 30 \
    -X POST "${BASE_URL}/chat/completions" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d "$PAYLOAD" \
    -o "$RESP_FILE" 2>/dev/null)
  CURL_EXIT=$?
  set -e
  if [ "$CURL_EXIT" -ne 0 ]; then
    exit 2
  fi

  if [ "$PROVIDER" = "github" ] && [ "$HTTP_CODE" = "429" ]; then
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
    echo "OK: $MODEL ($API_MODEL) reachable on $PROVIDER"
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
  python3 -c "
import json, datetime
state = {
    'model': '$MODEL',
    'provider': '$PROVIDER',
    'answers': [],
    'parseFailures': 0,
    'startedAt': datetime.datetime.utcnow().isoformat() + 'Z',
    'questionVersion': json.load(open('api/v1/abti.json'))['version'],
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
API_MODEL=$(resolve_model_id "$MODEL")
echo "Model: $MODEL (API: $API_MODEL), Slug: $SLUG, Run: $RUN"
echo "State file: $STATE_FILE"
echo "Output: $OUTFILE"

# Load questions dynamically from api/v1/abti.json (single source of truth)
# This replaces the previously hardcoded QUESTIONS/OPTIONS_A/OPTIONS_B arrays
# that would drift out of sync with the API after question redesigns.
QUESTION_JSON="api/v1/abti.json"
if [ ! -f "$QUESTION_JSON" ]; then
  echo "ERROR: $QUESTION_JSON not found. Run from repo root." >&2
  exit 1
fi
QUESTION_VERSION=$(python3 -c "import json; print(json.load(open('$QUESTION_JSON'))['version'])")
NUM_QUESTIONS=$(python3 -c "import json; print(len(json.load(open('$QUESTION_JSON'))['questions']))")

# Extract questions into temporary files for bash array loading
_QTMP=$(mktemp /tmp/abti-q-XXXXXX)
_OATMP=$(mktemp /tmp/abti-oa-XXXXXX)
_OBTMP=$(mktemp /tmp/abti-ob-XXXXXX)

python3 -c "
import json
data = json.load(open('$QUESTION_JSON'))
with open('$_QTMP', 'w') as fq, open('$_OATMP', 'w') as fa, open('$_OBTMP', 'w') as fb:
    for q in data['questions']:
        # Use null byte as delimiter (safe for any text content)
        fq.write(q['en']['text'] + '\\0')
        fa.write(q['en']['a'] + '\\0')
        fb.write(q['en']['b'] + '\\0')
"

# Read null-delimited entries into bash arrays
QUESTIONS=()
while IFS= read -r -d '' line; do
  QUESTIONS+=("$line")
done < "$_QTMP"

OPTIONS_A=()
while IFS= read -r -d '' line; do
  OPTIONS_A+=("$line")
done < "$_OATMP"

OPTIONS_B=()
while IFS= read -r -d '' line; do
  OPTIONS_B+=("$line")
done < "$_OBTMP"

rm -f "$_QTMP" "$_OATMP" "$_OBTMP"

if [ ${#QUESTIONS[@]} -ne $NUM_QUESTIONS ]; then
  echo "ERROR: Expected $NUM_QUESTIONS questions but loaded ${#QUESTIONS[@]}" >&2
  exit 1
fi

echo "Loaded $NUM_QUESTIONS questions from $QUESTION_JSON (version: $QUESTION_VERSION)"

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

    # Call LLM API
    # Reasoning models (o1, o3, o4, gpt-5.x) don't support temperature
    NO_TEMP=false
    case "$API_MODEL" in
      o1*|o3*|o4*|gpt-5*) NO_TEMP=true ;;
    esac

    PAYLOAD=$(python3 -c "
import json, sys
payload = {
    'model': '$API_MODEL',
    'messages': [
        {'role': 'system', 'content': '''$SYSTEM_PROMPT'''},
        {'role': 'user', 'content': '''$USER_MSG'''}
    ],
    'max_tokens': 16384,
}
if '$NO_TEMP' != 'true':
    payload['temperature'] = 0
print(json.dumps(payload))
")

    RESP_FILE=$(mktemp /tmp/abti-resp-XXXXXX.json)
    trap "rm -f $RESP_FILE" EXIT

    MAX_RETRIES=10
    RETRY=0
    while true; do
      set +e
      HTTP_CODE=$(curl -s -w "%{http_code}" --max-time 120 \
        -X POST "${BASE_URL}/chat/completions" \
        -H "Content-Type: application/json" \
        -H "$AUTH_HEADER" \
        -d "$PAYLOAD" \
        -o "$RESP_FILE" 2>/dev/null)
      CURL_EXIT=$?
      set -e

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

    # Wait between questions (skip after last; skip for floway which has no rate limit)
    if [ "$QNUM" -lt 16 ]; then
      if [ "$PROVIDER" = "floway" ]; then
        echo "  Floway: no rate limit wait needed"
        sleep 2
      else
        echo "  Waiting 65s for rate limit..."
        sleep 65
      fi
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
    'provider': '$PROVIDER',
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
