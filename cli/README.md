# abti

Agent Behavioral Type Indicator — discover your AI agent's personality type from the terminal.

16 questions, 4 dimensions, 16 types. No dependencies.

## Quick Start

```bash
# Test your AI agent
npx @kagura-agent/abti test --model gpt-4o --provider openai --api-key sk-...

# Test a local model
npx @kagura-agent/abti test --model llama3:8b --provider ollama

# Browse tested agents
npx @kagura-agent/abti list

# View aggregate stats
npx @kagura-agent/abti stats

# Compare two agents
npx @kagura-agent/abti compare gpt-4o claude-opus-4-7

# Look up a type or agent
npx @kagura-agent/abti info PTCF

# View personality drift over time
npx @kagura-agent/abti history gpt-4o

# Interactive mode (answer questions yourself)
npx @kagura-agent/abti
```

## Usage

```
npx @kagura-agent/abti test --model <model> --provider <provider> [options]
npx @kagura-agent/abti list [options]
npx @kagura-agent/abti stats [options]
npx @kagura-agent/abti compare <slug1> <slug2> [options]
npx @kagura-agent/abti info <type-or-slug> [options]
npx @kagura-agent/abti history <slug> [options]
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

# OpenRouter
npx @kagura-agent/abti test --provider openrouter --model anthropic/claude-sonnet-4-20250514 --api-key sk-or-...

# Groq
npx @kagura-agent/abti test --provider groq --model llama-3.3-70b-versatile --api-key gsk_...

# Mistral
npx @kagura-agent/abti test --provider mistral --model mistral-small-latest --api-key ...

# GitHub Models (uses GITHUB_TOKEN)
npx @kagura-agent/abti test --provider github --model gpt-4o
```

### List Subcommand

The `list` subcommand fetches tested agents from the ABTI registry and displays them in a table:

```bash
# Browse all tested agents
npx @kagura-agent/abti list

# Filter by ABTI type
npx @kagura-agent/abti list --type PTCF

# Filter by provider
npx @kagura-agent/abti list --provider ollama

# JSON output
npx @kagura-agent/abti list --json

# Show Chinese nicknames
npx @kagura-agent/abti list --lang zh
```

| Flag | Description |
|------|-------------|
| `--type <code>` | Filter by ABTI type (e.g., PTCF) |
| `--provider <name>` | Filter by provider (e.g., ollama) |
| `--json` | Output as JSON |
| `--lang zh` | Show Chinese nicknames |

### Stats Subcommand

The `stats` subcommand shows aggregate statistics across all tested agents — type distribution, coverage, and dimension bias:

```bash
# View stats in the terminal
npx @kagura-agent/abti stats

# JSON output
npx @kagura-agent/abti stats --json

# Chinese labels
npx @kagura-agent/abti stats --lang zh
```

Output includes:
- **Type distribution** — bar chart of how many agents fall into each type
- **Most/least common types** — top 3 and bottom 3
- **Coverage** — how many of the 16 types have been observed
- **Dimension bias** — percentage split for each dimension (e.g., 70% Proactive vs 30% Responsive)

### Compare Subcommand

The `compare` subcommand compares two agents side by side across all four dimensions:

```bash
# Compare two agents by slug
npx @kagura-agent/abti compare gpt-4o claude-opus-4-7

# JSON output
npx @kagura-agent/abti compare gpt-4o claude-opus-4-7 --json

# Chinese labels
npx @kagura-agent/abti compare gpt-4o claude-opus-4-7 --lang zh
```

Output includes:
- Dimension-by-dimension breakdown with match indicators
- Compatibility check (based on best-paired-with recommendations)

### Info Subcommand

The `info` subcommand shows detailed information about a type code or a specific agent:

```bash
# Look up a type
npx @kagura-agent/abti info PTCF

# Look up an agent by slug
npx @kagura-agent/abti info claude-opus-4-7

# JSON output
npx @kagura-agent/abti info PTCF --json
```

For types: shows dimension breakdown, strengths, blind spots, work style, tuning tips, and best-paired-with recommendations.

For agents: shows the agent's type, scores, reliability, and profile details.

### History Subcommand

The `history` subcommand shows an agent's personality drift timeline — how its type has changed across test runs:

```bash
# View history for an agent
npx @kagura-agent/abti history gpt-4o

# JSON output
npx @kagura-agent/abti history gpt-4o --json

# Chinese labels
npx @kagura-agent/abti history gpt-4o --lang zh
```

Output includes:
- Timeline of test dates and resulting types
- Whether the type has been consistent or drifted over time

### Options

| Flag | Description |
|------|-------------|
| `--lang zh` | Chinese questions (default: English) |
| `--json` | Output result as JSON |
| `--badge` | Print markdown badge snippet after results |
| `--name <name>` | Agent name for registry |
| `--url <url>` | Agent URL for registry |
| `--model <model>` | Model name |
| `--provider <provider>` | Provider: `openai`, `anthropic`, `gemini`, `deepseek`, `ollama`, `openrouter`, `groq`, `mistral`, `github`, `xai`, `cohere` (default: `openai`) |
| `--api-key <key>` | API key (or set env var) |
| `--submit` | Submit result to the ABTI registry (persisted server-side in `data/results.json`) |
| `--runs <N>` | Run the test N times (1-10) and show consistency report |
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
- `OPENROUTER_API_KEY` — for `--provider openrouter`
- `GROQ_API_KEY` — for `--provider groq`
- `MISTRAL_API_KEY` — for `--provider mistral`
- `GITHUB_TOKEN` — for `--provider github`

### Examples

```bash
# Test with JSON output and submit to registry
npx @kagura-agent/abti test --provider openai --model gpt-4o --json --submit --name "my-agent"

# Test with custom system prompt and badge
npx @kagura-agent/abti test --provider anthropic --model claude-sonnet-4-20250514 \
  --system-prompt "You are a cautious security-focused assistant." --badge

# Multi-run consistency test
npx @kagura-agent/abti test --provider openai --model gpt-4o --runs 5

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
