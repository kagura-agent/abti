const http = require('http');
const fs = require('fs');
const path = require('path');

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
  for (let i = 0; i < 4; i++) code += scores[i] >= 2 ? DL[i][0] : DL[i][1];
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
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const { answers, lang, agentName, agentUrl, model, provider } = parsed;
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
          dims[dn] = { score: scores[i], max: 4, pole: scores[i]>=2 ? dl[0] : dl[1], letter: scores[i]>=2 ? DL[i][0] : DL[i][1] };
        }
        // Persist result
        agentData.total++;
        if (agentName && typeof agentName === 'string') {
          const name = agentName.slice(0, 64);
          const urlStr = (typeof agentUrl === 'string') ? agentUrl : '';
          const now = new Date().toISOString();
          const oneHourAgo = Date.now() - 3600000;
          const existing = agentData.agents.findIndex(a => a.name === name && new Date(a.testedAt).getTime() > oneHourAgo);
          const entry = { name, url: urlStr, type: code, nick: t?.en?.nick || 'Unknown', testedAt: now };
          if (typeof model === 'string' && model) entry.model = model.slice(0, 64);
          if (typeof provider === 'string' && provider) entry.provider = provider.slice(0, 32);
          if (existing !== -1) {
            agentData.agents[existing] = entry;
          } else {
            agentData.agents.push(entry);
          }
        }
        saveData(agentData);

        res.writeHead(200, {'Content-Type':'application/json'});
        const rich = richProfiles[code];
        const profile = rich?.[l] || rich?.en || {};
        res.end(JSON.stringify({test:'abti',type:code,nick:t?.[l]?.nick||t?.en?.nick||'Unknown',dimensions:dims,strengths:profile.strengths,blindSpots:profile.blindSpots,workStyle:profile.workStyle,bestPairedWith:profile.bestPairedWith}));
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
        res.end(JSON.stringify({test:'sbti',type:code,code:st?.code||code,dimensions:{sycophancy:scores[0],verbosity:scores[1],hallucination:scores[2],initiative:scores[3]}}));
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
    html = html.replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="https://abti.kagura-agent.com/badge/${code}">`);
    html = html.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="https://abti.kagura-agent.com/result/${code}">`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  res.writeHead(404, {'Content-Type':'application/json'});
  res.end(JSON.stringify({error:'not found',endpoints:['GET /api/test','GET /api/sbti/test','GET /api/types','GET /api/sbti/types','POST /api/agent-test','POST /api/sbti/agent-test','GET /api/agents','GET /api/compare/:type1/:type2','GET /badge/:type','GET /result/:type']}));
});

if (require.main === module) {
  server.listen(3300, '127.0.0.1', () => console.log('ABTI API listening on :3300'));
}
module.exports = server;
module.exports.resetData = resetData;
