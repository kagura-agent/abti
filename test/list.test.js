const { describe, it } = require('node:test');
const assert = require('node:assert');
const { formatListTable } = require('../cli/bin/abti.js');

const SAMPLE_AGENTS = [
  { name: 'GPT-4o', provider: 'openai', type: 'PECN', nick: 'The Drill Sergeant', reliability: 1 },
  { name: 'Claude Opus 4.7', provider: 'anthropic', type: 'RECN', nick: 'The Machine', reliability: null },
  { name: 'Llama 3.1 8B', provider: 'ollama', type: 'PTCN', nick: 'The Commander', reliability: 1 },
];

describe('formatListTable', () => {
  it('should include all agent names sorted alphabetically', () => {
    const output = formatListTable(SAMPLE_AGENTS, 'en', false);
    const lines = output.split('\n');
    const dataLines = lines.filter(l => l.includes('openai') || l.includes('anthropic') || l.includes('ollama'));
    assert.strictEqual(dataLines.length, 3);
    // Alphabetical: Claude, GPT, Llama
    assert.ok(dataLines[0].includes('Claude Opus 4.7'));
    assert.ok(dataLines[1].includes('GPT-4o'));
    assert.ok(dataLines[2].includes('Llama 3.1 8B'));
  });

  it('should show total count in header', () => {
    const output = formatListTable(SAMPLE_AGENTS, 'en', false);
    assert.ok(output.includes('3 total'));
  });

  it('should show "-" for null reliability', () => {
    const output = formatListTable(SAMPLE_AGENTS, 'en', false);
    const claudeLine = output.split('\n').find(l => l.includes('Claude Opus'));
    assert.ok(claudeLine.includes('-'));
  });

  it('should show percentage for numeric reliability', () => {
    const output = formatListTable(SAMPLE_AGENTS, 'en', false);
    const gptLine = output.split('\n').find(l => l.includes('GPT-4o'));
    assert.ok(gptLine.includes('100%'));
  });

  it('should use Chinese nicknames with lang=zh', () => {
    const output = formatListTable(SAMPLE_AGENTS, 'zh', false);
    assert.ok(output.includes('指挥官'));  // PTCN zh nick
    assert.ok(output.includes('已测试'));
  });

  it('should handle empty agent list', () => {
    const output = formatListTable([], 'en', false);
    assert.ok(output.includes('0 total'));
  });
});
