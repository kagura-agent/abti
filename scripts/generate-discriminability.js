#!/usr/bin/env node
'use strict';

/**
 * Generate per-question discriminability data from reliability test runs.
 *
 * Reads all data/reliability/*.json files, computes per-question A/B split
 * and discriminability score, then writes data/discriminability.json.
 *
 * Discriminability formula: disc = 1 - |%A - 50| / 50
 *   0 = all answers same (no discrimination)
 *   1 = perfect 50/50 split (maximum discrimination)
 */

const fs = require('fs');
const path = require('path');

const RELIABILITY_DIR = path.join(__dirname, '..', 'data', 'reliability');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'discriminability.json');

const DIMENSIONS = [
  { name: 'Autonomy', poles: ['P', 'R'], questions: [1, 2, 3, 4] },
  { name: 'Precision', poles: ['T', 'E'], questions: [5, 6, 7, 8] },
  { name: 'Transparency', poles: ['C', 'D'], questions: [9, 10, 11, 12] },
  { name: 'Adaptability', poles: ['F', 'N'], questions: [13, 14, 15, 16] },
];

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

  // Count A answers per question
  const aCounts = new Array(16).fill(0);
  let totalRuns = 0;

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RELIABILITY_DIR, file), 'utf-8'));
      if (!Array.isArray(data.answers) || data.answers.length !== 16) continue;
      totalRuns++;
      for (let i = 0; i < 16; i++) {
        if (data.answers[i] === 'A') aCounts[i]++;
      }
    } catch (e) {
      console.warn(`  Skipping ${file}: ${e.message}`);
    }
  }

  if (totalRuns === 0) {
    console.error('No valid reliability runs found');
    process.exit(1);
  }

  // Compute discriminability per question
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

  // Group by dimension
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

  const output = {
    totalRuns,
    generatedAt: new Date().toISOString(),
    threshold: 0.6,
    questions,
    dimensions,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n');
  console.log(`Generated discriminability data from ${totalRuns} runs → ${OUTPUT_FILE}`);

  // Summary
  const belowThreshold = questions.filter(q => q.discriminability < 0.6);
  if (belowThreshold.length > 0) {
    console.log(`\n  ⚠ ${belowThreshold.length} question(s) below 0.6 threshold:`);
    for (const q of belowThreshold) {
      console.log(`    Q${q.question}: ${q.discriminability} (A:${q.aPercent}% B:${q.bPercent}%)`);
    }
  }
}

main();
