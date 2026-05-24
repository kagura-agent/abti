const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function startServer() {
  return new Promise((resolve) => {
    delete require.cache[require.resolve('../api-server.js')];
    const serverModule = require('../api-server.js');
    const server = serverModule.server || serverModule;
    if (server.listening) return resolve(server);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

describe('dynamic OpenRouter models', () => {
  let server;
  let base;

  it('test-agent.html contains dynamicModels flag for openrouter', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'test-agent.html'), 'utf8');
    assert.ok(html.includes('dynamicModels: true'), 'openrouter should have dynamicModels flag');
    assert.ok(html.includes('fetchOpenRouterModels'), 'should have fetchOpenRouterModels function');
    assert.ok(html.includes('dynamicModelCache'), 'should have dynamicModelCache');
    assert.ok(html.includes('sessionStorage'), 'should cache in sessionStorage');
  });

  it('test-agent.html still has static fallback models for openrouter', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'test-agent.html'), 'utf8');
    assert.ok(html.includes("'openai/gpt-oss-120b:free'"), 'should have fallback models');
    assert.ok(html.includes("'custom'"), 'should have custom option');
  });

  it('fetchOpenRouterModels filters to :free models', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'test-agent.html'), 'utf8');
    assert.ok(html.includes("m.id.endsWith(':free')"), 'should filter by :free suffix');
  });
});
