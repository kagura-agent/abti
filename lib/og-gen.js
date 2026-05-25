// Shared module for generating per-agent OG PNG images (1200x630).
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const dimNames = ['Autonomy', 'Precision', 'Transparency', 'Adaptability'];
const dimLabels = [['Proactive','Responsive'],['Thorough','Efficient'],['Candid','Diplomatic'],['Flexible','Principled']];
const DL = [['P','R'],['T','E'],['C','D'],['F','N']];

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildAgentSVG(agent) {
  const { name, type, nick, scores } = agent;
  const safeName = escapeXml(name);
  const safeNick = escapeXml(nick || type);

  // Truncate long names by reducing font size
  let nameFontSize = 52;
  if (safeName.length > 30) nameFontSize = 38;
  else if (safeName.length > 20) nameFontSize = 44;

  // Build dimension bars
  const dimBars = scores.map((score, i) => {
    const letter = type[i];
    const poleIdx = DL[i].indexOf(letter);
    const pole = dimLabels[i][poleIdx];
    const dim = dimNames[i];
    const pct = (score / 4) * 100;
    const barWidth = 180;
    const fillWidth = Math.round((score / 4) * barWidth);
    const y = 380 + i * 56;

    return `  <g transform="translate(160, ${y})">
    <text x="0" y="14" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="500" fill="#8a8aad">${dim}</text>
    <text x="880" y="14" text-anchor="end" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="500" fill="#ededed">${pole}</text>
    <text x="880" y="14" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="700" fill="#ff6b9d" text-anchor="end" dx="50">${letter}</text>
    <text x="880" y="14" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="400" fill="#8a8aad" text-anchor="end" dx="90">${score}/4</text>
    <rect x="0" y="24" width="${barWidth * 5}" height="10" rx="5" fill="#1e1e38"/>
    <rect x="0" y="24" width="${fillWidth * 5}" height="10" rx="5" fill="url(#accent)"/>
  </g>`;
  }).join('\n');

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
  <text x="600" y="230" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="${nameFontSize}" font-weight="700" fill="#ededed">${safeName}</text>
  <text x="600" y="295" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="64" font-weight="700" fill="url(#accent)" letter-spacing="12">${type}</text>
  <text x="600" y="340" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="24" font-weight="400" fill="#8a8aad">${safeNick}</text>
  <line x1="200" y1="365" x2="1000" y2="365" stroke="#2a2a4a" stroke-width="1"/>
${dimBars}
</svg>`;
}

/**
 * Generate an OG PNG image for a single agent.
 * @param {object} agent - Agent object with name, type, nick, scores, slug
 * @param {string} outputDir - Directory to write PNG files into
 */
function generateAgentOG(agent, outputDir) {
  if (!agent.slug) return;
  fs.mkdirSync(outputDir, { recursive: true });
  const svg = buildAgentSVG(agent);
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const png = resvg.render().asPng();
  fs.writeFileSync(path.join(outputDir, `${agent.slug}.png`), png);
}

module.exports = { buildAgentSVG, generateAgentOG };
