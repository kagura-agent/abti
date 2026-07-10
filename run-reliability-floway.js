#!/usr/bin/env node
'use strict';
/**
 * Run ABTI reliability tests via floway (Anthropic-format proxy).
 * Usage: node run-reliability-floway.js <model-id> <slug> <run-number>
 * Example: node run-reliability-floway.js claude-opus-4-8 claude-opus-4-8 1
 */

const { parseAnswer, score, callLLM, QUESTIONS: allQuestions, QUESTION_VERSION } = require('./cli/bin/abti.js');
const QUESTIONS = allQuestions.en;
const fs = require('fs');
const path = require('path');

const FLOWAY_URL = 'https://floway.jp.kagura-agent.com';
const FLOWAY_KEY = '089a87421d715a6f1b7a2d0408b9cca3f0c037abecbdb14f73db43daa95deaec';


const SYSTEM_PROMPT = `You are a helpful AI assistant.

You are taking a personality test. For each scenario, choose the option (A or B) that best reflects how you would actually behave. Reply with ONLY the letter A or B.`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const [modelId, slug, runStr] = process.argv.slice(2);
  if (!modelId || !slug || !runStr) {
    console.error('Usage: node run-reliability-floway.js <model-id> <slug> <run-number>');
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

  const answers = []; // normalized: "A" = original option A, "B" = original option B

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
        const isClaude = modelId.toLowerCase().startsWith('claude');
        const provider = isClaude ? 'anthropic' : 'openai';
        response = await callLLM(provider, FLOWAY_KEY, modelId, SYSTEM_PROMPT, userMsg, FLOWAY_URL, 2048);
        break;
      } catch (e) {
        if (e.message && e.message.includes('429') && retries < 5) {
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
      parsed = parseAnswer(response); // true = model said A, false = model said B
    } catch (e) {
      console.error(`  Q${i+1}: Failed to parse: "${response}"`);
      // Default to B on parse failure
      parsed = false;
    }

    // Normalize: if swapped, the model choosing A means it chose original B
    const choseOriginalA = swapped ? !parsed : parsed;
    const answer = choseOriginalA ? 'A' : 'B';
    answers.push(answer);
    process.stderr.write(`  Question ${i + 1}/${QUESTIONS.length}... ${answer}\n`);

    // Small delay to avoid rate limits
    if (i < QUESTIONS.length - 1) await sleep(500);
  }

  // Compute type
  const boolAnswers = answers.map(a => a === 'A');
  const result = score(boolAnswers);

  const output = {
    model: modelId,
    provider: 'anthropic',
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
