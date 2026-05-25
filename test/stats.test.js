const { describe, it } = require('node:test');
const assert = require('node:assert');
const { formatStatsTable, formatStatsJson } = require('../cli/bin/abti.js');

const SAMPLE_AGENTS = [
  { name: 'a1', type: 'PTCF', provider: 'openai' },
  { name: 'a2', type: 'PTCF', provider: 'openai' },
  { name: 'a3', type: 'RECN', provider: 'anthropic' },
  { name: 'a4', type: 'RTDF', provider: 'ollama' },
  { name: 'a5', type: 'PEDN', provider: 'gemini' },
];

describe('stats subcommand', () => {
  describe('formatStatsJson', () => {
    it('should return correct total', () => {
      const result = formatStatsJson(SAMPLE_AGENTS);
      assert.strictEqual(result.total, 5);
    });

    it('should count types represented', () => {
      const result = formatStatsJson(SAMPLE_AGENTS);
      assert.strictEqual(result.typesRepresented, 4);
    });

    it('should identify most common type', () => {
      const result = formatStatsJson(SAMPLE_AGENTS);
      assert.strictEqual(result.mostCommonType.type, 'PTCF');
      assert.strictEqual(result.mostCommonType.count, 2);
    });

    it('should include all 16 types in distribution', () => {
      const result = formatStatsJson(SAMPLE_AGENTS);
      assert.strictEqual(Object.keys(result.typeDistribution).length, 16);
    });

    it('should show zero for unrepresented types', () => {
      const result = formatStatsJson(SAMPLE_AGENTS);
      assert.strictEqual(result.typeDistribution['PTCN'], 0);
    });

    it('should compute dimension bias', () => {
      const result = formatStatsJson(SAMPLE_AGENTS);
      assert.strictEqual(result.dimensionBias.length, 4);
      const autonomy = result.dimensionBias[0];
      assert.strictEqual(autonomy.dimension, 'Autonomy');
      assert.strictEqual(autonomy.P + autonomy.R, 5);
    });

    it('should handle empty agents array', () => {
      const result = formatStatsJson([]);
      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.typesRepresented, 0);
    });
  });

  describe('formatStatsTable', () => {
    it('should return a string', () => {
      const result = formatStatsTable(SAMPLE_AGENTS, 'en', false);
      assert.strictEqual(typeof result, 'string');
    });

    it('should include all 16 types', () => {
      const result = formatStatsTable(SAMPLE_AGENTS, 'en', false);
      assert.ok(result.includes('PTCF'));
      assert.ok(result.includes('PTCN'));
      assert.ok(result.includes('REDN'));
    });

    it('should include summary section', () => {
      const result = formatStatsTable(SAMPLE_AGENTS, 'en', false);
      assert.ok(result.includes('Total agents: 5'));
      assert.ok(result.includes('Types represented: 4/16'));
    });

    it('should include dimension bias', () => {
      const result = formatStatsTable(SAMPLE_AGENTS, 'en', false);
      assert.ok(result.includes('Autonomy'));
      assert.ok(result.includes('Precision'));
    });

    it('should support Chinese', () => {
      const result = formatStatsTable(SAMPLE_AGENTS, 'zh', false);
      assert.ok(result.includes('类型分布'));
      assert.ok(result.includes('维度倾向'));
    });
  });
});
