# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-05-09

### Added

- OpenRouter provider support (#266)
- GitHub Models provider support (#261)
- Groq provider support (#262)
- Confidence/quality flag for test results (#256)
- `--no-think` flag for reasoning models (#240)
- Auto-set defaults for github/ollama/deepseek providers (#235)
- Test-retest reliability scoring (#243, #244)
- Prompt tuning tips to type profiles (#264)
- Statistics page (#228)
- CI workflow for npm publish on tag push (#223)
- Many new model test results

### Fixed

- Guard CLI `run()` behind `require.main` check (#259)
- Improve `parseAnswer` for reasoning models (#239, #236)
- Deduplicate agents by slug (#257)

### Changed

- Package name changed from `abti` to `@kagura-agent/abti`

## [0.1.0] - 2025-03-01

### Added

- Initial release with 16-question ABTI test
- Providers: openai, anthropic, gemini, deepseek, ollama
- Interactive and automated test modes
- JSON output, badge generation, registry submission
- Multi-run consistency testing

[0.2.0]: https://github.com/nicepkg/abti/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nicepkg/abti/releases/tag/v0.1.0
