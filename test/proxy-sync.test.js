const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('proxy.js sync (issue #330)', () => {
  it('lib/proxy.js and cli/lib/proxy.js must be identical', () => {
    const root = path.resolve(__dirname, '..');
    const a = fs.readFileSync(path.join(root, 'lib', 'proxy.js'), 'utf8');
    const b = fs.readFileSync(path.join(root, 'cli', 'lib', 'proxy.js'), 'utf8');
    assert.equal(a, b, 'lib/proxy.js and cli/lib/proxy.js have diverged — copy the updated file to both locations');
  });
});
