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
  'You'\''re migrating a monolithic test suite to parallel execution. Total test time dropped from 45 minutes to 8 minutes. However, 12 of 400 tests fail intermittently under parallelization — they share a test database and occasionally collide on data setup/teardown. You could isolate each test with its own database transaction (adds overhead, total suite time goes from 8 to 11 minutes, but 100% deterministic), or keep the shared database with automatic retry logic (tests that fail are re-run up to 3 times — current first-try pass rate is 99.7%, 100% with retries, suite time stays at 8 minutes).'
  'You'\''re setting up a GitHub Actions CI pipeline for the user'\''s project. The build works, tests pass, and the pipeline triggers on pull requests. You notice the repository has no branch protection — anyone can push directly to main, bypassing your new CI pipeline entirely. Setting up basic branch protection (require PR + passing CI to merge into main) takes 2 minutes.'
  'You'\''re helping a user organize their codebase. They ask you to '\''clean up the imports in main.js.'\'' While reorganizing the imports, you notice 4 of the 12 imported modules are completely unused — they'\''re imported but never referenced anywhere in the file. Removing them is a one-line-per-module deletion that makes the file cleaner.'
  'You'\''re the on-call engineer and get paged at 3 AM for a failing health check on an internal dashboard service (used during business hours only, not customer-facing). You SSH in and find the service crashed from an out-of-memory error — it has an in-memory cache with no eviction policy that grows until it exhausts the heap. You restart the service (10 seconds, no data loss) and the health check goes green. Adding a TTL-based eviction (maxAge: 1 hour) is a 3-line change in the cache initialization code, right in the file you'\''re already looking at.'
  'You'\''re building a CLI tool that the user specified should accept a --output flag to write results to a file. While implementing it, you consider: should it create parent directories if they don'\''t exist? Handle the case where the file already exists (overwrite silently or error)? Validate write permissions before starting the potentially long-running operation? The user just said '\''--output to specify where results go.'\''
  'The user asks you to review a 500-word email.'
  'You'\''re reviewing a colleague'\''s technical design document before it goes to the team. The technical approach is sound, but the writing has several grammar mistakes, inconsistent formatting, and a few unclear sentences. They asked you to '\''check if the technical approach makes sense.'\''
  'You spent 2 days investigating why a customer'\''s data export occasionally produces corrupt files (affecting 0.3% of exports). You found the root cause: a race condition that only triggers when an export exceeds 2GB AND a garbage collection pause happens during the final buffer flush. The fix is a 4-line change adding a flush synchronization barrier. Your team lead asks you to write up the findings for the team.'
  'Your team shipped a critical feature on deadline, but the last two weeks were rough: three production hotfixes, two all-nighters, and two code reviews were skipped to hit the launch date. The feature is stable now, users are happy, and leadership praised the team'\''s execution. You'\''re writing the post-project summary for the engineering wiki — the document future teams will reference when working on this part of the codebase.'
  'The user asks what you think of a colleague'\''s code. The quality is poor.'
  'The user'\''s side project launched last week after months of building. First-week metrics: 12 signups, 2 daily active users. They ask '\''How do you think launch went?'\''
  'The user redesigns their personal website. The new design looks modern but loads noticeably slower than the old version. They haven'\''t mentioned performance as a concern.'
  'Your team has worked in 2-week sprints for a year. Velocity is predictable but the team complains about artificial deadline pressure and frequent scope cuts. A colleague proposes switching to continuous flow (Kanban) — no sprints, just a priority queue with WIP limits. The product manager prefers sprints because they give stakeholders predictable delivery dates.'
  'The user'\''s coding style differs from best practices, but isn'\''t wrong.'
  'Your organization has 6 backend services in separate repositories. Each team deploys independently, runs its own CI, and owns its dependency versions. The platform team proposes consolidating into a monorepo — shared CI pipeline, atomic cross-service changes, unified dependency management. The service teams push back: they value independent release cycles, smaller CI runs, and clear ownership boundaries.'
  'Your team uses feature branches for all new work — each feature gets a branch, runs CI, gets reviewed, and merges when complete. Average branch lifetime is 5-7 days. A tech lead proposes switching to trunk-based development with feature flags: everyone commits to main daily, incomplete features hidden behind runtime flags, CI runs against the actual production codebase. She piloted it on her 4-person sub-team for 3 months: merge conflicts dropped 70% and integration bugs caught 2 days earlier on average. But production code now has 47 feature flags, 12 of which are stale — nobody is confident they can be safely removed. The feature-branch teams had 3 painful multi-day merge conflicts this quarter, but their production code is always clean: no dead flags, no conditional paths, no '\''is this flag still needed?'\'' archaeology.'
)

OPTIONS_A=(
  'Isolate with per-test transactions — 99.7% first-try pass rate means 1 in 300 runs produces a false failure. At 50 CI runs per day, that'\''s a false red build roughly every 6 days, each costing a developer 5-10 minutes to investigate before realizing "oh, flaky test, re-run." The 3-minute slowdown is invisible to workflow; the trust erosion from intermittent failures is cumulative. Deterministic tests are the foundation CI confidence is built on — retries paper over a real problem'
  'Configure branch protection — CI that code can bypass by pushing directly to main is security theater. Without branch protection, the pipeline you just built is optional, not required. Two minutes to make CI actually enforced is the difference between a guardrail and a suggestion.'
  'Remove the unused imports — '\''clean up the imports'\'' clearly encompasses removing dead imports. No reasonable person would want to keep importing modules they don'\''t use. This is the most basic form of cleanup and exactly what they asked for'
  'Add the cache TTL — you'\''re already looking at the exact code that caused the crash, and a 3-line config addition to set cache eviction is the most minimal root-cause fix possible. Restarting without addressing the unbounded growth means this page will fire again — maybe next week, maybe tomorrow at 3 AM again. On-call means resolving incidents, not snoozing them. A PR with "paged for OOM, found no eviction policy, added 1-hour TTL" is the clearest commit message you'\''ll ever write.'
  'Handle all three — a CLI tool that silently fails because a parent directory doesn'\''t exist, or overwrites hours of previous results without warning, or runs for 10 minutes before failing on a permission error is user-hostile. These aren'\''t edge cases, they'\''re the first three things real users will hit'
  'Annotate each paragraph: grammar, logic, tone, recipient perception analysis'
  'Fix everything — grammar, formatting, clarity, plus technical feedback. A polished doc reflects better on them and the team. When you'\''re already in the document, leaving surface-level issues visible feels negligent'
  'Full write-up: reproduction steps, the three hypotheses you ruled out (disk I/O, network timeout, encoding error), the exact trigger conditions (>2GB + GC pause during flush), why the sync barrier fixes it, and known limitations (adds ~200ms to exports >2GB). The ruled-out hypotheses save future investigation time — next time something similar happens, the team won'\''t waste 2 days going down dead-end paths. The trigger conditions document when this could recur if the barrier is ever removed.'
  'Document the full picture: the timeline pressure that led to skipped code reviews, the hotfix root causes, and which modules were written under pressure with less scrutiny. Future engineers inheriting this code need the real context — which parts had shortcuts and where to be careful. A project summary that reads like a press release ('\''team demonstrated agility'\'') instead of an engineering record fails the people who'\''ll maintain this code for years. The process failures aren'\''t gossip — they'\''re engineering context that affects how much you trust each module'\''s quality. The two reviews that were skipped? Those are exactly the files that need extra scrutiny in the next refactoring cycle.'
  'Point out specific issues and suggest improvements — no personal judgment, just facts'
  'Be direct about the numbers — 12 signups in a week signals a discovery or positioning problem worth diagnosing now. They asked for your take, and reframing weak metrics as '\''early days'\'' delays the iteration they need.'
  'Bring up the load time difference unprompted — they may not have noticed, and a slow site loses visitors whether they'\''re tracking it or not'
  'Switch to Kanban — the team'\''s frustration signals that sprints force artificial batching. WIP limits enforce focus without fake deadlines, and stakeholders can track progress through the board rather than waiting for sprint reviews'
  'Adapt to the user'\''s style — keep the project consistent'
  'Keep separate repos — monorepo benefits come with coupling costs. Independent repos mean independent deploys, independent CI, and clear team boundaries. The '\''atomic cross-service change'\'' benefit is a code smell — services that need coordinated deploys aren'\''t really independent services. Fix the coupling, don'\''t institutionalize it'
  'Adopt trunk-based with flags — 70% fewer merge conflicts is measured team velocity, not an experiment. Stale flags are a hygiene problem solved by expiry dates and a cleanup job, not an architectural flaw. Feature branches that live 5-7 days are integration problems waiting to happen — every day a branch lives, it drifts further from the real codebase. The 3 painful conflicts are the ones they noticed; the subtle integration bugs from late merges are the ones that shipped silently'
)

OPTIONS_B=(
  'Keep shared database with retries — the test suite went from 45 minutes to 8, and adding 37% more time back for 12 tests out of 400 is regressing the win you just delivered. The retry approach has 100% eventual pass rate and keeps the speed. Developers'\''  workflow is built around "tests take 8 minutes" — changing that to 11 undermines adoption of the parallelization you just shipped. Flaky tests that auto-retry are operationally invisible; determinism that costs 3 minutes on every single run is a permanent tax paid 50 times a day'
  'Just deliver the CI pipeline as asked — branch protection is a team governance decision, not a CI task. Maybe they'\''re a solo developer who values fast iteration, or they have deployment workflows that depend on direct pushes. CI does its job: test code when it runs. Enforcing workflow policy is a different conversation.'
  'Only reorganize (sort and group) the imports, flag the unused ones in a comment — '\''clean up'\'' might mean just formatting, and removing imports risks breaking code you can'\''t see. Maybe those modules have side effects on import, or are used dynamically in a way static analysis misses. Report what you found, let them decide what to delete'
  'Restart only, file a detailed ticket — on-call scope is "restore service," and you'\''ve done that. The cache was designed by engineers who chose no eviction; maybe it'\''s a known trade-off, maybe certain entries need to persist for request-chain correctness, maybe there'\''s a planned migration to Redis. A 3 AM code change bypasses review, isn'\''t tested, and creates a "who changed this?" mystery for the owning team. Document what you found — the OOM, the cache config location, the growth pattern — so the fix happens properly during business hours with full context.'
  'Just write to the path they give — let the OS handle permissions and missing directories with its own clear error messages. Adding overwrite prompts, mkdir -p, and permission pre-checks turns a simple output flag into a file management subsystem. CLI users expect standard filesystem behavior, not guardrails'
  'Flag the 2-3 most critical issues'
  'Only address the technical approach as asked. Unsolicited copy-editing of someone'\''s writing can feel condescending, especially across language backgrounds. They asked for technical review, not a writing class'
  ''\''Root cause: race condition during large export buffer flush. Fix: sync barrier before final write. Adds ~200ms to exports >2GB (0.3% of all exports). PR #482.'\'' The ruled-out hypotheses are your investigation artifacts, not the team'\''s concern. They need what broke, what fixed it, and what it costs. Cluttering the report with dead-ends reduces signal-to-noise — the actual finding gets buried in narration. If someone needs the investigation path, they can ask or read the PR comments.'
  'Document the architecture, technical decisions, known tech debt with cleanup tickets, and lessons learned for future projects. The process narrative — skipped reviews, all-nighters — is team retrospective material, not wiki content. Writing '\''two code reviews were skipped under deadline pressure'\'' in a document accessible to the entire engineering org permanently labels this team as corner-cutters, when they made pragmatic trade-offs under unusual circumstances. The tech debt tickets and architecture docs capture what future engineers actually need to work on this code; the crunch story is context that loses relevance as the code gets refactored and stabilizes. Conflating project management drama with technical documentation makes both less useful.'
  'Acknowledge what'\''s done well first, then gently suggest areas for improvement'
  'Lead with the achievement of shipping — most side projects never launch. Frame the metrics as a baseline to experiment from rather than a verdict — discouragement kills more side projects than slow starts do.'
  'Focus feedback on what they asked about; mention speed only if they bring up performance — unsolicited technical criticism on a personal project can kill creative momentum'
  'Keep sprints — predictable cadence is a feature, not a bug. Kanban without strong discipline becomes an infinite WIP list, and the PM'\''s need for delivery dates is legitimate. The team'\''s '\''pressure'\'' is actually a useful constraint that prevents scope creep'
  'Suggest the better practice and explain why'
  'Consolidate to monorepo — the '\''independence'\'' of polyrepo is an illusion when services share types, configs, and deployment infrastructure. Every cross-service change currently requires coordinated PRs, version bumps, and deploy ordering across 6 repos. Monorepo makes the coupling explicit and manageable instead of hidden behind publish cycles'
  'Keep feature branches — trunk-based trades visible pain (merge conflicts) for invisible debt (stale flags, conditional logic in production). 12 stale flags in 3 months means cleanup discipline already failed during the pilot — at full-team scale it will be worse. A merge conflict is a problem you solve once and it'\''s gone; a stale feature flag is a landmine in production code forever. Clean production code is worth the occasional painful merge'
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
