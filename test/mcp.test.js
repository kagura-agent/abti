const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// We need to require from the mcp directory's node_modules
const mcpModules = path.join(__dirname, '..', 'mcp', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs');
const { Client } = require(path.join(mcpModules, 'client', 'index.js'));
const { InMemoryTransport } = require(path.join(mcpModules, 'inMemory.js'));

// The MCP server modifies module-level state, so we spawn it fresh
// But since server.js calls main() which connects transport, we need a different approach:
// Re-create the server logic by requiring the file's McpServer before it connects.
// Actually, server.js calls main() at the bottom — we need to intercept.

// Approach: fork the server as a child process and use StdioClientTransport
// Actually simpler: extract McpServer from server.js by mocking the transport connect.
// Simplest: just use child_process spawn with StdioClientTransport.

const { spawn } = require('node:child_process');
const { StdioClientTransport } = require(path.join(mcpModules, 'client', 'stdio.js'));

let client;
let transport;

before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, '..', 'mcp', 'server.js')],
    cwd: path.join(__dirname, '..'),
  });
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client.close();
});

// Helper to call a tool
async function callTool(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0]?.text;
  return { ...result, parsed: text ? JSON.parse(text) : null };
}

// ─── abti_get_questions ───

describe('abti_get_questions', () => {
  it('returns 16 questions in English by default', async () => {
    const { parsed } = await callTool('abti_get_questions', {});
    assert.equal(parsed.test, 'abti');
    assert.equal(parsed.questions.length, 16);
    assert.equal(parsed.dimensions.length, 4);
    assert.ok(parsed.questions[0].A);
    assert.ok(parsed.questions[0].B);
    assert.ok(parsed.questions[0].text);
  });

  it('returns Chinese questions when lang=zh', async () => {
    const { parsed } = await callTool('abti_get_questions', { lang: 'zh' });
    assert.equal(parsed.questions.length, 16);
    // Chinese questions should contain Chinese characters
    assert.ok(/[\u4e00-\u9fff]/.test(parsed.questions[0].text));
  });
});

// ─── abti_submit_answers ───

describe('abti_submit_answers', () => {
  it('returns a valid type for all-A answers', async () => {
    const answers = Array(16).fill(1);
    const { parsed } = await callTool('abti_submit_answers', { answers });
    assert.equal(parsed.test, 'abti');
    assert.equal(parsed.type.length, 4);
    assert.ok(parsed.nick);
    assert.ok(parsed.strengths);
    assert.ok(parsed.blindSpots);
    assert.ok(parsed.workStyle);
    assert.ok(parsed.dimensions);
  });

  it('returns a valid type for all-B answers', async () => {
    const answers = Array(16).fill(0);
    const { parsed } = await callTool('abti_submit_answers', { answers });
    assert.equal(parsed.type.length, 4);
    assert.ok(parsed.nick);
  });

  it('includes agent metadata when provided', async () => {
    const answers = Array(16).fill(1);
    const { parsed } = await callTool('abti_submit_answers', {
      answers,
      agentName: 'TestBot',
      model: 'test-model',
      provider: 'test',
    });
    assert.equal(parsed.agentName, 'TestBot');
    assert.equal(parsed.model, 'test-model');
    assert.equal(parsed.provider, 'test');
  });

  it('returns Chinese results when lang=zh', async () => {
    const answers = Array(16).fill(1);
    const { parsed } = await callTool('abti_submit_answers', { answers, lang: 'zh' });
    assert.equal(parsed.type.length, 4);
    // Dimensions should have Chinese keys
    const dimKeys = Object.keys(parsed.dimensions);
    assert.ok(dimKeys.some(k => /[\u4e00-\u9fff]/.test(k)));
  });
});

// ─── abti_get_type_info ───

describe('abti_get_type_info', () => {
  it('returns profile for a valid type', async () => {
    const { parsed } = await callTool('abti_get_type_info', { type: 'PTCF' });
    assert.equal(parsed.type, 'PTCF');
    assert.ok(parsed.nick);
    assert.ok(parsed.strengths);
    assert.ok(parsed.blindSpots);
  });

  it('handles lowercase type codes', async () => {
    const { parsed } = await callTool('abti_get_type_info', { type: 'ptcf' });
    assert.equal(parsed.type, 'PTCF');
  });

  it('returns error for invalid type code', async () => {
    const result = await client.callTool({ name: 'abti_get_type_info', arguments: { type: 'XXXX' } });
    assert.equal(result.isError, true);
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.error);
    assert.ok(parsed.validTypes);
  });

  it('returns Chinese profile when lang=zh', async () => {
    const { parsed } = await callTool('abti_get_type_info', { type: 'PTCF', lang: 'zh' });
    assert.equal(parsed.type, 'PTCF');
    assert.ok(parsed.nick);
  });
});

// ─── abti_compare_types ───

describe('abti_compare_types', () => {
  it('compares two valid types', async () => {
    const { parsed } = await callTool('abti_compare_types', { type1: 'PTCF', type2: 'REDN' });
    assert.ok(parsed.type1);
    assert.ok(parsed.type2);
    assert.equal(parsed.type1.code, 'PTCF');
    assert.equal(parsed.type2.code, 'REDN');
    assert.equal(parsed.dimensions.length, 4);
    assert.ok(typeof parsed.sharedDimensions === 'number');
    assert.ok(parsed.compatibility);
  });

  it('comparing same type yields 4 shared dimensions', async () => {
    const { parsed } = await callTool('abti_compare_types', { type1: 'PTCF', type2: 'PTCF' });
    assert.equal(parsed.sharedDimensions, 4);
  });

  it('comparing opposite types yields 0 shared dimensions', async () => {
    const { parsed } = await callTool('abti_compare_types', { type1: 'PTCF', type2: 'REDN' });
    assert.equal(parsed.sharedDimensions, 0);
  });

  it('returns error for invalid type', async () => {
    const result = await client.callTool({ name: 'abti_compare_types', arguments: { type1: 'XXXX', type2: 'PTCF' } });
    assert.equal(result.isError, true);
  });
});

// ─── abti_list_agents ───

describe('abti_list_agents', () => {
  it('returns agent list with total count', async () => {
    const { parsed } = await callTool('abti_list_agents', {});
    assert.ok(typeof parsed.total === 'number');
    assert.ok(Array.isArray(parsed.agents));
  });
});

// ─── abti_sbti_get_questions ───

describe('abti_sbti_get_questions', () => {
  it('returns 16 SBTI questions', async () => {
    const { parsed } = await callTool('abti_sbti_get_questions', {});
    assert.equal(parsed.test, 'sbti');
    assert.equal(parsed.questions.length, 16);
    assert.ok(parsed.questions[0].A);
    assert.ok(parsed.questions[0].B);
    assert.ok(parsed.questions[0].C);
  });

  it('returns Chinese SBTI questions', async () => {
    const { parsed } = await callTool('abti_sbti_get_questions', { lang: 'zh' });
    assert.equal(parsed.questions.length, 16);
    assert.ok(/[\u4e00-\u9fff]/.test(parsed.questions[0].text));
  });
});

// ─── abti_sbti_submit_answers ───

describe('abti_sbti_submit_answers', () => {
  it('returns SBTI type for valid answers (all A=3)', async () => {
    const answers = Array(16).fill(3);
    const { parsed } = await callTool('abti_sbti_submit_answers', { answers });
    assert.equal(parsed.test, 'sbti');
    assert.equal(parsed.type.length, 4);
    assert.ok(parsed.code);
    assert.ok(parsed.dimensions);
  });

  it('returns SBTI type for all C=1 answers', async () => {
    const answers = Array(16).fill(1);
    const { parsed } = await callTool('abti_sbti_submit_answers', { answers });
    assert.equal(parsed.test, 'sbti');
    assert.equal(parsed.type.length, 4);
  });

  it('returns Chinese SBTI results when lang=zh', async () => {
    const answers = Array(16).fill(2);
    const { parsed } = await callTool('abti_sbti_submit_answers', { answers, lang: 'zh' });
    assert.equal(parsed.test, 'sbti');
    // Description should be in Chinese
    if (parsed.description) {
      assert.ok(/[\u4e00-\u9fff]/.test(parsed.description));
    }
  });
});
