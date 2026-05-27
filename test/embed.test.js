const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-embed-test-'));
process.env.ABTI_DATA_DIR = tmpDir;

const server = require('../api-server.js');
const { rateLimitMap } = require('../api-server.js');

let BASE;

function req(p, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(p, BASE);
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
    const { port } = server.address();
    BASE = `http://127.0.0.1:${port}`;
    resolve();
  });
}));

beforeEach(() => { rateLimitMap.clear(); });

after(() => new Promise((resolve) => {
  server.close(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ABTI_DATA_DIR;
    resolve();
  });
}));

describe('GET /embed/:type', () => {
  it('returns HTML with correct content-type for valid type', async () => {
    const r = await req('/embed/PECN');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.match(r.body, /PECN/);
    assert.match(r.body, /Powered by ABTI/);
    assert.match(r.body, /__EMBED_PARAMS__/);
  });

  it('injects type param into HTML', async () => {
    const r = await req('/embed/PTCF');
    assert.equal(r.status, 200);
    assert.match(r.body, /"type":"PTCF"/);
  });

  it('is case-insensitive for type code', async () => {
    const r = await req('/embed/pecn');
    assert.equal(r.status, 200);
    assert.match(r.body, /"type":"PECN"/);
  });

  it('supports lang parameter', async () => {
    const r = await req('/embed/PECN?lang=zh');
    assert.equal(r.status, 200);
    assert.match(r.body, /"lang":"zh"/);
  });

  it('supports theme=dark parameter', async () => {
    const r = await req('/embed/PECN?theme=dark');
    assert.equal(r.status, 200);
    assert.match(r.body, /"theme":"dark"/);
  });

  it('defaults to lang=en and theme=light', async () => {
    const r = await req('/embed/PECN');
    assert.match(r.body, /"lang":"en"/);
    assert.match(r.body, /"theme":"light"/);
  });

  it('contains dimension bars markup', async () => {
    const r = await req('/embed/PECN');
    assert.match(r.body, /dim-bar/);
    assert.match(r.body, /dim-fill/);
  });

  it('contains type nickname data', async () => {
    const r = await req('/embed/PECN');
    assert.match(r.body, /Drill Sergeant/);
  });
});

describe('GET /embed/agent/:slug', () => {
  it('returns HTML with correct content-type', async () => {
    const r = await req('/embed/agent/test-agent');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.match(r.body, /__EMBED_PARAMS__/);
    assert.match(r.body, /"agent":"test-agent"/);
  });

  it('supports lang and theme params', async () => {
    const r = await req('/embed/agent/test-agent?lang=zh&theme=dark');
    assert.equal(r.status, 200);
    assert.match(r.body, /"lang":"zh"/);
    assert.match(r.body, /"theme":"dark"/);
  });
});
