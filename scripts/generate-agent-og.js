#!/usr/bin/env node
// Generate per-agent OG PNG images (1200x630) for social sharing.
// Reads data/results.json, outputs to og/agents/<slug>.png.

const fs = require('fs');
const path = require('path');
const { generateAgentOG } = require('../lib/og-gen');

const resultsPath = path.join(__dirname, '..', 'data', 'results.json');
const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const agents = results.agents;

const outDir = path.join(__dirname, '..', 'og', 'agents');

let count = 0;
for (const agent of agents) {
  if (!agent.slug) continue;
  generateAgentOG(agent, outDir);
  console.log(`Generated og/agents/${agent.slug}.png`);
  count++;
}

console.log(`Done — ${count} agent OG images generated.`);
