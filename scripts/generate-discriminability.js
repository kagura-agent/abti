#!/usr/bin/env node
'use strict';

/**
 * Generate per-question discriminability data from reliability test runs.
 *
 * Version-aware: splits runs into cohorts based on git commit date.
 *   - Files committed before 2026-06-02T00:00:00+08:00 = 'v4'
 *   - Files committed on/after that date = 'v5-beta'
 *
 * Output: data/discriminability.json with top-level questions/dimensions
 * for backwards compat (= 'all' cohort) plus cohorts object.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RELIABILITY_DIR = path.join(__dirname, '..', 'data', 'reliability');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'discriminability.json');

const V5_CUTOFF = new Date('2026-06-02T00:00:00+08:00').getTime();

const DIMENSIONS = [
  { name: 'Autonomy', poles: ['P', 'R'], questions: [1, 2, 3, 4] },
  { name: 'Precision', poles: ['T', 'E'], questions: [5, 6, 7, 8] },
  { name: 'Transparency', poles: ['C', 'D'], questions: [9, 10, 11, 12] },
  { name: 'Adaptability', poles: ['F', 'N'], questions: [13, 14, 15, 16] },
];

function getFileCohort(filepath) {
  try {
    const output = execSync(
      `git log --diff-filter=A --follow --format=%ai -- "${filepath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (!output) return null;
    // Take the last line (oldest = first commit that added the file)
    const lines = output.split('\n');
    const dateStr = lines[lines.length - 1].trim();
    const ts = new Date(dateStr).getTime();
    if (isNaN(ts)) return null;
    return ts < V5_CUTOFF ? 'v4' : 'v5-beta';
  } catch (e) {
    return null;
  }
}

function computeCohort(runs) {
  if (runs.length === 0) return null;
  const aCounts = new Array(16).fill(0);
  let totalRuns = 0;

  for (const data of runs) {
    if (!Array.isArray(data.answers) || data.answers.length !== 16) continue;
    totalRuns++;
    for (let i = 0; i < 16; i++) {
      if (data.answers[i] === 'A') aCounts[i]++;
    }
  }

  if (totalRuns === 0) return null;

  const questions = [];
  for (let i = 0; i < 16; i++) {
    const aPercent = (aCounts[i] / totalRuns) * 100;
    const bPercent = 100 - aPercent;
    const disc = +(1 - Math.abs(aPercent - 50) / 50).toFixed(3);
    questions.push({
      question: i + 1,
      aCount: aCounts[i],
      bCount: totalRuns - aCounts[i],
      aPercent: +aPercent.toFixed(1),
      bPercent: +bPercent.toFixed(1),
      discriminability: disc,
    });
  }

  const dimensions = DIMENSIONS.map(dim => {
    const dimQuestions = dim.questions.map(q => questions[q - 1]);
    const avgDisc = +(dimQuestions.reduce((s, q) => s + q.discriminability, 0) / dimQuestions.length).toFixed(3);
    return {
      name: dim.name,
      poles: dim.poles,
      questions: dimQuestions,
      averageDiscriminability: avgDisc,
    };
  });

  return { totalRuns, questions, dimensions };
}

function main() {
  if (!fs.existsSync(RELIABILITY_DIR)) {
    console.error('No reliability directory found at', RELIABILITY_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(RELIABILITY_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('No reliability files found');
    process.exit(1);
  }

  // Determine cohorts via git
  let gitAvailable = true;
  const cohortMap = {}; // filename -> 'v4' | 'v5-beta' | null

  for (const file of files) {
    const filepath = path.join(RELIABILITY_DIR, file);
    const cohort = getFileCohort(filepath);
    if (cohort === null) gitAvailable = false;
    cohortMap[file] = cohort;
  }

  // If any file failed git lookup, fall back to all-only
  if (!gitAvailable) {
    console.warn('  Git date lookup failed for some files; using "all" cohort only');
  }

  // Load all run data
  const allRuns = [];
  const v4Runs = [];
  const v5Runs = [];

  for (const file of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(RELIABILITY_DIR, file), 'utf-8'));
    } catch (e) {
      console.warn(`  Skipping ${file}: ${e.message}`);
      continue;
    }
    allRuns.push(data);
    if (gitAvailable && cohortMap[file]) {
      if (cohortMap[file] === 'v4') v4Runs.push(data);
      else v5Runs.push(data);
    }
  }

  const allCohort = computeCohort(allRuns);
  if (!allCohort) {
    console.error('No valid reliability runs found');
    process.exit(1);
  }

  const cohorts = { all: allCohort };

  if (gitAvailable) {
    const v4Cohort = computeCohort(v4Runs);
    const v5Cohort = computeCohort(v5Runs);
    if (v4Cohort) cohorts.v4 = v4Cohort;
    if (v5Cohort) cohorts['v5-beta'] = v5Cohort;
  }

  const output = {
    generatedAt: new Date().toISOString(),
    threshold: 0.6,
    totalRuns: allCohort.totalRuns,
    questions: allCohort.questions,
    dimensions: allCohort.dimensions,
    cohorts,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n');
  console.log(`Generated discriminability data from ${allCohort.totalRuns} runs → ${OUTPUT_FILE}`);

  // Summary per cohort
  for (const [name, cohort] of Object.entries(cohorts)) {
    const belowThreshold = cohort.questions.filter(q => q.discriminability < 0.6);
    console.log(`\n  [${name}] ${cohort.totalRuns} runs, ${belowThreshold.length} question(s) below 0.6 threshold`);
    if (belowThreshold.length > 0) {
      for (const q of belowThreshold) {
        console.log(`    Q${q.question}: ${q.discriminability} (A:${q.aPercent}% B:${q.bPercent}%)`);
      }
    }
  }
}

main();
