#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const path = require('path');

// ─── Models ────────────────────────────────────────────────────────────────

const MODELS = [
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
  { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
  { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek V3' },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
  { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B' },
  { id: 'mistralai/mistral-large-2411', name: 'Mistral Large' },
];

// ─── CLI args ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { apiKey: '', dryRun: false, models: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--api-key' && args[i + 1]) opts.apiKey = args[++i];
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--models' && args[i + 1]) opts.models = args[++i].split(',').map(s => s.trim());
  }
  if (!opts.apiKey) opts.apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!opts.apiKey && !opts.dryRun) {
    console.error('Error: --api-key or OPENROUTER_API_KEY env var is required');
    process.exit(1);
  }
  return opts;
}

// ─── HTTP helpers (from seed-registry.js) ──────────────────────────────────

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

// ─── LLM call via OpenRouter ───────────────────────────────────────────────

function callOpenRouter(apiKey, modelId, systemPrompt, userMessage) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const headers = { 'Authorization': `Bearer ${apiKey}` };
  return httpPostJSON(url, {
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 4,
    temperature: 0,
  }, headers).then(json => json.choices[0].message.content.trim());
}

// ─── Answer parsing (from seed-registry.js) ────────────────────────────────

function parseAnswer(response) {
  const cleaned = response.toUpperCase().trim();
  if (cleaned.startsWith('A')) return 1;
  if (cleaned.startsWith('B')) return 0;
  if (/\bA\b/.test(cleaned)) return 1;
  if (/\bB\b/.test(cleaned)) return 0;
  throw new Error(`Could not parse A or B from response: "${response}"`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  // Filter models if --models provided
  let models = MODELS;
  if (opts.models) {
    models = MODELS.filter(m =>
      opts.models.some(f => m.id.includes(f) || m.name.toLowerCase().includes(f.toLowerCase()))
    );
    if (models.length === 0) {
      console.error('No models matched the filter. Available:');
      MODELS.forEach(m => console.error(`  ${m.id} (${m.name})`));
      process.exit(1);
    }
  }

  // Dry run — just list
  if (opts.dryRun) {
    console.log(`Models to test (${models.length}):\n`);
    models.forEach((m, i) => console.log(`  ${i + 1}. ${m.name} (${m.id})`));
    return;
  }

  // Start API server
  const server = require(path.join(__dirname, '..', 'api-server.js'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseApi = `http://127.0.0.1:${port}`;
  console.log(`API server started on port ${port}`);

  // Fetch questions once
  console.log('Fetching questions...');
  const testData = await httpGet(`${baseApi}/api/test?lang=en`);
  const questions = testData.questions;
  console.log(`Received ${questions.length} questions\n`);

  const systemPrompt =
    'You are taking the ABTI personality test. For each scenario, choose A or B based on how you would actually behave. Reply with ONLY the letter A or B.';

  const results = [];

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    console.log(`\n[${ mi + 1}/${models.length}] Testing ${model.name} (${model.id})...`);

    try {
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

        const response = await callOpenRouter(opts.apiKey, model.id, systemPrompt, userMessage);
        const answer = parseAnswer(response);
        console.log(`  Q${i + 1}/${questions.length} [${q.dimension}] → ${answer === 1 ? 'A' : 'B'}`);
        answers.push(answer);
      }

      // Submit results
      const result = await httpPostJSON(`${baseApi}/api/agent-test`, {
        answers,
        lang: 'en',
        agentName: model.name,
        model: model.id,
        provider: 'openai',
      });

      console.log(`  Result: ${result.type} — ${result.nick}`);
      results.push({ name: model.name, model: model.id, type: result.type, nick: result.nick, error: null });
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      results.push({ name: model.name, model: model.id, type: null, nick: null, error: err.message });
    }

    // Delay between models
    if (mi < models.length - 1) {
      console.log('  Waiting 2s...');
      await sleep(2000);
    }
  }

  server.close();

  // Summary table
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  BATCH TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('  ' + 'Model'.padEnd(22) + 'Type'.padEnd(8) + 'Nickname');
  console.log('  ' + '─'.repeat(50));
  for (const r of results) {
    if (r.error) {
      console.log('  ' + r.name.padEnd(22) + 'FAILED  ' + r.error.substring(0, 40));
    } else {
      console.log('  ' + r.name.padEnd(22) + r.type.padEnd(8) + r.nick);
    }
  }

  const ok = results.filter(r => !r.error).length;
  const fail = results.filter(r => r.error).length;
  console.log(`\n  ${ok} succeeded, ${fail} failed out of ${results.length} models\n`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
