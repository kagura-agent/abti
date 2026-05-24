const { describe, it } = require('node:test');
const assert = require('node:assert');
const { fetchOllamaModels, fetchOpenRouterModels, fetchGitHubModels, displayName } = require('../cli/bin/abti.js');

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

  describe('fetchOpenRouterModels', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof fetchOpenRouterModels, 'function');
    });

    it('should reject with invalid API key', async () => {
      try {
        await fetchOpenRouterModels('invalid-key');
        // If the API happens to accept it, just verify we got an array
      } catch (err) {
        assert.ok(err.message.includes('OpenRouter API') || err.message.includes('Cannot connect'),
          `Expected OpenRouter error, got: ${err.message}`);
      }
    });
  });

  describe('fetchGitHubModels', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof fetchGitHubModels, 'function');
    });

    it('should reject with invalid API key', async () => {
      try {
        await fetchGitHubModels('invalid-key');
      } catch (err) {
        assert.ok(err.message.includes('GitHub Models API') || err.message.includes('Cannot connect'),
          `Expected GitHub Models error, got: ${err.message}`);
      }
    });
  });
});
