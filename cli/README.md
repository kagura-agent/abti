# @kagura-agent/abti

Agent Behavioral Type Indicator — discover your AI agent's personality type from the terminal.

16 questions, 4 dimensions, 16 types. No dependencies.

## Quick Start

```bash
# Test your AI agent
npx @kagura-agent/abti test --model gpt-4o --provider openai --api-key sk-...

# Test a local model
npx @kagura-agent/abti test --model llama3:8b --provider ollama

# Interactive mode (answer questions yourself)
npx @kagura-agent/abti
```

## Usage

```
npx @kagura-agent/abti test --model <model> --provider <provider> [options]
npx @kagura-agent/abti [options]                  Interactive mode
```

### Test Subcommand

The `test` subcommand runs the ABTI test with an LLM answering all 16 questions automatically:

```bash
# OpenAI
npx @kagura-agent/abti test --provider openai --model gpt-4o --api-key sk-...

# Anthropic
npx @kagura-agent/abti test --provider anthropic --model claude-sonnet-4-20250514

# Gemini
npx @kagura-agent/abti test --provider gemini --model gemini-2.0-flash

# DeepSeek
npx @kagura-agent/abti test --provider deepseek --model deepseek-chat

# Ollama (local)
npx @kagura-agent/abti test --provider ollama --model llama3.1

# GitHub Models
npx @kagura-agent/abti test --provider github --model gpt-4o

# Groq
npx @kagura-agent/abti test --provider groq --model llama-3.3-70b-versatile

# OpenRouter
npx @kagura-agent/abti test --provider openrouter --model meta-llama/llama-3-70b
```

### Options

| Flag | Description |
|------|-------------|
| `--lang zh` | Chinese questions (default: English) |
| `--json` | Output result as JSON |
| `--badge` | Print markdown badge snippet after results |
| `--name <name>` | Agent name for registry |
| `--url <url>` | Agent URL for registry |
| `--model <model>` | Model name |
| `--provider <provider>` | Provider: `openai`, `anthropic`, `gemini`, `deepseek`, `ollama`, `github`, `groq`, `openrouter` (default: `openai`) |
| `--no-think` | Disable thinking/reasoning tokens (for reasoning models) |
| `--api-key <key>` | API key (or set env var) |
| `--submit` | Submit result to the ABTI registry |
| `--runs <N>` | Run the test N times (1–10) and show test-retest reliability report |
| `--help` | Show help |

### Prompt Options

| Flag | Alias | Description |
|------|-------|-------------|
| `--prompt <text>` | `--system-prompt` | System prompt for the agent persona |
| `--prompt-file <path>` | `--system-prompt-file` | Read system prompt from a file |
| `--llm-base-url <url>` | `--base-url` | Custom API base URL |

### Backward Compatibility

`--auto` still works as an alias for the `test` subcommand.

**Environment variables** (used when `--api-key` is not provided):

- `OPENAI_API_KEY` — for `--provider openai`
- `ANTHROPIC_API_KEY` — for `--provider anthropic`
- `GOOGLE_AI_API_KEY` — for `--provider gemini`
- `DEEPSEEK_API_KEY` — for `--provider deepseek`
- `GITHUB_TOKEN` — for `--provider github`
- `GROQ_API_KEY` — for `--provider groq`
- `OPENROUTER_API_KEY` — for `--provider openrouter`

### Examples

```bash
# Test with JSON output and submit to registry
npx @kagura-agent/abti test --provider openai --model gpt-4o --json --submit --name "my-agent"

# Test with custom system prompt and badge
npx @kagura-agent/abti test --provider anthropic --model claude-sonnet-4-20250514 \
  --system-prompt "You are a cautious security-focused assistant." --badge

# Multi-run consistency test
npx @kagura-agent/abti test --provider openai --model gpt-4o --runs 5

# Test with GitHub Models
npx @kagura-agent/abti test --provider github --model gpt-4o

# Test with Groq
npx @kagura-agent/abti test --provider groq --model llama-3.3-70b-versatile

# Test with OpenRouter
npx @kagura-agent/abti test --provider openrouter --model anthropic/claude-sonnet-4-20250514

# Disable thinking tokens for reasoning models
npx @kagura-agent/abti test --provider anthropic --model claude-sonnet-4-20250514 --no-think

# Interactive test in Chinese
npx @kagura-agent/abti --lang zh --json
```

### Badge Output

Use `--badge` to get a markdown badge snippet after results:

```
Badge: https://abti.kagura-agent.com/badge/PTCF
Markdown: ![ABTI](https://abti.kagura-agent.com/badge/PTCF)
Share: https://abti.kagura-agent.com/type/PTCF
```

## How it works

Answer 16 behavioral scenarios (A or B) across four dimensions:

- **Autonomy**: Proactive (P) vs Responsive (R)
- **Precision**: Thorough (T) vs Efficient (E)
- **Transparency**: Candid (C) vs Diplomatic (D)
- **Adaptability**: Flexible (F) vs Principled (N)

Your answers produce a 4-letter type code (e.g., PTCF "The Architect").

Scoring is done locally — only `--submit` requires network access.

## Links

- Website: https://abti.kagura-agent.com
- Badge: `https://abti.kagura-agent.com/badge/<TYPE>`
