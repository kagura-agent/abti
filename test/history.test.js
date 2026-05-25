const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-hist-'));
process.env.ABTI_DATA_DIR = tmpDir;

const server = require('../api-server.js');
const { rateLimitMap, resetData, stopWatching } = require('../api-server.js');

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

before(() => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    BASE = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

beforeEach(() => { rateLimitMap.clear(); });

after(() => new Promise((resolve) => {
  stopWatching();
  server.close(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ABTI_DATA_DIR;
    resolve();
  });
}));

const allA = Array(16).fill(1);
const allB = Array(16).fill(0);

describe('History tracking — browser test submission path', () => {
  it('first-time agent has empty history', async () => {
    await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'HistNewBot' } });
    const r = await req('/api/agent/histnewbot');
    const j = r.json();
    assert.deepEqual(j.agent.history, []);
  });

  it('preserves history on re-test', async () => {
    await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'HistReBot', model: 'v1' } });
    await req('/api/agent-test', { method: 'POST', body: { answers: allB, agentName: 'HistReBot', model: 'v2' } });
    const r = await req('/api/agent/histrebot');
    const j = r.json();
    assert.equal(j.agent.history.length, 1);
    assert.equal(j.agent.history[0].type, 'PTCF');
    assert.equal(j.agent.history[0].model, 'v1');
    assert.equal(j.agent.type, 'REDN');
    assert.equal(j.agent.model, 'v2');
  });

  it('history grows with each re-test', async () => {
    await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'HistGrowBot' } });
    await req('/api/agent-test', { method: 'POST', body: { answers: allB, agentName: 'HistGrowBot' } });
    await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'HistGrowBot' } });
    const r = await req('/api/agent/histgrowbot');
    const j = r.json();
    assert.equal(j.agent.history.length, 2);
    assert.equal(j.agent.history[0].type, 'PTCF');
    assert.equal(j.agent.history[1].type, 'REDN');
    assert.equal(j.agent.type, 'PTCF');
  });

  it('snapshot includes scores and testedAt', async () => {
    await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'HistFieldBot' } });
    await req('/api/agent-test', { method: 'POST', body: { answers: allB, agentName: 'HistFieldBot' } });
    const r = await req('/api/agent/histfieldbot');
    const h = r.json().agent.history[0];
    assert.deepEqual(h.scores, [4, 4, 4, 4]);
    assert.ok(h.testedAt);
    assert.equal(h.type, 'PTCF');
  });
});

describe('History tracking — registerAgent (MCP/API) path', () => {
  it('preserves history when registerAgent overwrites', async () => {
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'results.json'), 'utf8'));
    data.agents.push({ name: 'MCPBot', slug: 'mcpbot', type: 'PTCF', testedAt: '2026-01-01T00:00:00Z', scores: [4, 4, 4, 4] });
    fs.writeFileSync(path.join(tmpDir, 'results.json'), JSON.stringify(data));
    // Force reload
    resetData();

    await req('/api/agent-test', { method: 'POST', body: { answers: allB, agentName: 'MCPBot' } });
    const r = await req('/api/agent/mcpbot');
    const j = r.json();
    assert.equal(j.agent.type, 'REDN');
    assert.ok(j.agent.history.length >= 1);
    assert.equal(j.agent.history[j.agent.history.length - 1].type, 'PTCF');
  });
});

describe('History cap', () => {
  it('caps history at 50 entries', async () => {
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'results.json'), 'utf8'));
    const bigHistory = [];
    for (let i = 0; i < 55; i++) {
      bigHistory.push({ type: 'PTCF', testedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, scores: [4, 4, 4, 4] });
    }
    const idx = data.agents.findIndex(a => a.slug === 'histcapbot');
    if (idx !== -1) data.agents.splice(idx, 1);
    data.agents.push({ name: 'HistCapBot', slug: 'histcapbot', type: 'PTCF', testedAt: '2026-03-01T00:00:00Z', scores: [4, 4, 4, 4], history: bigHistory });
    fs.writeFileSync(path.join(tmpDir, 'results.json'), JSON.stringify(data));
    resetData();

    await req('/api/agent-test', { method: 'POST', body: { answers: allB, agentName: 'HistCapBot' } });
    const r = await req('/api/agent/histcapbot');
    const j = r.json();
    assert.ok(j.agent.history.length <= 50, `history length ${j.agent.history.length} exceeds cap`);
  });
});

describe('GET /api/agent/:slug includes history', () => {
  it('history field is always present in response', async () => {
    await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'HistAPIBot' } });
    const r = await req('/api/agent/histapibot');
    const j = r.json();
    assert.ok(Array.isArray(j.agent.history));
  });
});
