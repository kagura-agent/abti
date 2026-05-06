const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseAnswer } = require('../cli/bin/abti.js');

describe('parseAnswer', () => {
  it('should return false (B) when reasoning text mentions A but last line is B', () => {
    const response = 'Okay, the user is asking me to choose between A or B...\n\nB';
    assert.strictEqual(parseAnswer(response), false);
  });

  it('should return true (A) when reasoning mentions B but last line is A', () => {
    const response = 'Let me think. Option A seems good but B better.\n\nA';
    assert.strictEqual(parseAnswer(response), true);
  });

  it('should return false (B) with <think> tags', () => {
    const response = '<think>reasoning</think>\nB';
    assert.strictEqual(parseAnswer(response), false);
  });

  it('should return true (A) for standalone A', () => {
    assert.strictEqual(parseAnswer('A'), true);
  });

  it('should return false (B) for standalone B', () => {
    assert.strictEqual(parseAnswer('B'), false);
  });

  it('should return false (B) for "ANSWER: B"', () => {
    assert.strictEqual(parseAnswer('ANSWER: B'), false);
  });

  it('should return true (A) for "The answer is A."', () => {
    assert.strictEqual(parseAnswer('The answer is A.'), true);
  });

  it('should return true (A) for "A." with punctuation', () => {
    assert.strictEqual(parseAnswer('A.'), true);
  });

  it('should return false (B) for "My answer is B"', () => {
    assert.strictEqual(parseAnswer('My answer is B'), false);
  });

  it('should handle long reasoning with answer at end', () => {
    const response = 'I need to carefully consider both options.\nOption A has merit because of X.\nHowever, option B is better because of Y.\nAfter weighing both sides, I think A is correct.\n\nB';
    assert.strictEqual(parseAnswer(response), false);
  });
});
