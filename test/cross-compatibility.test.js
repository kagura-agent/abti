const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Set up isolated data dir BEFORE requiring the server
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-cross-compat-test-'));
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

const VALID_MBTI = ['INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'];
const VALID_ABTI = ['PTCF','PTCN','PTDF','PTDN','PECF','PECN','PEDF','PEDN','RTCF','RTCN','RTDF','RTDN','RECF','RECN','REDF','REDN'];

// ─── GET /api/compatibility/human ───

describe('GET /api/compatibility/human', () => {
  it('returns correct structure for valid MBTI type', async () => {
    const r = await req('/api/compatibility/human?mbti=INFJ');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.mbti, 'INFJ');
    assert.ok(j.mappedPoles);
    assert.ok(['P', 'R'].includes(j.mappedPoles.autonomy));
    assert.ok(['T', 'E'].includes(j.mappedPoles.precision));
    assert.ok(['C', 'D'].includes(j.mappedPoles.transparency));
    assert.ok(['F', 'N'].includes(j.mappedPoles.adaptability));
    assert.ok(j.mirrorType);
    assert.equal(j.mirrorType.length, 4);
    assert.ok(j.oppositeType);
    assert.equal(j.oppositeType.length, 4);
    assert.equal(j.dimensionMapping.length, 4);
    assert.ok(Array.isArray(j.ranked));
    assert.equal(j.ranked.length, 16);
  });

  it('ranked results have correct fields and score range', async () => {
    const r = await req('/api/compatibility/human?mbti=ENFP');
    const j = r.json();
    for (const match of j.ranked) {
      assert.ok(match.code, 'ranked item should have code');
      assert.ok(match.nick, 'ranked item should have nick');
      assert.equal(typeof match.score, 'number');
      assert.ok(match.score >= 0 && match.score <= 100, `score ${match.score} out of range`);
      assert.ok(match.category, 'ranked item should have category');
    }
  });

  it('ranked results are sorted by score descending', async () => {
    const r = await req('/api/compatibility/human?mbti=ISTJ');
    const j = r.json();
    for (let i = 1; i < j.ranked.length; i++) {
      assert.ok(j.ranked[i - 1].score >= j.ranked[i].score,
        `ranked[${i-1}].score (${j.ranked[i-1].score}) should be >= ranked[${i}].score (${j.ranked[i].score})`);
    }
  });

  it('all 16 MBTI types return valid results', async () => {
    for (const mbti of VALID_MBTI) {
      const r = await req(`/api/compatibility/human?mbti=${mbti}`);
      assert.equal(r.status, 200, `${mbti} should return 200`);
      const j = r.json();
      assert.equal(j.mbti, mbti);
      assert.equal(j.ranked.length, 16);
      assert.ok(VALID_ABTI.includes(j.mirrorType), `mirrorType ${j.mirrorType} should be valid ABTI`);
      assert.ok(VALID_ABTI.includes(j.oppositeType), `oppositeType ${j.oppositeType} should be valid ABTI`);
    }
  });

  it('returns 400 without mbti param', async () => {
    const r = await req('/api/compatibility/human');
    assert.equal(r.status, 400);
    assert.ok(r.json().error);
  });

  it('returns 400 with invalid MBTI type', async () => {
    const r = await req('/api/compatibility/human?mbti=ZZZZ');
    assert.equal(r.status, 400);
    assert.ok(r.json().error);
  });

  it('is case insensitive', async () => {
    const r = await req('/api/compatibility/human?mbti=infj');
    assert.equal(r.status, 200);
    assert.equal(r.json().mbti, 'INFJ');
  });

  it('opposite type is fully complementary (score 100)', async () => {
    const r = await req('/api/compatibility/human?mbti=INFJ');
    const j = r.json();
    // The opposite type (all dimensions differ) should be ranked first with highest score
    const topMatch = j.ranked[0];
    assert.equal(topMatch.score, 100);
    assert.equal(topMatch.code, j.oppositeType);
  });
});

// ─── GET /api/compatibility/cross ───

describe('GET /api/compatibility/cross', () => {
  it('returns correct structure for valid pair', async () => {
    const r = await req('/api/compatibility/cross?mbti=INFJ&abti=PTCF');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.mbti, 'INFJ');
    assert.equal(j.abti, 'PTCF');
    assert.ok(j.abtiNick);
    assert.equal(typeof j.score, 'number');
    assert.ok(j.score >= 0 && j.score <= 100);
    assert.ok(j.category);
    assert.ok(j.mappedPoles);
    assert.ok(Array.isArray(j.pairAnalysis));
    assert.equal(j.pairAnalysis.length, 4);
  });

  it('pair analysis has correct dimension fields', async () => {
    const r = await req('/api/compatibility/cross?mbti=ENTJ&abti=REDN');
    const j = r.json();
    for (const dim of j.pairAnalysis) {
      assert.ok(dim.dimension, 'should have dimension');
      assert.ok(dim.dimension.mbti, 'dimension should have mbti axis');
      assert.ok(dim.dimension.abti, 'dimension should have abti axis');
      assert.ok(dim.humanPole, 'should have humanPole');
      assert.ok(dim.agentPole, 'should have agentPole');
      assert.equal(typeof dim.match, 'boolean');
      assert.ok(dim.title, 'should have title');
      assert.ok(dim.description, 'should have description');
    }
  });

  it('returns 400 without params', async () => {
    const r = await req('/api/compatibility/cross');
    assert.equal(r.status, 400);
    assert.ok(r.json().error);
  });

  it('returns 400 with missing abti param', async () => {
    const r = await req('/api/compatibility/cross?mbti=INFJ');
    assert.equal(r.status, 400);
    assert.ok(r.json().error);
  });

  it('returns 400 with missing mbti param', async () => {
    const r = await req('/api/compatibility/cross?abti=PTCF');
    assert.equal(r.status, 400);
    assert.ok(r.json().error);
  });

  it('returns 400 with invalid MBTI', async () => {
    const r = await req('/api/compatibility/cross?mbti=XXXX&abti=PTCF');
    assert.equal(r.status, 400);
  });

  it('returns 400 with invalid ABTI', async () => {
    const r = await req('/api/compatibility/cross?mbti=INFJ&abti=ZZZZ');
    assert.equal(r.status, 400);
  });

  it('score matches ranked score from human endpoint', async () => {
    const humanRes = await req('/api/compatibility/human?mbti=INFJ');
    const humanData = humanRes.json();
    const ptcfMatch = humanData.ranked.find(m => m.code === 'PTCF');

    const crossRes = await req('/api/compatibility/cross?mbti=INFJ&abti=PTCF');
    const crossData = crossRes.json();

    assert.equal(crossData.score, ptcfMatch.score, 'cross score should match ranked score');
  });

  it('is case insensitive for both params', async () => {
    const r = await req('/api/compatibility/cross?mbti=infj&abti=ptcf');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.mbti, 'INFJ');
    assert.equal(j.abti, 'PTCF');
  });

  it('complementary pair has high score', async () => {
    // INFJ maps to REDN mirror; PTCF is opposite → should be complementary
    const r = await req('/api/compatibility/cross?mbti=INFJ&abti=PTCF');
    const j = r.json();
    assert.equal(j.category, 'complementary');
    assert.ok(j.score >= 75, `complementary score ${j.score} should be >= 75`);
  });
});
