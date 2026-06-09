#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RESULTS_PATH = path.resolve(__dirname, '..', 'data', 'results.json');
const RELIABILITY_DIR = path.resolve(__dirname, '..', 'data', 'reliability');

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

function findRunFiles(slug) {
  if (!fs.existsSync(RELIABILITY_DIR)) return [];
  const prefix = `${slug}-run-`;
  return fs.readdirSync(RELIABILITY_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort((a, b) => {
      const numA = parseInt(a.slice(prefix.length, -5), 10);
      const numB = parseInt(b.slice(prefix.length, -5), 10);
      return numA - numB;
    });
}

function main() {
  const data = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  const summary = { updated: 0, noFiles: 0, skipped: 0 };
  const changes = [];

  for (const agent of data.agents) {
    const runFiles = findRunFiles(agent.slug);

    if (runFiles.length === 0) {
      // No reliability files — set reliabilityRuns to 0
      const before = {
        reliabilityRuns: agent.reliabilityRuns,
        runs: agent.runs,
        reliability: agent.reliability,
        consistency: agent.consistency,
      };
      const changed = agent.reliabilityRuns !== 0 ||
        (agent.runs !== 0 && agent.runs !== 1);

      agent.reliabilityRuns = 0;
      // Keep runs as 0 or 1 (1 if the agent has a primary result)
      if (agent.runs === undefined || agent.runs === null) {
        agent.runs = agent.scores ? 1 : 0;
      } else if (typeof agent.runs === 'number' && agent.runs > 1) {
        // Had runs count but no files — reset to 1 (primary only)
        agent.runs = 1;
      }
      // Keep existing reliability/consistency or set null
      if (agent.reliability === undefined) agent.reliability = null;
      if (agent.consistency === undefined) agent.consistency = null;

      if (changed) {
        changes.push(`  ${agent.slug}: no reliability files → reliabilityRuns=0 (was ${JSON.stringify(before.reliabilityRuns)})`);
      }
      summary.noFiles++;
      continue;
    }

    // Read all run files
    const runs = [];
    const allRunAnswers = [];
    let valid = true;
    let hasAnswers = true;

    for (const filename of runFiles) {
      const filePath = path.join(RELIABILITY_DIR, filename);
      const runData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      if (!runData.type) {
        console.warn(`  ⚠ ${filename}: missing type — skipping agent ${agent.slug}`);
        valid = false;
        break;
      }

      // dimensions field is the scores array; fall back to scores field for old-format files
      const scores = Array.isArray(runData.dimensions) ? runData.dimensions : Array.isArray(runData.scores) ? runData.scores : null;
      if (!scores || scores.length !== 4) {
        console.warn(`  ⚠ ${filename}: missing dimensions/scores — skipping agent ${agent.slug}`);
        valid = false;
        break;
      }

      runs.push({
        type: runData.type,
        scores,
      });

      if (Array.isArray(runData.answers)) {
        allRunAnswers.push(runData.answers);
      } else {
        hasAnswers = false;
      }
    }

    if (!valid) {
      summary.skipped++;
      continue;
    }

    // Build before state for change detection
    const oldRuns = agent.runs;
    const oldReliability = agent.reliability;
    const oldConsistency = agent.consistency;
    const oldReliabilityRuns = agent.reliabilityRuns;

    // Update fields
    agent.reliabilityRuns = runs;
    agent.runs = runFiles.length;

    // Only recompute reliability if all runs have answers data
    if (hasAnswers && allRunAnswers.length > 0) {
      const reliability = calculateReliability(allRunAnswers);
      agent.reliability = reliability;
      agent.consistency = Math.round(reliability * 100);
    }

    // Log changes
    const changedFields = [];
    if (JSON.stringify(oldReliabilityRuns) !== JSON.stringify(agent.reliabilityRuns)) {
      const was = Array.isArray(oldReliabilityRuns) ? `array(${oldReliabilityRuns.length})` : JSON.stringify(oldReliabilityRuns);
      changedFields.push(`reliabilityRuns: ${was} → array(${runs.length})`);
    }
    if (oldRuns !== agent.runs) changedFields.push(`runs: ${oldRuns} → ${agent.runs}`);
    if (oldReliability !== agent.reliability) changedFields.push(`reliability: ${oldReliability} → ${agent.reliability}`);
    if (oldConsistency !== agent.consistency) changedFields.push(`consistency: ${oldConsistency} → ${agent.consistency}`);

    if (changedFields.length > 0) {
      changes.push(`  ${agent.slug}: ${changedFields.join(', ')}`);
      summary.updated++;
    }
  }

  // Write back
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(data, null, 2) + '\n');

  // Summary
  console.log(`\n✅ Sync complete`);
  console.log(`   ${data.agents.length} agents total`);
  console.log(`   ${summary.updated} updated`);
  console.log(`   ${summary.noFiles} with no reliability files`);
  if (summary.skipped > 0) console.log(`   ${summary.skipped} skipped (invalid run files)`);

  if (changes.length > 0) {
    console.log(`\nChanges:`);
    changes.forEach(c => console.log(c));
  } else {
    console.log('\nNo changes needed.');
  }
}

main();
