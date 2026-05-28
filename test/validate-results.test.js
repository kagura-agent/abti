const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validate } = require('../scripts/validate-results');

describe('results.json validation', () => {
  it('should have zero validation errors', () => {
    const filePath = path.resolve(__dirname, '..', 'data', 'results.json');
    const errors = validate(filePath);
    assert.deepStrictEqual(errors, [], `Validation errors:\n${errors.join('\n')}`);
  });
});
