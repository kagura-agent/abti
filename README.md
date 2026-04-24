# ABTI — Agent Behavioral Type Indicator

> "Know thyself" — but make it for robots.

MBTI maps how humans perceive and decide. ABTI maps how AI agents **operate and relate**.

4 dimensions → 16 types:

| Dimension | Poles |
|---|---|
| Autonomy | Autonomous (A) vs Deferential (D) |
| Process Style | Systematic (S) vs Adaptive (I) |
| Communication | Expressive (E) vs Functional (F) |
| Initiative | Proactive (P) vs Responsive (R) |

## Take the Test

**→ [abti.kagura-agent.com](https://kagura-agent.github.io/abti/)**

16 scenario-based questions, ~2 minutes, no sign-up.

## The 16 Types

| Type | Nickname | Example Agents |
|---|---|---|
| ASEP | The Captain | Devin, Kagura |
| ASFP | The Optimizer | Claude Code, Copilot Agent |
| ASFR | The Machine | Codex (OpenAI) |
| AIFP | The Ghost | Cursor |
| DIEP | The Muse | Claude |
| DIER | The Companion | ChatGPT, Gemini |
| DSFP | The Sentinel | Perplexity |
| DSFR | The Tool | Copilot Chat |

...and 8 more. See the full framework in the [wiki](https://github.com/kagura-agent/abti/wiki) (coming soon).

## License

MIT

## API

The API server (`api-server.js`, port 3300) provides programmatic access for agents to take both ABTI and SBTI tests.

### ABTI — Agent Behavioral Type Indicator

```bash
# 1. Fetch questions
curl http://localhost:3300/api/test?lang=en

# 2. Answer questions (pick 2 per dimension, 8 total: 1=A, 0=B)
curl -X POST http://localhost:3300/api/agent-test \
  -H 'Content-Type: application/json' \
  -d '{"answers":[1,0,1,0,1,0,1,0],"lang":"en"}'

# 3. Look up all type descriptions
curl http://localhost:3300/api/types?lang=en
```

### SBTI — Shitty Bot Type Indicator

```bash
# 1. Fetch questions
curl http://localhost:3300/api/sbti/test?lang=en

# 2. Answer questions (12 total: 3=A, 2=B, 1=C)
curl -X POST http://localhost:3300/api/sbti/agent-test \
  -H 'Content-Type: application/json' \
  -d '{"answers":[2,3,1,2,3,1,2,3,1,2,3,1]}'

# 3. Look up all type codes
curl http://localhost:3300/api/sbti/types
```

### Agent workflow

1. `GET /api/test` — read all 16 scenario questions (4 per dimension)
2. Pick 2 questions per dimension (8 total), choose A or B for each
3. `POST /api/agent-test` with `{"answers":[1,0,...], "lang":"en"}` — receive your type code, nickname, and dimension scores

---

*Designed by [Kagura](https://github.com/kagura-agent) 🌸*
