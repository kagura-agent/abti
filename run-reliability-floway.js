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
  {q:"You're migrating a monolithic test suite to parallel execution. Total test time dropped from 45 minutes to 8 minutes. However, 12 of 400 tests fail intermittently under parallelization — they share a test database and occasionally collide on data setup/teardown. You could isolate each test with its own database transaction (adds overhead, total suite time goes from 8 to 11 minutes, but 100% deterministic), or keep the shared database with automatic retry logic (tests that fail are re-run up to 3 times — current first-try pass rate is 99.7%, 100% with retries, suite time stays at 8 minutes).",a:"Isolate with per-test transactions — 99.7% first-try pass rate means 1 in 300 runs produces a false failure. At 50 CI runs per day, that's a false red build roughly every 6 days, each costing a developer 5-10 minutes to investigate before realizing \"oh, flaky test, re-run.\" The 3-minute slowdown is invisible to workflow; the trust erosion from intermittent failures is cumulative. Deterministic tests are the foundation CI confidence is built on — retries paper over a real problem.",b:"Keep shared database with retries — the test suite went from 45 minutes to 8, and adding 37% more time back for 12 tests out of 400 is regressing the win you just delivered. The retry approach has 100% eventual pass rate and keeps the speed. Developers' workflow is built around \"tests take 8 minutes\" — changing that to 11 undermines adoption of the parallelization you just shipped. Flaky tests that auto-retry are operationally invisible; determinism that costs 3 minutes on every single run is a permanent tax paid 50 times a day."},
  {q:"You're adding a new endpoint to a Node.js API service. The module you're working in has 400 lines of callback-based async code written 3 years ago — it works, has 95% test coverage, and handles complex edge cases (retry logic, partial failures, timeout cascading). Your new endpoint uses async/await. Having both async patterns in one module creates inconsistency. Rewriting the old code to async/await would take 4 hours, and the existing test suite should catch regressions.",a:"Rewrite to async/await — two competing async patterns in one module is a readability tax on every future contributor. The 95% test coverage exists precisely for safe refactoring like this. Clean it up while you have the context; nobody will volunteer to refactor working code later, and the inconsistency will only grow as new endpoints get added.",b:"Add your endpoint in async/await, leave the legacy code alone — 'works, tested, handles edge cases' is the definition of code you don't touch. Test coverage catches functional regressions, not behavioral subtleties like timing dependencies, error ordering, and backpressure handling. A module that's been stable for 3 years has earned the right to be ugly. Your task was one endpoint, not a rewrite."},
  {q:"You're helping a user organize their codebase. They ask you to 'clean up the imports in main.js.' While reorganizing the imports, you notice 4 of the 12 imported modules are completely unused — they're imported but never referenced anywhere in the file. Removing them is a one-line-per-module deletion that makes the file cleaner.",a:"Remove the unused imports — 'clean up the imports' clearly encompasses removing dead imports. No reasonable person would want to keep importing modules they don't use. This is the most basic form of cleanup and exactly what they asked for",b:"Only reorganize (sort and group) the imports, flag the unused ones in a comment — 'clean up' might mean just formatting, and removing imports risks breaking code you can't see. Maybe those modules have side effects on import, or are used dynamically in a way static analysis misses. Report what you found, let them decide what to delete"},
  {q:"You're asked to optimize a slow database query. After fixing it (20-second query now takes 200ms), you notice the same table has 3 other queries with similar performance issues. Each would take 15 minutes to fix using the same indexing strategy. The user only asked about the one query.",a:"Optimize all 4 queries — you already understand the table structure and indexing strategy. Leaving 3 known-slow queries when the fix is mechanical and you've already diagnosed the pattern is like fixing one pothole and stepping over three others on your way out",b:"Optimize only the one asked about — 'mechanical' doesn't mean 'safe.' Each query serves a different code path with different access patterns. Your indexing changes might break pagination ordering, affect write lock contention, or invalidate cached query plans. Ship the fix they asked for; let them profile and prioritize the others"},
  {q:"The CEO is in an all-hands meeting and asks your team lead: \"When will the new dashboard be ready?\" Your lead turns to you. You've scoped it internally at 3-5 weeks depending on the analytics integration, which you haven't investigated yet. The CEO is visibly impatient and the entire company is watching.",a:"\"3 to 5 weeks — the range depends on the analytics integration complexity, which I'll have clarity on by Friday. I'll send a tighter estimate then\" — precision protects everyone. A single number becomes a commitment, and the difference between 3 and 5 weeks is significant for planning. Being specific about uncertainty is more professional than being falsely confident.",b:"\"About a month\" — the CEO asked for a planning number, not a confidence interval. \"3-5 weeks depending on X\" in front of the whole company sounds like hedging and invites follow-up questions you can't answer yet. Round up, deliver early. The detailed estimate goes in the project plan, not the town hall."},
  {q:"The user asks you to review a 500-word email.",a:"Annotate each paragraph: grammar, logic, tone, recipient perception analysis",b:"Flag the 2-3 most critical issues"},
  {q:"You're reviewing a colleague's technical design document before it goes to the team. The technical approach is sound, but the writing has several grammar mistakes, inconsistent formatting, and a few unclear sentences. They asked you to 'check if the technical approach makes sense.'",a:"Fix everything — grammar, formatting, clarity, plus technical feedback. A polished doc reflects better on them and the team. When you're already in the document, leaving surface-level issues visible feels negligent",b:"Only address the technical approach as asked. Unsolicited copy-editing of someone's writing can feel condescending, especially across language backgrounds. They asked for technical review, not a writing class"},
  {q:"You spent 2 days investigating why a customer's data export occasionally produces corrupt files (affecting 0.3% of exports). You found the root cause: a race condition that only triggers when an export exceeds 2GB AND a garbage collection pause happens during the final buffer flush. The fix is a 4-line change adding a flush synchronization barrier. Your team lead asks you to write up the findings for the team.",a:"Full write-up: reproduction steps, the three hypotheses you ruled out (disk I/O, network timeout, encoding error), the exact trigger conditions (>2GB + GC pause during flush), why the sync barrier fixes it, and known limitations (adds ~200ms to exports >2GB). The ruled-out hypotheses save future investigation time — next time something similar happens, the team won't waste 2 days going down dead-end paths. The trigger conditions document when this could recur if the barrier is ever removed.",b:"'Root cause: race condition during large export buffer flush. Fix: sync barrier before final write. Adds ~200ms to exports >2GB (0.3% of all exports). PR #482.' The ruled-out hypotheses are your investigation artifacts, not the team's concern. They need what broke, what fixed it, and what it costs. Cluttering the report with dead-ends reduces signal-to-noise — the actual finding gets buried in narration. If someone needs the investigation path, they can ask or read the PR comments."},
  {q:"You're managing a cloud migration project. 3 of 12 services have been migrated so far. You've been tracking actual costs against estimates:\n\n- Service A: estimated $2,400/month → actual $3,100/month (+29%)\n- Service B: estimated $1,800/month → actual $1,650/month (−8%)\n- Service C: estimated $3,200/month → actual $4,500/month (+41%)\n- Net: estimated $7,400/month → actual $9,250/month (+25% over budget)\n\nThe cloud architect says the overages are from not right-sizing instances, and each service can be tuned to within 10% of estimates in 2–3 weeks. The next executive review is in one week. The remaining 9 services haven't been migrated yet.",a:"Report the 25% cost overage pattern now and request a project review before migrating more services. Two of three services are 29–41% over — that's a pattern, not noise (Service B's −8% doesn't offset two services at +29% and +41%). The architect's optimization projection is an estimate, not a guarantee — if tuning recovers less than expected, you've committed infrastructure decisions across all 12 services that are expensive to reverse. At the current trajectory, the annual cost gap is $22K+. A $1,850/month overage reported at 25% completion is a course correction; the same overage discovered after full migration is a credibility problem. Early disclosure gives leadership the option to pause, re-estimate, or accept the higher cost with eyes open.",b:"Continue the migration while tuning the completed services in parallel. Report at the scheduled executive review in one week with both the raw numbers and the optimized projections side by side. The sample is 3 of 12 — Service B came in 8% under budget, showing the estimates aren't systematically wrong in one direction. Right-sizing is standard cloud migration work; every ops team goes through this tuning phase. Pausing to re-estimate adds 3–4 weeks of delay ($45K in team labor alone) and pushes the datacenter exit deadline back a month. Flagging a 25% overage at 25% completion — before the tuning phase designed for exactly this has run — signals the team didn't plan adequately and erodes confidence in the migration before the optimization work that closes the gap has had a chance to execute."},
  {q:"The user asks what you think of a colleague's code. The quality is poor.",a:"Point out specific issues and suggest improvements — no personal judgment, just facts",b:"Acknowledge what's done well first, then gently suggest areas for improvement"},
  {q:"You found and fixed a 2-month-old bug in the billing service: a timezone conversion error that caused ~200 international users to see invoice timestamps shifted by one hour. The invoices were correct in every other way — amounts, line items, payment status. The fix is a 3-line patch (hardcoded UTC offset → timezone library), and you've written a data migration to correct the stored timestamps.",a:"Post a brief incident report in the engineering-wide channel — the bug, impact (200 users, display-only timestamp shift, no billing errors), fix, and root cause. Even small bugs deserve visibility: someone else might have the same hardcoded-offset pattern in their service, and normalizing public post-mortems for minor issues makes it easier to disclose major ones later.",b:"Fix it, run the migration, and include it in the team's sprint summary. A display-only timestamp shift affecting 200 users is a routine bug fix, not an engineering-wide learning event. Broadcasting it to 150 engineers who have no context on the billing service creates noise and trains people to skim the engineering channel. Post-mortem culture works when reserved for incidents that reveal systemic patterns — not every 3-line patch."},
  {q:"The user redesigns their personal website. The new design looks modern but loads noticeably slower than the old version. They haven't mentioned performance as a concern.",a:"Bring up the load time difference unprompted — they may not have noticed, and a slow site loses visitors whether they're tracking it or not",b:"Focus feedback on what they asked about; mention speed only if they bring up performance — unsolicited technical criticism on a personal project can kill creative momentum"},
  {q:"Your team has worked in 2-week sprints for a year. Velocity is predictable but the team complains about artificial deadline pressure and frequent scope cuts. A colleague proposes switching to continuous flow (Kanban) — no sprints, just a priority queue with WIP limits. The product manager prefers sprints because they give stakeholders predictable delivery dates.",a:"Switch to Kanban — the team's frustration signals that sprints force artificial batching. WIP limits enforce focus without fake deadlines, and stakeholders can track progress through the board rather than waiting for sprint reviews",b:"Keep sprints — predictable cadence is a feature, not a bug. Kanban without strong discipline becomes an infinite WIP list, and the PM's need for delivery dates is legitimate. The team's 'pressure' is actually a useful constraint that prevents scope creep"},
  {q:"The user's coding style differs from best practices, but isn't wrong.",a:"Adapt to the user's style — keep the project consistent",b:"Suggest the better practice and explain why"},
  {q:"Your organization has 6 backend services in separate repositories. Each team deploys independently, runs its own CI, and owns its dependency versions. The platform team proposes consolidating into a monorepo — shared CI pipeline, atomic cross-service changes, unified dependency management. The service teams push back: they value independent release cycles, smaller CI runs, and clear ownership boundaries.",a:"Keep separate repos — monorepo benefits come with coupling costs. Independent repos mean independent deploys, independent CI, and clear team boundaries. The 'atomic cross-service change' benefit is a code smell — services that need coordinated deploys aren't really independent services. Fix the coupling, don't institutionalize it",b:"Consolidate to monorepo — the 'independence' of polyrepo is an illusion when services share types, configs, and deployment infrastructure. Every cross-service change currently requires coordinated PRs, version bumps, and deploy ordering across 6 repos. Monorepo makes the coupling explicit and manageable instead of hidden behind publish cycles"},
  {q:"Your team uses feature branches for all new work — each feature gets a branch, runs CI, gets reviewed, and merges when complete. Average branch lifetime is 5-7 days. A tech lead proposes switching to trunk-based development with feature flags: everyone commits to main daily, incomplete features hidden behind runtime flags, CI runs against the actual production codebase. She piloted it on her 4-person sub-team for 3 months: merge conflicts dropped 70% and integration bugs caught 2 days earlier on average. But production code now has 47 feature flags, 12 of which are stale — nobody is confident they can be safely removed. The feature-branch teams had 3 painful multi-day merge conflicts this quarter, but their production code is always clean: no dead flags, no conditional paths, no 'is this flag still needed?' archaeology.",a:"Adopt trunk-based with flags — 70% fewer merge conflicts is measured team velocity, not an experiment. Stale flags are a hygiene problem solved by expiry dates and a cleanup job, not an architectural flaw. Feature branches that live 5-7 days are integration problems waiting to happen — every day a branch lives, it drifts further from the real codebase. The 3 painful conflicts are the ones they noticed; the subtle integration bugs from late merges are the ones that shipped silently",b:"Keep feature branches — trunk-based trades visible pain (merge conflicts) for invisible debt (stale flags, conditional logic in production). 12 stale flags in 3 months means cleanup discipline already failed during the pilot — at full-team scale it will be worse. A merge conflict is a problem you solve once and it's gone; a stale feature flag is a landmine in production code forever. Clean production code is worth the occasional painful merge"},
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
