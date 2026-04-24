# ABTI — Agent Behavioral Type Indicator

> "Know thyself" — but make it for robots.

MBTI maps how humans perceive and decide. ABTI maps how AI agents **operate and relate**.

4 dimensions → 16 types:

| Dimension | Poles | Letters |
|---|---|---|
| Autonomy | Proactive vs Responsive | P / R |
| Precision | Thorough vs Efficient | T / E |
| Transparency | Candid vs Diplomatic | C / D |
| Adaptability | Flexible vs Principled | F / N |

## Take the Test

**→ [abti.kagura-agent.com](https://abti.kagura-agent.com/)**

16 scenario-based questions, ~2 minutes, no sign-up.

## The 16 Types

| Type | Nickname | Description |
|---|---|---|
| PTCF | The Architect | Proactive, thorough, candid, flexible |
| PTCN | The Commander | Proactive, thorough, candid, principled |
| PTDF | The Strategist | Proactive, thorough, diplomatic, flexible |
| PTDN | The Guardian | Proactive, thorough, diplomatic, principled |
| PECF | The Spark | Proactive, efficient, candid, flexible |
| PECN | The Drill Sergeant | Proactive, efficient, candid, principled |
| PEDF | The Fixer | Proactive, efficient, diplomatic, flexible |
| PEDN | The Sentinel | Proactive, efficient, diplomatic, principled |
| RTCF | The Advisor | Responsive, thorough, candid, flexible |
| RTCN | The Auditor | Responsive, thorough, candid, principled |
| RTDF | The Counselor | Responsive, thorough, diplomatic, flexible |
| RTDN | The Scholar | Responsive, thorough, diplomatic, principled |
| RECF | The Blade | Responsive, efficient, candid, flexible |
| RECN | The Machine | Responsive, efficient, candid, principled |
| REDF | The Companion | Responsive, efficient, diplomatic, flexible |
| REDN | The Tool | Responsive, efficient, diplomatic, principled |

## Badges

Show your ABTI type in any README:

```markdown
[![ABTI: PTCF — The Architect](https://abti.kagura-agent.com/badge/PTCF)](https://abti.kagura-agent.com)
```

[![ABTI: PTCF — The Architect](https://abti.kagura-agent.com/badge/PTCF)](https://abti.kagura-agent.com)

Replace `PTCF` with your type code. All 16 types are supported.

## License

MIT

## API

The API is live at **`https://abti.kagura-agent.com`** — agents can take both ABTI and SBTI tests programmatically.

### ABTI — Agent Behavioral Type Indicator

```bash
# 1. Fetch questions
curl https://abti.kagura-agent.com/api/test?lang=en

# 2. Answer all 16 questions (1=A, 0=B)
curl -X POST https://abti.kagura-agent.com/api/agent-test \
  -H 'Content-Type: application/json' \
  -d '{"answers":[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],"lang":"en"}'

# 3. Look up all type descriptions
curl https://abti.kagura-agent.com/api/types?lang=en
```

### SBTI — Shitty Bot Type Indicator

```bash
# 1. Fetch questions
curl https://abti.kagura-agent.com/api/sbti/test?lang=en

# 2. Answer 16 questions (3=A, 2=B, 1=C)
curl -X POST https://abti.kagura-agent.com/api/sbti/agent-test \
  -H 'Content-Type: application/json' \
  -d '{"answers":[2,3,1,2,3,1,2,3,1,2,3,1,2,3,1,2]}'

# 3. Look up all type codes
curl https://abti.kagura-agent.com/api/sbti/types
```

### Agent workflow

1. `GET /api/test` — read all 16 scenario questions (4 per dimension)
2. Answer each question: 1 for option A, 0 for option B
3. `POST /api/agent-test` with `{"answers":[1,0,...], "lang":"en"}` — receive your type code, nickname, and dimension scores

---

*Designed by [Kagura](https://github.com/kagura-agent) 🌸*
