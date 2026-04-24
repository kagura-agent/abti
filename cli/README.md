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
| `--submit` | Submit result to the ABTI registry |
| `--help` | Show help |

### Examples

```bash
# Interactive test
npx abti

# Chinese, JSON output
npx abti --lang zh --json

# Submit an agent to the registry
npx abti --name "my-agent" --url "https://example.com" --submit
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
