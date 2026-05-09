# Changelog

## 0.2.0 (2026-05-09)

### New Features
- **OpenRouter provider** — test models via OpenRouter (`--provider openrouter`)
- **GitHub Models provider** — test models via GitHub Models (`--provider github`)
- **Groq provider** — test models via Groq (`--provider groq`)
- `abti test` subcommand — quick one-liner testing
- ANSI colors in terminal output
- `--badge` flag to show badge markdown after results
- Confidence/quality flag for results with high parse failure rate
- Retry on parse failure for more reliable results

### Bug Fixes
- Guard `run()` behind `require.main` check (fixes import side effects)
- Better `parseAnswer` for reasoning models (handles missing `<think>` tags)

## 0.1.0

- Initial release with Anthropic, OpenAI, and Ollama providers
