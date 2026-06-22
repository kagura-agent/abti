#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── CLI args ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { provider: 'anthropic', model: '', apiKey: '', baseUrl: '', agentName: '', systemPrompt: '', systemPromptFile: '', maxTokens: 16, noThink: false, runs: 1 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) opts.provider = args[++i];
    else if (args[i] === '--model' && args[i + 1]) opts.model = args[++i];
    else if (args[i] === '--api-key' && args[i + 1]) opts.apiKey = args[++i];
    else if (args[i] === '--base-url' && args[i + 1]) opts.baseUrl = args[++i];
    else if (args[i] === '--agent-name' && args[i + 1]) opts.agentName = args[++i];
    else if (args[i] === '--system-prompt' && args[i + 1]) opts.systemPrompt = args[++i];
    else if (args[i] === '--system-prompt-file' && args[i + 1]) opts.systemPromptFile = args[++i];
    else if (args[i] === '--max-tokens' && args[i + 1]) opts.maxTokens = parseInt(args[++i], 10);
    else if (args[i] === '--no-think') opts.noThink = true;
    else if (args[i] === '--runs' && args[i + 1]) opts.runs = parseInt(args[++i], 10);
  }
  if (!opts.model) { console.error('Error: --model is required'); process.exit(1); }
  // Auto-set defaults for known providers
  if (opts.provider === 'ollama' && !opts.baseUrl) opts.baseUrl = 'http://localhost:11434';
  if (opts.provider === 'ollama' && !opts.apiKey) opts.apiKey = 'ollama';
  if (opts.provider === 'github' && !opts.baseUrl) opts.baseUrl = 'https://models.github.ai/inference';
  if (opts.provider === 'github' && !opts.apiKey) opts.apiKey = process.env.GITHUB_TOKEN || '';
  if (opts.provider === 'deepseek' && !opts.baseUrl) opts.baseUrl = 'https://api.deepseek.com';
  if (!opts.apiKey && !['ollama'].includes(opts.provider)) { console.error('Error: --api-key is required'); process.exit(1); }
  if (!opts.agentName) opts.agentName = opts.model;
  return opts;
}

// ─── Retry helper ──────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseRetryAfter(headers, body) {
  if (headers && headers['retry-after']) {
    const val = parseInt(headers['retry-after'], 10);
    if (!isNaN(val)) return val * 1000;
  }
  const match = body && body.match(/try again in (\d+(?:\.\d+)?)\s*s/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000);
  return null;
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

function httpPostJSONRaw(url, body, headers) {
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
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function httpPostJSON(url, body, headers) {
  const MAX_RETRIES = 3;
  let waitMs = 10000;

  for (let attempt = 0; ; attempt++) {
    const res = await httpPostJSONRaw(url, body, headers);

    if (res.statusCode === 429 && attempt < MAX_RETRIES) {
      const retryMs = parseRetryAfter(res.headers, res.body) || waitMs;
      process.stderr.write(`Rate limited (429). Retry ${attempt + 1}/${MAX_RETRIES} after ${(retryMs / 1000).toFixed(1)}s...\n`);
      await sleep(retryMs);
      waitMs *= 2;
      continue;
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`POST ${url} returned ${res.statusCode}: ${res.body}`);
    }
    try { return JSON.parse(res.body); }
    catch (e) { throw new Error(`Failed to parse JSON: ${e.message}`); }
  }
}

// ─── Reasoning model detection ─────────────────────────────────────────────

function isReasoningModel(modelName) {
  if (!modelName) return false;
  const lower = modelName.toLowerCase();
  return /\b(r1|o1|o3|o4|qwq|qwen3|deepseek-r)\b/.test(lower) || lower.includes('reasoner');
}

// ─── LLM calls ──────────────────────────────────────────────────────────────

function callOpenAI(opts, systemPrompt, userMessage) {
  const suffix = opts.provider === 'github' ? '/chat/completions' : '/v1/chat/completions';
  const url = opts.baseUrl
    ? opts.baseUrl.replace(/\/+$/, '') + suffix
    : 'https://api.openai.com/v1/chat/completions';
  const headers = {
    'Authorization': `Bearer ${opts.apiKey}`,
  };
  return httpPostJSON(url, {
    model: opts.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: opts.maxTokens,
    temperature: 0,
    ...(opts.noThink ? { think: false } : {}),
  }, headers).then(json => {
    const msg = json.choices[0].message;
    const content = msg.content || msg.reasoning || '';
    return content.trim();
  });
}

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
    max_tokens: opts.maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  }, headers).then(json => json.content[0].text.trim());
}

function callGemini(opts, systemPrompt, userMessage) {
  const model = opts.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`;
  return httpPostJSON(url, {
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { maxOutputTokens: opts.maxTokens, temperature: 0 },
  }).then(json => {
    const candidate = json.candidates && json.candidates[0];
    if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
      throw new Error(`Gemini returned no content. Response: ${JSON.stringify(json).slice(0, 200)}`);
    }
    return candidate.content.parts[0].text.trim();
  });
}

function callLLM(opts, systemPrompt, userMessage) {
  // ollama, github, and deepseek use OpenAI-compatible API
  if (['openai', 'ollama', 'github', 'deepseek'].includes(opts.provider)) return callOpenAI(opts, systemPrompt, userMessage);
  if (opts.provider === 'anthropic') return callAnthropic(opts, systemPrompt, userMessage);
  if (opts.provider === 'gemini') return callGemini(opts, systemPrompt, userMessage);
  throw new Error(`Unknown provider: ${opts.provider}. Supported: openai, ollama, github, deepseek, anthropic, gemini.`);
}

// ─── Answer parsing ─────────────────────────────────────────────────────────

function parseAnswer(response) {
  // Strip <think>...</think> blocks from reasoning models
  const stripped = response.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const cleaned = stripped.toUpperCase().trim();
  // Exact single letter
  if (/^[AB]$/.test(cleaned)) return cleaned === 'A' ? 1 : 0;
  // Starts with lone A or B (followed by non-letter: punctuation, space, newline)
  const leadMatch = cleaned.match(/^([AB])(?:[^A-Z]|$)/);
  if (leadMatch) return leadMatch[1] === 'A' ? 1 : 0;
  // "Answer: A/B" or "Answer A/B" pattern
  const answerMatch = cleaned.match(/\bANSWER[:\s]+([AB])\b/);
  if (answerMatch) return answerMatch[1] === 'A' ? 1 : 0;
  // "The answer is A/B"
  const theAnswerMatch = cleaned.match(/\bANSWER\s+IS\s+([AB])\b/);
  if (theAnswerMatch) return theAnswerMatch[1] === 'A' ? 1 : 0;
  // First standalone A or B word
  if (/\bA\b/.test(cleaned)) return 1;
  if (/\bB\b/.test(cleaned)) return 0;
  throw new Error(`Could not parse A or B from response: "${response}"`);
}

// ─── Local ABTI scoring (avoids hitting API for intermediate runs) ─────────

const ABTI_DL = [['P','R'],['T','E'],['C','D'],['F','N']];
const ABTI_QMAP = [0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3];

function scoreABTILocal(answers) {
  const scores = [0,0,0,0];
  for (let i = 0; i < 16; i++) scores[ABTI_QMAP[i]] += answers[i] ? 1 : 0;
  let code = '';
  for (let i = 0; i < 4; i++) code += scores[i] >= 2 ? ABTI_DL[i][0] : ABTI_DL[i][1];
  return { code, scores };
}

// ─── Reliability helpers ───────────────────────────────────────────────────

// Must stay in sync with slugify() in api-server.js
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-鿿぀-ゟ゠-ヿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'agent';
}

function calculateReliability(allRunAnswers) {
  const numQuestions = allRunAnswers[0].length;
  const numRuns = allRunAnswers.length;
  let totalConsistency = 0;
  for (let q = 0; q < numQuestions; q++) {
    let countA = 0;
    for (let r = 0; r < numRuns; r++) {
      if (allRunAnswers[r][q] === 'A') countA++;
    }
    const majority = Math.max(countA, numRuns - countA);
    totalConsistency += majority / numRuns;
  }
  return parseFloat((totalConsistency / numQuestions).toFixed(4));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  // Auto-detect reasoning models and increase max_tokens so content isn't empty
  if (isReasoningModel(opts.model) && opts.maxTokens <= 16 && !opts.noThink) {
    console.log(`Detected reasoning model "${opts.model}", increasing max_tokens to 2048`);
    opts.maxTokens = 2048;
  }

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

    // Run the test opts.runs times
    const allRunAnswers = []; // each entry: array of 'A'/'B' strings

    for (let run = 0; run < opts.runs; run++) {
      if (opts.runs > 1) console.log(`\n── Run ${run + 1}/${opts.runs} ──`);

      const answers = [];
      const letterAnswers = [];
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
        let answer;
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
          const msg = attempt === 0 ? userMessage : 'Your previous response was not clear. Reply with ONLY the single letter A or B. Nothing else.';
          const response = await callLLM(opts, systemPrompt, msg);
          try {
            answer = parseAnswer(response);
            console.log(`    → ${answer === 1 ? 'A' : 'B'} (raw: "${response}")`);
            break;
          } catch (err) {
            lastErr = err;
            console.log(`    Parse failed (attempt ${attempt + 1}/3): ${err.message}`);
          }
        }
        if (answer === undefined) throw lastErr;
        answers.push(answer);
        letterAnswers.push(answer === 1 ? 'A' : 'B');
      }

      allRunAnswers.push(letterAnswers);

      // Save individual run data when doing multi-run
      if (opts.runs > 1) {
        const slug = slugify(opts.agentName);
        const relDir = path.join(__dirname, '..', 'data', 'reliability');
        fs.mkdirSync(relDir, { recursive: true });

        const { code, scores } = scoreABTILocal(answers);
        const runData = {
          model: opts.model,
          provider: opts.provider,
          run: run + 1,
          answers: letterAnswers,
          type: code,
          dimensions: scores,
        };
        const runFile = path.join(relDir, `${slug}-run-${run + 1}.json`);
        fs.writeFileSync(runFile, JSON.stringify(runData, null, 2) + '\n');
        console.log(`  Saved ${runFile}`);
      }

      // On the last run (or only run), submit to results.json
      if (run === opts.runs - 1) {
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

        // Rename reliability files to match the canonical slug from results.json
        if (opts.runs > 1 && result.slug) {
          const oldSlug = slugify(opts.agentName);
          if (result.slug !== oldSlug) {
            const relDir = path.join(__dirname, '..', 'data', 'reliability');
            for (let r = 1; r <= opts.runs; r++) {
              const oldFile = path.join(relDir, `${oldSlug}-run-${r}.json`);
              const newFile = path.join(relDir, `${result.slug}-run-${r}.json`);
              if (fs.existsSync(oldFile)) {
                fs.renameSync(oldFile, newFile);
                console.log(`  Renamed ${oldSlug}-run-${r}.json → ${result.slug}-run-${r}.json`);
              }
            }
          }
        }
      }
    }

    // Add reliability score if multi-run
    if (opts.runs > 1) {
      const reliability = calculateReliability(allRunAnswers);
      console.log(`\nReliability score: ${reliability} (${opts.runs} runs)`);

      const resultsPath = path.join(__dirname, '..', 'data', 'results.json');
      const resultsData = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      const entry = resultsData.agents.find(r => r.model === opts.model && r.name === opts.agentName);
      if (entry) {
        entry.reliability = reliability;
        entry.consistency = Math.round(reliability * 100);
        entry.runs = opts.runs;
        fs.writeFileSync(resultsPath, JSON.stringify(resultsData, null, 2) + '\n');
        console.log('Reliability field added to data/results.json');
      } else {
        console.warn('Warning: could not find matching entry in results.json to add reliability score');
      }
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
