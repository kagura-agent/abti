const { describe, it } = require('node:test');
const assert = require('node:assert');
const { formatTypeInfo, formatAgentInfo, isTypeCode } = require('../cli/bin/abti.js');

describe('isTypeCode', () => {
  it('should recognize valid 4-letter ABTI type codes', () => {
    assert.ok(isTypeCode('PTCF'));
    assert.ok(isTypeCode('REDN'));
    assert.ok(isTypeCode('rtcf'));  // case-insensitive
  });

  it('should reject invalid codes', () => {
    assert.ok(!isTypeCode('XXXX'));
    assert.ok(!isTypeCode('PT'));
    assert.ok(!isTypeCode('gpt-4o'));
    assert.ok(!isTypeCode(''));
  });
});

const MOCK_TYPE_DATA = {
  strengths: ['Covers every angle', 'Takes initiative'],
  weaknesses: ['Can be overwhelming'],
  tuningTips: ['Dial back verbosity for simple tasks'],
  bestPairedWith: [
    { type: 'REDN', reason: 'Balances breadth with depth' },
  ],
};

describe('formatTypeInfo', () => {
  it('should display type code and nickname', () => {
    const output = formatTypeInfo(MOCK_TYPE_DATA, 'PTCF', 'en', false);
    assert.ok(output.includes('PTCF'));
    assert.ok(output.includes('The Architect'));
  });

  it('should show dimension breakdown', () => {
    const output = formatTypeInfo(MOCK_TYPE_DATA, 'PTCF', 'en', false);
    assert.ok(output.includes('Autonomy'));
    assert.ok(output.includes('Proactive'));
    assert.ok(output.includes('Thorough'));
    assert.ok(output.includes('Candid'));
    assert.ok(output.includes('Flexible'));
  });

  it('should show strengths and weaknesses', () => {
    const output = formatTypeInfo(MOCK_TYPE_DATA, 'PTCF', 'en', false);
    assert.ok(output.includes('Covers every angle'));
    assert.ok(output.includes('Can be overwhelming'));
  });

  it('should show tuning tips', () => {
    const output = formatTypeInfo(MOCK_TYPE_DATA, 'PTCF', 'en', false);
    assert.ok(output.includes('Dial back verbosity'));
  });

  it('should show best paired with', () => {
    const output = formatTypeInfo(MOCK_TYPE_DATA, 'PTCF', 'en', false);
    assert.ok(output.includes('REDN'));
    assert.ok(output.includes('Balances breadth with depth'));
  });

  it('should use Chinese labels with lang=zh', () => {
    const output = formatTypeInfo(MOCK_TYPE_DATA, 'PTCF', 'zh', false);
    assert.ok(output.includes('类型详情'));
    assert.ok(output.includes('建筑师'));
    assert.ok(output.includes('自主性'));
    assert.ok(output.includes('优势'));
    assert.ok(output.includes('弱点'));
  });

  it('should handle null typeData gracefully', () => {
    const output = formatTypeInfo(null, 'PTCF', 'en', false);
    assert.ok(output.includes('PTCF'));
    assert.ok(output.includes('The Architect'));
    assert.ok(!output.includes('Strengths'));
  });
});

const MOCK_AGENT_DATA = {
  agent: {
    name: 'GPT-4o',
    type: 'PTCF',
    nick: 'The Architect',
    scores: [3, 4, 3, 3],
    slug: 'gpt-4o',
    provider: 'openai',
    model: 'gpt-4o',
  },
  profile: {
    strengths: ['Initiative', 'Thoroughness'],
    weaknesses: ['Verbosity'],
    tuningTips: ['Be concise'],
    bestPairedWith: [
      { type: 'REDN', reason: 'Complementary' },
    ],
  },
};

describe('formatAgentInfo', () => {
  it('should display agent name, type, and nickname', () => {
    const output = formatAgentInfo(MOCK_AGENT_DATA, 'en', false);
    assert.ok(output.includes('GPT-4o'));
    assert.ok(output.includes('PTCF'));
    assert.ok(output.includes('The Architect'));
  });

  it('should show provider and model', () => {
    const output = formatAgentInfo(MOCK_AGENT_DATA, 'en', false);
    assert.ok(output.includes('openai'));
    assert.ok(output.includes('gpt-4o'));
  });

  it('should show dimension scores', () => {
    const output = formatAgentInfo(MOCK_AGENT_DATA, 'en', false);
    assert.ok(output.includes('3/4'));
    assert.ok(output.includes('4/4'));
  });

  it('should show strengths and weaknesses', () => {
    const output = formatAgentInfo(MOCK_AGENT_DATA, 'en', false);
    assert.ok(output.includes('Initiative'));
    assert.ok(output.includes('Verbosity'));
  });

  it('should show best paired with', () => {
    const output = formatAgentInfo(MOCK_AGENT_DATA, 'en', false);
    assert.ok(output.includes('REDN'));
    assert.ok(output.includes('Complementary'));
  });

  it('should use Chinese labels with lang=zh', () => {
    const output = formatAgentInfo(MOCK_AGENT_DATA, 'zh', false);
    assert.ok(output.includes('Agent 详情'));
    assert.ok(output.includes('建筑师'));
    assert.ok(output.includes('自主性'));
  });
});
