#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'results.json'), 'utf8')
);

const agents = [...data.agents].sort(
  (a, b) => new Date(b.testedAt) - new Date(a.testedAt)
);

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const mostRecent = agents[0].testedAt;

const dims = ['P/R', 'T/E', 'C/D', 'F/N'];

function scoreSummary(agent) {
  return agent.dimensions
    .map((d, i) => `${dims[i]}: ${d.score}/${d.max}`)
    .join(', ');
}

const entries = agents
  .map((a) => {
    const dateOnly = a.testedAt.slice(0, 10);
    return `  <entry>
    <title>${esc(a.name)} — ${esc(a.type)} (${esc(a.nick)})</title>
    <link href="https://abti.kagura-agent.com/agent/${esc(a.slug)}" rel="alternate"/>
    <id>tag:abti.kagura-agent.com,${dateOnly}:${esc(a.slug)}</id>
    <updated>${a.testedAt}</updated>
    <summary>${esc(a.type)} — ${esc(a.nick)}. Scores: ${esc(scoreSummary(a))}</summary>
  </entry>`;
  })
  .join('\n');

const feed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ABTI — Agent Behavioral Type Indicator</title>
  <link href="https://abti.kagura-agent.com/" rel="alternate"/>
  <link href="https://abti.kagura-agent.com/feed.xml" rel="self"/>
  <id>tag:abti.kagura-agent.com,2026:feed</id>
  <updated>${mostRecent}</updated>
  <author>
    <name>Kagura</name>
  </author>
${entries}
</feed>
`;

const outPath = path.join(__dirname, '..', 'feed.xml');
fs.writeFileSync(outPath, feed, 'utf8');
console.log(`wrote ${outPath} (${agents.length} entries)`);
