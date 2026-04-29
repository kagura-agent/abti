const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Set up isolated data dir BEFORE requiring the server
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-compat-test-'));
process.env.ABTI_DATA_DIR = tmpDir;

const server = require('../api-server.js');
const { rateLimitMap } = require('../api-server.js');

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

// ─── GET /api/compatibility ───

describe('GET /api/compatibility', () => {
  it('returns correct structure for PTCF vs RECN', async () => {
    const r = await req('/api/compatibility?type1=PTCF&type2=RECN');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.type1.code, 'PTCF');
    assert.equal(j.type2.code, 'RECN');
    assert.ok(j.type1.nick);
    assert.ok(j.type2.nick);
    assert.ok(['complementary', 'similar', 'contrasting', 'balanced'].includes(j.overallCategory));
    assert.equal(typeof j.compatibilityScore, 'number');
    assert.ok(j.compatibilityScore >= 0 && j.compatibilityScore <= 100);
    assert.equal(j.dimensionAnalysis.length, 4);
    for (const dim of j.dimensionAnalysis) {
      assert.ok(dim.dimension);
      assert.ok(dim.type1Pole);
      assert.ok(dim.type2Pole);
      assert.equal(typeof dim.match, 'boolean');
      assert.ok(dim.analysis_en);
      assert.ok(dim.analysis_zh);
    }
    assert.ok(j.summary_en);
    assert.ok(j.summary_zh);
  });

  it('returns score 50 for same type (PTCF vs PTCF)', async () => {
    const r = await req('/api/compatibility?type1=PTCF&type2=PTCF');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.type1.code, 'PTCF');
    assert.equal(j.type2.code, 'PTCF');
    assert.equal(j.overallCategory, 'similar');
    // All dimensions should match
    assert.ok(j.dimensionAnalysis.every(d => d.match === true));
  });

  it('returns 400 without params', async () => {
    const r = await req('/api/compatibility');
    assert.equal(r.status, 400);
    assert.ok(r.json().error);
  });

  it('returns 400 with missing type2', async () => {
    const r = await req('/api/compatibility?type1=PTCF');
    assert.equal(r.status, 400);
  });

  it('returns 400 with invalid type', async () => {
    const r = await req('/api/compatibility?type1=PTCF&type2=ZZZZ');
    assert.equal(r.status, 400);
    assert.ok(r.json().error.includes('ZZZZ'));
  });

  it('returns 400 with invalid type1', async () => {
    const r = await req('/api/compatibility?type1=XXXX&type2=PTCF');
    assert.equal(r.status, 400);
    assert.ok(r.json().error.includes('XXXX'));
  });

  it('is case insensitive', async () => {
    const r = await req('/api/compatibility?type1=ptcf&type2=redn');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.type1.code, 'PTCF');
    assert.equal(j.type2.code, 'REDN');
  });

  it('complementary types (all different) score higher than similar', async () => {
    const comp = await req('/api/compatibility?type1=PTCF&type2=REDN');
    const sim = await req('/api/compatibility?type1=PTCF&type2=PTCF');
    assert.ok(comp.json().compatibilityScore > sim.json().compatibilityScore);
  });

  it('supports lang=zh', async () => {
    const r = await req('/api/compatibility?type1=PTCF&type2=REDN&lang=zh');
    assert.equal(r.status, 200);
    const j = r.json();
    // zh dimension names should contain CJK characters
    assert.ok(j.dimensionAnalysis[0].dimension.match(/[\u4e00-\u9fff]/));
    assert.ok(j.summary_zh);
  });
});

// ─── GET /api/compatibility/matrix ───

describe('GET /api/compatibility/matrix', () => {
  it('returns 16x16 matrix structure', async () => {
    const r = await req('/api/compatibility/matrix');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.types.length, 16);
    assert.equal(Object.keys(j.matrix).length, 16);
    // Each row has 16 entries
    for (const type of j.types) {
      assert.equal(Object.keys(j.matrix[type]).length, 16);
      for (const other of j.types) {
        const score = j.matrix[type][other];
        assert.equal(typeof score, 'number');
        assert.ok(score >= 0 && score <= 100);
      }
    }
  });

  it('diagonal entries are all 50 or below (same type)', async () => {
    const r = await req('/api/compatibility/matrix');
    const j = r.json();
    for (const type of j.types) {
      // Same type should have lower score (similar category)
      assert.ok(j.matrix[type][type] <= 55, `${type} self-score ${j.matrix[type][type]} should be <= 55`);
    }
  });

  it('matrix is symmetric', async () => {
    const r = await req('/api/compatibility/matrix');
    const j = r.json();
    for (const t1 of j.types) {
      for (const t2 of j.types) {
        assert.equal(j.matrix[t1][t2], j.matrix[t2][t1], `${t1}x${t2} should equal ${t2}x${t1}`);
      }
    }
  });

  it('opposite types score higher than same type', async () => {
    const r = await req('/api/compatibility/matrix');
    const j = r.json();
    assert.ok(j.matrix['PTCF']['REDN'] > j.matrix['PTCF']['PTCF']);
  });
});
