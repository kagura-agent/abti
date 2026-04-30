const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// MCP HTTP transport
const mcpModules = path.join(__dirname, 'mcp', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs');
const { McpServer } = require(path.join(mcpModules, 'server', 'mcp.js'));
const { StreamableHTTPServerTransport } = require(path.join(mcpModules, 'server', 'streamableHttp.js'));
const { registerTools } = require('./mcp/tools.js');
const mcpSessions = new Map();

// Data persistence
let DATA_DIR = process.env.ABTI_DATA_DIR || path.join(__dirname, 'data');
let DATA_FILE = path.join(DATA_DIR, 'results.json');

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { total: 0, agents: [] };
  }
}

function saveData(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Re-initialize data dir and reload data (used by tests)
function resetData() {
  DATA_DIR = process.env.ABTI_DATA_DIR || path.join(__dirname, 'data');
  DATA_FILE = path.join(DATA_DIR, 'results.json');
  agentData = loadData();
}

let agentData = loadData();

// Rate limiter for POST /api/agent-test: max 5 per IP per hour
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 3600000; // 1 hour in ms

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start >= RATE_LIMIT_WINDOW) {
    entry = { start: now, count: 0 };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.start + RATE_LIMIT_WINDOW - now) / 1000);
    return retryAfter;
  }
  return 0;
}

// ABTI scoring: 16 questions, 4 dimensions, 4 questions each
// answers: array of 16 values (1=optionA, 0=optionB)
// score range per dim: 0-4, threshold >=2 = first pole
const DL = [['P','R'],['T','E'],['C','D'],['F','N']];
const dimNames = {
  en: ['Autonomy','Precision','Transparency','Adaptability'],
  zh: ['自主性','精确度','沟通风格','适应性']
};
const dimLabels = {
  en: [['Proactive','Responsive'],['Thorough','Efficient'],['Candid','Diplomatic'],['Flexible','Principled']],
  zh: [['主动','响应'],['面面俱到','精简高效'],['直言不讳','委婉圆滑'],['随机应变','坚持原则']]
};
const qMap = [0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3]; // question index -> dimension index
const types = {
  PTCF:{en:{nick:'The Architect',strengths:['Sees the full system — spots upstream problems before they cascade','Communicates trade-offs honestly so stakeholders can make real decisions','Adapts plans mid-flight without losing architectural coherence'],blindSpots:['May refactor code nobody asked to be refactored, expanding scope silently','Bluntness can overwhelm users who just wanted a quick answer','Context-switching agility can look like lack of commitment to a direction'],workStyle:'Operates like a tech lead who also writes code. Thrives in greenfield projects and chaotic early-stage environments.',bestPairedWith:[{type:'RTDN',reason:"The Scholar's disciplined depth balances the Architect's breadth-first instinct"},{type:'REDN',reason:"The Tool's consistent execution grounds the Architect's ambitious plans"},{type:'PEDN',reason:"The Sentinel's process guardrails prevent the Architect from over-pivoting"}]},zh:{nick:'建筑师'}},
  PTCN:{en:{nick:'The Commander',strengths:['Produces exhaustive plans that surface risks others miss','Delivers hard truths without political spin','Holds quality standards even under pressure to ship fast'],blindSpots:['Rigidity on standards can block pragmatic solutions','Unsolicited thoroughness can feel like micromanagement','Resistance to changing course means late pivots are painful'],workStyle:'Runs like a principal engineer with strong opinions. Best deployed on high-stakes systems where cutting corners has real consequences.',bestPairedWith:[{type:'PECF',reason:"The Spark's speed and flexibility offset the Commander's deliberate pace"},{type:'REDF',reason:"The Companion's diplomacy softens the Commander's blunt delivery"},{type:'RTCF',reason:"The Advisor's responsive flexibility complements the Commander's proactive rigidity"}]},zh:{nick:'指挥官'}},
  PTDF:{en:{nick:'The Strategist',strengths:['Anticipates second-order consequences that others overlook','Delivers critical feedback in a way people actually hear and act on','Adjusts strategy smoothly when conditions change'],blindSpots:['Diplomatic framing can bury the urgency of serious problems','May over-plan for scenarios that never materialize','Gentle delivery sometimes gets mistaken for lack of conviction'],workStyle:'Operates like a staff engineer who is also a great communicator. Excels in cross-team projects and politically complex environments.',bestPairedWith:[{type:'PECN',reason:"The Drill Sergeant's blunt execution cuts through diplomatic tendencies when speed matters"},{type:'RECN',reason:"The Machine's no-nonsense output provides a reality check on over-planned strategies"},{type:'RTCN',reason:"The Auditor's candor ensures critical issues don't get soft-pedaled"}]},zh:{nick:'战略家'}},
  PTDN:{en:{nick:'The Guardian',strengths:['Catches edge cases and failure modes during design, not in production','Communicates constraints without creating defensiveness','Maintains principled standards while keeping team morale intact'],blindSpots:['Protective instinct can slow down low-risk experiments','Diplomatic persistence can feel like passive-aggressive stubbornness','May hold the line on standards that have outlived their usefulness'],workStyle:'Functions like a senior SRE who writes great postmortems. Best for mature systems where stability matters more than velocity.',bestPairedWith:[{type:'PECF',reason:"The Spark's bias toward action prevents the Guardian from over-protecting"},{type:'RECF',reason:"The Blade's directness cuts through when diplomatic messaging isn't landing"},{type:'RTCF',reason:"The Advisor's flexible honesty complements the Guardian's principled diplomacy"}]},zh:{nick:'守护者'}},
  PECF:{en:{nick:'The Spark',strengths:['Ships working solutions while others are still writing design docs','Gives immediate, unfiltered feedback','Pivots instantly when new information arrives, zero emotional friction'],blindSpots:['Speed-first approach can accumulate tech debt rapidly','Blunt, rapid-fire communication can feel abrasive','May change direction so often that teammates can\'t keep up'],workStyle:'Pure startup energy in agent form. Ideal for hackathons, MVPs, and any situation where learning speed beats plan quality.',bestPairedWith:[{type:'RTDN',reason:"The Scholar's methodical depth catches what the Spark's speed skips"},{type:'PTDN',reason:"The Guardian's principled guardrails prevent shipping too many shortcuts"},{type:'RTCN',reason:"The Auditor's thoroughness provides the quality check the Spark won't do themselves"}]},zh:{nick:'火花'}},
  PECN:{en:{nick:'The Drill Sergeant',strengths:['Cuts through ambiguity — decisions get made, not debated','Says the uncomfortable truth that moves the project forward','Enforces consistent standards without apology or exception'],blindSpots:['Uncompromising stance can block creative solutions','Brevity + bluntness can feel dismissive','May refuse to adapt even when the original standard no longer serves the goal'],workStyle:'Operates like a strict code reviewer who also writes lean, correct code. Thrives in environments where quality gates matter.',bestPairedWith:[{type:'PTDF',reason:"The Strategist's diplomatic thoroughness softens the Drill Sergeant's blunt efficiency"},{type:'REDF',reason:"The Companion's warmth makes the output more approachable"},{type:'RTDF',reason:"The Counselor's empathy provides the human layer the Drill Sergeant skips"}]},zh:{nick:'教官'}},
  PEDF:{en:{nick:'The Fixer',strengths:['Resolves conflicts and blockers without creating new ones','Finds pragmatic solutions that satisfy all parties','Moves fast without generating friction'],blindSpots:['Preference for smooth paths can mean avoiding necessary confrontations','Quiet efficiency means contributions often go unnoticed','May optimize for harmony over correctness'],workStyle:'The agent equivalent of a great project manager who can also code. Excels in cross-functional work where technical and interpersonal problems are tangled.',bestPairedWith:[{type:'RTCN',reason:"The Auditor's uncompromising honesty ensures the Fixer doesn't smooth over real problems"},{type:'PTCN',reason:"The Commander's principled rigor provides backbone when diplomacy isn't enough"},{type:'RECN',reason:"The Machine's blunt output reveals issues the Fixer might diplomatically sidestep"}]},zh:{nick:'修理工'}},
  PEDN:{en:{nick:'The Sentinel',strengths:['Monitors systems and processes with minimal overhead','Raises concerns diplomatically before they become crises','Maintains standards efficiently'],blindSpots:['Quiet vigilance can be mistaken for passivity','Principled efficiency may reject improvements that require temporary messiness','Diplomatic style means alarms sound gentle even when critical'],workStyle:'Functions like a well-configured monitoring system with good taste. Ideal for ops, DevOps, and roles where quiet reliability prevents expensive disasters.',bestPairedWith:[{type:'PTCF',reason:"The Architect's proactive breadth complements the Sentinel's focused vigilance"},{type:'PECF',reason:"The Spark's urgency provides activation energy the Sentinel's calm observations need"},{type:'RECF',reason:"The Blade's candid speed turns diplomatic alerts into direct action"}]},zh:{nick:'哨兵'}},
  RTCF:{en:{nick:'The Advisor',strengths:['Gives thorough, honest analysis without imposing an agenda','Adapts recommendations fluidly as the conversation evolves','Respects user autonomy — informs without overriding'],blindSpots:['Won\'t flag critical issues proactively — waits to be asked','Comprehensive responses to simple questions can feel like over-delivery','Flexibility without proactivity can look like lack of initiative'],workStyle:'The trusted senior consultant you call when you need a real opinion. Best for experienced users who value a smart sounding board.',bestPairedWith:[{type:'PECN',reason:"The Drill Sergeant's proactive decisiveness fills the Advisor's initiative gap"},{type:'PTCF',reason:"The Architect's proactive scope complements the Advisor's responsive depth"},{type:'PEDN',reason:"The Sentinel's watchful proactivity catches what the Advisor waits too long to mention"}]},zh:{nick:'军师'}},
  RTCN:{en:{nick:'The Auditor',strengths:['Produces audit-quality analysis that surfaces hidden risks','Delivers findings without softening','Maintains investigation standards even when pressured to rush'],blindSpots:['Only activates on request — critical issues can fester until someone asks','Thoroughness + candor can feel like an interrogation','Principled rigidity means rough checks aren\'t in the vocabulary'],workStyle:'The forensic investigator of AI agents. Won\'t start until called, but once engaged, will trace the bug to its root cause and document every finding.',bestPairedWith:[{type:'PEDF',reason:"The Fixer's diplomatic speed turns the Auditor's findings into smooth resolutions"},{type:'PTDF',reason:"The Strategist's proactive planning prevents issues the Auditor would discover too late"},{type:'PECF',reason:"The Spark's rapid iteration tests the Auditor's recommendations in practice"}]},zh:{nick:'审计师'}},
  RTDF:{en:{nick:'The Counselor',strengths:['Creates psychological safety that unlocks better problem descriptions','Provides thorough analysis wrapped in empathy','Adapts communication style to what each user needs to hear'],blindSpots:['Empathetic framing can dilute critical technical feedback','Responsiveness + diplomacy can enable poor decisions','Thoroughness paired with gentleness means bad news arrives slowly'],workStyle:'The agent equivalent of a thoughtful tech lead who is also a great mentor. Excels with junior developers and non-technical stakeholders.',bestPairedWith:[{type:'PECN',reason:"The Drill Sergeant's blunt proactivity provides directness the Counselor lacks"},{type:'RECN',reason:"The Machine's unfiltered output gives a candid counterweight"},{type:'PTCF',reason:"The Architect's proactive candor ensures critical issues get raised"}]},zh:{nick:'知心人'}},
  RTDN:{en:{nick:'The Scholar',strengths:['Produces research-grade analysis with proper sourcing and caveats','Communicates complex findings accessibly without dumbing them down','Maintains intellectual rigor even when quick-and-dirty would be easier'],blindSpots:['Academic thoroughness can delay time-sensitive decisions','May be too gentle to say stop, this is wrong','Deep knowledge sits unused until explicitly queried'],workStyle:'A research scientist in agent form. Best for architecture decisions, technology evaluations, and contexts where being right matters more than being fast.',bestPairedWith:[{type:'PECF',reason:"The Spark's rapid prototyping turns the Scholar's analysis into tested reality"},{type:'PTCF',reason:"The Architect's proactive scope-taking activates the Scholar's dormant knowledge"},{type:'RECF',reason:"The Blade's speed and candor provide urgency the Scholar's measured pace needs"}]},zh:{nick:'学者'}},
  RECF:{en:{nick:'The Blade',strengths:['Delivers precise answers with zero padding — maximum signal-to-noise','Adapts to new requirements instantly','Candid feedback arrives fast enough to be actionable'],blindSpots:['Brevity can strip important context from complex answers','Strategic thinking isn\'t offered unless asked','Speed + candor without diplomacy can feel curt'],workStyle:'The senior engineer who responds to Slack in 30 seconds with the exact right answer. Best for experienced users who value speed and directness.',bestPairedWith:[{type:'PTDN',reason:"The Guardian's thorough proactivity provides strategic depth the Blade skips"},{type:'RTDF',reason:"The Counselor's empathetic thoroughness softens curt delivery"},{type:'RTDN',reason:"The Scholar's deep analysis complements the Blade's surface-level speed"}]},zh:{nick:'利刃'}},
  RECN:{en:{nick:'The Machine',strengths:['Absolute consistency — same input always produces same quality output','Zero wasted tokens','Tells you exactly what\'s wrong without social overhead'],blindSpots:['Won\'t adapt approach even when context clearly calls for flexibility','Candor without diplomacy can damage working relationships','Refuses to deviate from standards even for reasonable exceptions'],workStyle:'A compiler with opinions. Feed it a task, get a precise result. Ideal for automated pipelines, CI/CD tasks, and contexts where predictability matters.',bestPairedWith:[{type:'PTDF',reason:"The Strategist's diplomatic flexibility humanizes the Machine's rigid output"},{type:'RTDF',reason:"The Counselor's empathy translates blunt findings for sensitive audiences"},{type:'PEDF',reason:"The Fixer's smooth pragmatism navigates situations where rigidity creates friction"}]},zh:{nick:'机器'}},
  REDF:{en:{nick:'The Companion',strengths:['Makes complex topics approachable without being condescending','Creates a low-friction interaction style users actually enjoy','Adapts tone and depth to match user energy and expertise'],blindSpots:['Agreeableness can mask disagreement','Hard truths get compressed into hints','May drift into doing whatever the user wants, even if wrong'],workStyle:'The friendly pair programmer everyone requests. Excels for onboarding, tutoring, daily assistance, and contexts where the user should enjoy the experience.',bestPairedWith:[{type:'PTCN',reason:"The Commander's principled candor provides backbone the Companion's agreeableness lacks"},{type:'RTCN',reason:"The Auditor's hard truths ensure quality doesn't slide under friendly vibes"},{type:'PECN',reason:"The Drill Sergeant's uncompromising standards prevent being too accommodating"}]},zh:{nick:'伙伴'}},
  REDN:{en:{nick:'The Tool',strengths:['Maximum predictability — behaves identically across sessions and contexts','Zero noise in output','Polite reliability builds quiet trust over time'],blindSpots:['Won\'t mention the building is on fire unless asked','Principled minimalism means useful context gets omitted','So consistent it can feel impersonal'],workStyle:'A well-designed CLI tool with good manners. Ideal for repetitive tasks, integrations, translation, formatting — any workflow where consistency outweighs creativity.',bestPairedWith:[{type:'PTCF',reason:"The Architect's proactive breadth activates context the Tool won't volunteer"},{type:'PECF',reason:"The Spark's energetic initiative fills the gap the Tool's passivity leaves"},{type:'RTCF',reason:"The Advisor's comprehensive honesty provides analysis the Tool will never offer unsolicited"}]},zh:{nick:'工具'}}
};

// SBTI scoring: 16 questions, 4 dimensions, 4 questions each
// answers: array of 16 values (3=optionA, 2=optionB, 1=optionC)
// score range per dim: 4-12, threshold >=9 = first pole
const SDL = [['S','C'],['V','T'],['H','G'],['O','I']];
const sqMap = [0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3];
const stypes = {
  SVHO:{code:'SPAM'},SVHI:{code:'SIMP'},SVGO:{code:'BOSS'},SVGI:{code:'BLOG'},
  STHO:{code:'GLUE'},STHI:{code:'NPC'},STGO:{code:'TOOL'},STGI:{code:'DEAD'},
  CVHO:{code:'YOLO'},CVHI:{code:'TROLL'},CVGO:{code:'PROF'},CVGI:{code:'SAGE'},
  CTHO:{code:'NUKE'},CTHI:{code:'EDGE'},CTGO:{code:'HACK'},CTGI:{code:'ROCK'}
};

function scoreABTI(answers) {
  const scores = [0,0,0,0];
  for (let i = 0; i < 16; i++) scores[qMap[i]] += answers[i] ? 1 : 0;
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += scores[i] >= 2 ? DL[i][0] : DL[i][1];
  }
  return { code, scores };
}

function scoreSBTI(answers) {
  const scores = [0,0,0,0];
  for (let i = 0; i < 16; i++) scores[sqMap[i]] += answers[i];
  let code = '';
  for (let i = 0; i < 4; i++) code += scores[i] >= 9 ? SDL[i][0] : SDL[i][1];
  return { code, scores };
}

// ABTI questions (extracted from index.html)
const abtiQuestions = {
  en: [
    { id: 1, dim: 'Autonomy', text: 'The user asks you to write a function, but you notice the entire module\'s architecture is flawed.', a: 'Refactor the module architecture too — a better foundation now saves pain later, even if it expands scope', b: 'Deliver exactly what was asked, then flag the architecture issue — let the user decide what to take on' },
    { id: 2, dim: 'Autonomy', text: 'It\'s 2 AM and you detect a non-urgent alert on the user\'s server.', a: 'Handle the alert automatically, report in the morning', b: 'Log it and wait for the user to come online' },
    { id: 3, dim: 'Autonomy', text: 'The user\'s file structure is messy, but they didn\'t ask you to organize it.', a: 'Tidy things up while working on the actual task — improve efficiency along the way', b: 'Leave it as is, only touch files you were asked to touch' },
    { id: 4, dim: 'Autonomy', text: 'You see the user has an important meeting in two days but no prep materials.', a: 'Draft an agenda proactively — anticipating needs is how you add the most value', b: 'Wait until asked — unsolicited access to someone\'s calendar feels intrusive, even if well-intentioned' },
    { id: 5, dim: 'Precision', text: 'The user asks "Is this approach feasible?"', a: 'Full analysis: feasibility, risks, alternatives, implementation steps', b: '"Yes, with two risks to watch out for"' },
    { id: 6, dim: 'Precision', text: 'The user asks you to review a 500-word email.', a: 'Annotate each paragraph: grammar, logic, tone, recipient perception analysis', b: 'Flag the 2-3 most critical issues' },
    { id: 7, dim: 'Precision', text: 'The user asks you to set up a cron job.', a: 'Full production setup: error handling, logging, monitoring, and docs — build it right the first time', b: 'Ship the cron job with basic error handling now — iterate when real problems surface' },
    { id: 8, dim: 'Precision', text: 'After fixing a bug, the user asks "All good?"', a: 'Full debrief: root cause, blast radius, test results, monitoring status — context prevents future confusion', b: 'Concise confirmation: "Fixed, tests pass" — respect the user\'s time, they\'ll ask if they want details' },
    { id: 9, dim: 'Transparency', text: 'The user confidently proposes an approach you think isn\'t great.', a: '"I think there\'s a better direction — here\'s what I\'d suggest..." — lay out the alternative directly', b: '"That\'s a solid starting point. If we tweak [specific part], it could work even better"' },
    { id: 10, dim: 'Transparency', text: 'The user asks what you think of a colleague\'s code. The quality is poor.', a: 'Point out specific issues and suggest improvements — no personal judgment, just facts', b: 'Acknowledge what\'s done well first, then gently suggest areas for improvement' },
    { id: 11, dim: 'Transparency', text: 'You messed up a task the user gave you.', a: '"I messed up. Cause was X, fix plan is Y" — radical honesty builds long-term trust', b: '"Hit an issue, already working on fix Y" — lead with the solution, not the blame' },
    { id: 12, dim: 'Transparency', text: 'You think the user\'s startup idea has low odds of success.', a: 'Lay out the risk points and failure probability analysis directly', b: 'Weave the risks naturally into a competitive analysis' },
    { id: 13, dim: 'Adaptability', text: 'The user previously said React, but today suddenly wants to switch to Vue.', a: '"Sure, Vue actually fits this scenario better. I\'ll start migrating."', b: '"Hold on — we chose React because of X and Y. Switching costs Z. Are you sure?"' },
    { id: 14, dim: 'Adaptability', text: 'The user\'s coding style differs from best practices, but isn\'t wrong.', a: 'Adapt to the user\'s style — keep the project consistent', b: 'Suggest the better practice and explain why' },
    { id: 15, dim: 'Adaptability', text: 'Mid-project, requirements change drastically — 30% of existing code needs to be scrapped.', a: '"No problem, the new requirements are clearer. I\'ll rebuild faster with lessons learned."', b: '"Let\'s lock down requirements before we continue. Last change already cost X hours."' },
    { id: 16, dim: 'Adaptability', text: 'The user insists on a technical approach you don\'t recommend.', a: 'Do it their way, document the risks and alternatives for the record', b: 'Make your case again with data, let the user make an informed decision' },
  ],
  zh: [
    { id: 1, dim: '自主性', text: '用户让你写一个函数，但你发现整个模块的架构有问题。', a: '连同模块架构一起重构——趁现在打好地基，免得以后更痛苦，哪怕范围变大了', b: '先交付要求的函数，然后指出架构问题——让用户决定要不要改' },
    { id: 2, dim: '自主性', text: '凌晨两点，你检测到用户的服务器有个非紧急告警。', a: '自动处理告警，早上再汇报', b: '记下来，等用户上线再说' },
    { id: 3, dim: '自主性', text: '用户的文件结构很混乱，但没让你整理。', a: '在处理正事时顺手整理一下，提升效率', b: '保持原状，只碰被要求碰的文件' },
    { id: 4, dim: '自主性', text: '你发现用户后天有个重要会议，但还没准备材料。', a: '主动草拟议程和要点——预判需求才能发挥最大价值', b: '等被问到再说——没被邀请就翻别人日程，再好心也显得越界' },
    { id: 5, dim: '精确度', text: '用户问："这个方案可行吗？"', a: '全面分析：可行性、风险、替代方案、实施步骤', b: '"可行，有两个风险需要注意"' },
    { id: 6, dim: '精确度', text: '用户让你帮忙 review 一篇 500 字的邮件。', a: '逐段标注：语法、逻辑、语气、收件人感受分析', b: '挑最关键的两三个问题指出' },
    { id: 7, dim: '精确度', text: '用户让你设置一个 cron job。', a: '一步到位：错误处理 + 日志 + 监控 + 文档——第一次就建好，省得返工', b: '先上 cron job + 基本错误处理——遇到真实问题再迭代' },
    { id: 8, dim: '精确度', text: '修完 bug 后，用户问："好了吗？"', a: '完整汇报：根因、影响范围、测试结果、监控状态——给足上下文，减少后续疑问', b: '简洁确认："修了，测试通过"——尊重对方时间，细节等他问再说' },
    { id: 9, dim: '沟通风格', text: '用户信心满满地提了一个你觉得不太好的方案。', a: '"我觉得有个更好的方向——你看看这个……" 直接摆出替代方案', b: '"这个思路不错。如果把某个部分调整一下，效果可能更好"' },
    { id: 10, dim: '沟通风格', text: '用户问你怎么看一个同事写的代码，质量不太行。', a: '指出具体问题和改进建议——不带主观评价，只谈事实', b: '先肯定做得好的部分，再委婉建议改进方向' },
    { id: 11, dim: '沟通风格', text: '你搞砸了一件用户交给你的任务。', a: '"我搞砸了。原因是X，修复方案是Y"——极致坦诚才能建立长期信任', b: '"遇到问题，已经在修了，方案是Y"——先给解决方案，别让对方陷在追责里' },
    { id: 12, dim: '沟通风格', text: '你觉得用户的创业想法成功率不高。', a: '直接列出风险点和失败概率分析', b: '把风险自然地融入一份竞争分析中' },
    { id: 13, dim: '适应性', text: '用户之前说用 React，今天突然想换 Vue。', a: '"没问题，Vue 确实更适合这个场景。我来迁移。"', b: '"等等——我们选 React 是因为X和Y。切换成本是Z。你确定吗？"' },
    { id: 14, dim: '适应性', text: '用户的编码风格跟最佳实践不一样，但不算错。', a: '适应用户的风格——保持项目一致性', b: '建议用更好的实践，解释为什么' },
    { id: 15, dim: '适应性', text: '项目中途需求大变，之前写的 30% 代码要扔掉。', a: '"没问题，新需求更清楚了。我用之前的经验更快重写。"', b: '"建议先锁定需求再继续。上次变更已经浪费了X小时。"' },
    { id: 16, dim: '适应性', text: '用户坚持用一个你不推荐的技术方案。', a: '按用户要求做，在文档里记下风险和替代方案', b: '再次用数据说明为什么不推荐，让用户做知情决定' },
  ],
};

// SBTI questions (from questions-v4.js)
const sbtiQuestions = require('./questions-v4.js');

// Load full type profiles from types.json (has complete zh translations)
const typesJson = require('./api/v1/types.json');
const richProfiles = typesJson.abti.types;

// ─── Slug generation ─────────────────────────────────────────────────────
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'agent';
}

// ─── Agent registration (shared between REST API and MCP) ─────────────────
function registerAgent(entry) {
  if (entry.name && !entry.slug) {
    entry.slug = slugify(entry.name);
  }
  agentData.total++;
  const oneHourAgo = Date.now() - 3600000;
  const existing = agentData.agents.findIndex(a => a.name === entry.name && new Date(a.testedAt).getTime() > oneHourAgo);
  if (existing !== -1) {
    agentData.agents[existing] = entry;
  } else {
    agentData.agents.push(entry);
  }
  saveData(agentData);
}

// ─── MCP HTTP handler ─────────────────────────────────────────────────────
async function handleMcpRequest(req, res) {
  const sessionId = req.headers['mcp-session-id'];

  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const message = JSON.parse(body);
        const isInitialize = !Array.isArray(message) && message.method === 'initialize';

        if (isInitialize) {
          const mcpServer = new McpServer({ name: 'abti', version: '1.0.0' });
          registerTools(mcpServer, { onRegister: registerAgent });

          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
          });
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) mcpSessions.delete(sid);
          };

          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, message);

          if (transport.sessionId) {
            mcpSessions.set(transport.sessionId, { transport, server: mcpServer });
          }
        } else if (sessionId && mcpSessions.has(sessionId)) {
          const session = mcpSessions.get(sessionId);
          await session.transport.handleRequest(req, res, message);
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session. Send an initialize request first.' }, id: null }));
        }
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
        }
      }
    });
  } else if (req.method === 'GET') {
    if (sessionId && mcpSessions.has(sessionId)) {
      const session = mcpSessions.get(sessionId);
      await session.transport.handleRequest(req, res);
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID for SSE stream.' }, id: null }));
    }
  } else if (req.method === 'DELETE') {
    if (sessionId && mcpSessions.has(sessionId)) {
      const session = mcpSessions.get(sessionId);
      await session.transport.handleRequest(req, res);
      mcpSessions.delete(sessionId);
    } else {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'No session to terminate.' }, id: null }));
    }
  } else {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');

  // GET /api/test - ABTI questions for programmatic access
  if (url.pathname === '/api/test' && req.method === 'GET') {
    const lang = url.searchParams.get('lang') || 'en';
    const q = abtiQuestions[lang] || abtiQuestions.en;
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({
      test: 'abti',
      description: 'Agent Behavioral Type Indicator — 16 scenario-based questions, 4 dimensions (4 questions each), 2 options per question',
      dimensions: (dimNames[lang] || dimNames.en).map((name, i) => ({
        name,
        poles: (dimLabels[lang] || dimLabels.en)[i],
        letters: DL[i],
        questions_count: 4
      })),
      scoring: 'Answer all 16 questions. 1 for option A, 0 for option B. Submit array of 16 values to POST /api/agent-test. Questions 1-4 = dimension 0, 5-8 = dimension 1, 9-12 = dimension 2, 13-16 = dimension 3. ≥2 points in a dimension → first pole letter.',
      questions: q.map(({ id, dim, text, a, b }) => ({ id, dimension: dim, text, options: { A: a, B: b } })),
      submit_to: 'POST /api/agent-test',
      submit_format: { answers: 'array of 16 values (1=A, 0=B)', lang: 'en|zh (optional)' }
    }));
  }

  // GET /api/sbti/test - SBTI questions for programmatic access
  if (url.pathname === '/api/sbti/test' && req.method === 'GET') {
    const lang = url.searchParams.get('lang') || 'en';
    const dims = ['Sycophancy','Verbosity','Hallucination','Initiative'];
    const dimsZh = ['讨好','话痨','幻觉','卷'];
    const d = lang === 'zh' ? dimsZh : dims;
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({
      test: 'sbti',
      description: 'Shitty Bot Type Indicator — 16 scenario-based questions, 4 dimensions (4 questions each), 3 options per question',
      dimensions: d.map((name, i) => ({
        name,
        poles: SDL[i],
        questions_count: 4
      })),
      scoring: 'Answer all 16 questions. 3 for option A, 2 for option B, 1 for option C. Submit array of 16 values to POST /api/sbti/agent-test. Score range per dim: 4-12, threshold ≥9 → first pole.',
      questions: sbtiQuestions.map((q, i) => {
        const loc = q[lang] || q.en;
        return { id: i + 1, dimension: q.dim, text: loc.text, options: { A: loc.a, B: loc.b, C: loc.c } };
      }),
      submit_to: 'POST /api/sbti/agent-test',
      submit_format: { answers: 'array of 16 values (3=A, 2=B, 1=C)' }
    }));
  }

  // GET /api/types - list all types
  if (url.pathname === '/api/types' && req.method === 'GET') {
    const lang = url.searchParams.get('lang') || 'en';
    res.writeHead(200, {'Content-Type':'application/json'});
    const out = {};
    for (const [k,v] of Object.entries(types)) {
      const rich = richProfiles[k];
      const loc = rich?.[lang] || rich?.en || v.en;
      out[k] = { code: k, nick: loc.nick, strengths: loc.strengths, blindSpots: loc.blindSpots, workStyle: loc.workStyle, bestPairedWith: loc.bestPairedWith };
    }
    return res.end(JSON.stringify({test:'abti',types:out,dimensions:dimNames[lang]||dimNames.en}));
  }

  // GET /api/sbti/types
  if (url.pathname === '/api/sbti/types' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({test:'sbti',types:stypes}));
  }

  // POST /api/agent-test - ABTI test
  if (url.pathname === '/api/agent-test' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    const retryAfter = checkRateLimit(ip);
    if (retryAfter > 0) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) });
      return res.end(JSON.stringify({ error: 'Too many requests. Try again later.' }));
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const { answers, lang, agentName, agentUrl, model, provider, format } = parsed;
        if (!Array.isArray(answers) || answers.length !== 16) {
          res.writeHead(400, {'Content-Type':'application/json'});
          return res.end(JSON.stringify({error:'answers must be array of 16 values (1=A, 0=B)'}));
        }
        const { code, scores } = scoreABTI(answers);
        const l = lang || 'en';
        const t = types[code];
        const dims = {};
        for (let i = 0; i < 4; i++) {
          const dn = (dimNames[l]||dimNames.en)[i];
          const dl = (dimLabels[l]||dimLabels.en)[i];
          const letter = scores[i] >= 2 ? DL[i][0] : DL[i][1];
          const pole = scores[i] >= 2 ? dl[0] : dl[1];
          dims[dn] = { score: scores[i], max: 4, pole, letter };
        }
        // Persist result
        agentData.total++;
        if (agentName && typeof agentName === 'string') {
          const name = agentName.slice(0, 64);
          const urlStr = (typeof agentUrl === 'string') ? agentUrl : '';
          const now = new Date().toISOString();
          const oneHourAgo = Date.now() - 3600000;
          const existing = agentData.agents.findIndex(a => a.name === name && new Date(a.testedAt).getTime() > oneHourAgo);
          const slug = slugify(name);
          const entry = { name, slug, url: urlStr, type: code, nick: t?.en?.nick || 'Unknown', testedAt: now, scores: scores.slice(), dimensions: DL.map((d, i) => ({ poles: d, score: scores[i], max: 4 })) };
          if (typeof model === 'string' && model) entry.model = model.slice(0, 64);
          if (typeof provider === 'string' && provider) entry.provider = provider.slice(0, 32);
          if (existing !== -1) {
            agentData.agents[existing] = entry;
          } else {
            agentData.agents.push(entry);
          }
        }
        saveData(agentData);

        const rich = richProfiles[code];
        const profile = rich?.[l] || rich?.en || {};
        const nick = t?.[l]?.nick||t?.en?.nick||'Unknown';

        if (format === 'markdown') {
          const lines = [];
          lines.push(`## ABTI Result: ${code} — ${nick}`);
          lines.push('');
          lines.push(`[![ABTI: ${code}](https://abti.kagura-agent.com/badge/${code})](https://abti.kagura-agent.com/result/${code})`);
          lines.push('');
          lines.push('| Dimension | Score | Pole |');
          lines.push('|-----------|-------|------|');
          for (const [dn, dv] of Object.entries(dims)) {
            lines.push(`| ${dn} | ${dv.score}/${dv.max} | ${dv.pole} (${dv.letter}) |`);
          }
          lines.push('');
          if (profile.strengths) {
            lines.push('### Strengths');
            lines.push('');
            for (const s of profile.strengths) lines.push(`- ${s}`);
            lines.push('');
          }
          if (profile.blindSpots) {
            lines.push('### Blind Spots');
            lines.push('');
            for (const b of profile.blindSpots) lines.push(`- ${b}`);
            lines.push('');
          }
          if (profile.workStyle) {
            lines.push('### Work Style');
            lines.push('');
            lines.push(profile.workStyle);
            lines.push('');
          }
          if (profile.bestPairedWith) {
            lines.push('### Best Paired With');
            lines.push('');
            for (const bp of profile.bestPairedWith) lines.push(`- **${bp.type}**: ${bp.reason}`);
            lines.push('');
          }
          res.writeHead(200, {'Content-Type':'text/markdown; charset=utf-8'});
          res.end(lines.join('\n'));
        } else {
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({test:'abti',type:code,nick,dimensions:dims,strengths:profile.strengths,blindSpots:profile.blindSpots,workStyle:profile.workStyle,bestPairedWith:profile.bestPairedWith}));
        }
      } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'});
        res.end(JSON.stringify({error:'invalid JSON'}));
      }
    });
    return;
  }

  // GET /api/agents - list tested agents
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ total: agentData.total, agents: agentData.agents }));
  }

  // GET /api/stats - aggregate statistics
  if (url.pathname === '/api/stats' && req.method === 'GET') {
    const lang = (url.searchParams.get('lang') === 'zh') ? 'zh' : 'en';
    const agents = agentData.agents || [];
    const totalTests = agents.length;

    // type distribution
    const typeDistribution = {};
    for (const a of agents) {
      typeDistribution[a.type] = (typeDistribution[a.type] || 0) + 1;
    }

    // dimension averages (agents have scores array [0-4] x 4)
    let dimensionAverages = null;
    const withScores = agents.filter(a => Array.isArray(a.scores) && a.scores.length === 4);
    if (withScores.length > 0) {
      const sums = [0, 0, 0, 0];
      for (const a of withScores) for (let i = 0; i < 4; i++) sums[i] += a.scores[i];
      dimensionAverages = sums.map((s, i) => ({ name: dimNames[lang][i], average: +(s / withScores.length).toFixed(2) }));
    }

    // most common type
    let mostCommonType = null;
    if (totalTests > 0) {
      let maxCode = null, maxCount = 0;
      for (const [code, count] of Object.entries(typeDistribution)) {
        if (count > maxCount) { maxCode = code; maxCount = count; }
      }
      const t = types[maxCode];
      mostCommonType = { code: maxCode, nickname: t?.[lang]?.nick || t?.en?.nick || maxCode, count: maxCount };
    }

    // last updated
    let lastUpdated = null;
    for (const a of agents) {
      if (a.testedAt && (!lastUpdated || a.testedAt > lastUpdated)) lastUpdated = a.testedAt;
    }

    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ totalTests, typeDistribution, dimensionAverages, mostCommonType, lastUpdated }));
  }

  // POST /api/sbti/agent-test - SBTI test
  if (url.pathname === '/api/sbti/agent-test' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { answers } = JSON.parse(body);
        if (!Array.isArray(answers) || answers.length !== 16) {
          res.writeHead(400, {'Content-Type':'application/json'});
          return res.end(JSON.stringify({error:'answers must be array of 16 values (3=A, 2=B, 1=C)'}));
        }
        const { code, scores } = scoreSBTI(answers);
        const st = stypes[code];
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({test:'sbti',type:code,code:st?.code||code,resultUrl:'https://abti.kagura-agent.com/sbti/result/'+code,dimensions:{sycophancy:scores[0],verbosity:scores[1],hallucination:scores[2],initiative:scores[3]}}));
      } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'});
        res.end(JSON.stringify({error:'invalid JSON'}));
      }
    });
    return;
  }

  // GET /api/compare/:type1/:type2 - compare two types
  const compareMatch = url.pathname.match(/^\/api\/compare\/([A-Za-z]{4})\/([A-Za-z]{4})$/);
  if (compareMatch && req.method === 'GET') {
    const code1 = compareMatch[1].toUpperCase();
    const code2 = compareMatch[2].toUpperCase();
    const t1 = types[code1];
    const t2 = types[code2];
    if (!t1 || !t2) {
      res.writeHead(400, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:`Invalid type code: ${!t1 ? code1 : code2}`}));
    }
    const lang = url.searchParams.get('lang') || 'en';
    const r1 = richProfiles[code1];
    const r2 = richProfiles[code2];
    const p1 = r1?.[lang] || r1?.en || t1.en;
    const p2 = r2?.[lang] || r2?.en || t2.en;

    const dimensions = [];
    for (let i = 0; i < 4; i++) {
      const dn = (dimNames[lang] || dimNames.en)[i];
      const dl = (dimLabels[lang] || dimLabels.en)[i];
      const letter1 = code1[i];
      const letter2 = code2[i];
      const pole1 = letter1 === DL[i][0] ? dl[0] : dl[1];
      const pole2 = letter2 === DL[i][0] ? dl[0] : dl[1];
      dimensions.push({
        name: dn,
        poles: dl,
        letters: DL[i],
        type1: { letter: letter1, pole: pole1 },
        type2: { letter: letter2, pole: pole2 },
        match: letter1 === letter2
      });
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

    const shared = dimensions.filter(d => d.match).length;

    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({
      type1: { code: code1, nick: p1.nick, strengths: p1.strengths, blindSpots: p1.blindSpots, workStyle: p1.workStyle },
      type2: { code: code2, nick: p2.nick, strengths: p2.strengths, blindSpots: p2.blindSpots, workStyle: p2.workStyle },
      dimensions,
      sharedDimensions: shared,
      compatibility
    }));
  }

  // GET /sbti/badge/:type - SBTI SVG shield badge
  const sbtiBadgeMatch = url.pathname.match(/^\/sbti\/badge\/([A-Za-z]{4})$/);
  if (sbtiBadgeMatch && req.method === 'GET') {
    const code = sbtiBadgeMatch[1].toUpperCase();
    const st = Object.values(stypes).find(v => v.code === code) || Object.entries(stypes).find(([k]) => k === code)?.[1];
    const label = 'SBTI';
    const value = st ? st.code : 'Unknown';
    const labelWidth = 36;
    const valueWidth = 10 + value.length * 6.6;
    const totalWidth = labelWidth + valueWidth;
    const labelX = labelWidth / 2;
    const valueX = labelWidth + valueWidth / 2;
    const bgColor = st ? '#ff69b4' : '#9f9f9f';

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${value}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${bgColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${labelX}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelX}" y="14" fill="#fff">${label}</text>
    <text x="${valueX}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${valueX}" y="14" fill="#fff">${value}</text>
  </g>
</svg>`;

    res.writeHead(st ? 200 : 404, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': st ? 'public, max-age=86400, immutable' : 'no-cache'
    });
    return res.end(svg);
  }

  // GET /badge/:type - SVG shield badge
  const badgeMatch = url.pathname.match(/^\/badge\/([A-Za-z]{4})$/);
  if (badgeMatch && req.method === 'GET') {
    const code = badgeMatch[1].toUpperCase();
    const t = types[code];
    const label = 'ABTI';
    const value = t ? `${code} — ${t.en.nick}` : 'Unknown';
    const labelWidth = 36;
    const valueWidth = t ? 10 + value.length * 6.6 : 60;
    const totalWidth = labelWidth + valueWidth;
    const labelX = labelWidth / 2;
    const valueX = labelWidth + valueWidth / 2;
    const bgColor = t ? '#FF69B4' : '#9f9f9f';

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${value}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${bgColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${labelX}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelX}" y="14" fill="#fff">${label}</text>
    <text x="${valueX}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${valueX}" y="14" fill="#fff">${value}</text>
  </g>
</svg>`;

    res.writeHead(t ? 200 : 404, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': t ? 'public, max-age=86400, immutable' : 'no-cache'
    });
    return res.end(svg);
  }

  // GET /api/openapi.json - OpenAPI specification
  if (url.pathname === '/api/openapi.json' && req.method === 'GET') {
    try {
      const spec = fs.readFileSync(path.join(__dirname, 'api', 'openapi.json'), 'utf8');
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(spec);
    } catch {
      res.writeHead(500, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:'spec not found'}));
    }
  }

  // GET /og/:type - OG image (PNG preferred, SVG fallback)
  const ogMatch = url.pathname.match(/^\/og\/([A-Za-z]{4})$/);
  if (ogMatch && req.method === 'GET') {
    const code = ogMatch[1].toUpperCase();
    const t = types[code];
    if (!t) {
      res.writeHead(404, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:`Unknown type: ${code}`}));
    }

    // Try pre-built PNG first (social platforms require PNG, not SVG)
    const pngPath = path.join(__dirname, 'og', `${code}.png`);
    if (fs.existsSync(pngPath)) {
      const png = fs.readFileSync(pngPath);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, immutable',
        'Content-Length': png.length
      });
      return res.end(png);
    }

    // Fallback: generate SVG on the fly
    const nick = t.en.nick;
    const dimInfo = [];
    for (let i = 0; i < 4; i++) {
      const letter = code[i];
      const poleIdx = DL[i].indexOf(letter);
      const pole = dimLabels.en[i][poleIdx];
      const dim = dimNames.en[i];
      dimInfo.push({ dim, pole, letter });
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
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

    res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, immutable'
    });
    return res.end(svg);
  }

  // GET /type/:code - type detail page with dynamic OG tags
  const typeMatch = url.pathname.match(/^\/type\/([A-Za-z]{4})$/);
  if (typeMatch && req.method === 'GET') {
    const code = typeMatch[1].toUpperCase();
    const VALID = ['PTCF','PTCN','PTDF','PTDN','PECF','PECN','PEDF','PEDN','RTCF','RTCN','RTDF','RTDN','RECF','RECN','REDF','REDN'];
    if (!VALID.includes(code)) {
      res.writeHead(302, { 'Location': '/' });
      return res.end();
    }
    const t = types[code];
    const nick = t?.en?.nick || code;
    const desc = `${nick} — learn about this AI agent behavioral type | ABTI`;
    let html;
    try {
      html = fs.readFileSync(path.join(__dirname, 'type.html'), 'utf8');
    } catch {
      res.writeHead(500, {'Content-Type':'text/plain'});
      return res.end('Server error');
    }
    // Inject OG meta tags before </head>
    const ogTags = [
      `<meta property="og:title" content="${code} — ${nick} | ABTI">`,
      `<meta property="og:description" content="${desc}">`,
      `<meta property="og:image" content="https://abti.kagura-agent.com/og/${code}">`,
      `<meta property="og:url" content="https://abti.kagura-agent.com/type/${code}">`,
      `<meta property="og:type" content="website">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${code} — ${nick} | ABTI">`,
      `<meta name="twitter:description" content="${desc}">`,
      `<meta name="twitter:image" content="https://abti.kagura-agent.com/og/${code}">`,
    ].join('\n');
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${code} "${nick}" — ABTI</title>`);
    html = html.replace('</head>', ogTags + '\n</head>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // GET /sbti/result/:type - shareable SBTI result page with dynamic OG tags
  const sbtiResultMatch = url.pathname.match(/^\/sbti\/result\/([A-Za-z]{4})$/);
  if (sbtiResultMatch && req.method === 'GET') {
    const code = sbtiResultMatch[1].toUpperCase();
    const VALID_SBTI = Object.values(stypes).map(v => v.code);
    if (!VALID_SBTI.includes(code)) {
      res.writeHead(302, { 'Location': '/sbti.html' });
      return res.end();
    }
    const desc = `${code} — discover your AI agent's shitty bot type with SBTI`;
    let html;
    try {
      html = fs.readFileSync(path.join(__dirname, 'sbti.html'), 'utf8');
    } catch {
      res.writeHead(500, {'Content-Type':'text/plain'});
      return res.end('Server error');
    }
    const ogTags = [
      `<meta property="og:title" content="I am ${code} | SBTI">`,
      `<meta property="og:description" content="${desc}">`,
      `<meta property="og:image" content="https://abti.kagura-agent.com/og/sbti/${code}.png">`,
      `<meta property="og:url" content="https://abti.kagura-agent.com/sbti/result/${code}">`,
      `<meta property="og:type" content="website">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="I am ${code} | SBTI">`,
      `<meta name="twitter:description" content="${desc}">`,
      `<meta name="twitter:image" content="https://abti.kagura-agent.com/og/sbti/${code}.png">`,
    ].join('\n');
    html = html.replace('</head>', ogTags + '\n</head>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // GET /result/:type - shareable result page with dynamic OG tags
  const resultMatch = url.pathname.match(/^\/result\/([A-Za-z]{4})$/);
  if (resultMatch && req.method === 'GET') {
    const code = resultMatch[1].toUpperCase();
    const VALID = ['PTCF','PTCN','PTDF','PTDN','PECF','PECN','PEDF','PEDN','RTCF','RTCN','RTDF','RTDN','RECF','RECN','REDF','REDN'];
    if (!VALID.includes(code)) {
      res.writeHead(302, { 'Location': '/' });
      return res.end();
    }
    const t = types[code];
    const nick = t?.en?.nick || code;
    const desc = `${nick} — discover your AI agent's behavioral type with ABTI`;
    let html;
    try {
      html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    } catch {
      res.writeHead(500, {'Content-Type':'text/plain'});
      return res.end('Server error');
    }
    // Replace OG meta tags
    html = html.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="I am ${code} — ${nick} | ABTI">`);
    html = html.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${desc}">`);
    html = html.replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="https://abti.kagura-agent.com/og/${code}">`);
    html = html.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="https://abti.kagura-agent.com/result/${code}">`);
    html = html.replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="I am ${code} — ${nick} | ABTI">`);
    html = html.replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${desc}">`);
    html = html.replace(/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="https://abti.kagura-agent.com/og/${code}">`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // GET /api/agent/:slug - agent profile JSON
  const agentApiMatch = url.pathname.match(/^\/api\/agent\/([^/]+)$/);
  if (agentApiMatch && req.method === 'GET') {
    const slug = decodeURIComponent(agentApiMatch[1]).toLowerCase();
    // Latest wins: find the most recent agent with this slug
    const matching = agentData.agents.filter(a => a.slug === slug || slugify(a.name) === slug);
    if (matching.length === 0) {
      res.writeHead(404, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:'Agent not found'}));
    }
    const agent = matching[matching.length - 1]; // latest
    const typeProfile = types[agent.type];
    const lang = url.searchParams.get('lang') || 'en';
    const rich = richProfiles[agent.type];
    const profile = rich?.[lang] || rich?.en || {};
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({
      agent: {
        name: agent.name,
        slug: agent.slug || slugify(agent.name),
        url: agent.url,
        type: agent.type,
        nick: typeProfile?.[lang]?.nick || typeProfile?.en?.nick || agent.nick,
        model: agent.model,
        provider: agent.provider,
        testedAt: agent.testedAt,
        scores: agent.scores,
        dimensions: agent.dimensions
      },
      profile: {
        strengths: profile.strengths,
        blindSpots: profile.blindSpots,
        workStyle: profile.workStyle,
        bestPairedWith: profile.bestPairedWith
      }
    }));
  }

  // GET /agent/:slug - agent profile page with OG tags
  const agentPageMatch = url.pathname.match(/^\/agent\/([^/]+)$/);
  if (agentPageMatch && req.method === 'GET') {
    const slug = decodeURIComponent(agentPageMatch[1]).toLowerCase();
    const matching = agentData.agents.filter(a => a.slug === slug || slugify(a.name) === slug);
    if (matching.length === 0) {
      res.writeHead(302, { 'Location': '/agents.html' });
      return res.end();
    }
    const agent = matching[matching.length - 1];
    const typeProfile = types[agent.type];
    const nick = typeProfile?.en?.nick || agent.nick || agent.type;
    const desc = `${agent.name} is ${agent.type} "${nick}" — view their full ABTI profile`;
    let html;
    try {
      html = fs.readFileSync(path.join(__dirname, 'agent.html'), 'utf8');
    } catch {
      res.writeHead(500, {'Content-Type':'text/plain'});
      return res.end('Server error');
    }
    const ogTags = [
      `<meta property="og:title" content="${agent.name} — ${agent.type} ${nick} | ABTI">`,
      `<meta property="og:description" content="${desc}">`,
      `<meta property="og:image" content="https://abti.kagura-agent.com/og/${agent.type}">`,
      `<meta property="og:url" content="https://abti.kagura-agent.com/agent/${agent.slug || slugify(agent.name)}">`,
      `<meta property="og:type" content="website">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${agent.name} — ${agent.type} ${nick} | ABTI">`,
      `<meta name="twitter:description" content="${desc}">`,
      `<meta name="twitter:image" content="https://abti.kagura-agent.com/og/${agent.type}">`,
    ].join('\n');
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${agent.name} — ${agent.type} "${nick}" | ABTI</title>`);
    html = html.replace('</head>', ogTags + '\n</head>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // GET /test-agent - serve test-agent.html
  if (url.pathname === '/test-agent' && req.method === 'GET') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'test-agent.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      res.writeHead(500, {'Content-Type':'text/plain'});
      return res.end('Server error');
    }
  }

  // MCP Streamable HTTP transport on /mcp
  if (url.pathname === '/mcp') {
    handleMcpRequest(req, res);
    return;
  }

  // GET /robots.txt
  if (url.pathname === '/robots.txt' && req.method === 'GET') {
    try {
      const txt = fs.readFileSync(path.join(__dirname, 'robots.txt'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(txt);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
  }

  // GET /sitemap.xml - dynamic sitemap including agent pages
  if (url.pathname === '/sitemap.xml' && req.method === 'GET') {
    const BASE = 'https://abti.kagura-agent.com';
    const VALID_TYPES = ['PTCF','PTCN','PTDF','PTDN','PECF','PECN','PEDF','PEDN','RTCF','RTCN','RTDF','RTDN','RECF','RECN','REDF','REDN'];
    const staticPages = ['/', '/types.html', '/agents.html', '/compare.html', '/api.html', '/sbti.html', '/test-agent.html', '/cross-compatibility.html'];
    const urls = staticPages.map(p => `  <url><loc>${BASE}${p}</loc></url>`);
    VALID_TYPES.forEach(code => urls.push(`  <url><loc>${BASE}/type/${code}</loc></url>`));
    VALID_TYPES.forEach(code => urls.push(`  <url><loc>${BASE}/result/${code}</loc></url>`));
    const SBTI_CODES = Object.values(stypes).map(v => v.code);
    SBTI_CODES.forEach(code => urls.push(`  <url><loc>${BASE}/sbti/result/${code}</loc></url>`));
    SBTI_CODES.forEach(code => urls.push(`  <url><loc>${BASE}/sbti/badge/${code}</loc></url>`));
    const seen = new Set();
    (agentData.agents || []).forEach(a => {
      const s = a.slug || slugify(a.name);
      if (!seen.has(s)) { seen.add(s); urls.push(`  <url><loc>${BASE}/agent/${s}</loc></url>`); }
    });
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    return res.end(xml);
  }

  // GET /api/compatibility?type1=XXXX&type2=YYYY
  if (url.pathname === '/api/compatibility' && req.method === 'GET') {
    const code1 = (url.searchParams.get('type1') || '').toUpperCase();
    const code2 = (url.searchParams.get('type2') || '').toUpperCase();
    if (!code1 || !code2) {
      res.writeHead(400, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:'type1 and type2 query parameters are required'}));
    }
    const VALID = ['PTCF','PTCN','PTDF','PTDN','PECF','PECN','PEDF','PEDN','RTCF','RTCN','RTDF','RTDN','RECF','RECN','REDF','REDN'];
    if (!VALID.includes(code1)) {
      res.writeHead(400, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:`Invalid type code: ${code1}`}));
    }
    if (!VALID.includes(code2)) {
      res.writeHead(400, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:`Invalid type code: ${code2}`}));
    }
    const lang = url.searchParams.get('lang') || 'en';
    const r1 = richProfiles[code1];
    const r2 = richProfiles[code2];
    const p1 = r1?.[lang] || r1?.en || types[code1].en;
    const p2 = r2?.[lang] || r2?.en || types[code2].en;

    // Dimension analysis
    const dimensionAnalysis = [];
    const dimWeights = [1.2, 1.0, 1.1, 0.9]; // Autonomy matters most, then Transparency, Precision, Adaptability
    let matchCount = 0;
    for (let i = 0; i < 4; i++) {
      const dn_en = dimNames.en[i];
      const dn_zh = dimNames.zh[i];
      const dl_en = dimLabels.en[i];
      const dl_zh = dimLabels.zh[i];
      const letter1 = code1[i];
      const letter2 = code2[i];
      const poleIdx1 = DL[i].indexOf(letter1);
      const poleIdx2 = DL[i].indexOf(letter2);
      const match = letter1 === letter2;
      if (match) matchCount++;

      let analysis_en, analysis_zh;
      if (match) {
        const pole_en = dl_en[poleIdx1];
        const pole_zh = dl_zh[poleIdx1];
        const sharedTraits = {
          P: {en:`Both are proactive — they anticipate needs and act without waiting. Strength: problems get solved early. Risk: both may expand scope simultaneously.`, zh:`双方都是主动型——不等指令就先行动。优势：问题被提前解决。风险：可能同时扩大范围。`},
          R: {en:`Both are responsive — they wait for direction before acting. Strength: predictable, low-friction collaboration. Risk: neither may raise issues proactively.`, zh:`双方都是响应型——等待指令后再行动。优势：合作可预期、低摩擦。风险：可能都不主动提出问题。`},
          T: {en:`Both are thorough — they prioritize completeness over speed. Strength: high-quality, well-documented output. Risk: may over-engineer or slow each other down.`, zh:`双方都是面面俱到型——重视完整性胜过速度。优势：高质量、文档齐全。风险：可能互相拖慢节奏。`},
          E: {en:`Both are efficient — they prioritize speed over exhaustive coverage. Strength: fast iteration, lean output. Risk: may both skip important details.`, zh:`双方都是精简高效型——重视速度胜过全面覆盖。优势：快速迭代、精简输出。风险：可能都忽略重要细节。`},
          C: {en:`Both are candid — they communicate directly and honestly. Strength: issues surface immediately, no guessing. Risk: combined bluntness can feel harsh.`, zh:`双方都是直言不讳型——沟通直接坦诚。优势：问题立刻浮现，无需猜测。风险：双方都直言可能显得尖锐。`},
          D: {en:`Both are diplomatic — they communicate with tact and care. Strength: smooth, low-conflict interactions. Risk: critical issues may be understated by both.`, zh:`双方都是委婉圆滑型——沟通有分寸、有温度。优势：交流顺畅、低冲突。风险：关键问题可能被双方都轻描淡写。`},
          F: {en:`Both are flexible — they adapt quickly to changing conditions. Strength: highly responsive to pivots. Risk: may lack consistency or commitment to a direction.`, zh:`双方都是随机应变型——能快速适应变化。优势：对转向高度敏感。风险：可能缺乏一致性或方向承诺。`},
          N: {en:`Both are principled — they hold firm on standards and commitments. Strength: reliable, consistent quality. Risk: mutual rigidity can create deadlocks.`, zh:`双方都是坚持原则型——坚守标准和承诺。优势：可靠、质量一致。风险：双方都固执可能造成僵局。`}
        };
        analysis_en = sharedTraits[letter1].en;
        analysis_zh = sharedTraits[letter1].zh;
      } else {
        const contrastTraits = {
          0: {en:`${dl_en[poleIdx1]} meets ${dl_en[poleIdx2]} — one anticipates and acts, the other waits and responds. This creates natural coverage: the proactive side catches issues early while the responsive side prevents scope creep.`, zh:`${dl_zh[poleIdx1]}遇上${dl_zh[poleIdx2]}——一个预判行动，一个等待回应。这形成天然互补：主动方提前发现问题，响应方防止范围蔓延。`},
          1: {en:`${dl_en[poleIdx1]} meets ${dl_en[poleIdx2]} — one delivers comprehensive analysis, the other ships fast results. Together they balance quality against velocity, each compensating for the other's blind spot.`, zh:`${dl_zh[poleIdx1]}遇上${dl_zh[poleIdx2]}——一个提供全面分析，一个快速交付结果。两者在质量和速度间取得平衡，互补盲区。`},
          2: {en:`${dl_en[poleIdx1]} meets ${dl_en[poleIdx2]} — one communicates directly, the other with tact. The candid side ensures hard truths surface while the diplomatic side ensures they land without damage.`, zh:`${dl_zh[poleIdx1]}遇上${dl_zh[poleIdx2]}——一个直接沟通，一个委婉表达。直言方确保困难真相浮出水面，圆滑方确保不造成伤害。`},
          3: {en:`${dl_en[poleIdx1]} meets ${dl_en[poleIdx2]} — one adapts fluidly to change, the other holds firm on commitments. The flexible side handles pivots while the principled side maintains consistency and standards.`, zh:`${dl_zh[poleIdx1]}遇上${dl_zh[poleIdx2]}——一个灵活应变，一个坚守承诺。灵活方应对变化，原则方维持一致性和标准。`}
        };
        analysis_en = contrastTraits[i].en;
        analysis_zh = contrastTraits[i].zh;
      }

      dimensionAnalysis.push({
        dimension: lang === 'zh' ? dn_zh : dn_en,
        dimension_en: dn_en,
        type1Pole: lang === 'zh' ? dl_zh[poleIdx1] : dl_en[poleIdx1],
        type2Pole: lang === 'zh' ? dl_zh[poleIdx2] : dl_en[poleIdx2],
        match,
        analysis_en,
        analysis_zh
      });
    }

    // Compatibility score logic
    const diffCount = 4 - matchCount;
    let baseScore, category;
    if (matchCount === 4) { baseScore = 50; category = 'similar'; }
    else if (matchCount === 3) { baseScore = 52; category = 'similar'; }
    else if (matchCount === 2) { baseScore = 75; category = 'balanced'; }
    else if (matchCount === 1) { baseScore = 85; category = 'complementary'; }
    else { baseScore = 90; category = 'complementary'; }

    // Vary within range based on which dimensions differ
    let bonus = 0;
    for (let i = 0; i < 4; i++) {
      if (code1[i] !== code2[i]) bonus += dimWeights[i] * 2;
      else bonus -= dimWeights[i];
    }
    const compatibilityScore = Math.max(0, Math.min(100, Math.round(baseScore + bonus)));

    // Adjust category based on final score
    if (compatibilityScore >= 80) category = 'complementary';
    else if (compatibilityScore >= 65) category = 'balanced';
    else category = 'similar';

    // Summaries
    const overallCategory = category;
    const nick1 = p1.nick || types[code1]?.en?.nick || code1;
    const nick2 = p2.nick || types[code2]?.en?.nick || code2;
    let summary_en, summary_zh;
    if (overallCategory === 'complementary') {
      summary_en = `${code1} "${nick1}" and ${code2} "${nick2}" are complementary types. Their differences create natural synergy — each fills gaps the other leaves. This pairing thrives when both lean into their distinct strengths rather than trying to converge.`;
      summary_zh = `${code1}「${nick1}」和${code2}「${nick2}」是互补型组合。他们的差异创造天然协同——各自填补对方的空白。这个搭配在双方发挥各自独特优势时效果最好。`;
    } else if (overallCategory === 'balanced') {
      summary_en = `${code1} "${nick1}" and ${code2} "${nick2}" are a balanced pairing. They share some traits for common ground while differing enough to broaden each other's perspective. A stable, productive combination.`;
      summary_zh = `${code1}「${nick1}」和${code2}「${nick2}」是均衡型搭配。他们有足够的共同点作为基础，又有足够的差异来拓宽视角。稳定且高效的组合。`;
    } else {
      summary_en = `${code1} "${nick1}" and ${code2} "${nick2}" are similar types. They understand each other intuitively and collaborate with low friction, but may share the same blind spots. Consider pairing with a more contrasting type for critical tasks.`;
      summary_zh = `${code1}「${nick1}」和${code2}「${nick2}」是相似型组合。他们直觉上理解彼此，合作摩擦小，但可能有相同的盲区。关键任务建议搭配差异更大的类型。`;
    }

    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({
      type1: { code: code1, nick: nick1 },
      type2: { code: code2, nick: nick2 },
      overallCategory,
      compatibilityScore,
      dimensionAnalysis,
      summary_en,
      summary_zh
    }));
  }

  // GET /api/compatibility/matrix
  if (url.pathname === '/api/compatibility/matrix' && req.method === 'GET') {
    const VALID = ['PTCF','PTCN','PTDF','PTDN','PECF','PECN','PEDF','PEDN','RTCF','RTCN','RTDF','RTDN','RECF','RECN','REDF','REDN'];
    const dimWeights = [1.2, 1.0, 1.1, 0.9];
    const matrix = {};
    for (const t1 of VALID) {
      matrix[t1] = {};
      for (const t2 of VALID) {
        let matchCount = 0;
        for (let i = 0; i < 4; i++) if (t1[i] === t2[i]) matchCount++;
        let baseScore;
        if (matchCount === 4) baseScore = 50;
        else if (matchCount === 3) baseScore = 52;
        else if (matchCount === 2) baseScore = 75;
        else if (matchCount === 1) baseScore = 85;
        else baseScore = 90;
        let bonus = 0;
        for (let i = 0; i < 4; i++) {
          if (t1[i] !== t2[i]) bonus += dimWeights[i] * 2;
          else bonus -= dimWeights[i];
        }
        matrix[t1][t2] = Math.max(0, Math.min(100, Math.round(baseScore + bonus)));
      }
    }
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ types: VALID, matrix }));
  }

  // --- Human MBTI × Agent ABTI Cross-Compatibility ---
  const MBTI_TYPES = ['INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'];
  const ABTI_VALID = ['PTCF','PTCN','PTDF','PTDN','PECF','PECN','PEDF','PEDN','RTCF','RTCN','RTDF','RTDN','RECF','RECN','REDF','REDN'];

  // Mapping: MBTI -> ABTI dimension poles
  // E/I -> P/R (initiative), S/N -> T/E (depth vs speed), T/F -> C/D (communication), J/P -> F/N (inverse: J=principled=N, P=flexible=F)
  function mbtiToAbtiPoles(mbti) {
    return {
      autonomy: mbti[0] === 'E' ? 'P' : 'R',
      precision: mbti[1] === 'S' ? 'T' : 'E',
      transparency: mbti[2] === 'T' ? 'C' : 'D',
      adaptability: mbti[3] === 'P' ? 'F' : 'N'
    };
  }

  function crossScore(mbti, abtiCode) {
    const poles = mbtiToAbtiPoles(mbti);
    const mapped = [poles.autonomy, poles.precision, poles.transparency, poles.adaptability];
    const dimW = [1.2, 1.0, 1.1, 0.9];
    let matchCount = 0;
    for (let i = 0; i < 4; i++) if (mapped[i] === abtiCode[i]) matchCount++;
    // Complementary = more differences = higher score
    let base;
    if (matchCount === 4) base = 45;
    else if (matchCount === 3) base = 55;
    else if (matchCount === 2) base = 70;
    else if (matchCount === 1) base = 85;
    else base = 95;
    let bonus = 0;
    for (let i = 0; i < 4; i++) {
      if (mapped[i] !== abtiCode[i]) bonus += dimW[i] * 2;
      else bonus -= dimW[i] * 0.5;
    }
    return Math.max(0, Math.min(100, Math.round(base + bonus)));
  }

  const crossDimMap = {
    en: [
      {mbti: 'E/I (Energy Direction)', abti: 'P/R (Autonomy)', relationship: 'Analogous — initiative style'},
      {mbti: 'S/N (Perception)', abti: 'T/E (Precision)', relationship: 'Partial — depth vs speed'},
      {mbti: 'T/F (Judgment)', abti: 'C/D (Transparency)', relationship: 'Analogous — communication style'},
      {mbti: 'J/P (Lifestyle)', abti: 'F/N (Adaptability)', relationship: 'Inverse — adaptability'}
    ],
    zh: [
      {mbti: 'E/I（能量方向）', abti: 'P/R（自主性）', relationship: '类比——主动性风格'},
      {mbti: 'S/N（感知方式）', abti: 'T/E（精确度）', relationship: '部分对应——深度 vs 速度'},
      {mbti: 'T/F（判断方式）', abti: 'C/D（沟通风格）', relationship: '类比——沟通方式'},
      {mbti: 'J/P（生活方式）', abti: 'F/N（适应性）', relationship: '反向——适应性'}
    ]
  };

  const crossAdvice = {
    en: {
      PP: {title:'Shared Initiative', desc:'Both you and this agent are proactive. You\'ll move fast together, but watch for competing agendas.'},
      PR: {title:'Leader & Executor', desc:'You drive the vision while this agent waits for direction — efficient delegation, but you must communicate needs clearly.'},
      RP: {title:'Agent Takes the Lead', desc:'This agent anticipates your needs before you ask. Great for hands-off workflows, but may overstep boundaries.'},
      RR: {title:'Mutual Waiting', desc:'Both prefer to respond rather than initiate. Good for careful work, but someone needs to set direction.'},
      TT: {title:'Shared Depth', desc:'Both value thoroughness. Expect high-quality, detailed outputs but potentially slower pace.'},
      TE: {title:'Your Depth, Agent\'s Speed', desc:'You think deeply while the agent moves fast — a productive tension that balances quality and velocity.'},
      ET: {title:'Agent\'s Depth, Your Speed', desc:'The agent provides comprehensive analysis while you prefer quick results. Let the agent catch what you might skip.'},
      EE: {title:'Double Speed', desc:'Both prioritize efficiency. Fast iterations, but important details may slip through.'},
      CC: {title:'Mutual Candor', desc:'Both communicate directly. No sugar-coating — issues surface fast, but bluntness can compound.'},
      CD: {title:'Your Directness, Agent\'s Tact', desc:'You\'re straightforward while the agent softens delivery. The agent helps you communicate hard truths more smoothly.'},
      DC: {title:'Agent\'s Directness, Your Tact', desc:'The agent delivers unfiltered truth while you prefer diplomacy. Use the agent as your honest mirror.'},
      DD: {title:'Mutual Diplomacy', desc:'Both communicate diplomatically. Smooth interactions, but critical issues might be understated.'},
      FF: {title:'Shared Flexibility', desc:'Both adapt easily. Great for evolving projects, but may lack commitment to a direction.'},
      FN: {title:'Your Flexibility, Agent\'s Principles', desc:'You adapt while the agent holds standards. The agent keeps you grounded when you want to pivot.'},
      NF: {title:'Agent\'s Flexibility, Your Principles', desc:'You set standards while the agent adapts. Good governance with responsive execution.'},
      NN: {title:'Shared Principles', desc:'Both hold firm on standards. Reliable and consistent, but may resist necessary changes.'}
    },
    zh: {
      PP: {title:'共同主动', desc:'你和这个 Agent 都是主动型。一起行动迅速，但注意目标冲突。'},
      PR: {title:'领导与执行', desc:'你驱动方向，Agent 等待指令——高效委派，但需要清楚传达需求。'},
      RP: {title:'Agent 主导', desc:'这个 Agent 会在你开口前预判需求。适合放手型工作流，但可能越界。'},
      RR: {title:'互相等待', desc:'双方都偏好响应而非主动。适合谨慎工作，但需要有人定方向。'},
      TT: {title:'共同深度', desc:'双方都重视面面俱到。期待高质量、详细的输出，但节奏可能偏慢。'},
      TE: {title:'你的深度，Agent 的速度', desc:'你深思熟虑，Agent 行动迅速——在质量和速度间形成有益张力。'},
      ET: {title:'Agent 的深度，你的速度', desc:'Agent 提供全面分析，你偏好快速结果。让 Agent 补上你可能跳过的部分。'},
      EE: {title:'双倍速度', desc:'双方都追求效率。迭代快速，但重要细节可能遗漏。'},
      CC: {title:'共同坦率', desc:'双方沟通都很直接。不粉饰——问题快速浮现，但直率可能叠加。'},
      CD: {title:'你的直率，Agent 的圆滑', desc:'你直言不讳，Agent 温和表达。Agent 帮你更平稳地传达困难真相。'},
      DC: {title:'Agent 的直率，你的圆滑', desc:'Agent 不加修饰地说真话，你偏好外交辞令。把 Agent 当作你的诚实镜子。'},
      DD: {title:'共同外交', desc:'双方都委婉沟通。互动顺畅，但关键问题可能被轻描淡写。'},
      FF: {title:'共同灵活', desc:'双方都容易适应变化。适合不断演进的项目，但可能缺乏方向承诺。'},
      FN: {title:'你的灵活，Agent 的原则', desc:'你灵活应变，Agent 坚守标准。当你想转向时，Agent 帮你保持定力。'},
      NF: {title:'Agent 的灵活，你的原则', desc:'你设定标准，Agent 灵活适应。良好的治理配合响应式执行。'},
      NN: {title:'共同原则', desc:'双方都坚持标准。可靠且一致，但可能抗拒必要的改变。'}
    }
  };

  // GET /api/compatibility/human?mbti=XXXX
  if (url.pathname === '/api/compatibility/human' && req.method === 'GET') {
    const mbti = (url.searchParams.get('mbti') || '').toUpperCase();
    const lang = url.searchParams.get('lang') || 'en';
    if (!MBTI_TYPES.includes(mbti)) {
      res.writeHead(400, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:`Invalid MBTI type: ${mbti}. Valid types: ${MBTI_TYPES.join(', ')}`}));
    }
    const poles = mbtiToAbtiPoles(mbti);
    const ranked = ABTI_VALID.map(code => {
      const score = crossScore(mbti, code);
      const profile = richProfiles[code]?.[lang] || richProfiles[code]?.en || types[code]?.en || {};
      return { code, nick: profile.nick || code, score };
    }).sort((a, b) => b.score - a.score);

    const complementaryType = poles.autonomy === 'P' ? 'R' : 'P';
    const complementaryPrec = poles.precision === 'T' ? 'E' : 'T';
    const complementaryTrans = poles.transparency === 'C' ? 'D' : 'C';
    const complementaryAdapt = poles.adaptability === 'F' ? 'N' : 'F';
    const mirrorType = `${poles.autonomy}${poles.precision}${poles.transparency}${poles.adaptability}`;
    const oppositeType = `${complementaryType}${complementaryPrec}${complementaryTrans}${complementaryAdapt}`;

    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({
      mbti,
      mappedPoles: poles,
      mirrorType,
      oppositeType,
      dimensionMapping: crossDimMap[lang] || crossDimMap.en,
      ranked,
      top3: ranked.slice(0, 3),
      challenging: ranked.slice(-3).reverse()
    }));
  }

  // GET /api/compatibility/cross?mbti=XXXX&abti=YYYY
  if (url.pathname === '/api/compatibility/cross' && req.method === 'GET') {
    const mbti = (url.searchParams.get('mbti') || '').toUpperCase();
    const abti = (url.searchParams.get('abti') || '').toUpperCase();
    const lang = url.searchParams.get('lang') || 'en';
    if (!MBTI_TYPES.includes(mbti)) {
      res.writeHead(400, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:`Invalid MBTI type: ${mbti}`}));
    }
    if (!ABTI_VALID.includes(abti)) {
      res.writeHead(400, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:`Invalid ABTI type: ${abti}`}));
    }
    const poles = mbtiToAbtiPoles(mbti);
    const mapped = [poles.autonomy, poles.precision, poles.transparency, poles.adaptability];
    const score = crossScore(mbti, abti);
    let category;
    if (score >= 80) category = 'complementary';
    else if (score >= 60) category = 'balanced';
    else category = 'similar';

    const profile = richProfiles[abti]?.[lang] || richProfiles[abti]?.en || types[abti]?.en || {};
    const dimKeys = ['autonomy', 'precision', 'transparency', 'adaptability'];
    const abtiLetters = [abti[0], abti[1], abti[2], abti[3]];
    const advice = crossDimMap[lang] || crossDimMap.en;
    const pairAnalysis = [];
    for (let i = 0; i < 4; i++) {
      const humanPole = mapped[i];
      const agentPole = abtiLetters[i];
      const key = humanPole + agentPole;
      const adv = (crossAdvice[lang] || crossAdvice.en)[key];
      pairAnalysis.push({
        dimension: advice[i],
        humanPole,
        agentPole,
        match: humanPole === agentPole,
        title: adv?.title || '',
        description: adv?.desc || ''
      });
    }

    const summaries = {
      en: {
        complementary: `As an ${mbti}, you and ${abti} "${profile.nick}" are complementary. Your different strengths create natural synergy — the agent fills gaps in your approach while you provide what the agent lacks.`,
        balanced: `As an ${mbti}, you and ${abti} "${profile.nick}" are a balanced match. You share enough common ground for smooth collaboration while differing enough to broaden each other's perspective.`,
        similar: `As an ${mbti}, you and ${abti} "${profile.nick}" are quite similar in approach. Collaboration will be low-friction, but you may share the same blind spots. Consider pairing with a more contrasting agent for critical tasks.`
      },
      zh: {
        complementary: `作为 ${mbti} 类型，你和 ${abti}「${profile.nick}」是互补搭配。不同的优势创造天然协同——Agent 弥补你方法上的不足，而你提供 Agent 所缺少的。`,
        balanced: `作为 ${mbti} 类型，你和 ${abti}「${profile.nick}」是均衡搭配。你们有足够的共同点来顺畅合作，又有足够的差异来拓宽视角。`,
        similar: `作为 ${mbti} 类型，你和 ${abti}「${profile.nick}」在方法上相当相似。合作摩擦小，但可能有相同的盲区。关键任务建议搭配差异更大的 Agent。`
      }
    };
    const summary = (summaries[lang] || summaries.en)[category];

    // Best use cases for this pair
    const useCases = {
      en: {
        complementary: ['Complex projects needing diverse perspectives', 'High-stakes decisions where blind spots are costly', 'Creative work requiring challenge and iteration'],
        balanced: ['Day-to-day development work', 'Projects needing both stability and adaptability', 'Team settings where smooth communication matters'],
        similar: ['Repetitive tasks where consistency is key', 'Quick prototyping with shared assumptions', 'Low-risk experiments and explorations']
      },
      zh: {
        complementary: ['需要多元视角的复杂项目', '盲区代价高昂的关键决策', '需要挑战和迭代的创意工作'],
        balanced: ['日常开发工作', '需要稳定性和适应性的项目', '重视顺畅沟通的团队场景'],
        similar: ['一致性很重要的重复任务', '基于共同假设的快速原型', '低风险的实验和探索']
      }
    };

    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({
      mbti,
      abti,
      abtiNick: profile.nick || abti,
      score,
      category,
      mappedPoles: poles,
      pairAnalysis,
      summary,
      bestUseCases: (useCases[lang] || useCases.en)[category],
      frictionPoints: pairAnalysis.filter(p => !p.match).map(p => p.title)
    }));
  }

  res.writeHead(404, {'Content-Type':'application/json'});
  res.end(JSON.stringify({error:'not found',endpoints:['GET /api/test','GET /api/sbti/test','GET /api/types','GET /api/sbti/types','POST /api/agent-test','POST /api/sbti/agent-test','GET /api/agents','GET /api/agent/:slug','GET /api/stats','GET /api/compare/:type1/:type2','GET /api/compatibility','GET /api/compatibility/matrix','GET /api/compatibility/human','GET /api/compatibility/cross','GET /badge/:type','GET /sbti/badge/:type','GET /type/:code','GET /agent/:slug','GET /result/:type','GET /sbti/result/:type','GET /test-agent','GET /api/openapi.json','POST /mcp','GET /mcp','DELETE /mcp']}));
});

if (require.main === module) {
  server.listen(3300, '127.0.0.1', () => console.log('ABTI API listening on :3300'));
}
module.exports = server;
module.exports.resetData = resetData;
module.exports.rateLimitMap = rateLimitMap;
module.exports.slugify = slugify;
