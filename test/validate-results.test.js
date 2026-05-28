const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validate } = require('../scripts/validate-results.js');

function makeAgent(overrides = {}) {
  return {
    name: 'Test Agent',
    slug: 'test-agent',
    type: 'PTCF',
    nick: 'The Tester',
    testedAt: '2026-05-04T00:00:00.000Z',
    scores: [3, 3, 3, 3],
    dimensions: [
      { poles: ['P', 'R'], score: 3, max: 4 },
      { poles: ['T', 'E'], score: 3, max: 4 },
      { poles: ['C', 'D'], score: 3, max: 4 },
      { poles: ['F', 'N'], score: 3, max: 4 },
    ],
    ...overrides,
  };
}

describe('validate-results', () => {
  it('passes on actual results.json', () => {
    const data = require(path.join(__dirname, '..', 'data', 'results.json'));
    const { errors } = validate(data);
    assert.deepStrictEqual(errors, [], `Unexpected errors:\n${errors.join('\n')}`);
  });

  it('rejects non-object top level', () => {
    assert.ok(validate(null).errors.length > 0);
    assert.ok(validate({ agents: 'nope' }).errors.length > 0);
  });

  it('rejects missing required fields', () => {
    const { errors } = validate({ agents: [{ slug: 'x' }] });
    assert.ok(errors.some(e => e.includes('name')));
    assert.ok(errors.some(e => e.includes('nick')));
    assert.ok(errors.some(e => e.includes('type')));
    assert.ok(errors.some(e => e.includes('scores')));
  });

  it('rejects invalid slug', () => {
    const { errors } = validate({ agents: [makeAgent({ slug: 'Bad Slug!' })] });
    assert.ok(errors.some(e => e.includes('slug')));
  });

  it('rejects duplicate slugs', () => {
    const { errors } = validate({
      agents: [makeAgent({ slug: 'dupe' }), makeAgent({ slug: 'dupe', name: 'Other' })],
    });
    assert.ok(errors.some(e => e.includes('duplicate slug')));
  });

  it('warns on wrong type derivation', () => {
    const { warnings } = validate({
      agents: [makeAgent({ type: 'RECN' })],
    });
    assert.ok(warnings.some(w => w.includes("doesn't match derived")));
  });

  it('rejects bad dimensions format', () => {
    const { errors } = validate({
      agents: [makeAgent({ dimensions: [{ poles: ['X'] }] })],
    });
    assert.ok(errors.length > 0);
  });

  it('rejects invalid testedAt', () => {
    const { errors } = validate({ agents: [makeAgent({ testedAt: 'not-a-date' })] });
    assert.ok(errors.some(e => e.includes('testedAt')));
  });

  it('accepts valid agent with no errors', () => {
    const { errors } = validate({ agents: [makeAgent()] });
    assert.deepStrictEqual(errors, []);
  });
});
