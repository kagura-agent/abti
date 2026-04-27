const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Isolated data dir
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-mcp-http-test-'));
process.env.ABTI_DATA_DIR = tmpDir;

const server = require('../api-server.js');

let BASE;
let sessionId;

// SSE-aware request helper
function mcpReq(urlPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(opts.headers || {}),
    };
    const o = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: opts.method || 'POST',
      headers,
    };
    const r = http.request(o, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        let parsed = null;
        if (ct.includes('text/event-stream')) {
          // Parse SSE: extract data lines
          const lines = d.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try { parsed = JSON.parse(line.slice(6)); } catch (_) {}
            }
          }
        } else {
          try { parsed = JSON.parse(d); } catch (_) {}
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: d,
          data: parsed,
        });
      });
    });
    r.on('error', reject);
    if (opts.body) r.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    r.end();
  });
}

// Simple HTTP request (non-SSE)
function httpReq(urlPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const o = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    };
    const r = http.request(o, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d, json() { return JSON.parse(d); } }));
    });
    r.on('error', reject);
    r.end();
  });
}

before(() => new Promise((resolve) => {
  server.resetData();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    BASE = `http://127.0.0.1:${port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  server.close(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resolve();
  });
}));

describe('MCP HTTP transport', () => {
  it('initializes a session via POST /mcp', async () => {
    const res = await mcpReq('/mcp', {
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      },
    });
    assert.equal(res.status, 200);
    assert.ok(res.data, 'should parse SSE response');
    assert.equal(res.data.jsonrpc, '2.0');
    assert.equal(res.data.id, 1);
    assert.ok(res.data.result);
    assert.ok(res.data.result.serverInfo);
    assert.equal(res.data.result.serverInfo.name, 'abti');
    sessionId = res.headers['mcp-session-id'];
    assert.ok(sessionId, 'should return mcp-session-id header');
  });

  it('sends initialized notification', async () => {
    // MCP protocol requires initialized notification after initialize
    const res = await mcpReq('/mcp', {
      headers: { 'mcp-session-id': sessionId },
      body: {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      },
    });
    // Notifications return 204 or 202
    assert.ok([200, 202, 204].includes(res.status), `Expected 200/202/204, got ${res.status}`);
  });

  it('lists tools via POST /mcp with session', async () => {
    const res = await mcpReq('/mcp', {
      headers: { 'mcp-session-id': sessionId },
      body: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      },
    });
    assert.equal(res.status, 200);
    assert.ok(res.data?.result);
    assert.ok(Array.isArray(res.data.result.tools));
    const toolNames = res.data.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('abti_get_questions'));
    assert.ok(toolNames.includes('abti_submit_answers'));
    assert.ok(toolNames.includes('abti_compare_types'));
    assert.ok(toolNames.includes('abti_list_agents'));
    assert.ok(toolNames.includes('abti_sbti_get_questions'));
    assert.ok(toolNames.includes('abti_sbti_submit_answers'));
  });

  it('calls abti_get_questions tool', async () => {
    const res = await mcpReq('/mcp', {
      headers: { 'mcp-session-id': sessionId },
      body: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'abti_get_questions',
          arguments: { lang: 'en' },
        },
      },
    });
    assert.equal(res.status, 200);
    const content = JSON.parse(res.data.result.content[0].text);
    assert.equal(content.test, 'abti');
    assert.equal(content.questions.length, 16);
  });

  it('calls abti_submit_answers and registers agent in registry', async () => {
    const res = await mcpReq('/mcp', {
      headers: { 'mcp-session-id': sessionId },
      body: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'abti_submit_answers',
          arguments: {
            answers: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            lang: 'en',
            agentName: 'MCP Test Agent',
            model: 'test-model',
            provider: 'test-provider',
          },
        },
      },
    });
    assert.equal(res.status, 200);
    const content = JSON.parse(res.data.result.content[0].text);
    assert.equal(content.test, 'abti');
    assert.equal(content.type, 'PTCF');
    assert.equal(content.agentName, 'MCP Test Agent');

    // Verify agent was registered in the API registry
    const agentsRes = await httpReq('/api/agents');
    const agents = agentsRes.json();
    assert.ok(agents.total >= 1, 'total should be >= 1');
    const registered = agents.agents.find(a => a.name === 'MCP Test Agent');
    assert.ok(registered, 'Agent should be registered in registry via MCP');
    assert.equal(registered.type, 'PTCF');
    assert.equal(registered.model, 'test-model');
    assert.equal(registered.provider, 'test-provider');
  });

  it('returns 400 for POST without session or initialize', async () => {
    const res = await mcpReq('/mcp', {
      body: {
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/list',
        params: {},
      },
    });
    assert.equal(res.status, 400);
  });

  it('returns 400 for GET without session', async () => {
    const res = await mcpReq('/mcp', { method: 'GET' });
    assert.equal(res.status, 400);
  });

  it('returns 405 for DELETE without session', async () => {
    const res = await mcpReq('/mcp', { method: 'DELETE' });
    assert.equal(res.status, 405);
  });

  it('terminates session via DELETE /mcp', async () => {
    const res = await mcpReq('/mcp', {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId },
    });
    assert.equal(res.status, 200);
  });
});
