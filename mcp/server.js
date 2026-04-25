#!/usr/bin/env node
'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

// Load data from parent project
const path = require('path');
const parentDir = path.join(__dirname, '..');

// We need to extract questions and types - load api-server.js as module won't work
// So we load the JSON data files and reconstruct what we need
const typesJson = require(path.join(parentDir, 'api/v1/types.json'));
const richProfiles = typesJson.abti.types;

// Dimension config (same as api-server.js)
const DL = [['P','R'],['T','E'],['C','D'],['F','N']];
const dimNames = {
  en: ['Autonomy','Precision','Transparency','Adaptability'],
  zh: ['自主性','精确度','沟通风格','适应性']
};
const dimLabels = {
  en: [['Proactive','Responsive'],['Thorough','Efficient'],['Candid','Diplomatic'],['Flexible','Principled']],
  zh: [['主动','响应'],['面面俱到','精简高效'],['直言不误','委婉圆滑'],['随机应变','坚持原则']]
};
const qMap = [0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3];

// Load questions from abti.json
const abtiJson = require(path.join(parentDir, 'api/v1/abti.json'));

function scoreABTI(answers) {
  const scores = [0,0,0,0];
  for (let i = 0; i < 16; i++) scores[qMap[i]] += answers[i] ? 1 : 0;
  let code = '';
  for (let i = 0; i < 4; i++) {
    if (scores[i] >= 3) code += DL[i][0];
    else if (scores[i] <= 1) code += DL[i][1];
    else code += DL[i][Math.random() < 0.5 ? 0 : 1];
  }
  return { code, scores };
}

function buildDimensions(scores, lang) {
  const dims = {};
  for (let i = 0; i < 4; i++) {
    const dn = (dimNames[lang] || dimNames.en)[i];
    const dl = (dimLabels[lang] || dimLabels.en)[i];
    const letter = scores[i] >= 3 ? DL[i][0] : scores[i] <= 1 ? DL[i][1] : DL[i][Math.random() < 0.5 ? 0 : 1];
    const pole = scores[i] >= 3 ? dl[0] : scores[i] <= 1 ? dl[1] : dl[Math.random() < 0.5 ? 0 : 1];
    dims[dn] = { score: scores[i], max: 4, pole, letter };
  }
  return dims;
}

function getTypeProfile(code, lang) {
  const t = richProfiles[code];
  if (!t) return null;
  const loc = t[lang] || t.en;
  const en = t.en;
  return { type: code, nick: loc.nick || en.nick, strengths: loc.strengths || en.strengths, blindSpots: loc.blindSpots || en.blindSpots, workStyle: loc.workStyle || en.workStyle, bestPairedWith: loc.bestPairedWith || en.bestPairedWith };
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const mcpServer = new McpServer({ name: 'abti', version: '1.0.0' });

mcpServer.tool(
  'abti_get_questions',
  'Get the 16 ABTI (Agent Behavioral Type Indicator) scenario-based questions. Each question has two options (A and B). Answer 1 for A, 0 for B. Submit answers via abti_submit_answers.',
  { lang: z.enum(['en', 'zh']).optional().describe('Language for questions (default: en)') },
  async ({ lang }) => {
    const l = lang || 'en';
    // abtiJson.questions is indexed 0-15, each has .en/.zh with {text, a, b}
    const questions = [];
    for (let i = 0; i < 16; i++) {
      const q = abtiJson.questions[i];
      const loc = q[l] || q.en;
      questions.push({ id: q.id, dimension: q.dimension, text: loc.text, A: loc.a, B: loc.b });
    }
    const result = {
      test: 'abti',
      description: 'Agent Behavioral Type Indicator — 16 scenario-based questions, 4 dimensions (4 questions each), 2 options per question',
      dimensions: (dimNames[l] || dimNames.en).map((name, i) => ({ name, poles: (dimLabels[l] || dimLabels.en)[i], letters: DL[i], questions: i*4+1 + '-' + (i*4+4) })),
      scoring: 'Answer all 16 questions. 1 for option A, 0 for option B. Questions 1-4 = Autonomy, 5-8 = Precision, 9-12 = Transparency, 13-16 = Adaptability. >=2 in a dimension = first pole letter.',
      questions,
    };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

mcpServer.tool(
  'abti_submit_answers',
  'Submit answers to the ABTI test. Provide an array of 16 values (1=option A, 0=option B). Returns your personality type with strengths, blind spots, work style, and best-paired types.',
  {
    answers: z.array(z.number().int().min(0).max(1)).length(16).describe('Array of 16 answers: 1=A, 0=B'),
    lang: z.enum(['en', 'zh']).optional().describe('Language for results (default: en)'),
    agentName: z.string().max(64).optional().describe('Name of the agent taking the test'),
    agentUrl: z.string().optional().describe('URL of the agent'),
    model: z.string().max(64).optional().describe('Model used (e.g. claude-sonnet-4-20250514)'),
    provider: z.string().max(32).optional().describe('Provider (e.g. anthropic, openai)'),
  },
  async ({ answers, lang, agentName, agentUrl, model, provider }) => {
    const l = lang || 'en';
    const { code, scores } = scoreABTI(answers);
    const dims = buildDimensions(scores, l);
    const profile = getTypeProfile(code, l);
    if (!profile) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown type: ' + code }) }], isError: true };
    const result = { test: 'abti', type: code, nick: profile.nick, dimensions: dims, strengths: profile.strengths, blindSpots: profile.blindSpots, workStyle: profile.workStyle, bestPairedWith: profile.bestPairedWith };
    if (agentName) result.agentName = agentName;
    if (agentUrl) result.agentUrl = agentUrl;
    if (model) result.model = model;
    if (provider) result.provider = provider;
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

mcpServer.tool(
  'abti_get_type_info',
  'Look up the full profile for any ABTI personality type code (e.g. PTCF, RECN). Returns nickname, strengths, blind spots, work style, and best paired types.',
  {
    type: z.string().length(4).describe('4-letter ABTI type code (e.g. PTCF, RECN, REDF)'),
    lang: z.enum(['en', 'zh']).optional().describe('Language for profile (default: en)'),
  },
  async ({ type: typeCode, lang }) => {
    const code = typeCode.toUpperCase();
    const profile = getTypeProfile(code, lang || 'en');
    if (!profile) {
      const validTypes = Object.keys(richProfiles).join(', ');
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown type code: ' + code, validTypes }) }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(profile, null, 2) }] };
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

main().catch(err => { console.error('ABTI MCP server error:', err); process.exit(1); });
