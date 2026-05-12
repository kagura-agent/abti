const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadState, saveState, defaultStateFile } = require('../cli/bin/abti.js');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abti-resume-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadState', () => {
  it('returns null for non-existent file', () => {
    const result = loadState(path.join(tmpDir, 'nope.json'));
    assert.strictEqual(result, null);
  });

  it('parses valid JSON state file', () => {
    const state = { model: 'test-model', questionIndex: 3, answers: [true, false, true] };
    const fp = path.join(tmpDir, 'state.json');
    fs.writeFileSync(fp, JSON.stringify(state));
    const loaded = loadState(fp);
    assert.deepStrictEqual(loaded.model, 'test-model');
    assert.strictEqual(loaded.questionIndex, 3);
    assert.deepStrictEqual(loaded.answers, [true, false, true]);
  });

  it('normalizes string answers "A"→true, "B"→false', () => {
    const state = { model: 'test', questionIndex: 4, answers: ['A', 'B', 'A', 'B'] };
    const fp = path.join(tmpDir, 'state.json');
    fs.writeFileSync(fp, JSON.stringify(state));
    const loaded = loadState(fp);
    assert.deepStrictEqual(loaded.answers, [true, false, true, false]);
  });

  it('handles mixed boolean and string answers', () => {
    const state = { model: 'test', questionIndex: 3, answers: [true, 'B', 'A', false] };
    const fp = path.join(tmpDir, 'state.json');
    fs.writeFileSync(fp, JSON.stringify(state));
    const loaded = loadState(fp);
    assert.deepStrictEqual(loaded.answers, [true, false, true, false]);
  });
});

describe('saveState', () => {
  it('writes JSON with lastUpdated field', () => {
    const fp = path.join(tmpDir, 'out.json');
    const state = { model: 'gpt-4', questionIndex: 2, answers: [true] };
    saveState(fp, state);
    const written = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    assert.strictEqual(written.model, 'gpt-4');
    assert.strictEqual(written.questionIndex, 2);
    assert.deepStrictEqual(written.answers, [true]);
    assert.ok(written.lastUpdated, 'lastUpdated should be present');
    // Verify it's a valid ISO date
    assert.ok(!isNaN(Date.parse(written.lastUpdated)), 'lastUpdated should be valid ISO date');
  });
});

describe('defaultStateFile', () => {
  it('sanitizes model names with slashes', () => {
    assert.strictEqual(defaultStateFile('openai/gpt-4'), 'openai-gpt-4-state.json');
  });

  it('sanitizes model names with special characters', () => {
    assert.strictEqual(defaultStateFile('my:model@v2'), 'my-model-v2-state.json');
  });

  it('handles undefined model', () => {
    assert.strictEqual(defaultStateFile(undefined), 'unknown-state.json');
  });

  it('passes through clean model names', () => {
    assert.strictEqual(defaultStateFile('gpt-4o'), 'gpt-4o-state.json');
  });
});
