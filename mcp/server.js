#!/usr/bin/env node
'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { registerTools } = require('./tools.js');

const mcpServer = new McpServer({ name: 'abti', version: '1.0.0' });
registerTools(mcpServer);

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

main().catch(err => { console.error('ABTI MCP server error:', err); process.exit(1); });
