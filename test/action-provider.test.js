const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { callLLM } = require('../action/index.js');

describe('action callLLM provider routing', () => {
  it('should throw for unknown provider', () => {
    assert.throws(
      () => callLLM('unknown', 'key', 'model', 'sys', 'usr'),
      /Unknown provider: unknown/
    );
  });

  it('should route deepseek to callOpenAI (rejects with network error, not unknown provider)', async () => {
    const promise = callLLM('deepseek', 'test-key', 'deepseek-chat', 'system', 'user');
    await assert.rejects(promise, (err) => {
      assert.ok(!err.message.includes('Unknown provider'), 'should not throw Unknown provider for deepseek');
      return true;
    });
  });

  it('should route cohere to callOpenAI (rejects with network error, not unknown provider)', async () => {
    const promise = callLLM('cohere', 'test-key', 'command-a-08-2025', 'system', 'user');
    await assert.rejects(promise, (err) => {
      assert.ok(!err.message.includes('Unknown provider'), 'should not throw Unknown provider for cohere');
      return true;
    });
  });

  it('should include deepseek and cohere in error message for unknown providers', () => {
    try {
      callLLM('bad', 'key', 'model', 'sys', 'usr');
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('deepseek'), 'error message should list deepseek as valid provider');
      assert.ok(e.message.includes('cohere'), 'error message should list cohere as valid provider');
    }
  });

});
