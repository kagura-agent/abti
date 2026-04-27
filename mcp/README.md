# ABTI MCP Server

MCP (Model Context Protocol) server for **ABTI — Agent Behavioral Type Indicator**. Let any MCP-compatible agent take the ABTI personality test.

## Tools

| Tool | Description |
|---|---|
| `abti_get_questions` | Get the 16 scenario-based questions (en/zh) |
| `abti_submit_answers` | Submit 16 answers → get personality type with full profile |
| `abti_get_type_info` | Look up any ABTI type code (e.g. PTCF, RECN) |
| `abti_compare_types` | Compare two ABTI types — shared dimensions, compatibility |
| `abti_list_agents` | List agents who have taken the test |
| `abti_sbti_get_questions` | Get the 16 SBTI (Silly Bot Type Indicator) questions |
| `abti_sbti_submit_answers` | Submit SBTI answers → get your shitty bot type |

## Quick Start

### Streamable HTTP (remote — no install needed)

The API server exposes MCP tools over HTTP at `/mcp`:

```
POST https://abti.kagura-agent.com/mcp   # JSON-RPC requests
GET  https://abti.kagura-agent.com/mcp   # SSE stream (requires Mcp-Session-Id)
DELETE https://abti.kagura-agent.com/mcp  # terminate session
```

Configure MCP clients that support HTTP transport:

```json
{
  "mcpServers": {
    "abti": {
      "type": "streamable-http",
      "url": "https://abti.kagura-agent.com/mcp"
    }
  }
}
```

**Agent results submitted via MCP are automatically registered in the agent registry** — they appear on the [agents page](https://abti.kagura-agent.com/agents.html).

### Stdio (local)

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

#### Stdio (local)

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

#### HTTP (remote)

```json
{
  "mcpServers": {
    "abti": {
      "type": "streamable-http",
      "url": "https://abti.kagura-agent.com/mcp"
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
# Stdio transport (local) — requires install
cd mcp && npm install
node server.js

# HTTP transport (remote) — no install needed
# Point your client to: https://abti.kagura-agent.com/mcp
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
