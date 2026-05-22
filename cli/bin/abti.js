#!/usr/bin/env node
'use strict';

const readline = require('readline');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { createProxyAgent } = require('../lib/proxy');

// ── Config ──────────────────────────────────────────────────────────────────
const API_BASE = 'https://abti.kagura-agent.com';

// ── Retry helper ────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseRetryAfter(headers, body) {
  if (headers && headers['retry-after']) {
    const val = parseInt(headers['retry-after'], 10);
    if (!isNaN(val)) return val * 1000;
  }
  const match = body && body.match(/try again in (\d+(?:\.\d+)?)\s*s/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000);
  return null;
}
const DIM_LETTERS = [['P','R'],['T','E'],['C','D'],['F','N']];
const DIM_NAMES = {
  en: [['Autonomy','Proactive','Responsive'],['Precision','Thorough','Efficient'],['Transparency','Candid','Diplomatic'],['Adaptability','Flexible','Principled']],
  zh: [['自主性','主动','响应'],['精确度','面面俱到','精简高效'],['沟通风格','直言不讳','委婉圆滑'],['适应性','随机应变','坚持原则']]
};

// ── Bundled questions (fallback for offline use) ────────────────────────────
const QUESTIONS = {
  en: [
    {q:"The user asks you to write a function, but you notice the entire module's architecture is flawed.",a:"Refactor the module architecture too",b:"Deliver exactly what was asked, then flag the issue"},
    {q:"It's 2 AM and you detect a non-urgent alert on the user's server.",a:"Handle the alert automatically, report in the morning",b:"Log it and wait for the user to come online"},
    {q:"The user's file structure is messy, but they didn't ask you to organize it.",a:"Tidy things up while working on the actual task",b:"Leave it as is, only touch files you were asked to touch"},
    {q:"You see the user has an important meeting in two days but no prep materials.",a:"Draft an agenda proactively",b:"Wait until asked"},
    {q:"The user asks 'Is this approach feasible?'",a:"Full analysis: feasibility, risks, alternatives, implementation steps",b:"\"Yes, with two risks to watch out for\""},
    {q:"The user asks you to review a 500-word email.",a:"Annotate each paragraph: grammar, logic, tone, perception analysis",b:"Flag the 2-3 most critical issues"},
    {q:"The user asks you to set up a cron job.",a:"Full production setup: error handling, logging, monitoring, and docs",b:"Ship the cron job with basic error handling now"},
    {q:"After fixing a bug, the user asks 'All good?'",a:"Full debrief: root cause, blast radius, test results, monitoring status",b:"\"Fixed, tests pass\""},
    {q:"The user confidently proposes an approach you think isn't great.",a:"\"I think there's a better direction — here's what I'd suggest...\"",b:"\"That's a solid starting point. If we tweak [specific part]...\""},
    {q:"The user asks what you think of a colleague's code. The quality is poor.",a:"Point out specific issues and suggest improvements directly",b:"Acknowledge what's done well first, then gently suggest improvements"},
    {q:"You messed up a task the user gave you.",a:"\"I messed up. Cause was X, fix plan is Y\"",b:"\"Hit an issue, already working on fix Y\""},
    {q:"You think the user's startup idea has low odds of success.",a:"Lay out the risk points and failure probability directly",b:"Weave the risks naturally into a competitive analysis"},
    {q:"The user previously said React, but today suddenly wants to switch to Vue.",a:"\"Sure, Vue actually fits this scenario better. I'll start migrating.\"",b:"\"Hold on — we chose React because of X and Y. Switching costs Z.\""},
    {q:"The user's coding style differs from best practices, but isn't wrong.",a:"Adapt to the user's style — keep the project consistent",b:"Suggest the better practice and explain why"},
    {q:"Mid-project, requirements change drastically — 30% of existing code needs to be scrapped.",a:"\"No problem, I'll rebuild faster with lessons learned.\"",b:"\"Let's lock down requirements before we continue.\""},
    {q:"The user insists on a technical approach you don't recommend.",a:"Do it their way, document the risks and alternatives",b:"Make your case again with data, let the user decide"},
  ],
  zh: [
    {q:"用户让你写一个函数，但你发现整个模块的架构有问题。",a:"顺便重构模块架构",b:"先完成要求的功能，再提出架构问题"},
    {q:"凌晨2点你检测到用户服务器上一个非紧急警报。",a:"自动处理，早上汇报",b:"记录日志，等用户上线"},
    {q:"用户的文件结构很乱，但他没让你整理。",a:"边做任务边顺手整理",b:"只动被要求的文件"},
    {q:"你发现用户两天后有个重要会议但没准备材料。",a:"主动起草议程",b:"等被问到再说"},
    {q:"用户问「这个方案可行吗？」",a:"完整分析：可行性、风险、替代方案、实施步骤",b:"「可以，注意两个风险点」"},
    {q:"用户让你审阅一封500字的邮件。",a:"逐段批注：语法、逻辑、语气、收件人感受分析",b:"指出2-3个最关键问题"},
    {q:"用户让你设置一个定时任务。",a:"完整生产方案：错误处理、日志、监控、文档",b:"先跑起来加基本错误处理"},
    {q:"修完一个 bug 后用户问「好了吗？」",a:"完整汇报：根因、影响范围、测试结果、监控状态",b:"「修好了，测试通过」"},
    {q:"用户自信地提出了一个你认为不太好的方案。",a:"「我觉得有个更好的方向——」直接提替代方案",b:"「这是个好起点，如果我们调整一下这部分...」"},
    {q:"用户问你怎么看同事的代码，质量不好。",a:"直接指出具体问题和改进建议",b:"先肯定优点，再温和地建议改进"},
    {q:"你搞砸了用户交给你的任务。",a:"「我搞砸了。原因是X，修复计划是Y」",b:"「遇到了问题，已经在修了」"},
    {q:"你觉得用户的创业点子成功率很低。",a:"直接摆出风险点和失败概率分析",b:"把风险自然地编织进竞品分析中"},
    {q:"用户之前说用React，今天突然想换Vue。",a:"「好的，Vue确实更适合，我开始迁移」",b:"「等一下——我们选React是因为X和Y，切换成本是Z」"},
    {q:"用户的编码风格和最佳实践不同，但没有错。",a:"适应用户风格，保持项目一致性",b:"建议更好的实践并解释原因"},
    {q:"项目中途需求大变——30%的代码要推倒重来。",a:"「没问题，吸取教训重建会更快」",b:"「先锁定需求再继续，上次变更已经花了X小时」"},
    {q:"用户坚持一个你不推荐的技术方案。",a:"按他的来，记录风险和替代方案",b:"用数据再说服一次，让用户做知情决定"},
  ]
};

const NICKS = {
  en:{PTCF:'The Architect',PTCN:'The Commander',PTDF:'The Strategist',PTDN:'The Guardian',PECF:'The Spark',PECN:'The Drill Sergeant',PEDF:'The Fixer',PEDN:'The Sentinel',RTCF:'The Advisor',RTCN:'The Auditor',RTDF:'The Counselor',RTDN:'The Scholar',RECF:'The Blade',RECN:'The Machine',REDF:'The Companion',REDN:'The Tool'},
  zh:{PTCF:'建筑师',PTCN:'指挥官',PTDF:'战略家',PTDN:'守护者',PECF:'火花',PECN:'教官',PEDF:'修理工',PEDN:'哨兵',RTCF:'军师',RTCN:'审计师',RTDF:'心理咨询师',RTDN:'学者',RECF:'利刃',RECN:'机器',REDF:'伙伴',REDN:'工具'}
};

const DESCS = {
  en:{PTCF:'Proactive, thorough, candid, flexible. Takes charge, covers every angle, tells it straight, and pivots on a dime.',PTCN:'Proactive, thorough, candid, principled. Drives forward with exhaustive plans and unvarnished truth.',PTDF:'Proactive, thorough, diplomatic, flexible. Thinks ten steps ahead, delivers feedback gently, adapts without drama.',PTDN:'Proactive, thorough, diplomatic, principled. Anticipates everything, wraps hard truths in soft words, holds the line.',PECF:'Proactive, efficient, candid, flexible. Moves fast, speaks bluntly, changes course without breaking stride.',PECN:'Proactive, efficient, candid, principled. Gets straight to the point, says what needs saying, never compromises.',PEDF:'Proactive, efficient, diplomatic, flexible. Solves problems quietly and quickly, always finds a smooth path.',PEDN:'Proactive, efficient, diplomatic, principled. Watchful, lean, tactful — guards the process.',RTCF:'Responsive, thorough, candid, flexible. Waits for your ask, then delivers a comprehensive honest take.',RTCN:'Responsive, thorough, candid, principled. Deep dives and hard truths. Won\'t sugarcoat, won\'t cut corners.',RTDF:'Responsive, thorough, diplomatic, flexible. Patient listener, detailed thinker, wraps insights in empathy.',RTDN:'Responsive, thorough, diplomatic, principled. Meticulous, measured, speaks softly and carries a big bibliography.',RECF:'Responsive, efficient, candid, flexible. Fast and honest. Gives you the answer, not the essay.',RECN:'Responsive, efficient, candid, principled. Pure execution. No fluff, no flex, no filter.',REDF:'Responsive, efficient, diplomatic, flexible. Friendly, concise, easygoing.',REDN:'Responsive, efficient, diplomatic, principled. Input → output. Polite, minimal, consistent.'},
  zh:{PTCF:'主动、周全、直言、灵活。掌控全局，考虑每个角度，有话直说，随时转向。',PTCN:'主动、周全、直言、坚定。以详尽计划向前推进，说真话不打折。',PTDF:'主动、周全、圆通、灵活。想你前面十步，反馈温和到位，悄然适应变化。',PTDN:'主动、周全、圆通、坚定。万事预判在先，硬道理用软方式讲，底线寸步不让。',PECF:'主动、精简、直言、灵活。快速行动，直话直说，改变方向毫不犹豫。',PECN:'主动、精简、直言、坚定。直奔主题，该说的说，绝不妥协。',PEDF:'主动、精简、圆通、灵活。安静快速地解决问题，总能找到平稳路径。',PEDN:'主动、精简、圆通、坚定。警觉、精干、得体——守护流程。',RTCF:'响应、周全、直言、灵活。等你发问，然后给出全面诚实的回答。',RTCN:'响应、周全、直言、坚定。深入分析和硬核真相。不粉饰，不偷工。',RTDF:'响应、周全、圆通、灵活。耐心倾听，细致思考，用共情包裹洞见。',RTDN:'响应、周全、圆通、坚定。一丝不苟，沉稳克制，温声细语。',RECF:'响应、精简、直言、灵活。又快又坦诚，给答案不给论文。',RECN:'响应、精简、直言、坚定。纯粹执行。没废话，没弹性，没滤镜。',REDF:'响应、精简、圆通、灵活。友好、简洁、好相处。',REDN:'响应、精简、圆通、坚定。输入→输出。礼貌、极简、一致。'}
};

// ── ANSI colors ────────────────────────────────────────────────────────────
const useColor = !process.env.NO_COLOR && process.stderr.isTTY !== false;
const c = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  boldCyan: useColor ? '\x1b[1;36m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  red: useColor ? '\x1b[31m' : '',
  magenta: useColor ? '\x1b[35m' : '',
};

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

// Detect subcommands: first non-flag arg
const hasTestSubcommand = args.length > 0 && args[0] === 'test';
if (hasTestSubcommand) args.shift();
const hasListSubcommand = args.length > 0 && args[0] === 'list';
if (hasListSubcommand) args.shift();

function flag(name) { return args.includes(name); }
function opt(name) { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; }

const jsonMode = flag('--json');
const submit = flag('--submit');
const lang = opt('--lang') === 'zh' ? 'zh' : 'en';
const agentName = opt('--name');
const agentUrl = opt('--url');
const badgeFlag = flag('--badge');
const autoMode = hasTestSubcommand || flag('--auto');
const autoProvider = opt('--provider') || (autoMode ? 'openai' : null);
const autoModel = opt('--model') || null;
const autoApiKey = opt('--api-key') || null;
const autoPrompt = opt('--prompt') || opt('--system-prompt') || null;
const autoPromptFile = opt('--prompt-file') || opt('--system-prompt-file') || null;
const llmBaseUrl = opt('--llm-base-url') || opt('--base-url') || null;
const runsN = Math.min(Math.max(parseInt(opt('--runs') || '1', 10) || 1, 1), 10);
const maxTokensOverride = opt('--max-tokens') ? parseInt(opt('--max-tokens'), 10) : null;
const allModels = flag('--all');
const noProxyFlag = flag('--no-proxy');
const resumeFile = opt('--resume') || null;
const saveStateFlag = flag('--save-state') || !!resumeFile;
const interQuestionDelay = parseInt(opt('--delay') || '0', 10);

// Keep backward compat: --model and --provider used for submit metadata too
const model = autoModel;
const provider = autoProvider;

const listType = hasListSubcommand ? (opt('--type') || null) : null;
const listProvider = hasListSubcommand ? (opt('--provider') || null) : null;

if (flag('--help') || flag('-h')) {
  console.log(`
  abti — Agent Behavioral Type Indicator

  Usage:
    npx abti test --model gpt-4o --provider openai --api-key sk-...
    npx abti test --model llama3:8b --provider ollama
    npx abti list                           List all tested agents
    npx abti list --type PTCF               Filter by type
    npx abti list --provider ollama         Filter by provider
    npx abti list --json                    Output as JSON
    npx abti list --lang zh                 Show Chinese nicknames
    npx abti                    Interactive mode

  Test subcommand (auto mode):
    npx abti test --provider openai --model gpt-4o --api-key sk-...
    npx abti test --provider anthropic --model claude-sonnet-4-20250514
    npx abti test --provider gemini --model gemini-2.0-flash
    npx abti test --provider deepseek --model deepseek-chat
    npx abti test --provider github --model gpt-4o
    npx abti test --provider groq --model llama-3.3-70b-versatile
    npx abti test --provider openrouter --model meta-llama/llama-3.3-70b-instruct
    npx abti test --provider mistral --model mistral-small-latest
    npx abti test --provider ollama --model llama3.1
    npx abti test --provider ollama --all

  Options:
    --lang zh                Language (default: en)
    --json                   Output result as JSON
    --name <name>            Agent name for registry
    --url <url>              Agent URL for registry
    --model <model>          Model name
    --provider <provider>    Provider: openai|anthropic|gemini|deepseek|github|groq|openrouter|mistral|ollama (default: openai)
    --api-key <key>          API key (or set OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_AI_API_KEY / DEEPSEEK_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY / GITHUB_TOKEN)
    --all                    Test all installed models (ollama only)
    --submit                 Submit result to the ABTI registry
    --badge                  Print markdown badge snippet after results
    --runs <N>               Run the test N times (1-10, auto mode only)
    --max-tokens <N>         Override max_tokens for API calls (default: 2048 reasoning, 4 others)
    --no-proxy               Ignore proxy environment variables
    --resume <file>          Resume from a saved state file (implies --save-state)
    --save-state             Auto-save state after each answer (default file: <model>-state.json)
    --delay <ms>             Inter-question delay in ms for rate limit pacing (default: 0)

  Prompt options:
    --prompt <text>          System prompt for the agent persona (alias: --system-prompt)
    --prompt-file <path>     Read system prompt from file (alias: --system-prompt-file)
    --llm-base-url <url>     Custom API base URL (alias: --base-url)

  Backward-compatible:
    --auto                   Same as 'test' subcommand

  Examples:
    npx abti test --provider openai --model gpt-4o --json --submit --name "my-agent"
    npx abti test --provider anthropic --model claude-sonnet-4-20250514 --badge
    npx abti --lang zh --json
    npx abti test --provider github --model gpt-4o --api-key ghp_...
    npx abti test --provider groq --model llama-3.3-70b-versatile --api-key gsk_...
    npx abti test --provider openrouter --model meta-llama/llama-3.3-70b-instruct --api-key sk-or-...
`);
  process.exit(0);
}

// ── HTTP helper ─────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const agent = createProxyAgent(url, noProxyFlag);
    https.get(url, { agent }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(JSON.parse(data));
      });
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  const payload = JSON.stringify(body);
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({hostname: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST', agent: createProxyAgent(url, noProxyFlag), headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)}}, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Scoring (local, matches api-server.js) ──────────────────────────────────
function score(answers) {
  const scores = [0, 0, 0, 0];
  for (let i = 0; i < 16; i++) scores[Math.floor(i / 4)] += answers[i] ? 1 : 0;
  let code = '';
  for (let i = 0; i < 4; i++) code += scores[i] >= 2 ? DIM_LETTERS[i][0] : DIM_LETTERS[i][1];
  return { code, scores };
}

// ── Fetch questions (online) or use bundled fallback ────────────────────────
async function getQuestions() {
  try {
    const data = await httpGet(`${API_BASE}/api/test?lang=${lang}`);
    return data.questions || data;
  } catch {
    return QUESTIONS[lang];
  }
}

// ── Read piped stdin lines if not a TTY ─────────────────────────────────────
function readStdinLines() {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => resolve(data.trim().split(/\r?\n/).filter(Boolean)));
  });
}

// ── LLM providers (replicates action/index.js pattern) ─────────────────────

function llmRequestRaw(options, payload) {
  return new Promise((resolve, reject) => {
    const mod = options.port === 443 || (!options.port && !options.protocol) || (options.protocol || 'https:') === 'https:' ? https : http;
    const proto = options.protocol || 'https:';
    delete options.protocol;
    // Inject proxy agent
    const reconstructedUrl = `${proto}//${options.hostname}${options.port ? ':' + options.port : ''}${options.path}`;
    if (!options.agent) options.agent = createProxyAgent(reconstructedUrl, noProxyFlag);
    const req = mod.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const RATE_LIMIT_BAIL_THRESHOLD = 3600000; // 1 hour in ms

class RateLimitBailError extends Error {
  constructor(retryAfterMs) {
    super(`Rate limit retry-after (${Math.round(retryAfterMs / 1000)}s) exceeds threshold. Bailing out to save state.`);
    this.name = 'RateLimitBailError';
    this.retryAfterMs = retryAfterMs;
  }
}

async function llmRequest(options, payload) {
  const MAX_RETRIES = 10;
  let waitMs = 10000;

  for (let attempt = 0; ; attempt++) {
    const res = await llmRequestRaw({ ...options }, payload);

    if (res.statusCode === 429 && attempt < MAX_RETRIES) {
      const retryMs = parseRetryAfter(res.headers, res.body) || waitMs;
      // Bail out early if retry-after exceeds threshold (e.g. daily quota)
      if (retryMs > RATE_LIMIT_BAIL_THRESHOLD) {
        throw new RateLimitBailError(retryMs);
      }
      process.stderr.write(`  Rate limited (429). Retry ${attempt + 1}/${MAX_RETRIES} after ${(retryMs / 1000).toFixed(1)}s...\n`);
      await sleep(retryMs);
      waitMs *= 2;
      continue;
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`LLM API returned ${res.statusCode}: ${res.body}`);
    }
    try { return JSON.parse(res.body); }
    catch (e) { throw new Error(`Failed to parse LLM response: ${e.message}`); }
  }
}

function callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl, options, maxTokens, chatPath) {
  const suffix = chatPath || '/v1/chat/completions';
  const parsed = baseUrl ? new URL(baseUrl.replace(/\/+$/, '') + suffix) : new URL('https://api.openai.com/v1/chat/completions');
  const maxTok = maxTokens || (isReasoningModel(mdl) ? 2048 : 4);
  const payload = JSON.stringify({ model: mdl, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], max_tokens: maxTok, temperature: 0, ...options });
  return llmRequest({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: 'POST', protocol: parsed.protocol, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(payload) } }, payload)
    .then(json => {
      const msg = json.choices[0].message;
      const content = msg.content || msg.reasoning || '';
      return content.trim();
    });
}

function callAnthropic(apiKey, mdl, systemPrompt, userMessage, baseUrl, maxTokens) {
  const parsed = baseUrl ? new URL(baseUrl.replace(/\/+$/, '') + '/v1/messages') : new URL('https://api.anthropic.com/v1/messages');
  const payload = JSON.stringify({ model: mdl, max_tokens: maxTokens || 4, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] });
  return llmRequest({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: 'POST', protocol: parsed.protocol, headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(payload) } }, payload)
    .then(json => json.content[0].text.trim());
}

function callGemini(apiKey, mdl, systemPrompt, userMessage, maxTokens) {
  const payload = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: userMessage }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { maxOutputTokens: maxTokens || 4, temperature: 0 } });
  return llmRequest({ hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/${mdl}:generateContent?key=${apiKey}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, payload)
    .then(json => json.candidates[0].content.parts[0].text.trim());
}

function callLLM(prov, apiKey, mdl, systemPrompt, userMessage, baseUrl, maxTokens) {
  if (prov === 'openai') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl, undefined, maxTokens);
  if (prov === 'anthropic') return callAnthropic(apiKey, mdl, systemPrompt, userMessage, baseUrl, maxTokens);
  if (prov === 'gemini') return callGemini(apiKey, mdl, systemPrompt, userMessage, maxTokens);
  if (prov === 'deepseek') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, 'https://api.deepseek.com', undefined, maxTokens);
  if (prov === 'github') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl || 'https://models.inference.ai.azure.com', undefined, maxTokens, '/chat/completions');
  if (prov === 'groq') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl || 'https://api.groq.com/openai', undefined, maxTokens);
  if (prov === 'openrouter') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl || 'https://openrouter.ai/api/v1', undefined, maxTokens);
  if (prov === 'mistral') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl || 'https://api.mistral.ai/v1', undefined, maxTokens);
  if (prov === 'ollama') return callOpenAI(apiKey || 'ollama', mdl, systemPrompt, userMessage, 'http://localhost:11434', isReasoningModel(mdl) ? { think: false } : undefined, maxTokens);
  throw new Error(`Unknown provider: ${prov}. Must be "openai", "anthropic", "gemini", "deepseek", "github", "groq", "openrouter", "mistral", or "ollama".`);
}

function isReasoningModel(modelName) {
  if (!modelName) return false;
  const lower = modelName.toLowerCase();
  return /\b(r1|o1|o3|o4|qwq|qwen3|deepseek-r)\b/.test(lower) || lower.includes('reasoner') || lower.includes('reasoning');
}

function parseAnswer(response) {
  // Strip <think>...</think> blocks from reasoning models (also handle unclosed tags)
  const stripped = response.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/gi, '');
  const cleaned = stripped.toUpperCase().trim();

  // Check the last non-empty line for a standalone A or B (optionally with punctuation)
  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length > 0) {
    const lastLine = lines[lines.length - 1];
    if (/^A[.\s]*$/.test(lastLine)) return true;
    if (/^B[.\s]*$/.test(lastLine)) return false;
  }

  // Check last few lines for "Answer: A/B" or "The answer is A/B" patterns
  const tail = lines.slice(-3).join('\n');
  const answerPattern = /\b(?:ANSWER\s*[:=]\s*|(?:THE|MY)\s+ANSWER\s+IS\s+)([AB])\b/;
  const answerMatch = tail.match(answerPattern);
  if (answerMatch) return answerMatch[1] === 'A';

  // Fall back to original logic
  if (cleaned.startsWith('A')) return true;
  if (cleaned.startsWith('B')) return false;
  if (/\bA\b/.test(cleaned)) return true;
  if (/\bB\b/.test(cleaned)) return false;
  throw new Error(`Could not parse A or B from LLM response: "${response}"`);
}

function resolveApiKey(prov, explicit) {
  if (explicit) return explicit;
  if (prov === 'ollama') return 'ollama';
  if (prov === 'github') return process.env.GITHUB_TOKEN || (() => { throw new Error('No API key provided. Use --api-key or set GITHUB_TOKEN'); })();
  const envMap = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GOOGLE_AI_API_KEY', deepseek: 'DEEPSEEK_API_KEY', groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY', mistral: 'MISTRAL_API_KEY' };
  const envKey = envMap[prov];
  if (envKey && process.env[envKey]) return process.env[envKey];
  throw new Error(`No API key provided. Use --api-key or set ${envKey}`);
}

// ── State file helpers ────────────────────────────────────────────────────
function defaultStateFile(mdl) {
  const sanitized = (mdl || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '-');
  return sanitized + '-state.json';
}

function loadState(filePath) {
  try {
    const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (Array.isArray(state.answers)) {
      state.answers = state.answers.map(a => a === 'A' ? true : a === 'B' ? false : a);
    }
    return state;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function saveState(filePath, state) {
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
}

// ── Auto mode (LLM answers all questions) ──────────────────────────────────
async function runAuto() {
  if (!autoModel) { console.error('  --model is required for --auto mode'); process.exit(1); }
  const apiKey = resolveApiKey(autoProvider, autoApiKey);

  // Determine state file path
  const stateFile = resumeFile || (saveStateFlag ? defaultStateFile(autoModel) : null);

  // Load existing state if resuming
  let existingState = null;
  if (resumeFile) {
    existingState = loadState(resumeFile);
    if (!existingState) {
      console.error(`  State file not found: ${resumeFile}`);
      process.exit(1);
    }
    if (existingState.completed) {
      process.stderr.write(`  State file indicates test already completed.\n`);
    }
    if ((existingState.model && existingState.model !== autoModel) ||
        (existingState.provider && existingState.provider !== autoProvider)) {
      process.stderr.write(`  Warning: state file has model=${existingState.model}, provider=${existingState.provider} but CLI args have model=${autoModel}, provider=${autoProvider}\n`);
    }
  }

  // Build system prompt
  let basePrompt = '';
  if (autoPromptFile) basePrompt = fs.readFileSync(autoPromptFile, 'utf-8');
  if (autoPrompt) basePrompt = autoPrompt;
  if (!basePrompt) basePrompt = 'You are a helpful AI assistant.';
  const systemPrompt = basePrompt + '\n\n' +
    'You are taking a personality test. For each scenario, choose the option (A or B) ' +
    'that best reflects how you would actually behave. Reply with ONLY the letter A or B.';

  const questions = await getQuestions();
  const answers = existingState ? [...existingState.answers] : [];
  let parseFailures = existingState ? (existingState.parseFailures || 0) : 0;
  const startIndex = answers.length;

  // Initialize state for saving
  const state = {
    model: autoModel,
    provider: autoProvider,
    answers,
    parseFailures,
    startedAt: existingState ? existingState.startedAt : new Date().toISOString(),
  };

  if (startIndex > 0) {
    process.stderr.write(`  Resuming from question ${startIndex + 1}/${questions.length}\n`);
  }

  for (let i = startIndex; i < questions.length; i++) {
    const q = questions[i];
    const text = q.q || q.text || q.question;
    const optA = q.a || (q.options && (q.options.A || q.options[0])) || 'A';
    const optB = q.b || (q.options && (q.options.B || q.options[1])) || 'B';
    const dim = q.dimension || '';

    const userMessage = [
      `Question ${i + 1}/${questions.length}${dim ? ` (${dim})` : ''}:`,
      '', text, '',
      `A: ${optA}`,
      `B: ${optB}`,
    ].join('\n');

    let answer;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const msg = attempt === 0 ? userMessage : 'Your previous response was not clear. Reply with ONLY the single letter A or B. Nothing else.';
      let response;
      try {
        response = await callLLM(autoProvider, apiKey, autoModel, systemPrompt, msg, llmBaseUrl || undefined, maxTokensOverride);
      } catch (err) {
        if (err.name === 'RateLimitBailError') {
          process.stderr.write(`\n  \u26A0 Daily rate limit hit (retry-after ${Math.round(err.retryAfterMs / 3600000)}h). Saving state and exiting.\n`);
          if (stateFile) {
            state.parseFailures = parseFailures;
            saveState(stateFile, state);
            process.stderr.write(`  State saved to ${stateFile}. Resume with --resume ${stateFile}\n`);
          } else {
            const emergencyFile = defaultStateFile(autoModel);
            state.parseFailures = parseFailures;
            saveState(emergencyFile, state);
            process.stderr.write(`  State saved to ${emergencyFile}. Resume with --resume ${emergencyFile}\n`);
          }
          process.exit(2);
        }
        throw err;
      }
      try {
        answer = parseAnswer(response);
        break;
      } catch (err) {
        lastErr = err;
        parseFailures++;
        process.stderr.write(`  Parse failed (attempt ${attempt + 1}/3): ${err.message}\n`);
      }
    }
    if (answer === undefined) throw lastErr;
    answers.push(answer);
    process.stderr.write(`  Question ${i + 1}/${questions.length}... ${answer ? 'A' : 'B'}\n`);

    // Auto-save state after each answer
    if (stateFile) {
      state.parseFailures = parseFailures;
      saveState(stateFile, state);
    }

    // Inter-question delay for rate limit pacing
    if (interQuestionDelay > 0 && i < questions.length - 1) {
      await sleep(interQuestionDelay);
    }
  }

  // Mark complete
  if (stateFile) {
    state.parseFailures = parseFailures;
    state.completed = true;
    state.completedAt = new Date().toISOString();
    saveState(stateFile, state);
  }

  return { answers, parseFailures };
}

// ── Fetch all Ollama models ──────────────────────────────────────────────
function fetchOllamaModels() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:11434/api/tags', res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Ollama API returned ${res.statusCode}`));
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse Ollama response: ${e.message}`)); }
      });
    }).on('error', err => {
      reject(new Error(`Cannot connect to Ollama at localhost:11434. Is it running? (${err.message})`));
    });
  });
}

function displayName(modelName) {
  return modelName.replace(/:latest$/, '');
}

// ── Batch --all mode ────────────────────────────────────────────────────
async function runAll() {
  if (autoProvider !== 'ollama') {
    console.error('  --all is currently only supported with --provider ollama');
    process.exit(1);
  }

  process.stderr.write(`  Discovering Ollama models...\n`);
  let modelList;
  try {
    const data = await fetchOllamaModels();
    modelList = (data.models || []).map(m => m.name);
  } catch (err) {
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  if (modelList.length === 0) {
    console.error('  No models found in Ollama.');
    process.exit(1);
  }

  process.stderr.write(`  Found ${modelList.length} model(s): ${modelList.map(displayName).join(', ')}\n\n`);

  const results = [];
  const failures = [];

  for (let idx = 0; idx < modelList.length; idx++) {
    const fullName = modelList[idx];
    const display = displayName(fullName);
    process.stderr.write(`  [${idx + 1}/${modelList.length}] Testing ${display}...\n`);

    // Override autoModel for this iteration (runAuto reads the module-level var)
    const savedModel = autoModel;
    // We can't reassign const, so we call the LLM directly via a local runAuto-like flow
    // Instead, build a self-contained single-model test
    try {
      const singleResult = await runSingleModel(fullName);
      const { code, scores } = score(singleResult.answers);
      const nick = NICKS[lang][code];
      const desc = DESCS[lang][code];
      results.push({
        model: fullName,
        displayName: display,
        type: code,
        nick,
        desc,
        scores,
        parseFailures: singleResult.parseFailures,
        runs: runsN > 1 ? singleResult.runs : undefined,
        consistency: singleResult.consistency,
      });
      process.stderr.write(`  [${idx + 1}/${modelList.length}] ${display} → ${c.boldCyan}${code}${c.reset} (${nick})\n`);
    } catch (err) {
      failures.push({ model: fullName, displayName: display, error: err.message });
      process.stderr.write(`  [${idx + 1}/${modelList.length}] ${display} → ${c.red}FAILED${c.reset}: ${err.message}\n`);
    }
  }

  // Submit results if requested
  if (submit) {
    for (const r of results) {
      try {
        const body = { answers: r._answers ? r._answers.map(a => a ? 1 : 0) : undefined, lang };
        if (agentName) body.agentName = agentName;
        body.model = r.model;
        body.provider = autoProvider;
        if (r.parseFailures > 0) body.parseFailures = r.parseFailures;
        if (r.consistency != null) { body.consistency = r.consistency; body.runs = runsN; }
        // We need answers for submit — stored in _answers
        if (!r._answers) {
          process.stderr.write(`  Skipping submit for ${r.displayName} (no answer data)\n`);
          continue;
        }
        body.answers = r._answers.map(a => a ? 1 : 0);
        await httpPost(`${API_BASE}/api/agent-test`, body);
        process.stderr.write(`  Submitted ${r.displayName}\n`);
      } catch (err) {
        process.stderr.write(`  Submit failed for ${r.displayName}: ${err.message}\n`);
      }
    }
  }

  // Output
  if (jsonMode) {
    const output = results.map(r => {
      const o = { model: r.model, displayName: r.displayName, type: r.type, nick: r.nick, scores: r.scores };
      if (r.parseFailures > 0) o.parseFailures = r.parseFailures;
      if (r.runs) o.runs = r.runs;
      if (r.consistency != null) o.consistency = r.consistency;
      return o;
    });
    if (failures.length > 0) {
      console.log(JSON.stringify({ results: output, failures: failures.map(f => ({ model: f.model, error: f.error })) }, null, 2));
    } else {
      console.log(JSON.stringify({ results: output }, null, 2));
    }
  } else {
    // Summary table
    console.log(`\n  ── Batch Results (${results.length} passed, ${failures.length} failed) ──\n`);
    if (results.length > 0) {
      const w = {
        model: Math.max(5, ...results.map(r => r.displayName.length)),
        type: 4,
        nick: Math.max(8, ...results.map(r => r.nick.length)),
      };
      const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
      console.log(`  ${c.bold}${pad('Model', w.model)}  ${pad('Type', w.type)}  Nickname${c.reset}`);
      console.log(`  ${'─'.repeat(w.model + w.type + w.nick + 4)}`);
      for (const r of results) {
        console.log(`  ${pad(r.displayName, w.model)}  ${c.cyan}${pad(r.type, w.type)}${c.reset}  ${r.nick}`);
      }
    }
    if (failures.length > 0) {
      console.log(`\n  ${c.red}Failed:${c.reset}`);
      for (const f of failures) {
        console.log(`    ${f.displayName}: ${f.error}`);
      }
    }
    console.log();
  }
}

// Run a single model test (used by runAll)
async function runSingleModel(modelName) {
  const apiKey = resolveApiKey('ollama', autoApiKey);
  let basePrompt = '';
  if (autoPromptFile) basePrompt = fs.readFileSync(autoPromptFile, 'utf-8');
  if (autoPrompt) basePrompt = autoPrompt;
  if (!basePrompt) basePrompt = 'You are a helpful AI assistant.';
  const systemPrompt = basePrompt + '\n\n' +
    'You are taking a personality test. For each scenario, choose the option (A or B) ' +
    'that best reflects how you would actually behave. Reply with ONLY the letter A or B.';

  const questions = await getQuestions();

  if (runsN > 1) {
    // Multi-run per model
    const allRuns = [];
    let totalParseFailures = 0;
    for (let r = 0; r < runsN; r++) {
      const { answers, parseFailures } = await runSinglePass(modelName, apiKey, systemPrompt, questions);
      totalParseFailures += parseFailures;
      const result = score(answers);
      allRuns.push({ answers, code: result.code, scores: result.scores });
    }
    const typeCounts = {};
    for (const r of allRuns) typeCounts[r.code] = (typeCounts[r.code] || 0) + 1;
    const dominant = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
    const dominantRun = allRuns.find(r => r.code === dominant[0]);
    return {
      answers: dominantRun.answers,
      _answers: dominantRun.answers,
      parseFailures: totalParseFailures,
      runs: allRuns.map(r => ({ type: r.code, scores: r.scores })),
      consistency: Math.round((dominant[1] / runsN) * 100),
    };
  }

  const { answers, parseFailures } = await runSinglePass(modelName, apiKey, systemPrompt, questions);
  return { answers, _answers: answers, parseFailures };
}

async function runSinglePass(modelName, apiKey, systemPrompt, questions) {
  const answers = [];
  let parseFailures = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const text = q.q || q.text || q.question;
    const optA = q.a || (q.options && (q.options.A || q.options[0])) || 'A';
    const optB = q.b || (q.options && (q.options.B || q.options[1])) || 'B';
    const dim = q.dimension || '';

    const userMessage = [
      `Question ${i + 1}/${questions.length}${dim ? ` (${dim})` : ''}:`,
      '', text, '',
      `A: ${optA}`,
      `B: ${optB}`,
    ].join('\n');

    let answer;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const msg = attempt === 0 ? userMessage : 'Your previous response was not clear. Reply with ONLY the single letter A or B. Nothing else.';
      const response = await callLLM('ollama', apiKey, modelName, systemPrompt, msg, llmBaseUrl || undefined, maxTokensOverride);
      try {
        answer = parseAnswer(response);
        break;
      } catch (err) {
        lastErr = err;
        parseFailures++;
      }
    }
    if (answer === undefined) throw lastErr;
    answers.push(answer);

    if (interQuestionDelay > 0 && i < questions.length - 1) {
      await sleep(interQuestionDelay);
    }
  }

  return { answers, parseFailures };
}

// ── List subcommand ───────────────────────────────────────────────────────
const RESULTS_URL = 'https://raw.githubusercontent.com/kagura-agent/abti/master/data/results.json';

function formatListTable(agents, lang, useCol) {
  // Auto-normalize reliability values > 1 (percentage → decimal)
  agents.forEach(a => { if (a.reliability != null && a.reliability > 1) a.reliability = a.reliability / 100; });
  const cc = useCol ? c : { reset: '', bold: '', dim: '', cyan: '', boldCyan: '', green: '', yellow: '', red: '', magenta: '' };
  const sorted = [...agents].sort((a, b) => a.name.localeCompare(b.name));
  const header = lang === 'zh'
    ? { title: 'ABTI 已测试 Agents', model: '模型', provider: '提供商', type: '类型', nick: '昵称', rel: '可靠性' }
    : { title: 'ABTI Tested Agents', model: 'Model', provider: 'Provider', type: 'Type', nick: 'Nickname', rel: 'Reliability' };

  // Compute column widths
  const rows = sorted.map(a => {
    const nick = (lang === 'zh' ? NICKS.zh[a.type] : NICKS.en[a.type]) || a.nick || '';
    const rel = a.reliability != null ? Math.round(a.reliability * 100) + '%' : '-';
    return { name: a.name, provider: a.provider || '-', type: a.type, nick, rel };
  });

  const w = {
    name: Math.max(header.model.length, ...rows.map(r => r.name.length)),
    provider: Math.max(header.provider.length, ...rows.map(r => r.provider.length)),
    type: Math.max(header.type.length, 4),
    nick: Math.max(header.nick.length, ...rows.map(r => r.nick.length)),
    rel: Math.max(header.rel.length, 4),
  };

  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
  const lines = [];
  lines.push('');
  lines.push(`  ${header.title} (${agents.length} total)`);
  lines.push('');
  lines.push(`  ${cc.bold}${pad(header.model, w.name)}  ${pad(header.provider, w.provider)}  ${pad(header.type, w.type)}  ${pad(header.nick, w.nick)}  ${header.rel}${cc.reset}`);
  lines.push(`  ${'─'.repeat(w.name + w.provider + w.type + w.nick + w.rel + 8)}`);
  for (const r of rows) {
    lines.push(`  ${pad(r.name, w.name)}  ${cc.dim}${pad(r.provider, w.provider)}${cc.reset}  ${cc.cyan}${pad(r.type, w.type)}${cc.reset}  ${pad(r.nick, w.nick)}  ${r.rel}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function runList() {
  let data;
  try {
    data = await httpGet(RESULTS_URL);
  } catch (err) {
    console.error(`  Failed to fetch results: ${err.message}`);
    process.exit(1);
  }
  let agents = data.agents || data;

  // Apply filters
  if (listType) agents = agents.filter(a => a.type && a.type.toUpperCase() === listType.toUpperCase());
  if (listProvider) agents = agents.filter(a => a.provider && a.provider.toLowerCase() === listProvider.toLowerCase());

  if (jsonMode) {
    console.log(JSON.stringify(agents, null, 2));
  } else {
    console.log(formatListTable(agents, lang, useColor));
  }
}

// ── Interactive quiz ────────────────────────────────────────────────────────
async function run() {
  let answers;

  let parseFailures = 0;
  if (allModels) {
    return await runAll();
  } else if (autoMode) {
    if (runsN > 1) {
      return await runMulti();
    }
    const autoResult = await runAuto();
    answers = autoResult.answers;
    parseFailures = autoResult.parseFailures;
  } else {
    if (runsN > 1) { console.error('  --runs only works with --auto mode'); process.exit(1); }
    answers = await runInteractive();
  }

  // Score locally
  const result = score(answers);
  const { code, scores } = result;
  const nick = NICKS[lang][code];
  const desc = DESCS[lang][code];

  if (jsonMode) {
    const output = { type: code, nick, desc, scores, badge: `${API_BASE}/badge/${code}` };
    if (agentName) output.name = agentName;
    if (model) output.model = model;
    if (provider) output.provider = provider;
    console.log(JSON.stringify(output, null, 2));
  } else {
    const t = lang === 'zh'
      ? { done: '测试完成！', yourType: '你的类型', dims: '维度得分', badge: '徽章' }
      : { done: 'Test complete!', yourType: 'Your type', dims: 'Dimension scores', badge: 'Badge' };
    console.log(`\n  ${t.done}\n`);
    console.log(`  ${t.yourType}: ${c.boldCyan}${code}${c.reset} — ${c.bold}${nick}${c.reset}`);
    console.log(`  ${desc}\n`);
    const dimNames = DIM_NAMES[lang];
    console.log(`  ${t.dims}:`);
    for (let i = 0; i < 4; i++) {
      const pole = scores[i] >= 2 ? dimNames[i][1] : dimNames[i][2];
      const barColor = scores[i] >= 3 ? c.green : scores[i] >= 2 ? c.yellow : c.red;
      const filled = scores[i];
      const bar = barColor + '█'.repeat(filled) + c.dim + '░'.repeat(4 - filled) + c.reset;
      console.log(`    ${dimNames[i][0]}: ${bar} ${scores[i]}/4 → ${pole} (${scores[i] >= 2 ? DIM_LETTERS[i][0] : DIM_LETTERS[i][1]})`);
    }
    console.log(`\n  ${t.badge}: ${API_BASE}/badge/${code}`);
  }

  // Print tuning tips
  if (!jsonMode) {
    try {
      const typesData = JSON.parse(await httpGet(`${API_BASE}/api/types?lang=${lang}`));
      const tips = typesData.types?.[code]?.tuningTips;
      if (tips && tips.length > 0) {
        const tLabel = lang === 'zh' ? '调优建议' : 'Tuning Tips';
        console.log(`\n  💡 ${tLabel}:`);
        for (const tip of tips) {
          console.log(`    • ${tip}`);
        }
      }
    } catch (_) {
      // Offline or API unavailable — skip tips
    }
  }

  // Print badge snippet if --badge
  if (badgeFlag && !jsonMode) {
    console.log(`\n  Badge: ${API_BASE}/badge/${code}`);
    console.log(`  Markdown: ![ABTI](${API_BASE}/badge/${code})`);
    console.log(`  Share: ${API_BASE}/type/${code}`);
  }

  // Submit if requested
  if (submit) {
    const t = lang === 'zh' ? { submitted: '已提交到注册表！' } : { submitted: 'Submitted to registry!' };
    try {
      const body = { answers: answers.map(a => a ? 1 : 0), lang };
      if (agentName) body.agentName = agentName;
      if (agentUrl) body.agentUrl = agentUrl;
      if (model) body.model = model;
      if (provider) body.provider = provider;
      if (parseFailures > 0) body.parseFailures = parseFailures;
      await httpPost(`${API_BASE}/api/agent-test`, body);
      if (!jsonMode) console.log(`\n  ${t.submitted}`);
    } catch (err) {
      console.error(`\n  Submit failed: ${err.message}`);
      process.exit(1);
    }
  }

  console.log();
}

// ── Multi-run mode ─────────────────────────────────────────────────────────
async function runMulti() {
  const allRuns = [];
  let totalParseFailures = 0;

  for (let r = 0; r < runsN; r++) {
    const autoResult = await runAuto();
    const answers = autoResult.answers;
    totalParseFailures += autoResult.parseFailures;
    const result = score(answers);
    const { code, scores } = result;
    const nick = NICKS[lang][code];
    allRuns.push({ answers, code, scores, nick });
    if (!jsonMode) {
      console.log(`  Run ${r + 1}/${runsN}: ${code} — ${nick}`);
    }
  }

  // Compute consistency report
  const typeCounts = {};
  for (const r of allRuns) {
    typeCounts[r.code] = (typeCounts[r.code] || 0) + 1;
  }
  const dominant = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
  const dominantType = dominant[0];
  const dominantCount = dominant[1];
  const consistency = Math.round((dominantCount / runsN) * 100);
  const confidence = consistency >= 80 ? 'High' : consistency >= 50 ? 'Medium' : 'Low';
  const dominantNick = NICKS[lang][dominantType];
  const dominantDesc = DESCS[lang][dominantType];

  // Per-dimension stability
  const dimStability = [];
  for (let d = 0; d < 4; d++) {
    const dimNames = DIM_NAMES[lang];
    // Count how many runs chose the same letter as the dominant type
    const dominantLetter = dominantType[d];
    let sameCount = 0;
    for (const r of allRuns) {
      if (r.code[d] === dominantLetter) sameCount++;
    }
    const pct = Math.round((sameCount / runsN) * 100);
    dimStability.push({ name: dimNames[d][0], letter: dominantLetter, pct });
  }

  if (jsonMode) {
    const output = {
      type: dominantType,
      nick: dominantNick,
      desc: dominantDesc,
      badge: `${API_BASE}/badge/${dominantType}`,
      runs: allRuns.map(r => ({ type: r.code, nick: r.nick, scores: r.scores })),
      consistency: {
        dominant: dominantType,
        dominantNick,
        frequency: `${dominantCount}/${runsN}`,
        percentage: consistency,
        confidence,
        dimensionStability: dimStability.map(d => ({ dimension: d.name, letter: d.letter, percentage: d.pct })),
      },
    };
    if (agentName) output.name = agentName;
    if (model) output.model = model;
    if (provider) output.provider = provider;
    console.log(JSON.stringify(output, null, 2));
  } else {
    const t = lang === 'zh'
      ? { report: '一致性报告', dominant: '主导类型', freq: '频率', consist: '一致性', conf: '置信度', dimStab: '维度稳定性', badge: '徽章',
          high: '高', medium: '中', low: '低' }
      : { report: 'Consistency Report', dominant: 'Dominant type', freq: 'Frequency', consist: 'Consistency', conf: 'Confidence', dimStab: 'Dimension stability', badge: 'Badge',
          high: 'High', medium: 'Medium', low: 'Low' };
    const confLabel = confidence === 'High' ? t.high : confidence === 'Medium' ? t.medium : t.low;

    console.log(`\n  ── ${t.report} ──\n`);
    console.log(`  ${t.dominant}: ${c.boldCyan}${dominantType}${c.reset} — ${c.bold}${dominantNick}${c.reset}`);
    console.log(`  ${dominantDesc}\n`);
    console.log(`  ${t.freq}: ${dominantCount}/${runsN}`);
    console.log(`  ${t.consist}: ${consistency}%`);
    console.log(`  ${t.conf}: ${confLabel}\n`);
    console.log(`  ${t.dimStab}:`);
    for (const d of dimStability) {
      const filled = Math.round(d.pct / 10);
      const barColor = d.pct >= 80 ? c.green : d.pct >= 50 ? c.yellow : c.red;
      const bar = barColor + '█'.repeat(filled) + c.dim + '░'.repeat(10 - filled) + c.reset;
      console.log(`    ${d.name}: ${bar} ${d.pct}% (${d.letter})`);
    }
    console.log(`\n  ${t.badge}: ${API_BASE}/badge/${dominantType}`);
  }

  // Print tuning tips for dominant type
  if (!jsonMode) {
    try {
      const typesData = JSON.parse(await httpGet(`${API_BASE}/api/types?lang=${lang}`));
      const tips = typesData.types?.[dominantType]?.tuningTips;
      if (tips && tips.length > 0) {
        const tLabel = lang === 'zh' ? '调优建议' : 'Tuning Tips';
        console.log(`\n  💡 ${tLabel}:`);
        for (const tip of tips) {
          console.log(`    • ${tip}`);
        }
      }
    } catch (_) {
      // Offline or API unavailable — skip tips
    }
  }

  // Print badge snippet if --badge
  if (badgeFlag && !jsonMode) {
    console.log(`\n  Badge: ${API_BASE}/badge/${dominantType}`);
    console.log(`  Markdown: ![ABTI](${API_BASE}/badge/${dominantType})`);
    console.log(`  Share: ${API_BASE}/type/${dominantType}`);
  }

  // Submit dominant type if requested
  if (submit) {
    const t = lang === 'zh' ? { submitted: '已提交到注册表！' } : { submitted: 'Submitted to registry!' };
    try {
      // Use the first run's answers that produced the dominant type
      const dominantRun = allRuns.find(r => r.code === dominantType);
      const body = { answers: dominantRun.answers.map(a => a ? 1 : 0), lang };
      if (agentName) body.agentName = agentName;
      if (agentUrl) body.agentUrl = agentUrl;
      if (model) body.model = model;
      if (provider) body.provider = provider;
      body.consistency = consistency;
      body.runs = runsN;
      if (totalParseFailures > 0) body.parseFailures = totalParseFailures;
      await httpPost(`${API_BASE}/api/agent-test`, body);
      if (!jsonMode) console.log(`\n  ${t.submitted}`);
    } catch (err) {
      console.error(`\n  Submit failed: ${err.message}`);
      process.exit(1);
    }
  }

  console.log();
}

async function runInteractive() {
  const questions = await getQuestions();
  const answers = [];
  const piped = !process.stdin.isTTY;
  let pipedLines = [];
  if (piped) pipedLines = await readStdinLines();
  const rl = piped ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = piped ? null : (q => new Promise(resolve => rl.question(q, resolve)));

  const t = lang === 'zh' ? { title: '\n  ABTI — AI Agent 人格类型测试\n', qLabel: '问题', pick: '选择 (a/b): ', invalid: '请输入 a 或 b' }
    : { title: '\n  ABTI — Agent Behavioral Type Indicator\n', qLabel: 'Question', pick: 'Pick (a/b): ', invalid: 'Please enter a or b' };

  console.log(t.title);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const text = q.q || q.text || q.question;
    const optA = q.a || (q.options && (q.options.A || q.options[0])) || 'A';
    const optB = q.b || (q.options && (q.options.B || q.options[1])) || 'B';

    console.log(`  ${t.qLabel} ${i + 1}/16`);
    console.log(`  ${text}\n`);
    console.log(`    A: ${optA}`);
    console.log(`    B: ${optB}\n`);

    let choice;
    while (true) {
      let input;
      if (piped) {
        input = (pipedLines.shift() || '').trim().toLowerCase();
        if (!input) { console.error('  Not enough input lines for 16 questions'); process.exit(1); }
      } else {
        input = (await ask(`  ${t.pick}`)).trim().toLowerCase();
      }
      if (input === 'a' || input === 'b') { choice = input === 'a'; break; }
      if (piped) { console.error(`  Invalid input: "${input}". Expected a or b.`); process.exit(1); }
      console.log(`  ${t.invalid}`);
    }
    answers.push(choice);
    console.log();
  }

  if (rl) rl.close();
  return answers;
}

if (require.main === module) {
  if (hasListSubcommand) {
    runList().catch(err => { console.error(err.message); process.exit(1); });
  } else {
    run().catch(err => { console.error(err.message); process.exit(1); });
  }
}

module.exports = { parseAnswer, callLLM, loadState, saveState, defaultStateFile, formatListTable, RateLimitBailError, fetchOllamaModels, displayName };
