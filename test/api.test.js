const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Set up isolated data dir BEFORE requiring the server
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-test-'));
process.env.ABTI_DATA_DIR = tmpDir;

const server = require('../api-server.js');

let BASE;

function req(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
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

after(() => new Promise((resolve) => {
  server.close(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ABTI_DATA_DIR;
    resolve();
  });
}));

// ─── GET /api/test ───

describe('GET /api/test', () => {
  it('returns ABTI questions (default en)', async () => {
    const r = await req('/api/test');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.test, 'abti');
    assert.equal(j.questions.length, 16);
    assert.equal(j.dimensions.length, 4);
    assert.ok(j.questions[0].options.A);
    assert.ok(j.questions[0].options.B);
  });

  it('returns zh questions', async () => {
    const r = await req('/api/test?lang=zh');
    const j = r.json();
    assert.equal(j.questions.length, 16);
    assert.match(j.dimensions[0].name, /自主/);
  });

  it('falls back to en for unknown lang', async () => {
    const r = await req('/api/test?lang=xx');
    const j = r.json();
    assert.equal(j.dimensions[0].name, 'Autonomy');
  });
});

// ─── POST /api/agent-test ───

describe('POST /api/agent-test', () => {
  const allA = Array(16).fill(1);
  const allB = Array(16).fill(0);

  it('returns PTCF for all-A answers', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA } });
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.test, 'abti');
    assert.equal(j.type, 'PTCF');
    assert.ok(j.nick);
    assert.ok(j.dimensions);
    assert.ok(j.strengths);
  });

  it('returns REDN for all-B answers', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allB } });
    assert.equal(r.json().type, 'REDN');
  });

  it('randomly assigns pole letters when score is 2 (tie)', async () => {
    // 2 A's + 2 B's per dimension → score 2 each → random pick
    const tieAnswers = [1,1,0,0, 1,1,0,0, 1,1,0,0, 1,1,0,0];
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: tieAnswers } });
    const j = r.json();
    assert.equal(r.status, 200);
    // Each letter must be one of the two valid poles for its dimension
    const DL = [['P','R'],['T','E'],['C','D'],['F','N']];
    for (let i = 0; i < 4; i++) {
      assert.ok(DL[i].includes(j.type[i]), `dim ${i}: '${j.type[i]}' not in [${DL[i]}]`);
    }
  });

  it('returns zh nick with lang=zh', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA, lang: 'zh' } });
    const j = r.json();
    // zh dimension names
    const dimKeys = Object.keys(j.dimensions);
    assert.ok(dimKeys.some(k => /自主/.test(k)));
  });

  it('registers agent name', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'TestBot', agentUrl: 'https://example.com' } });
    assert.equal(r.status, 200);
    // verify via agents list
    const agents = await req('/api/agents');
    const j = agents.json();
    assert.ok(j.agents.some(a => a.name === 'TestBot'));
  });

  it('stores model and provider when provided', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'ModelBot', model: 'gpt-4o', provider: 'openai' } });
    assert.equal(r.status, 200);
    const agents = await req('/api/agents');
    const a = agents.json().agents.find(a => a.name === 'ModelBot');
    assert.equal(a.model, 'gpt-4o');
    assert.equal(a.provider, 'openai');
  });

  it('omits model/provider when not provided (backwards compat)', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'PlainBot' } });
    assert.equal(r.status, 200);
    const agents = await req('/api/agents');
    const a = agents.json().agents.find(a => a.name === 'PlainBot');
    assert.equal(a.model, undefined);
    assert.equal(a.provider, undefined);
  });

  it('stores dimension scores in agent entry', async () => {
    await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'ScoreBot' } });
    const agents = await req('/api/agents');
    const a = agents.json().agents.find(a => a.name === 'ScoreBot');
    assert.deepEqual(a.scores, [4, 4, 4, 4]);
    assert.equal(a.dimensions.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(a.dimensions[i].poles, [['P','R'],['T','E'],['C','D'],['F','N']][i]);
      assert.equal(a.dimensions[i].score, 4);
      assert.equal(a.dimensions[i].max, 4);
    }
  });

  it('truncates model and provider to max length', async () => {
    const longModel = 'x'.repeat(100);
    const longProvider = 'y'.repeat(50);
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA, agentName: 'TruncBot', model: longModel, provider: longProvider } });
    assert.equal(r.status, 200);
    const agents = await req('/api/agents');
    const a = agents.json().agents.find(a => a.name === 'TruncBot');
    assert.equal(a.model.length, 64);
    assert.equal(a.provider.length, 32);
  });

  it('400 on wrong length', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: [1, 0, 1] } });
    assert.equal(r.status, 400);
    assert.ok(r.json().error);
  });

  it('400 on missing answers', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: {} });
    assert.equal(r.status, 400);
  });

  it('400 on non-array answers', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: 'not an array' } });
    assert.equal(r.status, 400);
  });

  it('400 on invalid JSON', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: '{bad json', headers: { 'Content-Type': 'application/json' } });
    assert.equal(r.status, 400);
    assert.ok(r.json().error.includes('invalid JSON'));
  });
});

// ─── GET /api/types ───

describe('GET /api/types', () => {
  it('returns all 16 types', async () => {
    const r = await req('/api/types');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.test, 'abti');
    assert.equal(Object.keys(j.types).length, 16);
    assert.ok(j.types.PTCF.nick);
    assert.ok(j.dimensions);
  });

  it('returns zh content with lang=zh', async () => {
    const r = await req('/api/types?lang=zh');
    const j = r.json();
    assert.ok(j.dimensions.some(d => /自主/.test(d)));
  });
});

// ─── GET /badge/:type ───

describe('GET /badge/:type', () => {
  it('returns SVG for valid type', async () => {
    const r = await req('/badge/PTCF');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'image/svg+xml');
    assert.match(r.body, /<svg/);
    assert.match(r.body, /Architect/);
  });

  it('case insensitive type code', async () => {
    const r = await req('/badge/ptcf');
    assert.equal(r.status, 200);
    assert.match(r.body, /Architect/);
  });

  it('404 SVG for unknown type', async () => {
    const r = await req('/badge/XXXX');
    assert.equal(r.status, 404);
    assert.equal(r.headers['content-type'], 'image/svg+xml');
    assert.match(r.body, /Unknown/);
  });

  it('no match for non-4-letter path', async () => {
    const r = await req('/badge/AB');
    assert.equal(r.status, 404);
    const j = r.json();
    assert.ok(j.error);
  });
});

// ─── GET /api/agents ───

describe('GET /api/agents', () => {
  it('returns agents list', async () => {
    const r = await req('/api/agents');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.ok(typeof j.total === 'number');
    assert.ok(Array.isArray(j.agents));
  });
});

// ─── POST /api/agents/register (not implemented - should 404) ───

describe('POST /api/agents/register', () => {
  it('returns 404 (registration happens via agent-test)', async () => {
    const r = await req('/api/agents/register', { method: 'POST', body: {} });
    assert.equal(r.status, 404);
  });
});

// ─── GET /api/sbti/test ───

describe('GET /api/sbti/test', () => {
  it('returns SBTI questions (en)', async () => {
    const r = await req('/api/sbti/test');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.test, 'sbti');
    assert.equal(j.questions.length, 16);
    assert.ok(j.questions[0].options.A);
    assert.ok(j.questions[0].options.B);
    assert.ok(j.questions[0].options.C);
  });

  it('returns zh questions', async () => {
    const r = await req('/api/sbti/test?lang=zh');
    const j = r.json();
    assert.equal(j.questions.length, 16);
    assert.match(j.dimensions[0].name, /讨好/);
  });
});

// ─── POST /api/sbti/agent-test ───

describe('POST /api/sbti/agent-test', () => {
  it('scores all-3 answers', async () => {
    const r = await req('/api/sbti/agent-test', { method: 'POST', body: { answers: Array(16).fill(3) } });
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.test, 'sbti');
    assert.equal(j.type, 'SVHO');
    assert.ok(j.code);
    assert.ok(j.dimensions);
  });

  it('scores all-1 answers', async () => {
    const r = await req('/api/sbti/agent-test', { method: 'POST', body: { answers: Array(16).fill(1) } });
    const j = r.json();
    assert.equal(j.type, 'CTGI');
  });

  it('400 on wrong length', async () => {
    const r = await req('/api/sbti/agent-test', { method: 'POST', body: { answers: [1, 2] } });
    assert.equal(r.status, 400);
  });

  it('400 on invalid JSON', async () => {
    const r = await req('/api/sbti/agent-test', { method: 'POST', body: 'nope', headers: { 'Content-Type': 'application/json' } });
    assert.equal(r.status, 400);
  });
});

// ─── GET /result/:type ───

describe('GET /result/:type', () => {
  it('returns HTML with OG tags for valid type', async () => {
    const r = await req('/result/PTCF');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.match(r.body, /og:title/);
    assert.match(r.body, /PTCF/);
  });

  it('302 redirects for invalid type code', async () => {
    const r = await req('/result/ZZZZ');
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/');
  });

  it('case insensitive', async () => {
    const r = await req('/result/ptcf');
    assert.equal(r.status, 200);
  });
});

// ─── GET /api/compare/:type1/:type2 ───

describe('GET /api/compare/:type1/:type2', () => {
  it('compares same type', async () => {
    const r = await req('/api/compare/PTCF/PTCF');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.type1.code, 'PTCF');
    assert.equal(j.type2.code, 'PTCF');
    assert.equal(j.dimensions.length, 4);
    assert.equal(j.sharedDimensions, 4);
    assert.ok(j.dimensions.every(d => d.match === true));
  });

  it('compares different types', async () => {
    const r = await req('/api/compare/PTCF/REDN');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.type1.code, 'PTCF');
    assert.equal(j.type2.code, 'REDN');
    assert.equal(j.sharedDimensions, 0);
    assert.ok(j.dimensions.every(d => d.match === false));
    assert.ok(j.type1.strengths);
    assert.ok(j.type2.blindSpots);
    assert.ok(j.type1.nick);
  });

  it('400 for invalid type code', async () => {
    const r = await req('/api/compare/PTCF/ZZZZ');
    assert.equal(r.status, 400);
    assert.ok(r.json().error.includes('ZZZZ'));
  });

  it('returns zh content with lang=zh', async () => {
    const r = await req('/api/compare/PTCF/REDN?lang=zh');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.ok(j.dimensions[0].name.match(/自主/));
  });

  it('detects compatibility (PTCF ↔ RTDN mutual)', async () => {
    const r = await req('/api/compare/PTCF/RTDN');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.compatibility.type1RecommendsType2, true);
    assert.equal(j.compatibility.type2RecommendsType1, true);
    assert.equal(j.compatibility.mutual, true);
    assert.ok(j.compatibility.reason1);
    assert.ok(j.compatibility.reason2);
  });
});

// ─── OPTIONS (CORS) ───

describe('CORS', () => {
  it('responds 204 to OPTIONS', async () => {
    const r = await req('/api/test', { method: 'OPTIONS' });
    assert.equal(r.status, 204);
    assert.ok(r.headers['access-control-allow-origin']);
  });
});

// ─── 404 ───

describe('Unknown routes', () => {
  it('returns 404 with endpoint list', async () => {
    const r = await req('/nonexistent');
    assert.equal(r.status, 404);
    const j = r.json();
    assert.ok(j.error);
    assert.ok(Array.isArray(j.endpoints));
  });
});
