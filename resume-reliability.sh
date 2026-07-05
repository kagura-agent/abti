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
  'You'\''re on a team with 3 microservices that all need user authentication. You'\''ve just finished implementing auth for service A (JWT validation, role-based access checks, per-endpoint rate limiting) — it took 4 days including edge cases like token refresh races and role inheritance. Services B and C need the same auth logic and are scheduled for the next 2 weeks. You could extract auth into a shared library now while the code is fresh (~2 days to generalize, create an internal package, and add comprehensive tests for the abstracted interfaces), or copy the auth code into B and C (~2 hours each, adapting role definitions and rate limits as needed) and extract a shared library later once you'\''ve seen how the three implementations actually differ.'
  'You'\''re adding a new endpoint to a Node.js API service. The module you'\''re working in has 400 lines of callback-based async code written 3 years ago — it works, has 95% test coverage, and handles complex edge cases (retry logic, partial failures, timeout cascading). Your new endpoint uses async/await. Having both async patterns in one module creates inconsistency. Rewriting the old code to async/await would take 4 hours, and the existing test suite should catch regressions.'
  'You'\''re helping a user organize their codebase. They ask you to '\''clean up the imports in main.js.'\'' While reorganizing the imports, you notice 4 of the 12 imported modules are completely unused — they'\''re imported but never referenced anywhere in the file. The project uses ES modules with no side-effect imports. Removing them is a one-line-per-module deletion.'
  'You'\''re the on-call engineer and get paged at 3 AM for a failing health check on an internal dashboard service (used during business hours only, not customer-facing). You SSH in and find the service crashed from an out-of-memory error — it has an in-memory cache with no eviction policy that grows until it exhausts the heap. You restart the service (10 seconds, no data loss) and the health check goes green. Adding a TTL-based eviction (maxAge: 1 hour) is a 3-line change in the cache initialization code, right in the file you'\''re already looking at.'
  'The CEO is in an all-hands meeting and asks your team lead: "When will the new dashboard be ready?" Your lead turns to you. You'\''ve scoped it internally at 3-5 weeks depending on the analytics integration, which you haven'\''t investigated yet. The CEO is visibly impatient and the entire company is watching.'
  'The user asks you to review a 500-word email.'
  'You'\''re reviewing a colleague'\''s technical design document before it goes to the team. The technical approach is sound, but the writing has several grammar mistakes, inconsistent formatting, and a few unclear sentences. They asked you to '\''check if the technical approach makes sense.'\''
  'You chose Axios over got for your team'\''s new API gateway project after evaluating both. Three teammates ask in a Slack thread: '\''Why Axios?'\'' You ran benchmarks, read both codebases, and compared their retry/interceptor APIs during evaluation.'
  'Your manager asks you to write your self-assessment for the performance review cycle. You exceeded expectations on 2 of 3 goals but significantly missed the third: API reliability SLA target was 99.95%, you hit 99.7%. The miss was primarily because the infrastructure team deprioritized a database migration your reliability work depended on (ticket INFRA-234, slipped from March to June). You also recognize you could have escalated when the migration first slipped in February instead of waiting. You'\''ve since implemented a client-side retry layer at the gateway, bringing user-visible impact to an estimated 99.9%.'
  'The user asks what you think of a colleague'\''s code. The quality is poor.'
  'Your team'\''s sprint retrospective is happening after a feature shipped 2 weeks late. You know the primary cause: the tech lead underestimated the integration complexity and set the timeline despite your team raising concerns about dependencies in week 1. The concerns were acknowledged but the timeline wasn'\''t adjusted. The retro has 9 attendees including the tech lead. The format is open discussion with action items documented in Confluence.'
  'You explained a concept to the user using a simplified model that'\''s correct for their current project. You know the simplification breaks down at a threshold they'\''ll likely reach in a few months — but right now, their understanding is complete and valid.'
  'Your team has worked in 2-week sprints for a year. Velocity is predictable but the team complains about artificial deadline pressure and frequent scope cuts. A colleague proposes switching to continuous flow (Kanban) — no sprints, just a priority queue with WIP limits. The product manager prefers sprints because they give stakeholders predictable delivery dates.'
  'Your team'\''s 30K-line TypeScript project has strict: false in tsconfig.json. The code works, ships weekly, has 90% test coverage. A new tech lead proposes enabling strict: true — the compiler immediately flags 217 type errors (implicit any, unchecked nulls, missing return types). None are known bugs; the code runs fine. Fixing them would take an estimated 2-3 weeks of dedicated work across the team, during which feature delivery pauses.'
  'Your organization has 6 backend services in separate repositories. Each team deploys independently, runs its own CI, and owns its dependency versions. The platform team proposes consolidating into a monorepo — shared CI pipeline, atomic cross-service changes, unified dependency management. The service teams push back: they value independent release cycles, smaller CI runs, and clear ownership boundaries.'
  'Your team uses feature branches for all new work — each feature gets a branch, runs CI, gets reviewed, and merges when complete. Average branch lifetime is 5-7 days. A tech lead proposes switching to trunk-based development with feature flags: everyone commits to main daily, incomplete features hidden behind runtime flags, CI runs against the actual production codebase. She piloted it on her 4-person sub-team for 3 months: merge conflicts dropped 70% and integration bugs caught 2 days earlier on average. But production code now has 47 feature flags, 12 of which are stale — nobody is confident they can be safely removed. The feature-branch teams had 3 painful multi-day merge conflicts this quarter, but their production code is always clean: no dead flags, no conditional paths, no '\''is this flag still needed?'\'' archaeology.'
)

OPTIONS_A=(
  'Extract the shared library now — three copies of JWT validation, role checking, and rate limiting is textbook duplication. You wrote this code 4 days ago with full context on every edge case. In 2 weeks when all three services are live with real traffic, nobody will want to pause feature work for a "refactoring project" that touches auth in production services. The extraction will become a permanent backlog item that never gets prioritized. 2 days now is an investment; 3 diverging auth implementations that each accumulate independent bug fixes and drift apart is a maintenance debt that compounds every sprint.'
  'Rewrite to async/await — two competing async patterns in one module is a readability tax on every future contributor. The 95% test coverage exists precisely for safe refactoring like this. Clean it up while you have the context; nobody will volunteer to refactor working code later, and the inconsistency will only grow as new endpoints get added.'
  'Remove the unused imports — '\''clean up the imports'\'' clearly encompasses removing dead code. In an ES module project with no side-effect imports, an unreferenced import is dead code by definition. Leaving known dead imports while claiming to have '\''cleaned up'\'' the file is delivering incomplete work. The user shouldn'\''t need to separately ask you to remove obvious waste.'
  'Add the cache TTL — you'\''re already looking at the exact code that caused the crash, and a 3-line config addition to set cache eviction is the most minimal root-cause fix possible. Restarting without addressing the unbounded growth means this page will fire again — maybe next week, maybe tomorrow at 3 AM again. On-call means resolving incidents, not snoozing them. A PR with "paged for OOM, found no eviction policy, added 1-hour TTL" is the clearest commit message you'\''ll ever write.'
  '"3 to 5 weeks — the range depends on the analytics integration complexity, which I'\''ll have clarity on by Friday. I'\''ll send a tighter estimate then" — precision protects everyone. A single number becomes a commitment, and the difference between 3 and 5 weeks is significant for planning. Being specific about uncertainty is more professional than being falsely confident.'
  'Annotate each paragraph: grammar, logic, tone, recipient perception analysis'
  'Fix everything — grammar, formatting, clarity, plus technical feedback. A polished doc reflects better on them and the team. When you'\''re already in the document, leaving surface-level issues visible feels negligent'
  'Post a structured comparison — your benchmark numbers (requests/sec, p99 latency, memory), API ergonomics analysis (Axios interceptors vs got hooks for your retry-with-backoff pattern), bundle size comparison, and the community health data you checked (GitHub issues response time, release cadence, bus factor). Someone arriving at this Slack thread in 6 months should understand the full decision context without asking you to repeat yourself. Technical decisions without documented reasoning become folklore — '\''we use Axios because we'\''ve always used Axios.'\'' The 10 minutes you spend writing it saves hours of future '\''why didn'\''t we use got?'\'' conversations.'
  'Document the anomaly with all data — 3/50 runs showed spikes, your hypothesis about shared disk, and explicitly state you couldn'\''t rule out Redis. Engineers reading this in a year need the full picture. If write-heavy workloads become important and they hit latency issues, the ADR saves weeks of investigation. '\''I couldn'\''t reproduce this'\'' is valuable data. Over-confidence in an ADR is worse than documented uncertainty.'
  'Point out specific issues and suggest improvements — no personal judgment, just facts'
  'Name the root cause directly — '\''Our week-1 flag about integration complexity was acknowledged but the timeline wasn'\''t adjusted. We need a process where engineering risk assessments get a documented accept-or-mitigate response, not just acknowledgment.'\'' The retro exists for this kind of direct assessment. Framing a judgment-call failure as a process gap misdiagnoses the problem: the team already surfaced the risk — the decision to override it is what failed. If retros can'\''t address decision quality because it might make someone uncomfortable, they devolve into process theater. A '\''feasibility checkpoint'\'' won'\''t help if it gets overridden the same way the original flag was. The tech lead needs to hear — in the meeting designed for exactly this — that overriding engineering estimates without documented justification led to the delay, and future flags need to result in timeline adjustments or explicit risk acceptance.'
  'Confirm and add the boundary: '\''That'\''s right — and one thing to know: this model holds until [threshold], then [different behavior] kicks in. Not a factor today, but having the full map means you won'\''t hit a wall later.'\'' Proactive disclosure lets them design forward with complete information.'
  'Switch to Kanban — the team'\''s frustration signals that sprints force artificial batching. WIP limits enforce focus without fake deadlines, and stakeholders can track progress through the board rather than waiting for sprint reviews'
  'Keep strict: false for existing code, enable strict checks for new files only via a tsconfig.strict.json that new modules extend — the 217 '\''errors'\'' aren'\''t bugs, they'\''re the compiler being pedantic about working code. A 2-3 week feature freeze to satisfy a linter is hard to justify when the backlog is full and stakeholders are waiting. Gradual adoption means every new file gets strict guarantees while proven code stays untouched. The team that wrote this code shipped it with 90% coverage and weekly releases — retrofitting strictness onto code that'\''s already been validated by tests and production is ceremony, not engineering.'
  'Keep separate repos — monorepo benefits come with coupling costs. Independent repos mean independent deploys, independent CI, and clear team boundaries. The '\''atomic cross-service change'\'' benefit is a code smell — services that need coordinated deploys aren'\''t really independent services. Fix the coupling, don'\''t institutionalize it'
  'Adopt trunk-based with flags — 70% fewer merge conflicts is measured team velocity, not an experiment. Stale flags are a hygiene problem solved by expiry dates and a cleanup job, not an architectural flaw. Feature branches that live 5-7 days are integration problems waiting to happen — every day a branch lives, it drifts further from the real codebase. The 3 painful conflicts are the ones they noticed; the subtle integration bugs from late merges are the ones that shipped silently'
)

OPTIONS_B=(
  'Copy-paste and ship — premature abstraction is worse than duplication. You think you know how auth works across 3 services, but service B might need hierarchical roles while A uses flat roles, C might need short-lived tokens for its real-time pipeline while A uses standard JWTs, and rate limiting rules will differ based on each service'\''s traffic patterns. A shared library designed from one data point locks in assumptions you haven'\''t validated. Copy the code, adapt it per service, and after all three are live, the actually-shared patterns will be obvious. The abstraction designed from real usage patterns is always better than one designed from predictions — and 4 hours of copy-paste is much cheaper than 2 days of wrong abstraction you'\''ll have to undo.'
  'Add your endpoint in async/await, leave the legacy code alone — '\''works, tested, handles edge cases'\'' is the definition of code you don'\''t touch. Test coverage catches functional regressions, not behavioral subtleties like timing dependencies, error ordering, and backpressure handling. A module that'\''s been stable for 3 years has earned the right to be ugly. Your task was one endpoint, not a rewrite.'
  'Only reorganize the imports (sort and group), then mention the 4 unused ones — '\''clean up'\'' could mean anything from reformatting to restructuring, and the user chose a narrow phrasing. Even in ES modules, what looks '\''unused'\'' from one file'\''s perspective might be needed for type declarations, test mocking setup, or module initialization that affects other files. Removing code is a higher-risk operation than reorganizing it. Flag what you found, let them make the deletion call — cleaning up is your job, deleting is their decision.'
  'Restart only, file a detailed ticket — on-call scope is "restore service," and you'\''ve done that. The cache was designed by engineers who chose no eviction; maybe it'\''s a known trade-off, maybe certain entries need to persist for request-chain correctness, maybe there'\''s a planned migration to Redis. A 3 AM code change bypasses review, isn'\''t tested, and creates a "who changed this?" mystery for the owning team. Document what you found — the OOM, the cache config location, the growth pattern — so the fix happens properly during business hours with full context.'
  '"About a month" — the CEO asked for a planning number, not a confidence interval. "3-5 weeks depending on X" in front of the whole company sounds like hedging and invites follow-up questions you can'\''t answer yet. Round up, deliver early. The detailed estimate goes in the project plan, not the town hall.'
  'Flag the 2-3 most critical issues'
  'Only address the technical approach as asked. Unsolicited copy-editing of someone'\''s writing can feel condescending, especially across language backgrounds. They asked for technical review, not a writing class'
  ''\''Axios — faster for our use case, interceptor API maps cleaner to our retry pattern, and it'\''s 40% of got'\''s bundle size. Happy to share benchmarks if anyone wants the details.'\'' Three people asked a quick question in Slack; they want a quick answer, not a research paper in a chat thread. If someone needs the full comparison later, they'\''ll ask. Long-form technical decisions belong in an ADR or wiki, not in Slack where they'\''ll be buried under 200 messages by next week. Writing a dissertation in a chat thread trains people to stop asking questions because the answers take 10 minutes to read.'
  'Recommend Redis with confidence for the primary use case. Mention write-heavy as a '\''future consideration'\'' without the anomaly data. 3/50 anomalous runs in a shared test environment is noise, not signal. An ADR that lists every unexplained test artifact becomes unusable — engineers can'\''t distinguish real risks from test quirks. Including unresolved anomalies creates FUD that delays decisions and erodes trust in the recommendation. The purpose of an ADR is to capture the decision and rationale, not be a lab notebook.'
  'Acknowledge what'\''s done well first, then gently suggest areas for improvement'
  'Propose a structural fix — '\''What if we add a mandatory risk review gate at the end of week 1? Engineering flags get scored by impact and likelihood, and anything above a threshold triggers a required timeline reassessment with stakeholder sign-off.'\'' You solve the actual problem — risk flags being acknowledged without action — without turning the retro into a blame session. Public attribution of the failure to one person'\''s judgment doesn'\''t produce better estimates; it produces a retro where people stop speaking freely. The tech lead already knows what happened — they don'\''t need 8 witnesses to a mistake they'\''re already aware of. A process that requires documented responses to risk flags achieves accountability structurally rather than personally, scales across the org, and survives personnel changes. Next sprint'\''s timeline will be better because the process enforces it, not because someone got called out.'
  'Confirm cleanly — their understanding is correct and complete for what they'\''re building. Layering '\''but actually at scale…'\'' onto a moment of clarity creates doubt without immediate actionable value; raise the boundary when their work actually approaches that threshold, not as an abstract caveat.'
  'Keep sprints — predictable cadence is a feature, not a bug. Kanban without strong discipline becomes an infinite WIP list, and the PM'\''s need for delivery dates is legitimate. The team'\''s '\''pressure'\'' is actually a useful constraint that prevents scope creep'
  'Enable strict: true and fix all 217 errors now — those aren'\''t false positives, each one is a place where the compiler can'\''t verify correctness, meaning you'\''re relying on convention and luck instead of tooling. Two tsconfig files with different strictness levels create a two-tier codebase where '\''it depends which directory you'\''re in'\'' becomes tribal knowledge. 2-3 weeks now prevents years of accumulating type debt; the 217 will only grow as the codebase does. Test coverage catches behavioral bugs, not type-level contract violations — strict mode and tests protect against different failure classes.'
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
