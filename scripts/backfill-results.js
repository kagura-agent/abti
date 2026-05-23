#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DIM_LETTERS = [['P','R'],['T','E'],['C','D'],['F','N']];

const NICKS = {
  PTCF:'The Architect', PTCN:'The Commander', PTDF:'The Strategist', PTDN:'The Guardian',
  PECF:'The Spark', PECN:'The Drill Sergeant', PEDF:'The Fixer', PEDN:'The Sentinel',
  RTCF:'The Advisor', RTCN:'The Auditor', RTDF:'The Counselor', RTDN:'The Scholar',
  RECF:'The Blade', RECN:'The Machine', REDF:'The Companion', REDN:'The Tool'
};

const DESCS = {
  PTCF:'Proactive, thorough, candid, flexible. Takes charge, covers every angle, tells it straight, and pivots on a dime.',
  PTCN:'Proactive, thorough, candid, principled. Drives forward with exhaustive plans and unvarnished truth.',
  PTDF:'Proactive, thorough, diplomatic, flexible. Thinks ten steps ahead, delivers feedback gently, adapts without drama.',
  PTDN:'Proactive, thorough, diplomatic, principled. Anticipates everything, wraps hard truths in soft words, holds the line.',
  PECF:'Proactive, efficient, candid, flexible. Moves fast, speaks bluntly, changes course without breaking stride.',
  PECN:'Proactive, efficient, candid, principled. Gets straight to the point, says what needs saying, never compromises.',
  PEDF:'Proactive, efficient, diplomatic, flexible. Solves problems quietly and quickly, always finds a smooth path.',
  PEDN:'Proactive, efficient, diplomatic, principled. Watchful, lean, tactful — guards the process.',
  RTCF:'Responsive, thorough, candid, flexible. Waits for your ask, then delivers a comprehensive honest take.',
  RTCN:'Responsive, thorough, candid, principled. Deep dives and hard truths. Won\'t sugarcoat, won\'t cut corners.',
  RTDF:'Responsive, thorough, diplomatic, flexible. Patient listener, detailed thinker, wraps insights in empathy.',
  RTDN:'Responsive, thorough, diplomatic, principled. Meticulous, measured, speaks softly and carries a big bibliography.',
  RECF:'Responsive, efficient, candid, flexible. Fast and honest. Gives you the answer, not the essay.',
  RECN:'Responsive, efficient, candid, principled. Pure execution. No fluff, no flex, no filter.',
  REDF:'Responsive, efficient, diplomatic, flexible. Friendly, concise, easygoing.',
  REDN:'Responsive, efficient, diplomatic, principled. Input → output. Polite, minimal, consistent.'
};

function computeScores(answers) {
  const scores = [0, 0, 0, 0];
  for (let i = 0; i < 16; i++) {
    if (answers[i] === 'A') scores[Math.floor(i / 4)]++;
  }
  return scores;
}

function scoresToType(scores) {
  return scores.map((s, i) => s >= 2 ? DIM_LETTERS[i][0] : DIM_LETTERS[i][1]).join('');
}

function modelToSlug(model) {
  return model.toLowerCase().replace(/[.:\/]/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function modelToName(model) {
  return model.replace(/:/g, ' ').split(/[-_ ]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function buildDimensions(scores) {
  return scores.map((s, i) => ({ poles: DIM_LETTERS[i], score: s, max: 4 }));
}

const MODEL_ALIASES = {
  'gpt-4.1-mini': 'openai/gpt-4.1-mini',
  'gpt-4.1-nano': 'openai/gpt-4.1-nano',
};

const reliabilityDir = path.join(__dirname, '..', 'data', 'reliability');
const resultsPath = path.join(__dirname, '..', 'data', 'results.json');

// 1. Read reliability runs grouped by model
const files = fs.readdirSync(reliabilityDir).filter(f => f.endsWith('.json')).sort();
const runsByModel = {};

for (const file of files) {
  const match = file.match(/^(.+)-run-(\d+)\.json$/);
  if (!match) continue;
  const data = JSON.parse(fs.readFileSync(path.join(reliabilityDir, file), 'utf8'));
  const runNum = parseInt(match[2], 10);
  const model = data.model || match[1];

  let scores, type;
  if (Array.isArray(data.answers) && data.answers.length === 16) {
    scores = computeScores(data.answers);
    type = scoresToType(scores);
  } else {
    scores = data.scores || data.dimensions || [0, 0, 0, 0];
    type = data.type || scoresToType(scores);
  }

  if (!runsByModel[model]) runsByModel[model] = [];
  runsByModel[model].push({ run: runNum, scores, type, provider: data.provider, answers: data.answers });
}

// 2. Load results and deduplicate claude-opus-4.7
const resultsData = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const seenModels = new Set();
resultsData.agents = resultsData.agents.filter(a => {
  if (!a.model) return true;
  if (seenModels.has(a.model)) {
    console.log(`Removed duplicate: ${a.name} (model: ${a.model})`);
    return false;
  }
  seenModels.add(a.model);
  return true;
});

// 3. Build model→agent index
const agentByModel = new Map();
for (const a of resultsData.agents) {
  if (a.model) agentByModel.set(a.model, a);
}

// 4. Process each model
let added = 0, updated = 0;
for (const [model, runs] of Object.entries(runsByModel)) {
  runs.sort((a, b) => a.run - b.run);
  const lastRun = runs[runs.length - 1];
  const { scores, type } = lastRun;
  const nick = NICKS[type] || '';

  // Reliability: proportion of runs matching last run's type
  const matching = runs.filter(r => r.type === type).length;
  const reliability = parseFloat((matching / runs.length).toFixed(2));

  // Consistency: % of questions where all runs agree (only if we have answers)
  let consistency;
  const allAnswers = runs.map(r => r.answers).filter(Boolean);
  if (allAnswers.length === runs.length && allAnswers.length > 1) {
    let consistent = 0;
    for (let q = 0; q < 16; q++) {
      if (allAnswers.every(a => a[q] === allAnswers[0][q])) consistent++;
    }
    consistency = Math.round((consistent / 16) * 100);
  }

  const resolvedModel = MODEL_ALIASES[model] || model;
  const agent = agentByModel.get(resolvedModel);

  if (agent) {
    agent.type = type;
    agent.nick = nick;
    agent.scores = scores;
    agent.dimensions = buildDimensions(scores);
    agent.reliability = reliability;
    agent.reliabilityRuns = runs.length;
    if (consistency != null) agent.consistency = consistency;
    agent.runs = runs.length;
    updated++;
    console.log(`Updated: ${agent.name} → ${type} (${nick}), reliability=${reliability}`);
  } else {
    const entry = {
      name: modelToName(model),
      slug: modelToSlug(model),
      url: '',
      type,
      nick,
      testedAt: new Date().toISOString(),
      scores,
      dimensions: buildDimensions(scores),
      model: resolvedModel,
      provider: lastRun.provider || 'unknown',
      reliability,
      reliabilityRuns: runs.length,
    };
    if (consistency != null) entry.consistency = consistency;
    entry.runs = runs.length;
    resultsData.agents.push(entry);
    agentByModel.set(resolvedModel, entry);
    added++;
    console.log(`Added: ${entry.name} (${resolvedModel}) → ${type} (${nick}), reliability=${reliability}`);
  }
}

// 5. Write back
fs.writeFileSync(resultsPath, JSON.stringify(resultsData, null, 2) + '\n');

const total = resultsData.agents.length;
const withR = resultsData.agents.filter(a => a.reliability != null).length;
console.log(`\nDone: ${added} added, ${updated} updated, ${total} total agents (${withR} with reliability)`);
