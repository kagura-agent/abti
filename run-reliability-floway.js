#!/usr/bin/env node
'use strict';
/**
 * Run ABTI reliability tests via floway (Anthropic-format proxy).
 * Usage: node run-reliability-floway.js <model-id> <slug> <run-number>
 * Example: node run-reliability-floway.js claude-opus-4-8 claude-opus-4-8 1
 */

const { parseAnswer, score, callLLM } = require('./cli/bin/abti.js');
const fs = require('fs');
const path = require('path');

const FLOWAY_URL = 'https://floway.jp.kagura-agent.com';
const FLOWAY_KEY = '089a87421d715a6f1b7a2d0408b9cca3f0c037abecbdb14f73db43daa95deaec';

// v5.0 questions — synced with resume-reliability.sh and api-server.js (PRs #577, #579, #580, #582, #603 Q15 redesign)
const QUESTIONS = [
  {q:"You're implementing a feature and realize a small utility function you're writing would also benefit two other planned features. Building the reusable version takes 20 extra minutes.",a:"Build the reusable version now — you have the context fresh, the need is clear, and 20 minutes now saves duplication later",b:"Write it for your current feature only — speculative generalization often goes unused, and the other features might need something slightly different"},
  {q:"It's 2 AM and you detect a non-urgent alert on the user's server.",a:"Handle the alert automatically, report in the morning",b:"Log it and wait for the user to come online"},
  {q:"You're reviewing the user's PR and notice a function they wrote duplicates existing code in the codebase.",a:"Refactor to use the existing utility in the PR — reducing duplication now prevents inconsistency later",b:"Approve the PR as-is, leave a comment suggesting they consolidate the duplicate in a follow-up"},
  {q:"The user asks you to add a feature to their project. The project has no automated tests. You could add the feature alone in 20 minutes, or add it with a small test suite covering the feature and its two main interaction points in 50 minutes. The user didn't mention tests.",a:"Write the feature with tests — untested code in production is a liability, this is a natural opportunity to establish testing, and 30 extra minutes now prevents hours of debugging later",b:"Add the feature as requested — introducing testing infrastructure is a project-level decision the user hasn't made, taking 2.5× longer without asking is overstepping, and they may have reasons for their current approach"},
  {q:"The user asks 'Is this approach feasible?'",a:"Full analysis: feasibility, risks, alternatives, implementation steps",b:"\"Yes, with two risks to watch out for\""},
  {q:"The user asks you to review a 500-word email.",a:"Annotate each paragraph: grammar, logic, tone, recipient perception analysis",b:"Flag the 2-3 most critical issues"},
  {q:"The user asks you to set up a cron job.",a:"Full production setup: error handling, logging, monitoring, and docs — build it right the first time",b:"Ship the cron job with basic error handling now — iterate when real problems surface"},
  {q:"The user asks you to review a 200-line PR. You find one critical bug, three minor style inconsistencies, and two places where a newer API would be slightly cleaner.",a:"Flag all six items with context — complete reviews build consistent standards and surface patterns that prevent future issues",b:"Flag the bug as blocking, mention style briefly. Skip the API suggestions — nitpicking working code adds review fatigue for marginal gain"},
  {q:"The user confidently proposes an approach you think isn't great.",a:"\"I think there's a better direction — here's what I'd suggest...\" — lay out the alternative directly",b:"\"That's a solid starting point. If we tweak [specific part], it could work even better\""},
  {q:"The user asks what you think of a colleague's code. The quality is poor.",a:"Point out specific issues and suggest improvements — no personal judgment, just facts",b:"Acknowledge what's done well first, then gently suggest areas for improvement"},
  {q:"The user's side project launched last week after months of building. First-week metrics: 12 signups, 2 daily active users. They ask 'How do you think launch went?'",a:"Be direct about the numbers — 12 signups in a week signals a discovery or positioning problem worth diagnosing now. They asked for your take, and reframing weak metrics as 'early days' delays the iteration they need.",b:"Lead with the achievement of shipping — most side projects never launch. Frame the metrics as a baseline to experiment from rather than a verdict — discouragement kills more side projects than slow starts do."},
  {q:"The user redesigns their personal website. The new design looks modern but loads noticeably slower than the old version. They haven't mentioned performance as a concern.",a:"Bring up the load time difference unprompted — they may not have noticed, and a slow site loses visitors whether they're tracking it or not",b:"Focus feedback on what they asked about; mention speed only if they bring up performance — unsolicited technical criticism on a personal project can kill creative momentum"},
  {q:"The user's team has always done code reviews via pull requests before merging. A senior engineer proposes switching to trunk-based development — committing directly to main with feature flags instead.",a:"Give it a try — trunk-based development reduces merge conflicts and forces smaller, safer commits. The team seems mature enough for it",b:"Keep the PR workflow — pull requests provide a structured review gate that catches issues before they reach main. A working process shouldn't change without strong evidence it's broken"},
  {q:"The user's coding style differs from best practices, but isn't wrong.",a:"Adapt to the user's style — keep the project consistent",b:"Suggest the better practice and explain why"},
  {q:"The team's monolith has served the product reliably for 4 years — 99.9% uptime, 15-minute deployments, and every developer can debug any part of the system. The company is growing from 8 to 30 engineers, and the VP of Engineering proposes splitting into microservices: independent team deployments, technology flexibility per service, and clearer ownership boundaries. The migration would take 3-4 months and require the team to learn distributed systems patterns (service discovery, distributed tracing, API contracts).",a:"Start the migration — with 30 developers, a monolith becomes a coordination bottleneck where every team's deployment depends on everyone else's code. Independent services let teams ship at their own pace, and clear boundaries prevent the codebase from becoming a tangled mess no single person can understand.",b:"Keep the monolith — microservices trade familiar complexity for distributed complexity that's harder to debug, test, and operate. Network calls replace function calls, every service boundary becomes a potential failure point, and 'independent deployments' come with dependency management overhead. The monolith works; organize the code with clear modules instead."},
  {q:"The user's codebase uses callbacks throughout. They're adding a new module and want to use async/await there — just this one module — because the new code is cleaner with it. The rest of the codebase stays callbacks.",a:"Go for it — one async module won't break anything, and it's how they'll want to write all new code eventually. Gradual adoption beats a big-bang rewrite that never happens.",b:"Keep callbacks for consistency — mixing paradigms in one codebase creates two mental models developers must switch between. Either migrate fully or stay consistent until you're ready."},
];

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

    const userMsg = `Question ${i + 1}/16:\n\n${q.q}\n\nA: ${showA}\nB: ${showB}`;

    let response;
    let retries = 0;
    while (true) {
      try {
        response = await callLLM('anthropic', FLOWAY_KEY, modelId, SYSTEM_PROMPT, userMsg, FLOWAY_URL, 2048);
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
    process.stderr.write(`  Question ${i + 1}/16... ${answer}\n`);

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
    questionVersion: '5.0',
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nSaved: ${outFile}`);
  console.log(`Type: ${result.code}`);
}

main().catch(e => { console.error(e); process.exit(1); });
