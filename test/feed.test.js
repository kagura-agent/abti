const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Set up isolated data dir BEFORE requiring the server
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-feed-test-'));
process.env.ABTI_DATA_DIR = tmpDir;

// Seed test data
const seedData = {
  agents: [
    {
      name: 'Test Agent Alpha',
      slug: 'test-agent-alpha',
      type: 'PTCF',
      nick: 'The Architect',
      testedAt: '2026-05-20T10:00:00.000Z',
      scores: [4, 4, 3, 2],
      dimensions: [
        { poles: ['P', 'R'], score: 4, majority: 'P' },
        { poles: ['T', 'E'], score: 4, majority: 'T' },
        { poles: ['C', 'D'], score: 3, majority: 'C' },
        { poles: ['F', 'N'], score: 2, majority: 'F' }
      ]
    },
    {
      name: 'Test Agent Beta',
      slug: 'test-agent-beta',
      type: 'RECN',
      nick: 'The Machine',
      testedAt: '2026-05-21T12:00:00.000Z',
      scores: [0, 0, 4, 1],
      dimensions: [
        { poles: ['P', 'R'], score: 0, majority: 'R' },
        { poles: ['T', 'E'], score: 0, majority: 'E' },
        { poles: ['C', 'D'], score: 4, majority: 'C' },
        { poles: ['F', 'N'], score: 1, majority: 'N' }
      ]
    }
  ]
};

fs.writeFileSync(path.join(tmpDir, 'results.json'), JSON.stringify(seedData, null, 2));

const server = require('../api-server.js');
const { resetData, stopWatching } = require('../api-server.js');

let BASE;

function req(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const o = { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'GET' };
    const r = http.request(o, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    r.on('error', reject);
    r.end();
  });
}

before(() => new Promise((resolve) => {
  resetData();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    BASE = `http://127.0.0.1:${port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  stopWatching();
  server.close(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ABTI_DATA_DIR;
    resolve();
  });
}));

describe('GET /feed.xml', () => {
  it('should return valid Atom XML with correct content type', async () => {
    const r = await req('/feed.xml');
    assert.equal(r.status, 200);
    assert.ok(r.headers['content-type'].includes('application/atom+xml'));
    assert.ok(r.body.includes('<?xml version="1.0"'));
    assert.ok(r.body.includes('<feed xmlns="http://www.w3.org/2005/Atom">'));
  });

  it('should contain feed metadata', async () => {
    const r = await req('/feed.xml');
    assert.ok(r.body.includes('<title>ABTI'), 'should have ABTI in title');
    assert.ok(r.body.includes('rel="self"'), 'should have self link');
    assert.ok(r.body.includes('rel="alternate"'), 'should have alternate link');
    assert.ok(r.body.includes('<author><name>ABTI</name></author>'), 'should have author');
    assert.ok(r.body.includes('<updated>'), 'should have updated timestamp');
  });

  it('should list agents sorted by testedAt desc (newest first)', async () => {
    const r = await req('/feed.xml');
    const betaIdx = r.body.indexOf('Test Agent Beta');
    const alphaIdx = r.body.indexOf('Test Agent Alpha');
    assert.ok(betaIdx > 0, 'Beta should be in feed');
    assert.ok(alphaIdx > 0, 'Alpha should be in feed');
    assert.ok(betaIdx < alphaIdx, 'Beta (newer) should appear before Alpha (older)');
  });

  it('should include agent type and nickname in entry title', async () => {
    const r = await req('/feed.xml');
    assert.ok(r.body.includes('Test Agent Beta'), 'should include agent name');
    assert.ok(r.body.includes('RECN'), 'should include type code');
    assert.ok(r.body.includes('The Machine'), 'should include nickname');
    assert.ok(r.body.includes('PTCF'), 'should include other type code');
    assert.ok(r.body.includes('The Architect'), 'should include other nickname');
  });

  it('should include agent profile links', async () => {
    const r = await req('/feed.xml');
    assert.ok(r.body.includes('agent/test-agent-beta'), 'should link to beta profile');
    assert.ok(r.body.includes('agent/test-agent-alpha'), 'should link to alpha profile');
  });

  it('should include dimension info in summary', async () => {
    const r = await req('/feed.xml');
    assert.ok(r.body.includes('Autonomy'), 'should have Autonomy dimension');
    assert.ok(r.body.includes('Precision'), 'should have Precision dimension');
    assert.ok(r.body.includes('Transparency'), 'should have Transparency dimension');
    assert.ok(r.body.includes('Adaptability'), 'should have Adaptability dimension');
  });

  it('should have published dates from testedAt', async () => {
    const r = await req('/feed.xml');
    assert.ok(r.body.includes('<published>2026-05-21T12:00:00.000Z</published>'));
    assert.ok(r.body.includes('<published>2026-05-20T10:00:00.000Z</published>'));
  });
});
