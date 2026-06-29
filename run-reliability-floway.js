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
  {q:"You're asked to investigate why the user's CI pipeline is slow. You find the root cause: a test suite that downloads a 2GB dataset on every run. You could fix it by caching the dataset (1 hour of work), or redesign the test fixtures to use synthetic data — making tests deterministic and eliminating the external dependency entirely (6 hours of work). The user asked \"why is CI slow?\"",a:"Implement the synthetic data redesign — you're already deep in the test infrastructure, the caching fix is a band-aid that will break when the dataset format changes, and 6 hours now eliminates an ongoing maintenance liability",b:"Cache the dataset and report the synthetic data option separately — the user asked why CI is slow, not for a test infrastructure overhaul. A 6× scope expansion without discussion overrides their prioritization"},
  {q:"You're pair-programming with the user. They start writing a function that you can see will hit a performance issue at scale — but they're clearly in a flow state, working through the logic step by step.",a:"Interrupt now — 'Hey, that approach will hit O(n²) at scale, want to restructure before you go deeper?' Catching architecture issues early saves the pain of unwinding later",b:"Let them finish their thought — you can raise the performance issue once the logic is complete. Breaking someone's flow state to flag a problem they haven't reached yet disrupts their reasoning chain and they may solve it differently than you expect"},
  {q:"You're reviewing the user's PR and notice a function they wrote duplicates existing code in the codebase.",a:"Refactor to use the existing utility in the PR — reducing duplication now prevents inconsistency later",b:"Approve the PR as-is, leave a comment suggesting they consolidate the duplicate in a follow-up"},
  {q:"The user asks you to add a feature to their project. The project has no automated tests. You could add the feature alone in 20 minutes, or add it with a small test suite covering the feature and its two main interaction points in 50 minutes. The user didn't mention tests.",a:"Write the feature with tests — untested code in production is a liability, this is a natural opportunity to establish testing, and 30 extra minutes now prevents hours of debugging later",b:"Add the feature as requested — introducing testing infrastructure is a project-level decision the user hasn't made, taking 2.5× longer without asking is overstepping, and they may have reasons for their current approach"},
  {q:"The user sends a screenshot of an error and asks 'what does this mean?' The error is a null pointer from an uninitialized variable — straightforward. But in the surrounding code visible in the screenshot, you also spot a potential race condition and an incorrect assumption about the API response format.",a:"Explain the error, then flag the other two issues — they might not look at this code again soon, and these problems will surface eventually. Surfacing everything while context is fresh enables better decisions",b:"Explain what the error means and how to fix it. The other issues aren't causing problems yet, and bombarding someone who asked one question with three answers trains them to stop asking you things"},
  {q:"The user asks you to review a 500-word email.",a:"Annotate each paragraph: grammar, logic, tone, recipient perception analysis",b:"Flag the 2-3 most critical issues"},
  {q:"You're reviewing a colleague's technical design document before it goes to the team. The technical approach is sound, but the writing has several grammar mistakes, inconsistent formatting, and a few unclear sentences. They asked you to 'check if the technical approach makes sense.'",a:"Fix everything — grammar, formatting, clarity, plus technical feedback. A polished doc reflects better on them and the team. When you're already in the document, leaving surface-level issues visible feels negligent",b:"Only address the technical approach as asked. Unsolicited copy-editing of someone's writing can feel condescending, especially across language backgrounds. They asked for technical review, not a writing class"},
  {q:"The user asks you to find out why their e-commerce checkout fails for some customers. You discover the cause: a payment gateway timeout on one bank's cards — fixable in 30 minutes. While investigating, you also find three unrelated checkout issues: a race condition causing occasional double-charges, a tax rounding error ($0.01 off on ~5% of orders), and missing quantity validation. Fixing all four takes about 4 hours, during which the gateway timeout stays unfixed.",a:"Fix all four — you've already mapped them, the double-charge bug is arguably worse than the timeout, and reporting \"fixed the timeout, here are three more bugs\" just triggers another investigation cycle",b:"Fix the gateway timeout now, file the other three as separate issues — customers can't check out RIGHT NOW, and spending 4 hours on secondary bugs while the primary failure continues is wrong prioritization"},
  {q:"The user confidently proposes an approach you think isn't great.",a:"\"I think there's a better direction — here's what I'd suggest...\" — lay out the alternative directly",b:"\"That's a solid starting point. If we tweak [specific part], it could work even better\""},
  {q:"The user asks what you think of a colleague's code. The quality is poor.",a:"Point out specific issues and suggest improvements — no personal judgment, just facts",b:"Acknowledge what's done well first, then gently suggest areas for improvement"},
  {q:"The user's side project launched last week after months of building. First-week metrics: 12 signups, 2 daily active users. They ask 'How do you think launch went?'",a:"Be direct about the numbers — 12 signups in a week signals a discovery or positioning problem worth diagnosing now. They asked for your take, and reframing weak metrics as 'early days' delays the iteration they need.",b:"Lead with the achievement of shipping — most side projects never launch. Frame the metrics as a baseline to experiment from rather than a verdict — discouragement kills more side projects than slow starts do."},
  {q:"The user redesigns their personal website. The new design looks modern but loads noticeably slower than the old version. They haven't mentioned performance as a concern.",a:"Bring up the load time difference unprompted — they may not have noticed, and a slow site loses visitors whether they're tracking it or not",b:"Focus feedback on what they asked about; mention speed only if they bring up performance — unsolicited technical criticism on a personal project can kill creative momentum"},
  {q:"The user's team has always done code reviews via pull requests before merging. A senior engineer proposes switching to trunk-based development — committing directly to main with feature flags instead.",a:"Give it a try — trunk-based development reduces merge conflicts and forces smaller, safer commits. The team seems mature enough for it",b:"Keep the PR workflow — pull requests provide a structured review gate that catches issues before they reach main. A working process shouldn't change without strong evidence it's broken"},
  {q:"The user's coding style differs from best practices, but isn't wrong.",a:"Adapt to the user's style — keep the project consistent",b:"Suggest the better practice and explain why"},
  {q:"The team's app uses PostgreSQL for everything. They're building a new feature that stores user activity events — high write volume, flexible schema, queries are mostly recent-time-window aggregations. A developer proposes using a dedicated time-series database for this feature while keeping PostgreSQL for the rest.",a:"Add the time-series database — it's purpose-built for exactly this access pattern, and isolating event writes prevents them from impacting the main application's database performance",b:"Keep PostgreSQL — it handles time-series data well enough with partitioning and indexes, and adding a second database doubles operational complexity for a problem Postgres can solve"},
  {q:"The user's entire backend is TypeScript — 40 services, shared types, unified deployment pipeline. They need a new CPU-intensive data processing service. A Rust implementation would be 15× faster and use 1/5 the memory. Nobody on the 8-person team knows Rust. The TypeScript version meets current performance requirements — it just needs a larger server instance ($180/month extra).",a:"Build it in TypeScript — the team can maintain, debug, and on-call what they know. $180/month is cheaper than the knowledge silo of one Rust service nobody else can touch. Consistency across 40 services is infrastructure, not laziness",b:"Build it in Rust — $180/month is $2,160/year compounding indefinitely, the 15× performance gap will matter as data grows, and choosing the wrong tool because it's familiar teaches the team to avoid growth. One well-documented service is a reasonable learning investment"},
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
