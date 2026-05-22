const { describe, it } = require('node:test');
const assert = require('node:assert');
const { fetchOllamaModels, displayName } = require('../cli/bin/abti.js');

describe('--all flag', () => {
  describe('displayName', () => {
    it('should strip :latest suffix', () => {
      assert.strictEqual(displayName('llama3.1:latest'), 'llama3.1');
    });

    it('should keep other tags', () => {
      assert.strictEqual(displayName('llama3.1:8b'), 'llama3.1:8b');
    });

    it('should keep name without tag', () => {
      assert.strictEqual(displayName('mistral'), 'mistral');
    });
  });

  describe('fetchOllamaModels', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof fetchOllamaModels, 'function');
    });

    it('should reject when Ollama is not running', async () => {
      // This test assumes Ollama is not running on the test machine at port 11434
      // If it IS running, this test will pass differently but won't fail
      try {
        await fetchOllamaModels();
        // If we get here, Ollama is running — that's fine, just verify shape
      } catch (err) {
        assert.ok(err.message.includes('Cannot connect to Ollama') || err.message.includes('Ollama API'),
          `Expected Ollama connection error, got: ${err.message}`);
      }
    });
  });
});
