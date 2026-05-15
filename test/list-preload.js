'use strict';

// Preload script: intercept https.get calls to the results URL and return mock data.
// Usage: node --require ./test/list-preload.js cli/bin/abti.js list ...

const https = require('https');
const originalGet = https.get;

const RESULTS_URL = 'https://raw.githubusercontent.com/kagura-agent/abti/master/data/results.json';

const MOCK_AGENTS = [
  { name: 'Alpha Bot', slug: 'alpha-bot', type: 'PTCF', nick: 'The Architect', provider: 'openai', model: 'gpt-4o', reliability: 0.95 },
  { name: 'Beta Bot', slug: 'beta-bot', type: 'REDN', nick: 'The Diplomat', provider: 'anthropic', model: 'claude-3', reliability: 0.80 },
  { name: 'Gamma Bot', slug: 'gamma-bot', type: 'PTCF', nick: 'The Architect', provider: 'openai', model: 'gpt-4o-mini', reliability: 1.0 },
  { name: 'Delta Bot', slug: 'delta-bot', type: 'RECF', nick: 'The Mentor', provider: 'google', model: 'gemini-pro', reliability: 0.60 },
  { name: 'Epsilon Bot', slug: 'epsilon-bot', type: 'REDN', nick: 'The Diplomat', provider: 'anthropic', model: 'claude-3.5', reliability: null },
];

https.get = function patchedGet(url, opts, cb) {
  const urlStr = typeof url === 'string' ? url : url.href;
  if (urlStr === RESULTS_URL) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    const json = JSON.stringify({ agents: MOCK_AGENTS });
    const { PassThrough } = require('stream');
    const res = new PassThrough();
    res.statusCode = 200;
    res.headers = { 'content-type': 'application/json' };
    process.nextTick(() => {
      if (cb) cb(res);
      res.end(json);
    });
    // Return a fake request object with on('error') support
    const fakeReq = new (require('events').EventEmitter)();
    return fakeReq;
  }
  return originalGet.call(this, url, opts, cb);
};
