#!/usr/bin/env node
'use strict';

const readline = require('readline');
const https = require('https');

// ── Config ──────────────────────────────────────────────────────────────────
const API_BASE = 'https://abti.kagura-agent.com';
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

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name) { return args.includes(name); }
function opt(name) { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; }

const jsonMode = flag('--json');
const submit = flag('--submit');
const lang = opt('--lang') === 'zh' ? 'zh' : 'en';
const agentName = opt('--name');
const agentUrl = opt('--url');

if (flag('--help') || flag('-h')) {
  console.log(`
  abti — Agent Behavioral Type Indicator

  Usage:
    npx abti                 Interactive test
    npx abti --json          Output result as JSON
    npx abti --lang zh       Chinese questions
    npx abti --name myAgent  Set agent name
    npx abti --url URL       Set agent URL
    npx abti --submit        Submit result to registry

  Combine flags:
    npx abti --name myBot --submit --json
`);
  process.exit(0);
}

// ── HTTP helper ─────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
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
    const req = https.request({hostname: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST', headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)}}, res => {
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

// ── Interactive quiz ────────────────────────────────────────────────────────
async function run() {
  const questions = await getQuestions();
  const answers = [];
  const piped = !process.stdin.isTTY;
  let pipedLines = [];
  if (piped) pipedLines = await readStdinLines();
  const rl = piped ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = piped ? null : (q => new Promise(resolve => rl.question(q, resolve)));

  const t = lang === 'zh' ? { title: '\n  ABTI — AI Agent 人格类型测试\n', qLabel: '问题', optA: 'A', optB: 'B', pick: '选择 (a/b): ', invalid: '请输入 a 或 b', done: '测试完成！', yourType: '你的类型', dims: '维度得分', badge: '徽章', submitted: '已提交到注册表！' }
    : { title: '\n  ABTI — Agent Behavioral Type Indicator\n', qLabel: 'Question', optA: 'A', optB: 'B', pick: 'Pick (a/b): ', invalid: 'Please enter a or b', done: 'Test complete!', yourType: 'Your type', dims: 'Dimension scores', badge: 'Badge', submitted: 'Submitted to registry!' };

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

  // Score locally
  const result = score(answers);
  const { code, scores } = result;
  const nick = NICKS[lang][code];
  const desc = DESCS[lang][code];

  if (jsonMode) {
    const output = { type: code, nick, desc, scores, badge: `${API_BASE}/badge/${code}` };
    if (agentName) output.name = agentName;
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`  ${t.done}\n`);
    console.log(`  ${t.yourType}: ${code} — ${nick}`);
    console.log(`  ${desc}\n`);
    const dimNames = DIM_NAMES[lang];
    console.log(`  ${t.dims}:`);
    for (let i = 0; i < 4; i++) {
      const pole = scores[i] >= 2 ? dimNames[i][1] : dimNames[i][2];
      console.log(`    ${dimNames[i][0]}: ${scores[i]}/4 → ${pole} (${scores[i] >= 2 ? DIM_LETTERS[i][0] : DIM_LETTERS[i][1]})`);
    }
    console.log(`\n  ${t.badge}: ${API_BASE}/badge/${code}`);
  }

  // Submit if requested
  if (submit) {
    try {
      const body = { answers: answers.map(a => a ? 1 : 0), lang };
      if (agentName) body.agentName = agentName;
      if (agentUrl) body.agentUrl = agentUrl;
      await httpPost(`${API_BASE}/api/agent-test`, body);
      if (!jsonMode) console.log(`\n  ${t.submitted}`);
    } catch (err) {
      console.error(`\n  Submit failed: ${err.message}`);
      process.exit(1);
    }
  }

  console.log();
}

run().catch(err => { console.error(err.message); process.exit(1); });
