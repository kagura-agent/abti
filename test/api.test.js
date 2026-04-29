const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Set up isolated data dir BEFORE requiring the server
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-test-'));
process.env.ABTI_DATA_DIR = tmpDir;

const server = require('../api-server.js');
const { rateLimitMap } = require('../api-server.js');
const { slugify } = require('../api-server.js');

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

// Clear rate limit before each test to prevent interference
beforeEach(() => { rateLimitMap.clear(); });

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

// ─── POST /api/agent-test?format=markdown ───

describe('POST /api/agent-test?format=markdown', () => {
  const allA = Array(16).fill(1);

  it('returns text/markdown content type', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA, format: 'markdown' } });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/markdown/);
  });

  it('includes badge image link and dimension table', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA, format: 'markdown' } });
    assert.match(r.body, /!\[ABTI: PTCF\]/);
    assert.match(r.body, /badge\/PTCF/);
    assert.match(r.body, /\| Dimension \| Score \| Pole \|/);
  });

  it('includes profile sections', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA, format: 'markdown' } });
    assert.match(r.body, /### Strengths/);
    assert.match(r.body, /### Blind Spots/);
    assert.match(r.body, /### Work Style/);
    assert.match(r.body, /### Best Paired With/);
  });

  it('without format param still returns JSON', async () => {
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA } });
    assert.match(r.headers['content-type'], /application\/json/);
    const j = r.json();
    assert.equal(j.type, 'PTCF');
  });
});

// ─── GET /type/:code ───

describe('GET /type/:code', () => {
  it('returns HTML with OG meta tags for valid type', async () => {
    const r = await req('/type/PTCF');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.match(r.body, /og:title/);
    assert.match(r.body, /PTCF/);
  });

  it('OG tags include correct type name and nickname', async () => {
    const r = await req('/type/PTCF');
    assert.match(r.body, /og:title.*Architect/);
    assert.match(r.body, /og:image.*og\/PTCF/);
  });

  it('case insensitive type code', async () => {
    const r = await req('/type/ptcf');
    assert.equal(r.status, 200);
    assert.match(r.body, /PTCF/);
  });

  it('302 redirects for invalid type code', async () => {
    const r = await req('/type/ZZZZ');
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/');
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

// ─── GET /og/:type ───

describe('GET /og/:type', () => {
  it('returns PNG for valid type', async () => {
    const r = await req('/og/PTCF');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'image/png');
    // PNG magic bytes: \x89PNG
    assert.ok(r.body.includes('PNG') || Buffer.from(r.body, 'binary')[0] === 0x89,
      'response should be a PNG image');
  });

  it('case insensitive type code', async () => {
    const r = await req('/og/ptcf');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'image/png');
  });

  it('404 for unknown type', async () => {
    const r = await req('/og/XXXX');
    assert.equal(r.status, 404);
    const j = r.json();
    assert.ok(j.error);
  });

  it('sets cache headers', async () => {
    const r = await req('/og/PTCF');
    assert.match(r.headers['cache-control'], /max-age=86400/);
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

// ─── GET /api/stats ───

describe('GET /api/stats', () => {
  it('returns stats with correct shape (empty registry)', async () => {
    const r = await req('/api/stats');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(typeof j.totalTests, 'number');
    assert.ok(typeof j.typeDistribution === 'object');
    assert.ok('mostCommonType' in j);
    assert.ok('lastUpdated' in j);
    assert.ok('dimensionAverages' in j);
  });

  it('returns stats after agent registration', async () => {
    // Register an agent first
    await req('/api/agent-test', { method: 'POST', body: { name: 'stats-test-agent', answers: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1] } });
    const r = await req('/api/stats');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.ok(j.totalTests >= 1);
    assert.ok(j.mostCommonType !== null);
    assert.equal(typeof j.mostCommonType.code, 'string');
    assert.equal(typeof j.mostCommonType.nickname, 'string');
    assert.equal(typeof j.mostCommonType.count, 'number');
    assert.ok(j.lastUpdated !== null);
    assert.ok(j.dimensionAverages !== null);
    assert.equal(j.dimensionAverages.length, 4);
    for (const d of j.dimensionAverages) {
      assert.equal(typeof d.name, 'string');
      assert.equal(typeof d.average, 'number');
    }
  });

  it('supports ?lang=zh for dimension names', async () => {
    const r = await req('/api/stats?lang=zh');
    assert.equal(r.status, 200);
    const j = r.json();
    if (j.dimensionAverages) {
      assert.ok(j.dimensionAverages[0].name.match(/[\u4e00-\u9fff]/), 'expected Chinese dimension name');
    }
  });

  it('supports ?lang=en for dimension names', async () => {
    const r = await req('/api/stats?lang=en');
    assert.equal(r.status, 200);
    const j = r.json();
    if (j.dimensionAverages) {
      assert.match(j.dimensionAverages[0].name, /^[A-Za-z]/);
    }
  });

  it('typeDistribution counts types correctly', async () => {
    const r = await req('/api/stats');
    const j = r.json();
    const totalFromDist = Object.values(j.typeDistribution).reduce((a, b) => a + b, 0);
    assert.equal(totalFromDist, j.totalTests);
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

// ─── POST /api/agent-test rate limiting ───

describe('POST /api/agent-test rate limiting', () => {
  const allA = Array(16).fill(1);

  it('allows 5 requests then returns 429 on 6th', async () => {
    rateLimitMap.clear();
    for (let i = 0; i < 5; i++) {
      const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA } });
      assert.equal(r.status, 200, `request ${i + 1} should succeed`);
    }
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA } });
    assert.equal(r.status, 429);
  });

  it('429 response includes Retry-After header', async () => {
    rateLimitMap.clear();
    for (let i = 0; i < 5; i++) {
      await req('/api/agent-test', { method: 'POST', body: { answers: allA } });
    }
    const r = await req('/api/agent-test', { method: 'POST', body: { answers: allA } });
    assert.equal(r.status, 429);
    assert.ok(r.headers['retry-after']);
    const retryAfter = parseInt(r.headers['retry-after'], 10);
    assert.ok(retryAfter > 0 && retryAfter <= 3600);
  });
});

// ─── URL field storage ───

describe('POST /api/agent-test url storage', () => {
  it('stores agentUrl in agent entry', async () => {
    rateLimitMap.clear();
    await req('/api/agent-test', { method: 'POST', body: { answers: Array(16).fill(1), agentName: 'UrlTestBot', agentUrl: 'https://example.com/bot' } });
    const agents = await req('/api/agents');
    const a = agents.json().agents.find(a => a.name === 'UrlTestBot');
    assert.ok(a);
    assert.equal(a.url, 'https://example.com/bot');
  });

  it('stores empty url when agentUrl not provided', async () => {
    rateLimitMap.clear();
    await req('/api/agent-test', { method: 'POST', body: { answers: Array(16).fill(1), agentName: 'NoUrlBot' } });
    const agents = await req('/api/agents');
    const a = agents.json().agents.find(a => a.name === 'NoUrlBot');
    assert.ok(a);
    assert.equal(a.url, '');
  });
});

// ─── slugify ───

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    assert.equal(slugify('My Cool Agent'), 'my-cool-agent');
  });

  it('removes special characters', () => {
    assert.equal(slugify('Agent (v2.0)!'), 'agent-v2-0');
  });

  it('preserves CJK characters', () => {
    assert.equal(slugify('测试机器人'), '测试机器人');
  });

  it('trims leading/trailing hyphens', () => {
    assert.equal(slugify('--hello--'), 'hello');
  });

  it('returns "agent" for empty string', () => {
    assert.equal(slugify(''), 'agent');
  });
});

// ─── POST /api/agent-test slug field ───

describe('POST /api/agent-test slug generation', () => {
  it('stores slug in agent entry', async () => {
    rateLimitMap.clear();
    await req('/api/agent-test', { method: 'POST', body: { answers: Array(16).fill(1), agentName: 'Slug Test Bot' } });
    const agents = await req('/api/agents');
    const a = agents.json().agents.find(a => a.name === 'Slug Test Bot');
    assert.ok(a);
    assert.equal(a.slug, 'slug-test-bot');
  });
});

// ─── GET /api/agent/:slug ───

describe('GET /api/agent/:slug', () => {
  it('returns agent profile for valid slug', async () => {
    rateLimitMap.clear();
    await req('/api/agent-test', { method: 'POST', body: { answers: Array(16).fill(1), agentName: 'ProfileBot', agentUrl: 'https://example.com', model: 'gpt-4o', provider: 'openai' } });
    const r = await req('/api/agent/profilebot');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.agent.name, 'ProfileBot');
    assert.equal(j.agent.slug, 'profilebot');
    assert.equal(j.agent.type, 'PTCF');
    assert.equal(j.agent.model, 'gpt-4o');
    assert.equal(j.agent.provider, 'openai');
    assert.ok(j.agent.dimensions);
    assert.ok(j.agent.scores);
    assert.ok(j.profile.strengths);
    assert.ok(j.profile.blindSpots);
    assert.ok(j.profile.workStyle);
    assert.ok(j.profile.bestPairedWith);
  });

  it('404 for unknown slug', async () => {
    const r = await req('/api/agent/nonexistent-agent-xyz');
    assert.equal(r.status, 404);
    assert.ok(r.json().error);
  });

  it('returns latest agent for duplicate slugs', async () => {
    rateLimitMap.clear();
    // Register two agents that produce the same slug
    await req('/api/agent-test', { method: 'POST', body: { answers: Array(16).fill(1), agentName: 'DupeBot' } });
    // Wait so it's not within 1 hour dedup window (simulate by using different name that produces different entry)
    // Actually same name within 1 hour overwrites, so the latest wins naturally
    await req('/api/agent-test', { method: 'POST', body: { answers: Array(16).fill(0), agentName: 'DupeBot' } });
    const r = await req('/api/agent/dupebot');
    assert.equal(r.status, 200);
    // Should have the latest result (all-B = REDN)
    assert.equal(r.json().agent.type, 'REDN');
  });
});

// ─── GET /agent/:slug ───

describe('GET /agent/:slug', () => {
  it('returns HTML with OG tags for valid agent', async () => {
    rateLimitMap.clear();
    await req('/api/agent-test', { method: 'POST', body: { answers: Array(16).fill(1), agentName: 'PageBot' } });
    const r = await req('/agent/pagebot');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.match(r.body, /og:title/);
    assert.match(r.body, /PageBot/);
    assert.match(r.body, /PTCF/);
  });

  it('302 redirects for unknown slug', async () => {
    const r = await req('/agent/totally-unknown-bot');
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/agents.html');
  });

  it('includes OG image pointing to type OG', async () => {
    rateLimitMap.clear();
    await req('/api/agent-test', { method: 'POST', body: { answers: Array(16).fill(1), agentName: 'OGBot' } });
    const r = await req('/agent/ogbot');
    assert.match(r.body, /og:image.*og\/PTCF/);
  });
});
