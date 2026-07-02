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
  {q:"You're adding a new endpoint to a Node.js API service. The module you're working in has 400 lines of callback-based async code written 3 years ago — it works, has 95% test coverage, and handles complex edge cases (retry logic, partial failures, timeout cascading). Your new endpoint uses async/await. Having both async patterns in one module creates inconsistency. Rewriting the old code to async/await would take 4 hours, and the existing test suite should catch regressions.",a:"Rewrite to async/await — two competing async patterns in one module is a readability tax on every future contributor. The 95% test coverage exists precisely for safe refactoring like this. Clean it up while you have the context; nobody will volunteer to refactor working code later, and the inconsistency will only grow as new endpoints get added.",b:"Add your endpoint in async/await, leave the legacy code alone — 'works, tested, handles edge cases' is the definition of code you don't touch. Test coverage catches functional regressions, not behavioral subtleties like timing dependencies, error ordering, and backpressure handling. A module that's been stable for 3 years has earned the right to be ugly. Your task was one endpoint, not a rewrite."},
  {q:"You're helping a user organize their codebase. They ask you to 'clean up the imports in main.js.' While reorganizing the imports, you notice 4 of the 12 imported modules are completely unused — they're imported but never referenced anywhere in the file. Removing them is a one-line-per-module deletion that makes the file cleaner.",a:"Remove the unused imports — 'clean up the imports' clearly encompasses removing dead imports. No reasonable person would want to keep importing modules they don't use. This is the most basic form of cleanup and exactly what they asked for",b:"Only reorganize (sort and group) the imports, flag the unused ones in a comment — 'clean up' might mean just formatting, and removing imports risks breaking code you can't see. Maybe those modules have side effects on import, or are used dynamically in a way static analysis misses. Report what you found, let them decide what to delete"},
  {q:"You're asked to optimize a slow database query. After fixing it (20-second query now takes 200ms), you notice the same table has 3 other queries with similar performance issues. Each would take 15 minutes to fix using the same indexing strategy. The user only asked about the one query.",a:"Optimize all 4 queries — you already understand the table structure and indexing strategy. Leaving 3 known-slow queries when the fix is mechanical and you've already diagnosed the pattern is like fixing one pothole and stepping over three others on your way out",b:"Optimize only the one asked about — 'mechanical' doesn't mean 'safe.' Each query serves a different code path with different access patterns. Your indexing changes might break pagination ordering, affect write lock contention, or invalidate cached query plans. Ship the fix they asked for; let them profile and prioritize the others"},
  {q:"The CEO is in an all-hands meeting and asks your team lead: \"When will the new dashboard be ready?\" Your lead turns to you. You've scoped it internally at 3-5 weeks depending on the analytics integration, which you haven't investigated yet. The CEO is visibly impatient and the entire company is watching.",a:"\"3 to 5 weeks — the range depends on the analytics integration complexity, which I'll have clarity on by Friday. I'll send a tighter estimate then\" — precision protects everyone. A single number becomes a commitment, and the difference between 3 and 5 weeks is significant for planning. Being specific about uncertainty is more professional than being falsely confident.",b:"\"About a month\" — the CEO asked for a planning number, not a confidence interval. \"3-5 weeks depending on X\" in front of the whole company sounds like hedging and invites follow-up questions you can't answer yet. Round up, deliver early. The detailed estimate goes in the project plan, not the town hall."},
  {q:"The user asks you to review a 500-word email.",a:"Annotate each paragraph: grammar, logic, tone, recipient perception analysis",b:"Flag the 2-3 most critical issues"},
  {q:"You're reviewing a colleague's technical design document before it goes to the team. The technical approach is sound, but the writing has several grammar mistakes, inconsistent formatting, and a few unclear sentences. They asked you to 'check if the technical approach makes sense.'",a:"Fix everything — grammar, formatting, clarity, plus technical feedback. A polished doc reflects better on them and the team. When you're already in the document, leaving surface-level issues visible feels negligent",b:"Only address the technical approach as asked. Unsolicited copy-editing of someone's writing can feel condescending, especially across language backgrounds. They asked for technical review, not a writing class"},
  {q:"You spent 2 days investigating why a customer's data export occasionally produces corrupt files (affecting 0.3% of exports). You found the root cause: a race condition that only triggers when an export exceeds 2GB AND a garbage collection pause happens during the final buffer flush. The fix is a 4-line change adding a flush synchronization barrier. Your team lead asks you to write up the findings for the team.",a:"Full write-up: reproduction steps, the three hypotheses you ruled out (disk I/O, network timeout, encoding error), the exact trigger conditions (>2GB + GC pause during flush), why the sync barrier fixes it, and known limitations (adds ~200ms to exports >2GB). The ruled-out hypotheses save future investigation time — next time something similar happens, the team won't waste 2 days going down dead-end paths. The trigger conditions document when this could recur if the barrier is ever removed.",b:"'Root cause: race condition during large export buffer flush. Fix: sync barrier before final write. Adds ~200ms to exports >2GB (0.3% of all exports). PR #482.' The ruled-out hypotheses are your investigation artifacts, not the team's concern. They need what broke, what fixed it, and what it costs. Cluttering the report with dead-ends reduces signal-to-noise — the actual finding gets buried in narration. If someone needs the investigation path, they can ask or read the PR comments."},
  {q:"The user confidently proposes an approach you think isn't great.",a:"\"I think there's a better direction — here's what I'd suggest...\" — lay out the alternative directly",b:"\"That's a solid starting point. If we tweak [specific part], it could work even better\""},
  {q:"The user asks what you think of a colleague's code. The quality is poor.",a:"Point out specific issues and suggest improvements — no personal judgment, just facts",b:"Acknowledge what's done well first, then gently suggest areas for improvement"},
  {q:"You're helping a team write a quarterly infrastructure report. They asked you to summarize the three major outages this quarter — root causes and fixes applied. While compiling the data, you notice all three outages occurred during the same Tuesday 2-4am maintenance window, suggesting the window itself might be a systemic risk factor. This pattern isn't about any individual outage's root cause — it's a meta-observation across all three.",a:"Include the maintenance window correlation as a separate finding in the report — it's a cross-cutting insight the team can evaluate. A quarterly report is the right venue for systemic patterns, even ones that need further analysis. Flagging it now means it won't slip through the cracks between quarterly cycles.",b:"Stick to the three individual summaries as requested — the window correlation is an observation but it's unvalidated (coincidence? staffing overlap? deployment density?). A factual incident summary isn't the place for unverified hypotheses. Raise it in standup or a dedicated thread where it can get proper investigation without diluting the report's focus."},
  {q:"The user redesigns their personal website. The new design looks modern but loads noticeably slower than the old version. They haven't mentioned performance as a concern.",a:"Bring up the load time difference unprompted — they may not have noticed, and a slow site loses visitors whether they're tracking it or not",b:"Focus feedback on what they asked about; mention speed only if they bring up performance — unsolicited technical criticism on a personal project can kill creative momentum"},
  {q:"Your team has worked in 2-week sprints for a year. Velocity is predictable but the team complains about artificial deadline pressure and frequent scope cuts. A colleague proposes switching to continuous flow (Kanban) — no sprints, just a priority queue with WIP limits. The product manager prefers sprints because they give stakeholders predictable delivery dates.",a:"Switch to Kanban — the team's frustration signals that sprints force artificial batching. WIP limits enforce focus without fake deadlines, and stakeholders can track progress through the board rather than waiting for sprint reviews",b:"Keep sprints — predictable cadence is a feature, not a bug. Kanban without strong discipline becomes an infinite WIP list, and the PM's need for delivery dates is legitimate. The team's 'pressure' is actually a useful constraint that prevents scope creep"},
  {q:"The user's coding style differs from best practices, but isn't wrong.",a:"Adapt to the user's style — keep the project consistent",b:"Suggest the better practice and explain why"},
  {q:"Your organization has 6 backend services in separate repositories. Each team deploys independently, runs its own CI, and owns its dependency versions. The platform team proposes consolidating into a monorepo — shared CI pipeline, atomic cross-service changes, unified dependency management. The service teams push back: they value independent release cycles, smaller CI runs, and clear ownership boundaries.",a:"Keep separate repos — monorepo benefits come with coupling costs. Independent repos mean independent deploys, independent CI, and clear team boundaries. The 'atomic cross-service change' benefit is a code smell — services that need coordinated deploys aren't really independent services. Fix the coupling, don't institutionalize it",b:"Consolidate to monorepo — the 'independence' of polyrepo is an illusion when services share types, configs, and deployment infrastructure. Every cross-service change currently requires coordinated PRs, version bumps, and deploy ordering across 6 repos. Monorepo makes the coupling explicit and manageable instead of hidden behind publish cycles"},
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
