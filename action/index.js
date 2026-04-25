const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ─── GitHub Actions helpers (no @actions/core dependency) ────────────────────

/**
 * Get an action input from environment. GitHub Actions sets INPUT_<NAME> env vars.
 */
function getInput(name, required = false) {
  const val = process.env[`INPUT_${name.replace(/-/g, '_').toUpperCase()}`] || '';
  if (required && !val) {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return val;
}

/**
 * Set an action output. Appends to GITHUB_OUTPUT file.
 */
function setOutput(name, value) {
  const filePath = process.env.GITHUB_OUTPUT;
  if (filePath) {
    fs.appendFileSync(filePath, `${name}=${value}\n`);
  }
}

/**
 * Write a job summary. Appends to GITHUB_STEP_SUMMARY file.
 */
function writeSummary(markdown) {
  const filePath = process.env.GITHUB_STEP_SUMMARY;
  if (filePath) {
    fs.appendFileSync(filePath, markdown + '\n');
  }
}

/** Log helpers matching GitHub Actions command syntax. */
function info(msg) { console.log(msg); }
function warning(msg) { console.log(`::warning::${msg}`); }
function setFailed(msg) { console.log(`::error::${msg}`); process.exitCode = 1; }

// ─── HTTP helpers ────────────────────────────────────────────────────────────

/**
 * Make an HTTPS GET request returning parsed JSON.
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`GET ${url} returned ${res.statusCode}: ${data}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Make an HTTPS POST request with a JSON body, returning parsed JSON.
 */
function httpPostJSON(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`POST ${url} returned ${res.statusCode}: ${data}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`)); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── LLM providers ──────────────────────────────────────────────────────────

/**
 * Call OpenAI chat completions API.
 */
function callOpenAI(apiKey, model, systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4,
      temperature: 0,
    });
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`OpenAI API returned ${res.statusCode}: ${data}`));
        }
        try {
          const json = JSON.parse(data);
          resolve(json.choices[0].message.content.trim());
        } catch (e) {
          reject(new Error(`Failed to parse OpenAI response: ${e.message}`));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Call Anthropic messages API.
 */
function callAnthropic(apiKey, model, systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      max_tokens: 4,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userMessage },
      ],
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Anthropic API returned ${res.statusCode}: ${data}`));
        }
        try {
          const json = JSON.parse(data);
          resolve(json.content[0].text.trim());
        } catch (e) {
          reject(new Error(`Failed to parse Anthropic response: ${e.message}`));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Route to the correct LLM provider.
 */
function callLLM(provider, apiKey, model, systemPrompt, userMessage) {
  if (provider === 'openai') return callOpenAI(apiKey, model, systemPrompt, userMessage);
  if (provider === 'anthropic') return callAnthropic(apiKey, model, systemPrompt, userMessage);
  throw new Error(`Unknown provider: ${provider}. Must be "openai" or "anthropic".`);
}

// ─── Answer parsing ──────────────────────────────────────────────────────────

/**
 * Extract A or B from an LLM response. Returns 1 for A, 0 for B.
 */
function parseAnswer(response) {
  const cleaned = response.toUpperCase().trim();
  if (cleaned.startsWith('A')) return 1;
  if (cleaned.startsWith('B')) return 0;
  if (/\bA\b/.test(cleaned)) return 1;
  if (/\bB\b/.test(cleaned)) return 0;
  throw new Error(`Could not parse A or B from LLM response: "${response}"`);
}

// ─── PR comment via GitHub API ───────────────────────────────────────────────

/**
 * Make a GitHub API request using the native https module.
 */
function githubAPI(method, apiPath, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const headers = {
      'User-Agent': 'abti-action',
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${token}`,
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`GitHub API ${method} ${apiPath} returned ${res.statusCode}: ${data}`));
        }
        try { resolve(data ? JSON.parse(data) : null); }
        catch (e) { reject(new Error(`Failed to parse GitHub API response: ${e.message}`)); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body) req.write(payload);
    req.end();
  });
}

/**
 * Post or update a PR comment with ABTI results.
 */
async function postPRComment(result, badgeUrl) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    warning('GITHUB_TOKEN not available, skipping PR comment');
    return;
  }

  // Parse event payload to find PR number
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    info('No GITHUB_EVENT_PATH, skipping PR comment');
    return;
  }
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
  const prNumber = event.pull_request && event.pull_request.number;
  if (!prNumber) {
    info('Not a PR context, skipping comment');
    return;
  }

  const repo = process.env.GITHUB_REPOSITORY; // owner/repo
  const marker = '<!-- abti-result -->';

  const body = [
    marker,
    `## 🌸 ABTI Result: ${result.type} — ${result.nick}`,
    '',
    `[![ABTI: ${result.type}](${badgeUrl})](https://abti.kagura-agent.com)`,
    '',
    '| Dimension | Score | Pole |',
    '|-----------|-------|------|',
    ...Object.entries(result.dimensions).map(
      ([dim, d]) => `| ${dim} | ${d.score}/${d.max} | ${d.pole} (${d.letter}) |`
    ),
    '',
    `> ${result.workStyle}`,
  ].join('\n');

  // Check for existing comment to update
  const comments = await githubAPI('GET', `/repos/${repo}/issues/${prNumber}/comments`, token);
  const existing = comments.find((c) => c.body && c.body.includes(marker));

  if (existing) {
    await githubAPI('PATCH', `/repos/${repo}/issues/comments/${existing.id}`, token, { body });
    info(`Updated existing PR comment #${existing.id}`);
  } else {
    await githubAPI('POST', `/repos/${repo}/issues/${prNumber}/comments`, token, { body });
    info('Posted new PR comment');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  const agentPrompt = getInput('agent-prompt');
  const agentPromptFile = getInput('agent-prompt-file');
  const provider = getInput('provider', true);
  const model = getInput('model', true);
  const apiKey = getInput('api-key', true);
  const postCommentFlag = getInput('post-comment') === 'true';
  const apiBaseUrl = getInput('api-base-url') || 'https://abti.kagura-agent.com';
  const lang = getInput('lang') || 'en';

  // Resolve agent system prompt
  let basePrompt = '';
  if (agentPromptFile) {
    info(`Reading agent prompt from file: ${agentPromptFile}`);
    basePrompt = fs.readFileSync(agentPromptFile, 'utf-8');
  }
  if (agentPrompt) {
    basePrompt = agentPrompt;
  }
  if (!basePrompt) {
    basePrompt = 'You are a helpful AI assistant.';
  }

  const systemPrompt = basePrompt + '\n\n' +
    'You are taking a personality test. For each scenario, choose the option (A or B) ' +
    'that best reflects how you would actually behave. Reply with ONLY the letter A or B.';

  // 1. Fetch questions
  info('Fetching ABTI questions...');
  const testData = await httpGet(`${apiBaseUrl}/api/test?lang=${lang}`);
  const questions = testData.questions;
  info(`Received ${questions.length} questions`);

  // 2. Present each question to the LLM and collect answers
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

    info(`Question ${i + 1}/${questions.length}: ${q.dimension}`);
    const response = await callLLM(provider, apiKey, model, systemPrompt, userMessage);
    const answer = parseAnswer(response);
    info(`  Answer: ${answer === 1 ? 'A' : 'B'} (raw: "${response}")`);
    answers.push(answer);
  }

  // 3. Submit answers
  info('Submitting answers...');
  const result = await httpPostJSON(`${apiBaseUrl}/api/agent-test`, { answers, lang });
  info(`Result: ${result.type} — ${result.nick}`);

  // 4. Set outputs
  const badgeUrl = `${apiBaseUrl}/badge/${result.type}`;
  setOutput('type', result.type);
  setOutput('nickname', result.nick);
  setOutput('badge-url', badgeUrl);

  // 5. Write job summary
  const summary = [
    `## 🌸 ABTI Result: ${result.type} — ${result.nick}`,
    '',
    `[![ABTI: ${result.type}](${badgeUrl})](https://abti.kagura-agent.com)`,
    '',
    `**Model:** \`${model}\` (${provider})`,
    '',
    '### Dimensions',
    '',
    '| Dimension | Score | Pole |',
    '|-----------|-------|------|',
    ...Object.entries(result.dimensions).map(
      ([dim, d]) => `| ${dim} | ${d.score}/${d.max} | ${d.pole} (${d.letter}) |`
    ),
    '',
    '### Work Style',
    '',
    result.workStyle,
    '',
    '### Strengths',
    '',
    ...result.strengths.map((s) => `- ${s}`),
    '',
    '### Blind Spots',
    '',
    ...result.blindSpots.map((s) => `- ${s}`),
  ].join('\n');

  writeSummary(summary);
  info('Job summary written');

  // 6. Optionally post PR comment
  if (postCommentFlag) {
    await postPRComment(result, badgeUrl);
  }
}

run().catch((error) => {
  setFailed(error.message);
});
