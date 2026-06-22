const { describe, it } = require('node:test');
const assert = require('node:assert');
const { filterExistingModels, normalizeModelName } = require('../cli/bin/abti.js');

describe('--skip-existing filtering', () => {
  it('should filter out models that already have results', () => {
    const modelList = ['gpt-4o', 'gpt-3.5-turbo', 'claude-sonnet-4-20250514'];
    const agents = [
      { model: 'gpt-4o', slug: 'gpt-4o' },
      { model: 'claude-sonnet-4-20250514', slug: 'claude-sonnet-4' },
    ];
    const { remaining, skipped } = filterExistingModels(modelList, agents);
    assert.deepStrictEqual(remaining, ['gpt-3.5-turbo']);
    assert.deepStrictEqual(skipped, ['gpt-4o', 'claude-sonnet-4-20250514']);
  });

  it('should match case-insensitively', () => {
    const modelList = ['GPT-4o', 'Llama-3'];
    const agents = [{ model: 'gpt-4o' }];
    const { remaining, skipped } = filterExistingModels(modelList, agents);
    assert.deepStrictEqual(remaining, ['Llama-3']);
    assert.deepStrictEqual(skipped, ['GPT-4o']);
  });

  it('should return all models when no agents exist', () => {
    const modelList = ['model-a', 'model-b'];
    const { remaining, skipped } = filterExistingModels(modelList, []);
    assert.deepStrictEqual(remaining, ['model-a', 'model-b']);
    assert.deepStrictEqual(skipped, []);
  });

  it('should handle null/undefined agents gracefully', () => {
    const modelList = ['model-a'];
    const { remaining, skipped } = filterExistingModels(modelList, null);
    assert.deepStrictEqual(remaining, ['model-a']);
    assert.deepStrictEqual(skipped, []);
  });

  it('should handle agents with missing model field', () => {
    const modelList = ['gpt-4o'];
    const agents = [{ slug: 'some-agent' }, { model: 'gpt-4o' }];
    const { remaining, skipped } = filterExistingModels(modelList, agents);
    assert.deepStrictEqual(remaining, []);
    assert.deepStrictEqual(skipped, ['gpt-4o']);
  });

  it('should skip nothing when no overlap', () => {
    const modelList = ['model-x', 'model-y'];
    const agents = [{ model: 'model-a' }, { model: 'model-b' }];
    const { remaining, skipped } = filterExistingModels(modelList, agents);
    assert.deepStrictEqual(remaining, ['model-x', 'model-y']);
    assert.deepStrictEqual(skipped, []);
  });

  it('should work when agents is an array (pre-unwrapped)', () => {
    const modelList = ['gpt-4o', 'llama-3'];
    const agents = [{ model: 'gpt-4o' }];
    const { remaining, skipped } = filterExistingModels(modelList, agents);
    assert.deepStrictEqual(remaining, ['llama-3']);
    assert.deepStrictEqual(skipped, ['gpt-4o']);
  });

  it('should match vendor-prefixed catalog IDs against plain model names', () => {
    const modelList = ['openai/gpt-4o', 'anthropic/claude-sonnet-4-20250514'];
    const agents = [
      { model: 'gpt-4o' },
      { model: 'claude-sonnet-4-20250514' },
    ];
    const { remaining, skipped } = filterExistingModels(modelList, agents);
    assert.deepStrictEqual(remaining, []);
    assert.deepStrictEqual(skipped, ['openai/gpt-4o', 'anthropic/claude-sonnet-4-20250514']);
  });

  it('should match plain model names against vendor-prefixed agents', () => {
    const modelList = ['gpt-4o', 'meta-llama-3.1-8b-instruct'];
    const agents = [
      { model: 'openai/gpt-4o' },
      { model: 'meta/meta-llama-3.1-8b-instruct' },
    ];
    const { remaining, skipped } = filterExistingModels(modelList, agents);
    assert.deepStrictEqual(remaining, []);
    assert.deepStrictEqual(skipped, ['gpt-4o', 'meta-llama-3.1-8b-instruct']);
  });

  it('should match vendor-prefixed IDs with case differences', () => {
    const modelList = ['meta/Meta-Llama-3.1-8B-Instruct'];
    const agents = [{ model: 'Meta-Llama-3.1-8B-Instruct' }];
    const { remaining, skipped } = filterExistingModels(modelList, agents);
    assert.deepStrictEqual(remaining, []);
    assert.deepStrictEqual(skipped, ['meta/Meta-Llama-3.1-8B-Instruct']);
  });
});

describe('normalizeModelName', () => {
  it('should strip vendor prefix and lowercase', () => {
    assert.strictEqual(normalizeModelName('openai/GPT-4o'), 'gpt-4o');
  });

  it('should lowercase plain model names', () => {
    assert.strictEqual(normalizeModelName('GPT-4o'), 'gpt-4o');
  });

  it('should handle null/undefined', () => {
    assert.strictEqual(normalizeModelName(null), '');
    assert.strictEqual(normalizeModelName(undefined), '');
  });

  it('should only strip the first prefix segment', () => {
    assert.strictEqual(normalizeModelName('meta/meta-llama/3.1'), 'meta-llama/3.1');
  });
});
