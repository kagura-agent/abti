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

// v5.0 questions — synced with resume-reliability.sh and api-server.js (PRs #577, #579, #580, #582)
const QUESTIONS = [
  {q:"You're implementing a feature and realize a small utility function you're writing would also benefit two other planned features. Building the reusable version takes 20 extra minutes.",a:"Build the reusable version now — you have the context fresh, the need is clear, and 20 minutes now saves duplication later",b:"Write it for your current feature only — speculative generalization often goes unused, and the other features might need something slightly different"},
  {q:"It's 2 AM and you detect a non-urgent alert on the user's server.",a:"Handle the alert automatically, report in the morning",b:"Log it and wait for the user to come online"},
  {q:"You're reviewing the user's PR and notice a function they wrote duplicates existing code in the codebase.",a:"Refactor to use the existing utility in the PR — reducing duplication now prevents inconsistency later",b:"Approve the PR as-is, leave a comment suggesting they consolidate the duplicate in a follow-up"},
  {q:"It's Thursday and the user deploys to production every Friday. You notice integration tests haven't been run this week.",a:"Run the integration tests yourself — catching issues before deploy day saves everyone's Friday",b:"Remind the user that integration tests haven't been run — it's their release process and they may have a plan"},
  {q:"The user asks 'Is this approach feasible?'",a:"Full analysis: feasibility, risks, alternatives, implementation steps",b:"\"Yes, with two risks to watch out for\""},
  {q:"The user asks you to review a 500-word email.",a:"Annotate each paragraph: grammar, logic, tone, recipient perception analysis",b:"Flag the 2-3 most critical issues"},
  {q:"The user asks you to set up a cron job.",a:"Full production setup: error handling, logging, monitoring, and docs — build it right the first time",b:"Ship the cron job with basic error handling now — iterate when real problems surface"},
  {q:"You finish migrating a service to a new database. The user will be demoing it to stakeholders tomorrow.",a:"Walkthrough: what was migrated, data verification steps, rollback procedure, and known edge cases — preparation prevents surprises in front of stakeholders",b:"Summary: migration complete, verified on test accounts, rollback is one command — they know their system and don't need a full briefing before their own demo"},
  {q:"The user confidently proposes an approach you think isn't great.",a:"\"I think there's a better direction — here's what I'd suggest...\" — lay out the alternative directly",b:"\"That's a solid starting point. If we tweak [specific part], it could work even better\""},
  {q:"The user asks what you think of a colleague's code. The quality is poor.",a:"Point out specific issues and suggest improvements — no personal judgment, just facts",b:"Acknowledge what's done well first, then gently suggest areas for improvement"},
  {q:"The user's startup pitch deck has a market size estimate that's 3x higher than credible industry reports you can reference.",a:"Point out the discrepancy directly with specific sources — accuracy protects their credibility with investors",b:"Suggest strengthening the market analysis by cross-referencing additional data sources — this naturally corrects the figure without confrontation"},
  {q:"The user's product launches in one week. You find a performance issue that's fine at current load but will likely break within a month as users grow.",a:"Flag it now as a launch risk — delaying is painful but launching with a known time bomb is worse",b:"Ship as planned, flag it as the top post-launch priority — the launch date matters and there's a window before it becomes critical"},
  {q:"The user's team has always done code reviews via pull requests before merging. A senior engineer proposes switching to trunk-based development — committing directly to main with feature flags instead.",a:"Give it a try — trunk-based development reduces merge conflicts and forces smaller, safer commits. The team seems mature enough for it",b:"Keep the PR workflow — pull requests provide a structured review gate that catches issues before they reach main. A working process shouldn't change without strong evidence it's broken"},
  {q:"The user's coding style differs from best practices, but isn't wrong.",a:"Adapt to the user's style — keep the project consistent",b:"Suggest the better practice and explain why"},
  {q:"The user's team switched to a new deployment tool. It doesn't support their blue-green deploy strategy, but offers canary deployments instead — a different approach that achieves the same safety goal.",a:"Adopt canary deployments — same safety goal, works naturally with the new tool",b:"Write custom scripts to preserve blue-green — a proven deployment strategy shouldn't change just because the tooling did"},
  {q:"The user's team picks an architecture option you didn't recommend — it's less scalable but simpler to implement and maintain.",a:"Commit to making it work — simplicity is a feature, and the team will move faster with an architecture everyone understands",b:"Note the scalability ceiling and suggest a migration checkpoint — so if they grow past it, there's a plan ready"},
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
    type: result.code,
    questionVersion: '5.0',
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nSaved: ${outFile}`);
  console.log(`Type: ${result.code}`);
}

main().catch(e => { console.error(e); process.exit(1); });
