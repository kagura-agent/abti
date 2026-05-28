const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateResults } = require('../scripts/validate-results.js');

function makeAgent(overrides = {}) {
  return {
    name: 'Test Agent',
    slug: 'test-agent',
    type: 'RECN',
    nick: 'The Tester',
    scores: [1, 0, 4, 0],
    dimensions: [
      { poles: ['P', 'R'], score: 1, max: 4 },
      { poles: ['T', 'E'], score: 0, max: 4 },
      { poles: ['C', 'D'], score: 4, max: 4 },
      { poles: ['F', 'N'], score: 0, max: 4 },
    ],
    model: 'test-model',
    provider: 'test-provider',
    ...overrides,
  };
}

describe('validateResults', () => {
  it('accepts a valid agent', () => {
    const errors = validateResults({ agents: [makeAgent()] });
    assert.equal(errors.length, 0);
  });

  it('rejects missing agents array', () => {
    const errors = validateResults({});
    assert.ok(errors.length > 0);
  });

  it('rejects empty name', () => {
    const errors = validateResults({ agents: [makeAgent({ name: '' })] });
    assert.ok(errors.some(e => e.includes('name')));
  });

  it('rejects invalid slug format', () => {
    const errors = validateResults({ agents: [makeAgent({ slug: 'UPPER' })] });
    assert.ok(errors.some(e => e.includes('slug')));
  });

  it('rejects duplicate slugs', () => {
    const errors = validateResults({ agents: [makeAgent(), makeAgent()] });
    assert.ok(errors.some(e => e.includes('duplicate')));
  });

  it('rejects wrong type length', () => {
    const errors = validateResults({ agents: [makeAgent({ type: 'AB' })] });
    assert.ok(errors.some(e => e.includes('type')));
  });

  it('rejects type that does not match dimensions', () => {
    const errors = validateResults({ agents: [makeAgent({ type: 'PTCF' })] });
    assert.ok(errors.some(e => e.includes('derived')));
  });

  it('rejects wrong scores length', () => {
    const errors = validateResults({ agents: [makeAgent({ scores: [1, 2] })] });
    assert.ok(errors.some(e => e.includes('scores')));
  });

  it('rejects wrong dimensions length', () => {
    const errors = validateResults({ agents: [makeAgent({ dimensions: [] })] });
    assert.ok(errors.some(e => e.includes('dimensions')));
  });

  it('rejects missing model', () => {
    const errors = validateResults({ agents: [makeAgent({ model: '' })] });
    assert.ok(errors.some(e => e.includes('model')));
  });

  it('rejects wrong dimension max', () => {
    const a = makeAgent();
    a.dimensions[0] = { poles: ['P', 'R'], score: 1, max: 5 };
    const errors = validateResults({ agents: [a] });
    assert.ok(errors.some(e => e.includes('max')));
  });

  it('rejects score/dimension mismatch', () => {
    const a = makeAgent();
    a.scores = [3, 0, 4, 0];
    const errors = validateResults({ agents: [a] });
    assert.ok(errors.some(e => e.includes('scores[0]')));
  });

  it('accepts optional fields', () => {
    const errors = validateResults({
      agents: [makeAgent({ url: 'https://example.com', testedAt: '2026-01-01', badge: 'gold' })],
    });
    assert.equal(errors.length, 0);
  });
});
