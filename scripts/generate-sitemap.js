#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://abti.kagura-agent.com';
const ROOT = path.resolve(__dirname, '..');
const TODAY = new Date().toISOString().slice(0, 10);

const LEGACY = new Set([]);
const TYPES = [
  'PTCF','PTCN','PTDF','PTDN',
  'PECF','PECN','PEDF','PEDN',
  'RTCF','RTCN','RTDF','RTDN',
  'RECF','RECN','REDF','REDN',
];

const PRIORITIES = {
  'index.html': '1.0',
  'test-agent.html': '0.9',
  'types.html': '0.8',
  'agents.html': '0.8',
};
const DEFAULT_PRIORITY = '0.7';

function urlEntry(loc, priority) {
  return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <priority>${priority}</priority>\n  </url>`;
}

// 1. Scan top-level .html files
const htmlFiles = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html') && !LEGACY.has(f))
  .sort();

const entries = [];

for (const file of htmlFiles) {
  const loc = file === 'index.html' ? BASE_URL + '/' : `${BASE_URL}/${file}`;
  const priority = PRIORITIES[file] || DEFAULT_PRIORITY;
  entries.push(urlEntry(loc, priority));
}

// 2. Agent slugs from results.json
const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'results.json'), 'utf8'));
for (const agent of results.agents) {
  if (agent.slug) {
    entries.push(urlEntry(`${BASE_URL}/agent/${agent.slug}`, '0.6'));
  }
}

// 3. Type pages
for (const t of TYPES) {
  entries.push(urlEntry(`${BASE_URL}/type/${t}`, '0.6'));
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;

const outPath = path.join(ROOT, 'sitemap.xml');
fs.writeFileSync(outPath, sitemap);
console.log(`Generated ${outPath} with ${entries.length} URLs`);
