#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── CLI args ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { provider: 'anthropic', model: '', apiKey: '', baseUrl: '', agentName: '', systemPrompt: '', systemPromptFile: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) opts.provider = args[++i];
    else if (args[i] === '--model' && args[i + 1]) opts.model = args[++i];
    else if (args[i] === '--api-key' && args[i + 1]) opts.apiKey = args[++i];
    else if (args[i] === '--base-url' && args[i + 1]) opts.baseUrl = args[++i];
    else if (args[i] === '--agent-name' && args[i + 1]) opts.agentName = args[++i];
    else if (args[i] === '--system-prompt' && args[i + 1]) opts.systemPrompt = args[++i];
    else if (args[i] === '--system-prompt-file' && args[i + 1]) opts.systemPromptFile = args[++i];
  }
  if (!opts.model) { console.error('Error: --model is required'); process.exit(1); }
  if (!opts.apiKey) { console.error('Error: --api-key is required'); process.exit(1); }
  if (!opts.agentName) opts.agentName = opts.model;
  return opts;
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300)
          return reject(new Error(`GET ${url} returned ${res.statusCode}: ${data}`));
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse JSON: ${e.message}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function httpPostJSON(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqHeaders = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      ...headers,
    };
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: reqHeaders,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300)
          return reject(new Error(`POST ${url} returned ${res.statusCode}: ${data}`));
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse JSON: ${e.message}`)); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── LLM call ───────────────────────────────────────────────────────────────

function callAnthropic(opts, systemPrompt, userMessage) {
  const url = opts.baseUrl
    ? opts.baseUrl.replace(/\/+$/, '') + '/v1/messages'
    : 'https://api.anthropic.com/v1/messages';
  const headers = {
    'x-api-key': opts.apiKey,
    'anthropic-version': '2023-06-01',
  };
  return httpPostJSON(url, {
    model: opts.model,
    max_tokens: 4,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  }, headers).then(json => json.content[0].text.trim());
}

// ─── Answer parsing ─────────────────────────────────────────────────────────

function parseAnswer(response) {
  const cleaned = response.toUpperCase().trim();
  if (cleaned.startsWith('A')) return 1;
  if (cleaned.startsWith('B')) return 0;
  if (/\bA\b/.test(cleaned)) return 1;
  if (/\bB\b/.test(cleaned)) return 0;
  throw new Error(`Could not parse A or B from response: "${response}"`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  // Start API server on a random port
  const server = require(path.join(__dirname, '..', 'api-server.js'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseApi = `http://127.0.0.1:${port}`;
  console.log(`API server started on port ${port}`);

  try {
    // Fetch questions
    console.log('Fetching questions...');
    const testData = await httpGet(`${baseApi}/api/test?lang=en`);
    const questions = testData.questions;
    console.log(`Received ${questions.length} questions`);

    // Build system prompt: --system-prompt-file > --system-prompt > agent name
    let prefix;
    if (opts.systemPromptFile) {
      prefix = fs.readFileSync(opts.systemPromptFile, 'utf8');
    } else if (opts.systemPrompt) {
      prefix = opts.systemPrompt;
    } else {
      prefix = opts.agentName;
    }
    const systemPrompt = prefix +
      '\nYou are taking the ABTI personality test. For each scenario, choose A or B based on how you would actually behave. Reply with ONLY the letter A or B.';

    // Ask each question
    const answers = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const userMessage = [
        `Question ${i + 1}/${questions.length} (${q.dimension}):`,
        '',
        q.text,
        '',
        `A: ${q.options.A}`,
        `B: ${q.options.B}`,
      ].join('\n');

      console.log(`  Q${i + 1}/${questions.length} [${q.dimension}]...`);
      const response = await callAnthropic(opts, systemPrompt, userMessage);
      const answer = parseAnswer(response);
      console.log(`    → ${answer === 1 ? 'A' : 'B'} (raw: "${response}")`);
      answers.push(answer);
    }

    // Submit results
    console.log('Submitting results...');
    const result = await httpPostJSON(`${baseApi}/api/agent-test`, {
      answers,
      lang: 'en',
      agentName: opts.agentName,
      model: opts.model,
      provider: opts.provider,
    });

    console.log(`\nResult: ${result.type} — ${result.nick}`);
    console.log('Dimensions:');
    for (const [dim, d] of Object.entries(result.dimensions)) {
      console.log(`  ${dim}: ${d.score}/${d.max} → ${d.pole} (${d.letter})`);
    }
    console.log('\nDone! Result saved to data/results.json');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
