const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-cmp-'));
process.env.ABTI_DATA_DIR = tmpDir;

const server = require('../api-server.js');
const { rateLimitMap, resetData } = require('../api-server.js');

let BASE;

function req(urlPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const o = { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: opts.method || 'GET', headers: opts.headers || {} };
    if (opts.body) o.headers['Content-Type'] = 'application/json';
    const r = http.request(o, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d, json() { return JSON.parse(d); } }));
    });
    r.on('error', reject);
    if (opts.body) r.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    r.end();
  });
}

before(async () => {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      BASE = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  rateLimitMap.clear();

  // Seed two test agents
  // answers: array of 16 values, 1=A, 0=B
  const answers1 = [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]; // all A → PTCN
  const answers2 = [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]; // all B → REDS

  rateLimitMap.clear();
  const r1 = await req('/api/agent-test', { method: 'POST', body: { agentName: 'Test Agent Alpha', model: 'test-model-1', provider: 'test-provider', answers: answers1 } });
  rateLimitMap.clear();
  const r2 = await req('/api/agent-test', { method: 'POST', body: { agentName: 'Test Agent Beta', model: 'test-model-2', provider: 'test-provider', answers: answers2 } });
  rateLimitMap.clear();
});

beforeEach(() => { rateLimitMap.clear(); });

after(() => new Promise((resolve) => {
  server.close(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ABTI_DATA_DIR;
    resolve();
  });
}));

describe('GET /api/compare/agents/:slug1/:slug2', () => {
  it('returns comparison for two valid agents', async () => {
    const r = await req('/api/compare/agents/test-agent-alpha/test-agent-beta');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.ok(j.agent1, 'should have agent1');
    assert.ok(j.agent2, 'should have agent2');
    assert.equal(j.agent1.name, 'Test Agent Alpha');
    assert.equal(j.agent2.name, 'Test Agent Beta');
    assert.ok(Array.isArray(j.dimensions), 'should have dimensions array');
    assert.equal(j.dimensions.length, 4);
    assert.equal(typeof j.sharedDimensions, 'number');
    assert.ok(j.compatibility, 'should have compatibility');
    assert.equal(typeof j.compatibility.mutual, 'boolean');

    // Each dimension should have score1 and score2
    for (const dim of j.dimensions) {
      assert.ok(dim.name, 'dimension should have name');
      assert.ok(Array.isArray(dim.poles), 'dimension should have poles');
      assert.equal(typeof dim.match, 'boolean');
      assert.equal(typeof dim.score1, 'number');
      assert.equal(typeof dim.score2, 'number');
    }
  });

  it('strips answers from agent data', async () => {
    const r = await req('/api/compare/agents/test-agent-alpha/test-agent-beta');
    const j = r.json();
    assert.equal(j.agent1.answers, undefined, 'agent1 should not have answers');
    assert.equal(j.agent2.answers, undefined, 'agent2 should not have answers');
  });

  it('returns 404 for nonexistent agent', async () => {
    const r = await req('/api/compare/agents/nonexistent-agent/test-agent-alpha');
    assert.equal(r.status, 404);
    const j = r.json();
    assert.ok(j.error.includes('nonexistent-agent'));
  });

  it('returns 404 when second agent not found', async () => {
    const r = await req('/api/compare/agents/test-agent-alpha/does-not-exist');
    assert.equal(r.status, 404);
    const j = r.json();
    assert.ok(j.error.includes('does-not-exist'));
  });

  it('comparing same agent works', async () => {
    const r = await req('/api/compare/agents/test-agent-alpha/test-agent-alpha');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.sharedDimensions, 4, 'same agent should share all dimensions');
    for (const dim of j.dimensions) {
      assert.equal(dim.match, true);
    }
  });
});
