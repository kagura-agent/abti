#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// ─── ABTI scoring constants ────────────────────────────────────────────────

const DL = [['P','R'],['T','E'],['C','D'],['F','N']];
const qMap = [0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3];

const NICKS = {
  PTCF:'The Architect', PTCN:'The Commander', PTDF:'The Strategist', PTDN:'The Guardian',
  PECF:'The Spark', PECN:'The Drill Sergeant', PEDF:'The Fixer', PEDN:'The Sentinel',
  RTCF:'The Advisor', RTCN:'The Auditor', RTDF:'The Counselor', RTDN:'The Scholar',
  RECF:'The Blade', RECN:'The Machine', REDF:'The Companion', REDN:'The Tool'
};

// ─── Scoring helpers ────────────────────────────────────────────────────────

function computeScores(answers) {
  const scores = [0, 0, 0, 0];
  for (let i = 0; i < 16; i++) {
    if (answers[i] === 'A') scores[qMap[i]]++;
  }
  return scores;
}

function scoresToType(scores) {
  return scores.map((s, i) => s >= 2 ? DL[i][0] : DL[i][1]).join('');
}

function computeReliability(allAnswers) {
  // For each question, find majority answer across runs, count agreements
  const numRuns = allAnswers.length;
  if (numRuns <= 1) return 1;

  let totalAgreement = 0;
  for (let q = 0; q < 16; q++) {
    let countA = 0;
    for (const answers of allAnswers) {
      if (answers[q] === 'A') countA++;
    }
    const majority = Math.max(countA, numRuns - countA);
    totalAgreement += majority;
  }
  return Math.round((totalAgreement / (16 * numRuns)) * 10000) / 10000;
}

function computeConsistency(allAnswers) {
  // Percentage of questions where ALL runs agree
  const numRuns = allAnswers.length;
  if (numRuns <= 1) return 100;

  let consistent = 0;
  for (let q = 0; q < 16; q++) {
    const first = allAnswers[0][q];
    if (allAnswers.every(a => a[q] === first)) consistent++;
  }
  return Math.round((consistent / 16) * 10000) / 100;
}

// ─── Slug normalization ─────────────────────────────────────────────────────

function fileSlugToResultSlug(fileSlug) {
  // Reliability files use slightly different slug conventions
  // e.g. "llama3-2-3b" vs "llama-3-2-3b", "phi4-mini" vs "phi-4-mini"
  // We'll create a mapping from the model name in the reliability file
  return fileSlug;
}

function modelToName(model) {
  // Convert model identifiers like "llama3.2:3b" to display names like "Llama 3.2 3B"
  return model
    .replace(/:/g, ' ')
    .replace(/\./g, ' ')
    .split(/[-_ ]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/(\d)\s+(\d)/g, '$1.$2'); // rejoin version numbers
}

function modelToSlug(model) {
  return model
    .toLowerCase()
    .replace(/[.:]/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Main ───────────────────────────────────────────────────────────────────

const reliabilityDir = path.join(__dirname, '..', 'data', 'reliability');
const resultsPath = path.join(__dirname, '..', 'data', 'results.json');

// Read existing results
const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const existingSlugs = new Set(results.agents.map(a => a.slug));

// Read all reliability files and group by slug
const files = fs.readdirSync(reliabilityDir).filter(f => f.endsWith('.json'));
const groups = {};

for (const file of files) {
  const match = file.match(/^(.+)-run-(\d+)\.json$/);
  if (!match) {
    console.warn(`Skipping unrecognized file: ${file}`);
    continue;
  }
  const [, fileSlug, runNum] = match;
  const data = JSON.parse(fs.readFileSync(path.join(reliabilityDir, file), 'utf8'));

  if (!groups[fileSlug]) groups[fileSlug] = [];
  groups[fileSlug].push({ run: parseInt(runNum, 10), data });
}

// Process each model group
let added = 0;
let updated = 0;
const slugs = Object.keys(groups).sort();

for (const fileSlug of slugs) {
  const runs = groups[fileSlug].sort((a, b) => a.run - b.run);
  const lastRun = runs[runs.length - 1].data;

  // Some reliability files have answers arrays, others only have scores/type
  const hasAnswers = runs.every(r => Array.isArray(r.data.answers) && r.data.answers.length === 16);

  let scores, type, nick, reliability, consistency;

  if (hasAnswers) {
    const allAnswers = runs.map(r => r.data.answers);
    scores = computeScores(lastRun.answers);
    type = scoresToType(scores);
    nick = NICKS[type] || 'Unknown';
    reliability = computeReliability(allAnswers);
    consistency = computeConsistency(allAnswers);
  } else {
    // Use pre-computed scores/type from the file
    scores = lastRun.scores || lastRun.dimensions || [0, 0, 0, 0];
    type = lastRun.type || scoresToType(scores);
    nick = NICKS[type] || 'Unknown';
    // Compute reliability from scores across runs (check if all runs got same type)
    const allTypes = runs.map(r => r.data.type);
    const allScores = runs.map(r => r.data.scores || r.data.dimensions || []);
    // Cross-run consistency: compare scores question-equivalent (dimension-level)
    let matchCount = 0;
    const total = 4 * runs.length;
    for (let d = 0; d < 4; d++) {
      const vals = allScores.map(s => s[d]);
      const majority = vals.sort()[Math.floor(vals.length / 2)];
      for (const v of allScores.map(s => s[d])) {
        if (v === majority) matchCount++;
      }
    }
    reliability = Math.round((matchCount / total) * 10000) / 10000;
    // Consistency: % of dimensions where all runs agree
    let consistentDims = 0;
    for (let d = 0; d < 4; d++) {
      const vals = allScores.map(s => s[d]);
      if (vals.every(v => v === vals[0])) consistentDims++;
    }
    consistency = Math.round((consistentDims / 4) * 10000) / 100;
  }

  // Build the slug from the model field in the reliability data
  const resultSlug = modelToSlug(lastRun.model);

  // Check if this model already exists in results
  // Try exact match first, then fuzzy match (strip all non-alphanumeric)
  const normalize = s => s.replace(/[^a-z0-9]/g, '');
  const existing = results.agents.find(a => a.slug === resultSlug)
    || results.agents.find(a => a.slug === fileSlug)
    || results.agents.find(a => normalize(a.slug) === normalize(resultSlug))
    || results.agents.find(a => normalize(a.slug) === normalize(fileSlug));

  if (existing) {
    // Update reliability data for existing entries
    existing.reliability = reliability;
    existing.reliabilityRuns = runs.length;
    existing.consistency = consistency;
    existing.runs = runs.length;
    // Also fix type/scores/dimensions if they differ (use last run)
    existing.type = type;
    existing.nick = nick;
    existing.scores = scores;
    existing.dimensions = DL.map((d, i) => ({ poles: d, score: scores[i], max: 4 }));
    updated++;
    console.log(`  Updated: ${existing.slug} → ${type} (${nick}), reliability=${reliability}, consistency=${consistency}%`);
  } else {
    // Add new entry
    const name = modelToName(lastRun.model);
    const entry = {
      name,
      slug: resultSlug,
      url: '',
      type,
      nick,
      testedAt: new Date().toISOString(),
      scores,
      dimensions: DL.map((d, i) => ({ poles: d, score: scores[i], max: 4 })),
      model: lastRun.model,
      provider: lastRun.provider,
      consistency,
      runs: runs.length,
      reliability,
      reliabilityRuns: runs.length
    };
    results.agents.push(entry);
    added++;
    console.log(`  Added: ${resultSlug} → ${type} (${nick}), reliability=${reliability}`);
  }
}

// Write updated results
fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + '\n');

console.log(`\nDone: ${added} added, ${updated} updated, ${results.agents.length} total agents`);
