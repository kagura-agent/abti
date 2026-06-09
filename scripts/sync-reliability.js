#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RESULTS_PATH = path.join(__dirname, '..', 'data', 'results.json');
const REL_DIR = path.join(__dirname, '..', 'data', 'reliability');

function calculateReliability(allRunAnswers) {
  const numQuestions = allRunAnswers[0].length;
  const numRuns = allRunAnswers.length;
  let totalConsistency = 0;
  for (let q = 0; q < numQuestions; q++) {
    let countA = 0;
    for (let r = 0; r < numRuns; r++) {
      if (allRunAnswers[r][q] === 'A') countA++;
    }
    const majority = Math.max(countA, numRuns - countA);
    totalConsistency += majority / numRuns;
  }
  return parseFloat((totalConsistency / numQuestions).toFixed(4));
}

function computeConsistency(runs) {
  const typeCounts = {};
  for (const r of runs) {
    typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
  }
  const dominant = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
  return Math.round((dominant[1] / runs.length) * 100);
}

function main() {
  const resultsData = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  // Index all reliability files by slug
  const relFiles = {};
  if (fs.existsSync(REL_DIR)) {
    for (const fname of fs.readdirSync(REL_DIR)) {
      const m = fname.match(/^(.+)-run-(\d+)\.json$/);
      if (!m) continue;
      const slug = m[1];
      const runNum = parseInt(m[2], 10);
      if (!relFiles[slug]) relFiles[slug] = [];
      const data = JSON.parse(fs.readFileSync(path.join(REL_DIR, fname), 'utf8'));
      relFiles[slug].push({ runNum, data });
    }
    // Sort each slug's runs by run number
    for (const slug of Object.keys(relFiles)) {
      relFiles[slug].sort((a, b) => a.runNum - b.runNum);
    }
  }

  let updated = 0;

  for (const agent of resultsData.agents) {
    const files = relFiles[agent.slug];
    const hasFiles = files && files.length > 0;

    if (hasFiles) {
      // Build reliabilityRuns array from files
      const runsArray = files.map(f => ({
        type: f.data.type,
        scores: f.data.dimensions,
      }));

      // Check if anything actually changed
      const oldRunsJson = JSON.stringify(agent.reliabilityRuns);
      const newRunsJson = JSON.stringify(runsArray);
      const oldRunCount = agent.runs;
      const newRunCount = files.length;

      agent.reliabilityRuns = runsArray;
      agent.runs = newRunCount;

      // Compute consistency from types
      agent.consistency = computeConsistency(runsArray);

      // Compute reliability if we have answers
      const allAnswers = files.map(f => f.data.answers).filter(Boolean);
      if (allAnswers.length === files.length && allAnswers.length > 0) {
        agent.reliability = calculateReliability(allAnswers);
      }
      // else keep existing reliability value

      if (oldRunsJson !== newRunsJson || oldRunCount !== newRunCount) {
        console.log(`  ✓ ${agent.slug}: ${files.length} runs from files`);
        updated++;
      }
    } else if (Array.isArray(agent.reliabilityRuns) && agent.reliabilityRuns.length > 0) {
      // Has array data but no files — keep as-is, ensure runs count matches
      const expectedRuns = agent.reliabilityRuns.length;
      if (agent.runs !== expectedRuns) {
        console.log(`  ✓ ${agent.slug}: fixed runs count ${agent.runs} → ${expectedRuns} (from existing array)`);
        agent.runs = expectedRuns;
        updated++;
      }
      // Recompute consistency from existing array
      const oldConsistency = agent.consistency;
      agent.consistency = computeConsistency(agent.reliabilityRuns);
      if (oldConsistency !== agent.consistency) {
        console.log(`  ✓ ${agent.slug}: fixed consistency ${oldConsistency} → ${agent.consistency}`);
        updated++;
      }
    } else if (typeof agent.reliabilityRuns === 'number') {
      // reliabilityRuns is a bare number with no files — leave as-is
      // Just ensure runs matches
      if (agent.runs !== agent.reliabilityRuns) {
        console.log(`  ✓ ${agent.slug}: fixed runs count ${agent.runs} → ${agent.reliabilityRuns}`);
        agent.runs = agent.reliabilityRuns;
        updated++;
      }
    }
    // else: no reliabilityRuns and no files — skip
  }

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(resultsData, null, 2) + '\n');
  console.log(`\nDone. ${updated} agent(s) updated.`);
}

main();
