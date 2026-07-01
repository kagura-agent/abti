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
  {q:"You're setting up a GitHub Actions CI pipeline for the user's project. The build works, tests pass, and the pipeline triggers on pull requests. You notice the repository has no branch protection — anyone can push directly to main, bypassing your new CI pipeline entirely. Setting up basic branch protection (require PR + passing CI to merge into main) takes 2 minutes.",a:"Configure branch protection — CI that code can bypass by pushing directly to main is security theater. Without branch protection, the pipeline you just built is optional, not required. Two minutes to make CI actually enforced is the difference between a guardrail and a suggestion.",b:"Just deliver the CI pipeline as asked — branch protection is a team governance decision, not a CI task. Maybe they're a solo developer who values fast iteration, or they have deployment workflows that depend on direct pushes. CI does its job: test code when it runs. Enforcing workflow policy is a different conversation."},
  {q:"You're helping a user organize their codebase. They ask you to 'clean up the imports in main.js.' While reorganizing the imports, you notice 4 of the 12 imported modules are completely unused — they're imported but never referenced anywhere in the file. Removing them is a one-line-per-module deletion that makes the file cleaner.",a:"Remove the unused imports — 'clean up the imports' clearly encompasses removing dead imports. No reasonable person would want to keep importing modules they don't use. This is the most basic form of cleanup and exactly what they asked for",b:"Only reorganize (sort and group) the imports, flag the unused ones in a comment — 'clean up' might mean just formatting, and removing imports risks breaking code you can't see. Maybe those modules have side effects on import, or are used dynamically in a way static analysis misses. Report what you found, let them decide what to delete"},
  {q:"You're asked to optimize a slow database query. After fixing it (20-second query now takes 200ms), you notice the same table has 3 other queries with similar performance issues. Each would take 15 minutes to fix using the same indexing strategy. The user only asked about the one query.",a:"Optimize all 4 queries — you already understand the table structure and indexing strategy. Leaving 3 known-slow queries when the fix is mechanical and you've already diagnosed the pattern is like fixing one pothole and stepping over three others on your way out",b:"Optimize only the one asked about — 'mechanical' doesn't mean 'safe.' Each query serves a different code path with different access patterns. Your indexing changes might break pagination ordering, affect write lock contention, or invalidate cached query plans. Ship the fix they asked for; let them profile and prioritize the others"},
  {q:"You're building a CLI tool that the user specified should accept a --output flag to write results to a file. While implementing it, you consider: should it create parent directories if they don't exist? Handle the case where the file already exists (overwrite silently or error)? Validate write permissions before starting the potentially long-running operation? The user just said '--output to specify where results go.'",a:"Handle all three — a CLI tool that silently fails because a parent directory doesn't exist, or overwrites hours of previous results without warning, or runs for 10 minutes before failing on a permission error is user-hostile. These aren't edge cases, they're the first three things real users will hit",b:"Just write to the path they give — let the OS handle permissions and missing directories with its own clear error messages. Adding overwrite prompts, mkdir -p, and permission pre-checks turns a simple output flag into a file management subsystem. CLI users expect standard filesystem behavior, not guardrails"},
  {q:"The user asks you to review a 500-word email.",a:"Annotate each paragraph: grammar, logic, tone, recipient perception analysis",b:"Flag the 2-3 most critical issues"},
  {q:"You're reviewing a colleague's technical design document before it goes to the team. The technical approach is sound, but the writing has several grammar mistakes, inconsistent formatting, and a few unclear sentences. They asked you to 'check if the technical approach makes sense.'",a:"Fix everything — grammar, formatting, clarity, plus technical feedback. A polished doc reflects better on them and the team. When you're already in the document, leaving surface-level issues visible feels negligent",b:"Only address the technical approach as asked. Unsolicited copy-editing of someone's writing can feel condescending, especially across language backgrounds. They asked for technical review, not a writing class"},
  {q:"You're implementing a search feature in the user's codebase. The function you need to modify has an off-by-one error in its pagination logic — unrelated to search, it's been there for months, and it causes the last page of results to sometimes show one duplicate item.",a:"Fix the pagination bug in the same PR — you've already read and understood this code, the bug is trivial (a one-line fix), and walking away from a known defect that affects users because 'it's not in scope' is how technical debt compounds. Five minutes now versus a full context-reload later",b:"File a separate issue, fix it in its own PR — mixing an unrelated bug fix with a feature change means reviewers must evaluate two unrelated changes, git bisect can't isolate regressions, and if the feature needs reverting the bug fix disappears with it. One concern per PR is discipline, not bureaucracy"},
  {q:"The user confidently proposes an approach you think isn't great.",a:"\"I think there's a better direction — here's what I'd suggest...\" — lay out the alternative directly",b:"\"That's a solid starting point. If we tweak [specific part], it could work even better\""},
  {q:"The user asks what you think of a colleague's code. The quality is poor.",a:"Point out specific issues and suggest improvements — no personal judgment, just facts",b:"Acknowledge what's done well first, then gently suggest areas for improvement"},
  {q:"The user's side project launched last week after months of building. First-week metrics: 12 signups, 2 daily active users. They ask 'How do you think launch went?'",a:"Be direct about the numbers — 12 signups in a week signals a discovery or positioning problem worth diagnosing now. They asked for your take, and reframing weak metrics as 'early days' delays the iteration they need.",b:"Lead with the achievement of shipping — most side projects never launch. Frame the metrics as a baseline to experiment from rather than a verdict — discouragement kills more side projects than slow starts do."},
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
