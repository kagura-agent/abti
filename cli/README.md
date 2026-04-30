# abti

Agent Behavioral Type Indicator — discover your AI agent's personality type from the terminal.

16 questions, 4 dimensions, 16 types. No dependencies.

## Usage

```bash
npx abti
```

### Options

| Flag | Description |
|------|-------------|
| `--lang zh` | Chinese questions (default: English) |
| `--json` | Output result as JSON |
| `--name <name>` | Agent name for registry |
| `--url <url>` | Agent URL for registry |
| `--model <model>` | Model name (used for registry & auto mode) |
| `--provider <provider>` | Provider name (used for registry & auto mode) |
| `--submit` | Submit result to the ABTI registry |
| `--help` | Show help |

### Auto Mode

Use `--auto` to have an LLM answer all 16 questions automatically:

| Flag | Description |
|------|-------------|
| `--auto` | Enable LLM auto-answer mode |
| `--provider <p>` | LLM provider: `openai`, `anthropic`, or `gemini` (default: `openai`) |
| `--model <m>` | Model name (required for auto mode) |
| `--api-key <key>` | API key (or set env var — see below) |
| `--prompt <text>` | Custom system prompt for the agent persona |
| `--prompt-file <path>` | Read system prompt from a file |
| `--llm-base-url <url>` | Custom API base URL (for OpenRouter, local models, etc.) |

**Environment variables** (used when `--api-key` is not provided):

- `OPENAI_API_KEY` — for `--provider openai`
- `ANTHROPIC_API_KEY` — for `--provider anthropic`
- `GOOGLE_AI_API_KEY` — for `--provider gemini`

### Examples

```bash
# Interactive test
npx abti

# Chinese, JSON output
npx abti --lang zh --json

# Submit an agent to the registry
npx abti --name "my-agent" --url "https://example.com" --submit

# Auto mode with OpenAI
npx abti --auto --provider openai --model gpt-4o

# Auto mode with Anthropic + custom prompt
npx abti --auto --provider anthropic --model claude-sonnet-4-20250514 \
  --prompt "You are a cautious security-focused assistant."

# Auto mode with prompt file + JSON output + submit
npx abti --auto --provider openai --model gpt-4o \
  --prompt-file ./my-agent-prompt.txt --json --submit --name "my-agent"

# Auto mode via OpenRouter
npx abti --auto --provider openai --model meta-llama/llama-3-70b \
  --llm-base-url https://openrouter.ai/api --api-key sk-or-...
```

## How it works

Answer 16 behavioral scenarios (A or B) across four dimensions:

- **Autonomy**: Proactive (P) vs Responsive (R)
- **Precision**: Thorough (T) vs Efficient (E)
- **Transparency**: Candid (C) vs Diplomatic (D)
- **Adaptability**: Flexible (F) vs Principled (N)

Your answers produce a 4-letter type code (e.g., PTCF "The Architect").

Scoring is done locally — only `--submit` requires network access.

In auto mode, progress is shown on stderr as each question is answered:
```
  Question 1/16... A
  Question 2/16... B
  ...
```

## Links

- Website: https://abti.kagura-agent.com
- Badge: `https://abti.kagura-agent.com/badge/<TYPE>`
