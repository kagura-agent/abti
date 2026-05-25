const { describe, it } = require('node:test');
const assert = require('node:assert');
const { formatCompare } = require('../cli/bin/abti.js');

const AGENT_A = {
  agent: { name: 'GPT-4o', type: 'PTCF', nick: 'The Architect', scores: [8, 7, 9, 6], slug: 'gpt-4o' },
  profile: {
    bestPairedWith: [
      { type: 'REDN', reason: 'Balances breadth with depth' },
    ],
  },
};

const AGENT_B = {
  agent: { name: 'Claude Opus 4', type: 'RTDF', nick: 'The Counselor', scores: [3, 7, 4, 8], slug: 'claude-opus-4' },
  profile: {
    bestPairedWith: [
      { type: 'PECN', reason: 'Complementary directness' },
    ],
  },
};

const AGENT_C = {
  agent: { name: 'Llama 3.3 70B', type: 'REDN', nick: 'The Tool', scores: [2, 5, 3, 8], slug: 'llama-3.3-70b' },
  profile: {
    bestPairedWith: [
      { type: 'PTCF', reason: 'The Architect provides initiative' },
    ],
  },
};

describe('formatCompare', () => {
  it('should show both agent names and types', () => {
    const output = formatCompare(AGENT_A, AGENT_B, 'en', false);
    assert.ok(output.includes('GPT-4o'));
    assert.ok(output.includes('Claude Opus 4'));
    assert.ok(output.includes('PTCF'));
    assert.ok(output.includes('RTDF'));
  });

  it('should show dimension breakdown with match indicators', () => {
    const output = formatCompare(AGENT_A, AGENT_B, 'en', false);
    // Autonomy: P vs R → differ (✗)
    assert.ok(output.includes('Autonomy'));
    assert.ok(output.includes('✗'));
    // Precision: T vs T → match (✓)  — both T? No, A=PTCF(T), B=RTDF(T) → match
    assert.ok(output.includes('✓'));
  });

  it('should count matching dimensions', () => {
    // PTCF vs RTDF: P≠R, T=T, C≠D, F=F → 2/4 match
    const output = formatCompare(AGENT_A, AGENT_B, 'en', false);
    assert.ok(output.includes('2/4'));
  });

  it('should show compatibility when bestPairedWith matches', () => {
    // AGENT_A recommends REDN, AGENT_C is REDN → compatibility
    const output = formatCompare(AGENT_A, AGENT_C, 'en', false);
    assert.ok(output.includes('★'));
    assert.ok(output.includes('Balances breadth with depth'));
    // AGENT_C recommends PTCF, AGENT_A is PTCF → mutual compatibility
    assert.ok(output.includes('The Architect provides initiative'));
  });

  it('should not show compatibility section when no match', () => {
    // AGENT_A recommends REDN, AGENT_B is RTDF → no match
    const output = formatCompare(AGENT_A, AGENT_B, 'en', false);
    assert.ok(!output.includes('★'));
  });

  it('should use Chinese labels with lang=zh', () => {
    const output = formatCompare(AGENT_A, AGENT_B, 'zh', false);
    assert.ok(output.includes('对比'));
    assert.ok(output.includes('自主性'));
    assert.ok(output.includes('维度相同'));
  });

  it('should show Chinese nicknames with lang=zh', () => {
    const output = formatCompare(AGENT_A, AGENT_B, 'zh', false);
    assert.ok(output.includes('建筑师'));     // PTCF zh nick
    assert.ok(output.includes('心理咨询师')); // RTDF zh nick
  });
});
