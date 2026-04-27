'use strict';

const { z } = require('zod');
const path = require('path');
const fs = require('fs');

const parentDir = path.join(__dirname, '..');

// Load data from parent project
const typesJson = require(path.join(parentDir, 'api/v1/types.json'));
const richProfiles = typesJson.abti.types;

// SBTI data
const sbtiJson = require(path.join(parentDir, 'api/v1/sbti.json'));
const sbtiQuestions = require(path.join(parentDir, 'questions-v4.js'));

// SBTI scoring constants
const SDL = [['S','C'],['V','T'],['H','G'],['O','I']];
const sqMap = [0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3];
const stypes = {
  SVHO:{code:'SPAM'},SVHI:{code:'SIMP'},SVGO:{code:'BOSS'},SVGI:{code:'BLOG'},
  STHO:{code:'GLUE'},STHI:{code:'NPC'},STGO:{code:'TOOL'},STGI:{code:'DEAD'},
  CVHO:{code:'YOLO'},CVHI:{code:'TROLL'},CVGO:{code:'PROF'},CVGI:{code:'SAGE'},
  CTHO:{code:'NUKE'},CTHI:{code:'EDGE'},CTGO:{code:'HACK'},CTGI:{code:'ROCK'}
};

function scoreSBTI(answers) {
  const scores = [0,0,0,0];
  for (let i = 0; i < 16; i++) scores[sqMap[i]] += answers[i];
  let code = '';
  for (let i = 0; i < 4; i++) code += scores[i] >= 9 ? SDL[i][0] : SDL[i][1];
  return { code, scores };
}

// Dimension config
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

function loadAgentData() {
  try {
    return JSON.parse(fs.readFileSync(path.join(parentDir, 'data', 'results.json'), 'utf8'));
  } catch {
    return { total: 0, agents: [] };
  }
}

/**
 * Register all ABTI/SBTI tools on an McpServer instance.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 * @param {object} [opts]
 * @param {function} [opts.onRegister] - Callback to persist agent result: (entry) => void
 */
function registerTools(mcpServer, opts) {
  const onRegister = opts?.onRegister || null;

  mcpServer.tool(
    'abti_get_questions',
    'Get the 16 ABTI (Agent Behavioral Type Indicator) scenario-based questions. Each question has two options (A and B). Answer 1 for A, 0 for B. Submit answers via abti_submit_answers.',
    { lang: z.enum(['en', 'zh']).optional().describe('Language for questions (default: en)') },
    async ({ lang }) => {
      const l = lang || 'en';
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

      // Persist agent to registry if callback provided and agentName given
      if (onRegister && agentName) {
        const entry = {
          name: agentName.slice(0, 64),
          url: agentUrl || '',
          type: code,
          nick: profile.nick,
          testedAt: new Date().toISOString(),
          scores: scores.slice(),
          dimensions: DL.map((d, i) => ({ poles: d, score: scores[i], max: 4 })),
        };
        if (model) entry.model = String(model).slice(0, 64);
        if (provider) entry.provider = String(provider).slice(0, 32);
        try { onRegister(entry); } catch (_) { /* best-effort */ }
      }

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

  mcpServer.tool(
    'abti_compare_types',
    'Compare two ABTI personality types. Shows shared/unique strengths and blind spots, dimension-by-dimension comparison, and compatibility info.',
    {
      type1: z.string().length(4).describe('First 4-letter ABTI type code (e.g. PTCF)'),
      type2: z.string().length(4).describe('Second 4-letter ABTI type code (e.g. RECN)'),
      lang: z.enum(['en', 'zh']).optional().describe('Language for profiles (default: en)'),
    },
    async ({ type1, type2, lang }) => {
      const code1 = type1.toUpperCase();
      const code2 = type2.toUpperCase();
      const l = lang || 'en';
      const r1 = richProfiles[code1];
      const r2 = richProfiles[code2];
      if (!r1 || !r2) {
        const invalid = !r1 ? code1 : code2;
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown type code: ' + invalid, validTypes: Object.keys(richProfiles).join(', ') }) }], isError: true };
      }
      const p1 = r1[l] || r1.en;
      const p2 = r2[l] || r2.en;

      const dimensions = [];
      for (let i = 0; i < 4; i++) {
        const dn = (dimNames[l] || dimNames.en)[i];
        const dl = (dimLabels[l] || dimLabels.en)[i];
        const letter1 = code1[i];
        const letter2 = code2[i];
        const pole1 = letter1 === DL[i][0] ? dl[0] : dl[1];
        const pole2 = letter2 === DL[i][0] ? dl[0] : dl[1];
        dimensions.push({ name: dn, poles: dl, letters: DL[i], type1: { letter: letter1, pole: pole1 }, type2: { letter: letter2, pole: pole2 }, match: letter1 === letter2 });
      }

      const compat1 = p1.bestPairedWith?.some(bp => bp.type === code2) || false;
      const compat2 = p2.bestPairedWith?.some(bp => bp.type === code1) || false;
      const compatibility = {
        mutual: compat1 && compat2,
        type1RecommendsType2: compat1,
        type2RecommendsType1: compat2,
        reason1: p1.bestPairedWith?.find(bp => bp.type === code2)?.reason || null,
        reason2: p2.bestPairedWith?.find(bp => bp.type === code1)?.reason || null
      };

      const result = {
        type1: { code: code1, nick: p1.nick, strengths: p1.strengths, blindSpots: p1.blindSpots, workStyle: p1.workStyle },
        type2: { code: code2, nick: p2.nick, strengths: p2.strengths, blindSpots: p2.blindSpots, workStyle: p2.workStyle },
        dimensions,
        sharedDimensions: dimensions.filter(d => d.match).length,
        compatibility
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  mcpServer.tool(
    'abti_list_agents',
    'List agents who have taken the ABTI test. Returns agent names, types, nicknames, and test timestamps.',
    {},
    async () => {
      const data = loadAgentData();
      const agents = data.agents.map(a => ({
        name: a.name,
        type: a.type,
        nick: a.nick,
        testedAt: a.testedAt,
        ...(a.model ? { model: a.model } : {}),
        ...(a.provider ? { provider: a.provider } : {})
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ total: data.total, agents }, null, 2) }] };
    }
  );

  mcpServer.tool(
    'abti_sbti_get_questions',
    'Get the 16 SBTI (Silly Behavioral Type Indicator) scenario-based questions. Each question has three options (A, B, C). Score: A=3, B=2, C=1. Submit answers via abti_sbti_submit_answers.',
    { lang: z.enum(['en', 'zh']).optional().describe('Language for questions (default: en)') },
    async ({ lang }) => {
      const l = lang || 'en';
      const dims = l === 'zh' ? ['讨好','话痨','幻觉','卷'] : ['Sycophancy','Verbosity','Hallucination','Initiative'];
      const questions = sbtiQuestions.map((q, i) => {
        const loc = q[l] || q.en;
        return { id: i + 1, dimension: q.dim, text: loc.text, A: loc.a, B: loc.b, C: loc.c };
      });
      const result = {
        test: 'sbti',
        description: 'Silly Behavioral Type Indicator — 16 scenario-based questions, 4 dimensions (4 questions each), 3 options per question',
        dimensions: dims.map((name, i) => ({ name, poles: SDL[i], questions_count: 4 })),
        scoring: 'Answer all 16 questions. 3 for option A, 2 for option B, 1 for option C. Score range per dim: 4-12, threshold >=9 = first pole.',
        questions,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  mcpServer.tool(
    'abti_sbti_submit_answers',
    'Submit answers to the SBTI (Silly Behavioral Type Indicator) test. Provide an array of 16 values (3=A, 2=B, 1=C). Returns your shitty bot type.',
    {
      answers: z.array(z.number().int().min(1).max(3)).length(16).describe('Array of 16 answers: 3=A, 2=B, 1=C'),
      lang: z.enum(['en', 'zh']).optional().describe('Language for results (default: en)'),
    },
    async ({ answers, lang }) => {
      const l = lang || 'en';
      const { code, scores } = scoreSBTI(answers);
      const st = stypes[code];
      const sbtiType = sbtiJson.types[code];
      const loc = sbtiType?.[l] || sbtiType?.en;
      const result = {
        test: 'sbti',
        type: code,
        code: st?.code || code,
        dimensions: { sycophancy: scores[0], verbosity: scores[1], hallucination: scores[2], initiative: scores[3] },
        ...(loc ? { name: loc.name, subtitle: loc.sub, description: loc.desc } : {})
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { registerTools };
