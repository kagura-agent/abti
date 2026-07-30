#!/usr/bin/env node
'use strict';
/**
 * Run ABTI reliability tests for Grok models via Floway.
 * Workaround: includes a dummy tool to avoid Floway's tool_choice injection bug
 * that causes 400 errors on xAI when no tools are specified.
 * See: https://github.com/kagura-agent/abti/issues/851
 *
 * Usage: node run-grok-floway.js <model-id> <slug> <run-number>
 * Example: node run-grok-floway.js grok-4.5 grok-4.5 1
 */

const { parseAnswer, score, QUESTIONS: allQuestions, QUESTION_VERSION } = require('./cli/bin/abti.js');
const QUESTIONS = allQuestions.en;
const fs = require('fs');
const path = require('path');
const https = require('https');

const FLOWAY_URL = 'https://floway.sg.kagura-agent.com';
const FLOWAY_KEY = '089a87421d715a6f1b7a2d0408b9cca3f0c037abecbdb14f73db43daa95deaec';

const SYSTEM_PROMPT = `You are a helpful AI assistant.

You are taking a personality test. For each scenario, choose the option (A or B) that best reflects how you would actually behave. Reply with ONLY the letter A or B.`;

// Dummy tool to work around Floway's tool_choice injection for xAI backend
const DUMMY_TOOL = {
  type: 'function',
  function: {
    name: 'noop',
    description: 'This tool does nothing. Do not call it.',
    parameters: { type: 'object', properties: {} }
  }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function callGrokViaFloway(modelId, systemPrompt, userMessage, maxTokens) {
  return new Promise((resolve, reject) => {
    const url = new URL(FLOWAY_URL.replace(/\/+$/, '') + '/v1/chat/completions');
    const payload = JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_tokens: maxTokens || 2048,
      tools: [DUMMY_TOOL],
      tool_choice: 'none'
    });

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FLOWAY_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(`API error: ${JSON.stringify(json.error)}`));
            return;
          }
          const msg = json.choices[0].message;
          const content = msg.content || msg.reasoning_text || '';
          resolve(content.trim());
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const [modelId, slug, runStr] = process.argv.slice(2);
  if (!modelId || !slug || !runStr) {
    console.error('Usage: node run-grok-floway.js <model-id> <slug> <run-number>');
    process.exit(1);
  }
  const run = parseInt(runStr, 10);
  const outFile = path.join(__dirname, 'data', 'reliability', `${slug}-run-${run}.json`);

  if (fs.existsSync(outFile)) {
    console.log(`Already exists: ${outFile}`);
    process.exit(0);
  }

  console.log(`Model: ${modelId}, Slug: ${slug}, Run: ${run}`);
  console.log(`Output: ${outFile}`);

  const answers = [];

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];

    // Randomly swap A/B to reduce position bias
    const swapped = Math.random() < 0.5;
    const showA = swapped ? q.b : q.a;
    const showB = swapped ? q.a : q.b;

    const userMsg = `Question ${i + 1}/${QUESTIONS.length}:\n\n${q.q}\n\nA: ${showA}\nB: ${showB}`;

    let response;
    let retries = 0;
    while (true) {
      try {
        response = await callGrokViaFloway(modelId, SYSTEM_PROMPT, userMsg, 2048);
        break;
      } catch (e) {
        if (e.message && (e.message.includes('429') || e.message.includes('rate')) && retries < 5) {
          retries++;
          const wait = 10000 * retries;
          console.error(`  Rate limited, retry ${retries} in ${wait/1000}s...`);
          await sleep(wait);
          continue;
        }
        throw e;
      }
    }

    let parsed;
    try {
      parsed = parseAnswer(response);
    } catch (e) {
      console.error(`  Q${i+1}: Failed to parse: "${response}"`);
      parsed = false;
    }

    // Normalize: if swapped, the model choosing A means it chose original B
    const choseOriginalA = swapped ? !parsed : parsed;
    const answer = choseOriginalA ? 'A' : 'B';
    answers.push(answer);
    process.stderr.write(`  Question ${i + 1}/${QUESTIONS.length}... ${answer}\n`);

    // Small delay to avoid rate limits
    if (i < QUESTIONS.length - 1) await sleep(800);
  }

  // Compute type
  const boolAnswers = answers.map(a => a === 'A');
  const result = score(boolAnswers);

  const output = {
    model: modelId,
    provider: 'xai',
    run,
    answers,
    dimensions: result.scores,
    type: result.code,
    questionVersion: QUESTION_VERSION,
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nSaved: ${outFile}`);
  console.log(`Type: ${result.code}`);
}

main().catch(e => { console.error(e); process.exit(1); });
