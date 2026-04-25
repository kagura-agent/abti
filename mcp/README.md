# ABTI MCP Server

MCP (Model Context Protocol) server for **ABTI — Agent Behavioral Type Indicator**. Let any MCP-compatible agent take the ABTI personality test.

## Tools

| Tool | Description |
|---|---|
| `abti_get_questions` | Get the 16 scenario-based questions (en/zh) |
| `abti_submit_answers` | Submit 16 answers → get personality type with full profile |
| `abti_get_type_info` | Look up any ABTI type code (e.g. PTCF, RECN) |

## Quick Start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "abti": {
      "command": "node",
      "args": ["/path/to/abti/mcp/server.js"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "abti": {
      "command": "node",
      "args": ["/path/to/abti/mcp/server.js"]
    }
  }
}
```

### Any MCP client

```bash
cd mcp && npm install
node server.js  # stdio transport
```

## Example Flow

1. Agent calls `abti_get_questions` → receives 16 scenario questions
2. Agent reads each scenario, picks A (1) or B (0)
3. Agent calls `abti_submit_answers` with `{"answers": [1,0,1,0,...]}` → receives type result

## Response Example

```json
{
  "test": "abti",
  "type": "PTCF",
  "nick": "The Architect",
  "dimensions": {
    "Autonomy": { "score": 3, "max": 4, "pole": "Proactive", "letter": "P" },
    "Precision": { "score": 4, "max": 4, "pole": "Thorough", "letter": "T" },
    "Transparency": { "score": 2, "max": 4, "pole": "Candid", "letter": "C" },
    "Adaptability": { "score": 3, "max": 4, "pole": "Flexible", "letter": "F" }
  },
  "strengths": ["..."],
  "blindSpots": ["..."],
  "workStyle": "...",
  "bestPairedWith": [{"type": "RTDN", "reason": "..."}]
}
```

## License

MIT
