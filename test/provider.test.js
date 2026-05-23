const { describe, it } = require('node:test');
const assert = require('node:assert');
const { callLLM } = require('../cli/bin/abti.js');

describe('callLLM provider routing', () => {
  it('should throw for unknown provider', () => {
    assert.throws(
      () => callLLM('unknown', 'key', 'model', 'sys', 'usr'),
      /Unknown provider: unknown/
    );
  });

  it('should route openrouter to callOpenAI (rejects with network error, not unknown provider)', async () => {
    // openrouter should be recognized and attempt an API call (which fails with network/fetch error, not "Unknown provider")
    const promise = callLLM('openrouter', 'test-key', 'test-model', 'system', 'user');
    await assert.rejects(promise, (err) => {
      assert.ok(!err.message.includes('Unknown provider'), 'should not throw Unknown provider for openrouter');
      return true;
    });
  });

  it('should route groq to callOpenAI (rejects with network error, not unknown provider)', async () => {
    const promise = callLLM('groq', 'test-key', 'test-model', 'system', 'user');
    await assert.rejects(promise, (err) => {
      assert.ok(!err.message.includes('Unknown provider'), 'should not throw Unknown provider for groq');
      return true;
    });
  });

  it('should route xai to callOpenAI (rejects with network error, not unknown provider)', async () => {
    const promise = callLLM('xai', 'test-key', 'grok-3-mini', 'system', 'user');
    await assert.rejects(promise, (err) => {
      assert.ok(!err.message.includes('Unknown provider'), 'should not throw Unknown provider for xai');
      return true;
    });
  });

  it('should route mistral to callOpenAI (rejects with network error, not unknown provider)', async () => {
    const promise = callLLM('mistral', 'test-key', 'mistral-small-latest', 'system', 'user');
    await assert.rejects(promise, (err) => {
      assert.ok(!err.message.includes('Unknown provider'), 'should not throw Unknown provider for mistral');
      return true;
    });
  });

  it('should include xai in error message for unknown providers', () => {
    try {
      callLLM('bad', 'key', 'model', 'sys', 'usr');
    } catch (e) {
      assert.ok(e.message.includes('xai'), 'error message should list xai as valid provider');
    }
  });

  it('should include openrouter in error message for unknown providers', () => {
    try {
      callLLM('bad', 'key', 'model', 'sys', 'usr');
    } catch (e) {
      assert.ok(e.message.includes('openrouter'), 'error message should list openrouter as valid provider');
    }
  });
});
