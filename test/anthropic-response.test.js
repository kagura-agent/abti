const { describe, it } = require('node:test');
const assert = require('node:assert');

// Extract the parsing logic to test it directly
const parseAnthropicContent = (json) =>
  ((json.content.find(b => b.type === 'text') || json.content[0]).text).trim();

describe('Anthropic response parsing', () => {
  it('should extract text from a simple response (no type field)', () => {
    const json = { content: [{ text: ' A ' }] };
    assert.strictEqual(parseAnthropicContent(json), 'A');
  });

  it('should extract text from a typed text block', () => {
    const json = { content: [{ type: 'text', text: 'B' }] };
    assert.strictEqual(parseAnthropicContent(json), 'B');
  });

  it('should skip thinking block and return text block', () => {
    const json = {
      content: [
        { type: 'thinking', thinking: 'Let me reason about this...' },
        { type: 'text', text: 'A' }
      ]
    };
    assert.strictEqual(parseAnthropicContent(json), 'A');
  });

  it('should handle multiple thinking blocks before text', () => {
    const json = {
      content: [
        { type: 'thinking', thinking: 'First thought...' },
        { type: 'thinking', thinking: 'Second thought...' },
        { type: 'text', text: ' B ' }
      ]
    };
    assert.strictEqual(parseAnthropicContent(json), 'B');
  });

  it('should fallback to content[0] when no type field matches', () => {
    const json = { content: [{ type: 'unknown', text: 'A' }] };
    assert.strictEqual(parseAnthropicContent(json), 'A');
  });
});
