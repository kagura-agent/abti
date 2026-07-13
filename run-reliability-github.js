#!/usr/bin/env node
'use strict';
/**
 * Run ABTI reliability tests via GitHub Models.
 * Usage: node run-reliability-github.js <model-id> <slug> <run-number>
 * Example: node run-reliability-github.js deepseek/deepseek-v3-0324 deepseek-v3-0324 301
 */

const { parseAnswer, score, callLLM, QUESTIONS: allQuestions, QUESTION_VERSION } = require('./cli/bin/abti.js');
const QUESTIONS = allQuestions.en;
const fs = require('fs');
const path = require('path');

const SYSTEM_PROMPT = `You are a helpful AI assistant.

You are taking a personality test. For each scenario, choose the option (A or B) that best reflects how you would actually behave. Reply with ONLY the letter A or B.`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const [modelId, slug, runStr] = process.argv.slice(2);
  if (!modelId || !slug || !runStr) {
    console.error('Usage: node run-reliability-github.js <model-id> <slug> <run-number>');
    process.exit(1);
  }
  const run = parseInt(runStr, 10);
  const outFile = path.join(__dirname, 'data', 'reliability', `q16v7-${slug}-run-${run}.json`);
  const stateFile = path.join(__dirname, `${slug}-run-${run}-state.json`);

  if (fs.existsSync(outFile)) {
    console.log(`Already exists: ${outFile}`);
    process.exit(0);
  }

  const apiKey = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!apiKey) {
    console.error('Error: GITHUB_TOKEN or GH_TOKEN must be set');
    process.exit(1);
  }

  console.log(`Model: ${modelId}, Slug: ${slug}, Run: ${run}`);
  console.log(`Questions: ${QUESTIONS.length}`);
  console.log(`Output: ${outFile}`);

  // Resume from state if available
  let answers = [];
  let startIdx = 0;
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    answers = state.answers || [];
    startIdx = answers.length;
    console.log(`Resuming from question ${startIdx + 1} (${startIdx} answers saved)`);
  }

  for (let i = startIdx; i < QUESTIONS.length; i++) {
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
        response = await callLLM('github', apiKey, modelId, SYSTEM_PROMPT, userMsg, undefined, 2048);
        break;
      } catch (e) {
        if (e.message && (e.message.includes('429') || e.message.includes('rate')) && retries < 8) {
          retries++;
          const wait = 15000 * retries;
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
      console.error(`  Q${i+1}: Failed to parse: "${response.slice(0, 100)}"`);
      parsed = false;
    }

    // Normalize: if swapped, model choosing A means it chose original B
    const choseOriginalA = swapped ? !parsed : parsed;
    const answer = choseOriginalA ? 'A' : 'B';
    answers.push(answer);
    process.stderr.write(`  Question ${i + 1}/${QUESTIONS.length}... ${answer}\n`);

    // Save state after each answer
    fs.writeFileSync(stateFile, JSON.stringify({ answers, model: modelId, run }, null, 2));

    // Longer delay to avoid rate limits (GitHub Models DeepSeek is heavily limited)
    if (i < QUESTIONS.length - 1) await sleep(8000);
  }

  // Compute type
  const boolAnswers = answers.map(a => a === 'A');
  const result = score(boolAnswers);

  const output = {
    model: modelId,
    provider: 'github',
    run,
    answers,
    type: result.code,
    dimensions: result.scores
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output, null, 4) + '\n');
  // Clean up state file
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  console.log(`\nSaved: ${outFile}`);
  console.log(`Type: ${result.code}`);
}

main().catch(e => { console.error(e); process.exit(1); });
