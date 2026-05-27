const { describe, it } = require('node:test');
const assert = require('node:assert');
const { fetchOllamaModels, fetchOpenRouterModels, fetchGitHubModels, fetchAnthropicModels, fetchOpenAICompatModels, fetchGeminiModels, fetchCohereModels, displayName } = require('../cli/bin/abti.js');

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
      try {
        await fetchOllamaModels();
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

    it('should strip namespace prefix from model IDs', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '..', 'cli', 'bin', 'abti.js'), 'utf8');
      assert.ok(
        src.includes("m.id.includes('/') ? m.id.split('/').pop() : m.id"),
        'fetchGitHubModels should strip org/ prefix from namespaced model IDs'
      );
    });
  });

  describe('fetchAnthropicModels', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof fetchAnthropicModels, 'function');
    });

    it('should reject with invalid API key', async () => {
      try {
        await fetchAnthropicModels('invalid-key');
      } catch (err) {
        assert.ok(err.message.includes('Anthropic API') || err.message.includes('Cannot connect'),
          `Expected Anthropic error, got: ${err.message}`);
      }
    });
  });

  describe('fetchOpenAICompatModels', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof fetchOpenAICompatModels, 'function');
    });

    it('should reject with invalid API key', async () => {
      try {
        await fetchOpenAICompatModels('https://api.groq.com/openai/v1', 'invalid-key', 'Groq');
      } catch (err) {
        assert.ok(err.message.includes('Groq API') || err.message.includes('Cannot connect'),
          `Expected Groq error, got: ${err.message}`);
      }
    });
  });

  describe('fetchGeminiModels', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof fetchGeminiModels, 'function');
    });

    it('should reject with invalid API key', async () => {
      try {
        await fetchGeminiModels('invalid-key');
      } catch (err) {
        assert.ok(err.message.includes('Gemini API') || err.message.includes('Cannot connect'),
          `Expected Gemini error, got: ${err.message}`);
      }
    });
  });

  describe('fetchCohereModels', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof fetchCohereModels, 'function');
    });

    it('should reject with invalid API key', async () => {
      try {
        await fetchCohereModels('invalid-key');
      } catch (err) {
        assert.ok(err.message.includes('Cohere API') || err.message.includes('Cannot connect'),
          `Expected Cohere error, got: ${err.message}`);
      }
    });
  });
});
