const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseAnswer, score } = require('../cli/bin/abti.js');

describe('option shuffle logic', () => {
  it('swapped=true flips parseAnswer result to correct scoring', () => {
    // LLM says "A" but options were swapped, so original answer is B (false)
    const llmResponse = 'A';
    let answer = parseAnswer(llmResponse); // true
    const swapped = true;
    if (swapped) answer = !answer;
    assert.strictEqual(answer, false);
  });

  it('swapped=false keeps parseAnswer result unchanged', () => {
    const llmResponse = 'A';
    let answer = parseAnswer(llmResponse); // true
    const swapped = false;
    if (swapped) answer = !answer;
    assert.strictEqual(answer, true);
  });

  it('swapped=true with B response maps back to A (true)', () => {
    const llmResponse = 'B';
    let answer = parseAnswer(llmResponse); // false
    const swapped = true;
    if (swapped) answer = !answer;
    assert.strictEqual(answer, true);
  });

  it('shuffle+unmap produces correct scores for all-A answers', () => {
    // Simulate: all questions answered A (true) with no swaps
    const answers = Array(16).fill(true);
    const { code, scores } = score(answers);
    assert.deepStrictEqual(scores, [4, 4, 4, 4]);
    assert.strictEqual(code.length, 4);
  });

  it('shuffle+unmap produces correct scores with mixed swaps', () => {
    // Simulate 16 questions: LLM always picks 'A', but some are swapped
    const swaps = [true, false, true, false, false, true, false, true,
                   true, true, false, false, true, false, true, false];
    const answers = swaps.map(swapped => {
      let answer = parseAnswer('A'); // true
      if (swapped) answer = !answer;
      return answer;
    });
    // Swapped questions flip true→false, non-swapped stay true
    // Expected answers: [false, true, false, true, true, false, true, false,
    //                    false, false, true, true, false, true, false, true]
    const expected = swaps.map(s => !s);
    assert.deepStrictEqual(answers, expected);

    const { scores } = score(answers);
    // Dim0 (q0-3): false,true,false,true = 2 trues
    // Dim1 (q4-7): true,false,true,false = 2 trues
    // Dim2 (q8-11): false,false,true,true = 2 trues
    // Dim3 (q12-15): false,true,false,true = 2 trues
    assert.deepStrictEqual(scores, [2, 2, 2, 2]);
  });

  it('parseAnswer still works with various response formats after shuffle', () => {
    // These should all work regardless of shuffling since parseAnswer is called before unmap
    assert.strictEqual(parseAnswer('A'), true);
    assert.strictEqual(parseAnswer('B'), false);
    assert.strictEqual(parseAnswer('ANSWER: A'), true);
    assert.strictEqual(parseAnswer('ANSWER: B'), false);
    assert.strictEqual(parseAnswer('<think>thinking</think>\nA'), true);
    assert.strictEqual(parseAnswer('<think>thinking</think>\nB'), false);
  });
});
