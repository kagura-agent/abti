const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-hist-cli-'));
process.env.ABTI_DATA_DIR = tmpDir;

const server = require('../api-server.js');
const { rateLimitMap, resetData, stopWatching } = require('../api-server.js');
const { formatHistoryTable } = require('../cli/bin/abti.js');

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

describe('history CLI — formatHistoryTable', () => {
  it('formats agent with no history', async () => {
    await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'CLIHistNone' } });
    const r = await req('/api/agent/clihistnone');
    const data = r.json();
    const output = formatHistoryTable(data, 'en', false);
    assert.ok(output.includes('Personality Drift Timeline'));
    assert.ok(output.includes('CLIHistNone'));
    assert.ok(output.includes('PTCF'));
    assert.ok(output.includes('current'));
    assert.ok(output.includes('1 test(s), 0 type change(s)'));
  });

  it('shows history entries and drift count', async () => {
    await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'CLIHistDrift' } });
    await req('/api/agent-test', { method: 'POST', body: { answers: allB, agentName: 'CLIHistDrift' } });
    await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'CLIHistDrift' } });
    const r = await req('/api/agent/clihistdrift');
    const data = r.json();
    const output = formatHistoryTable(data, 'en', false);
    assert.ok(output.includes('3 test(s), 2 type change(s)'));
    assert.ok(output.includes('PTCF'));
    assert.ok(output.includes('REDN'));
  });

  it('supports Chinese output', async () => {
    await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'CLIHistZh' } });
    const r = await req('/api/agent/clihistzh');
    const data = r.json();
    const output = formatHistoryTable(data, 'zh', false);
    assert.ok(output.includes('人格变迁时间线'));
    assert.ok(output.includes('当前'));
    assert.ok(output.includes('变迁摘要'));
  });
});

describe('history CLI — API response format', () => {
  it('history endpoint returns correct structure for JSON mode', async () => {
    await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'CLIHistJSON' } });
    await req('/api/agent-test', { method: 'POST', body: { answers: allB, agentName: 'CLIHistJSON' } });
    const r = await req('/api/agent/clihistjson');
    const j = r.json();
    assert.ok(j.agent);
    assert.ok(Array.isArray(j.agent.history));
    assert.equal(j.agent.history.length, 1);
    assert.ok(j.agent.history[0].type);
    assert.ok(j.agent.history[0].scores);
    assert.ok(j.agent.history[0].testedAt);
    assert.equal(j.agent.type, 'REDN');
  });
});
