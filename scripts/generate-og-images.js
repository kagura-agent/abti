#!/usr/bin/env node
// Generate OG PNG images (1200x630) for all 16 ABTI types.
// Uses the same SVG template as api-server.js /og/:type route.

const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const DL = [['P','R'],['T','E'],['C','D'],['F','N']];
const dimNames = ['Autonomy','Precision','Transparency','Adaptability'];
const dimLabels = [['Proactive','Responsive'],['Thorough','Efficient'],['Candid','Diplomatic'],['Flexible','Principled']];

const types = {
  PTCF:'The Architect', PTCN:'The Commander', PTDF:'The Strategist', PTDN:'The Guardian',
  PECF:'The Spark', PECN:'The Drill Sergeant', PEDF:'The Fixer', PEDN:'The Sentinel',
  RTCF:'The Advisor', RTCN:'The Auditor', RTDF:'The Counselor', RTDN:'The Scholar',
  RECF:'The Blade', RECN:'The Machine', REDF:'The Companion', REDN:'The Tool'
};

function buildSVG(code, nick) {
  const dimInfo = [];
  for (let i = 0; i < 4; i++) {
    const letter = code[i];
    const poleIdx = DL[i].indexOf(letter);
    const pole = dimLabels[i][poleIdx];
    const dim = dimNames[i];
    dimInfo.push({ dim, pole, letter });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0f"/>
      <stop offset="100%" stop-color="#12121f"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ff6b9d"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="60" y="60" width="1080" height="510" rx="24" fill="#17172e" stroke="#2a2a4a" stroke-width="1"/>
  <text x="600" y="130" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="22" font-weight="500" fill="#8a8aad" letter-spacing="4">ABTI \u2014 Agent Behavioral Type Indicator</text>
  <line x1="200" y1="160" x2="1000" y2="160" stroke="#2a2a4a" stroke-width="1"/>
  <text x="600" y="250" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="96" font-weight="700" fill="url(#accent)" letter-spacing="16">${code}</text>
  <text x="600" y="310" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="32" font-weight="400" fill="#ededed">${nick}</text>
  <line x1="200" y1="350" x2="1000" y2="350" stroke="#2a2a4a" stroke-width="1"/>
${dimInfo.map((d, i) => {
  const x = 160 + i * 250;
  return `  <g transform="translate(${x}, 390)">
    <rect width="190" height="130" rx="12" fill="#1e1e38" stroke="#2a2a4a" stroke-width="1"/>
    <text x="95" y="35" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="14" font-weight="500" fill="#8a8aad">${d.dim}</text>
    <text x="95" y="75" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="36" font-weight="700" fill="#ff6b9d">${d.letter}</text>
    <text x="95" y="108" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="16" font-weight="400" fill="#ededed">${d.pole}</text>
  </g>`;
}).join('\n')}
</svg>`;
}

const outDir = path.join(__dirname, '..', 'og');
fs.mkdirSync(outDir, { recursive: true });

for (const [code, nick] of Object.entries(types)) {
  const svg = buildSVG(code, nick);
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const png = resvg.render().asPng();
  const outPath = path.join(outDir, `${code}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${outPath}`);
}

console.log('Done — 16 OG images generated.');
