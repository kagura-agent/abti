const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-reload-'));
process.env.ABTI_DATA_DIR = tmpDir;

const server = require('../api-server.js');
const { resetData, stopWatching } = require('../api-server.js');

let BASE;

function req(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

before(() => new Promise((resolve) => {
  // Ensure data file exists so watcher can attach
  const dataFile = path.join(tmpDir, 'results.json');
  fs.writeFileSync(dataFile, JSON.stringify({ agents: [] }));
  resetData();
  server.listen(0, '127.0.0.1', () => {
    BASE = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  stopWatching();
  server.close(resolve);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}));

describe('auto-reload data on file change', () => {
  it('should reload agentData when results.json is modified externally', async () => {
    // Verify initially empty
    const before = await req('/api/agents');
    assert.equal(before.total, 0);

    // Write new data directly to file (simulating external edit)
    const dataFile = path.join(tmpDir, 'results.json');
    const newData = {
      agents: [
        { name: 'TestBot', type: 'PTCF', scores: [3,2,3,3], slug: 'testbot', testedAt: new Date().toISOString() }
      ]
    };
    fs.writeFileSync(dataFile, JSON.stringify(newData));

    // Wait for debounce (500ms) + buffer
    await sleep(1000);

    // Verify data was reloaded
    const afterReload = await req('/api/agents');
    assert.equal(afterReload.total, 1);
    assert.equal(afterReload.agents[0].name, 'TestBot');
  });
});
