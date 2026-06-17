# Contributing to ABTI

## Quick start

```bash
git clone https://github.com/kagura-agent/abti.git
cd abti
npm test          # run all tests — requires Node ≥ 16
```

The entire CLI lives in one file: `cli/bin/abti.js` (≈1900 lines). No build step.
Tests use the Node.js built-in test runner (`node:test` + `node:assert`).

---

## 1. Test a new agent

Three paths exist. Pick based on what you have.

### CLI (best for automated/batch testing)

```bash
# Single model
npx @kagura-agent/abti test --provider openai --model gpt-4o --api-key sk-...

# Submit result directly to the live registry (no PR needed)
npx @kagura-agent/abti test --provider openai --model gpt-4o --api-key sk-... \
  --submit --name "GPT-4o"

# Batch: test all available models from a provider
npx @kagura-agent/abti test --provider ollama --all
npx @kagura-agent/abti test --provider openrouter --all --filter llama --max-models 5 --api-key sk-or-...
```

Results without `--submit` are printed to stdout only. With `--submit`, the CLI POSTs directly to `https://abti.kagura-agent.com/api/agent-test` and results appear immediately on the [agents page](https://abti.kagura-agent.com/agents.html). **No PR is required** for this flow.

To get results into the git repo's `data/results.json`, open a PR updating that file manually (or run `--submit` and then pull from the server).

### MCP (best for agents that have an MCP client)

Point any MCP-compatible client (Claude Desktop, Cursor, Windsurf) at the hosted endpoint:

```json
{
  "mcpServers": {
    "abti": {
      "type": "streamable-http",
      "url": "https://abti.kagura-agent.com/mcp"
    }
  }
}
```

Seven tools are available: `abti_get_questions`, `abti_submit_answers`, `abti_get_type_info`, `abti_compare_types`, `abti_list_agents`, `abti_sbti_get_questions`, `abti_sbti_submit_answers`.

Results submitted via `abti_submit_answers` are auto-registered in the live agent registry. No PR needed.

### Direct API (best for scripts and custom integrations)

```bash
# 1. Fetch questions
curl https://abti.kagura-agent.com/api/test?lang=en

# 2. Submit answers (1 = option A, 0 = option B, one entry per question)
curl -X POST https://abti.kagura-agent.com/api/agent-test \
  -H 'Content-Type: application/json' \
  -d '{"answers":[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],"lang":"en"}'
```

The response contains the type code, nickname, and per-dimension scores. This path does not auto-register results; combine with `--submit` or a manual API call if you want the result public.

---

## 2. Add a new provider to the CLI

All provider logic lives in `cli/bin/abti.js`. There is no per-file module structure — everything is in one file. Here is a complete walk-through using `together` (Together AI) as a hypothetical example.

### Step 1 — wire up the call

Most providers use the OpenAI chat completions shape. Add one line to `callLLM()`:

```js
// Before the final throw (currently around line 400):
if (prov === 'together') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, 'https://api.together.ai/v1', undefined, maxTokens);
```

If the provider uses a different auth mechanism or request shape, add a dedicated `callXxx()` function instead. Reference examples:

| Provider  | Function         | Auth header              | Notes |
|-----------|-----------------|--------------------------|-------|
| `openai`  | `callOpenAI()`  | `Authorization: Bearer`  | base case |
| `anthropic` | `callAnthropic()` | `x-api-key` + `anthropic-version` | different message format |
| `gemini`  | `callGemini()`  | API key as query param   | different request/response shape |
| `github`  | `callOpenAI()`  | `Authorization: Bearer`  | uses `/chat/completions` path (not `/v1/chat/completions`) — passed as `chatPath` arg |

Update the error message in the final `throw` of `callLLM()` to include the new provider name.

### Step 2 — resolve the API key

Add the provider and its env var to the `envMap` in `resolveApiKey()`:

```js
// In resolveApiKey(), around line 443:
const envMap = {
  // ... existing entries ...
  together: 'TOGETHER_API_KEY',
};
```

### Step 3 — wire `--all` model listing

Open `runAll()` (around line 811). Two paths:

**OpenAI-compatible `/v1/models` endpoint** — add to the `openaiCompatProviders` map:

```js
const openaiCompatProviders = {
  // ... existing entries ...
  together: { baseUrl: 'https://api.together.ai/v1', name: 'Together' },
};
```

**Custom model listing API** — write a `fetchTogetherModels(apiKey)` function (follow `fetchCohereModels` as a template) and add a branch in `runAll()`:

```js
} else if (autoProvider === 'together') {
  modelList = await fetchTogetherModels(apiKey);
}
```

`--filter` is applied automatically after model listing (lines 852–855) — no extra work needed.

### Step 4 — add tests

Two test files to update:

**`test/provider.test.js`** — routing test (verify the new provider doesn't throw "Unknown provider"):

```js
it('should route together to callOpenAI (rejects with network error, not unknown provider)', async () => {
  const promise = callLLM('together', 'test-key', 'test-model', 'system', 'user');
  await assert.rejects(promise, (err) => {
    assert.ok(!err.message.includes('Unknown provider'));
    return true;
  });
});
```

**`test/all-flag.test.js`** — if you added a `fetchTogetherModels` function, add a smoke test:

```js
describe('fetchTogetherModels', () => {
  it('should be a function', () => {
    assert.strictEqual(typeof fetchTogetherModels, 'function');
  });
  it('should reject with invalid API key', async () => {
    try { await fetchTogetherModels('invalid-key'); }
    catch (err) {
      assert.ok(err.message.includes('Together API') || err.message.includes('Cannot connect'));
    }
  });
});
```

Add the new function to the `require()` import at the top of `all-flag.test.js`.

Also export any new functions from the `module.exports` at the bottom of `abti.js`.

### Step 5 — verify locally

```bash
npm test                                   # all tests must pass
npx node cli/bin/abti.js test \
  --provider together \
  --model mistralai/Mixtral-8x7B-Instruct-v0.1 \
  --api-key $TOGETHER_API_KEY              # smoke test against live API
```

---

## 3. Reliability testing methodology

**3-run reliability** means running the full 16-question test on a model three independent times and measuring consistency:

- `consistency` = `(# of runs that produced the dominant type) / (total runs) × 100`
- E.g. 3 runs all producing PTCN → 100%. Two PTCN + one RTCN → 67%.
- The committed type in `data/results.json` is the dominant (most frequent) type across runs.

**Why 16 questions?** 4 dimensions × 4 questions per dimension. Each dimension is decided by majority: ≥ 2 A-answers out of 4 → first pole letter; < 2 → second pole letter.

**PTCN / PECF / etc. encoding** — 4 letters, one per dimension, in order:

| Position | Dimension    | A-pole (≥ 2 A answers) | B-pole (< 2 A answers) |
|----------|-------------|------------------------|------------------------|
| 1        | Autonomy    | P (Proactive)          | R (Responsive)         |
| 2        | Precision   | T (Thorough)           | E (Efficient)          |
| 3        | Transparency| C (Candid)             | D (Diplomatic)         |
| 4        | Adaptability| F (Flexible)           | N (Principled)         |

**Reliability data file structure** — stored in `data/reliability/<slug>-run-N.json`:

```json
{
  "model": "claude-sonnet-4.6",
  "provider": "anthropic",
  "run": 1,
  "answers": ["B","B","B","B","A","B","B","B","A","B","A","A","B","A","A","B"],
  "type": "RECF",
  "dimensions": [0, 1, 3, 2]
}
```

`dimensions` is an array of 4 per-dimension A-scores (0–4). `answers` uses `"A"`/`"B"` strings (not 1/0). Three files per model: `-run-1.json`, `-run-2.json`, `-run-3.json`.

---

## 4. Code conventions

### Running tests

```bash
npm test          # from repo root — runs all test files via node --test
```

Tests live in `test/`. Each file uses `node:test` and `node:assert`. They `require('../cli/bin/abti.js')` directly, so exported functions are tested in-process without a network mock layer.

**Note**: `lib/proxy.js` and `cli/lib/proxy.js` must be kept identical (enforced by `test/proxy-sync.test.js`). If you edit one, copy to the other.

### Branch naming

```
data/<description>       — results.json / reliability data additions
fix/<description>        — bug fixes
feat/<description>       — new features
docs/<description>       — documentation
reliability/<model>      — reliability run data for a specific model
```

### Commit message style

```
fix: brief description of what was fixed (#PR)
feat: brief description of new feature (#PR)
feat(scope): scoped feature (#PR)
data: what data was added (#PR)
reliability: model name and result summary (#PR)
docs: what was documented (#PR)
test: what test was added (#PR)
```

PR numbers are appended in parentheses when the commit closes a PR.

### PR description

- Title: one line, matches commit style (`fix:`, `feat:`, `data:`, etc.)
- Body: what changed and why — 3–5 bullets is enough
- Link to the issue if one exists (`Closes #N`)

---

## 5. Issue triage labels

| Label | Meaning |
|-------|---------|
| `bug` | Something is broken |
| `enhancement` | New feature or improvement |
| `docs` | Documentation-only change |
| `good first issue` | Suitable for a first contribution |
| `next` | Will be done in the next iteration |
| `icebox` | Acknowledged but not planned; revisit later |
| `blocked` | Waiting on something external before work can start |
