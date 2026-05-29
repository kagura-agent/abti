'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateResults } = require('../scripts/validate-results.js');

function makeAgent(overrides = {}) {
  return {
    name: 'Test Agent',
    slug: 'test-agent',
    url: '',
    type: 'RECN',
    nick: 'The Tester',
    testedAt: '2026-05-04T00:00:00.000Z',
    scores: [1, 1, 3, 1],
    dimensions: [
      { poles: ['P', 'R'], score: 1, max: 4 },
      { poles: ['T', 'E'], score: 1, max: 4 },
      { poles: ['C', 'D'], score: 3, max: 4 },
      { poles: ['F', 'N'], score: 1, max: 4 },
    ],
    ...overrides,
  };
}

describe('validateResults', () => {
  it('accepts valid data', () => {
    const errors = validateResults({ agents: [makeAgent()] });
    assert.deepStrictEqual(errors, []);
  });

  it('rejects missing agents array', () => {
    assert.ok(validateResults({}).length > 0);
    assert.ok(validateResults({ agents: 'nope' }).length > 0);
  });

  it('rejects missing name', () => {
    const errors = validateResults({ agents: [makeAgent({ name: '' })] });
    assert.ok(errors.some(e => e.includes('name')));
  });

  it('rejects invalid slug', () => {
    const errors = validateResults({ agents: [makeAgent({ slug: 'Not_Kebab' })] });
    assert.ok(errors.some(e => e.includes('kebab')));
  });

  it('rejects duplicate slugs', () => {
    const errors = validateResults({ agents: [makeAgent(), makeAgent()] });
    assert.ok(errors.some(e => e.includes('duplicate')));
  });

  it('rejects wrong type derivation', () => {
    const errors = validateResults({ agents: [makeAgent({ type: 'PTCF' })] });
    assert.ok(errors.some(e => e.includes('derived')));
  });

  it('rejects wrong scores length', () => {
    const errors = validateResults({ agents: [makeAgent({ scores: [1, 2, 3] })] });
    assert.ok(errors.some(e => e.includes('scores')));
  });

  it('rejects score out of range', () => {
    const errors = validateResults({ agents: [makeAgent({ scores: [-1, 1, 3, 1] })] });
    assert.ok(errors.some(e => e.includes('scores[0]')));
    const errors2 = validateResults({ agents: [makeAgent({ scores: [5, 1, 3, 1] })] });
    assert.ok(errors2.some(e => e.includes('scores[0]')));
  });

  it('accepts score 0 as valid', () => {
    const agent = makeAgent({
      scores: [0, 0, 3, 0],
      type: 'RECN',
    });
    agent.dimensions[0].score = 0;
    agent.dimensions[1].score = 0;
    agent.dimensions[3].score = 0;
    const errors = validateResults({ agents: [agent] });
    assert.deepStrictEqual(errors, []);
  });

  it('uses >= 2 as type derivation threshold', () => {
    const agent = makeAgent({
      scores: [2, 1, 2, 1],
      type: 'PECN',
    });
    agent.dimensions[0].score = 2;
    agent.dimensions[1].score = 1;
    agent.dimensions[2].score = 2;
    agent.dimensions[3].score = 1;
    const errors = validateResults({ agents: [agent] });
    assert.deepStrictEqual(errors, []);
  });

  it('rejects mismatched dimension score', () => {
    const agent = makeAgent();
    agent.dimensions[0].score = 99;
    const errors = validateResults({ agents: [agent] });
    assert.ok(errors.some(e => e.includes('dimensions[0].score')));
  });

  it('rejects wrong max', () => {
    const agent = makeAgent();
    agent.dimensions[1].max = 5;
    const errors = validateResults({ agents: [agent] });
    assert.ok(errors.some(e => e.includes('max')));
  });

  it('rejects missing nick', () => {
    const errors = validateResults({ agents: [makeAgent({ nick: '' })] });
    assert.ok(errors.some(e => e.includes('nick')));
  });

  it('rejects type with wrong length', () => {
    const errors = validateResults({ agents: [makeAgent({ type: 'AB' })] });
    assert.ok(errors.some(e => e.includes('4-character')));
  });

  it('validates type derivation with high scores', () => {
    const agent = makeAgent({
      type: 'PTCF',
      scores: [3, 3, 3, 3],
    });
    agent.dimensions[0].score = 3;
    agent.dimensions[1].score = 3;
    agent.dimensions[2].score = 3;
    agent.dimensions[3].score = 3;
    const errors = validateResults({ agents: [agent] });
    assert.deepStrictEqual(errors, []);
  });
});
