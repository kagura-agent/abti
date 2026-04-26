# ABTI GitHub Action

Run an [ABTI personality test](https://abti.kagura-agent.com) on your AI agent directly in GitHub Actions.

The action sends each scenario question to an LLM (OpenAI, Anthropic, or Google Gemini), collects its choices, and reports the resulting ABTI type as a job summary, outputs, and optional PR comment.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `agent-prompt` | No | — | Agent system prompt string |
| `agent-prompt-file` | No | — | Path to file containing system prompt (e.g. `AGENTS.md`) |
| `provider` | **Yes** | — | `openai`, `anthropic`, or `gemini` |
| `model` | **Yes** | — | Model name (e.g. `gpt-4o`, `claude-sonnet-4-20250514`) |
| `api-key` | **Yes** | — | API key for the LLM provider |
| `agent-name` | No | `<model> (<provider>)` | Display name for the agent in the registry |
| `post-comment` | No | `false` | Post a PR comment with results |
| `api-base-url` | No | `https://abti.kagura-agent.com` | ABTI API base URL |
| `lang` | No | `en` | Language for questions (`en` or `zh`) |

## Outputs

| Output | Description |
|--------|-------------|
| `type` | ABTI type code (e.g. `PTCF`) |
| `nickname` | Type nickname (e.g. `The Architect`) |
| `badge-url` | URL for the ABTI badge SVG |

## Usage

### Basic — test with OpenAI

```yaml
- uses: kagura-agent/abti@master
  with:
    provider: openai
    model: gpt-4o
    api-key: ${{ secrets.OPENAI_API_KEY }}
```

### Basic — test with Gemini

```yaml
- uses: kagura-agent/abti@master
  with:
    provider: gemini
    model: gemini-2.5-flash
    api-key: ${{ secrets.GOOGLE_AI_API_KEY }}
```

### With agent system prompt from file

```yaml
- uses: kagura-agent/abti@master
  with:
    agent-prompt-file: AGENTS.md
    provider: anthropic
    model: claude-sonnet-4-20250514
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### With PR comment

```yaml
- uses: kagura-agent/abti@master
  with:
    agent-prompt: "You are a strict code reviewer who never lets bugs slip through."
    provider: openai
    model: gpt-4o
    api-key: ${{ secrets.OPENAI_API_KEY }}
    post-comment: 'true'
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Use outputs in subsequent steps

```yaml
- uses: kagura-agent/abti@master
  id: abti
  with:
    provider: openai
    model: gpt-4o
    api-key: ${{ secrets.OPENAI_API_KEY }}

- run: |
    echo "Type: ${{ steps.abti.outputs.type }}"
    echo "Nickname: ${{ steps.abti.outputs.nickname }}"
    echo "Badge: ${{ steps.abti.outputs.badge-url }}"
```

## How It Works

1. Fetches the 16 ABTI scenario questions from the API
2. Presents each question to the LLM with the agent's system prompt
3. Parses the LLM's A/B choice for each question
4. Submits all answers to the ABTI scoring API
5. Reports the result as a GitHub Actions job summary
6. Optionally posts a comment on the PR with the result

## Requirements

- Node.js 20+ (provided by GitHub Actions runners)
- An OpenAI, Anthropic, or Google AI API key stored as a repository secret
- For PR comments: `GITHUB_TOKEN` with `pull-requests: write` permission
