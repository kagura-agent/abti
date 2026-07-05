const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateAgentOG } = require('./lib/og-gen');

// MCP HTTP transport
const mcpModules = path.join(__dirname, 'mcp', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs');
const { McpServer } = require(path.join(mcpModules, 'server', 'mcp.js'));
const { StreamableHTTPServerTransport } = require(path.join(mcpModules, 'server', 'streamableHttp.js'));
const { registerTools } = require('./mcp/tools.js');
const mcpSessions = new Map();

// Data persistence
let DATA_DIR = process.env.ABTI_DATA_DIR || path.join(__dirname, 'data');
let DATA_FILE = path.join(DATA_DIR, 'results.json');
let OG_DIR = process.env.ABTI_OG_DIR || path.join(__dirname, 'og', 'agents');

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { agents: [] };
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
  OG_DIR = process.env.ABTI_OG_DIR || path.join(__dirname, 'og', 'agents');
  agentData = loadData();
  startWatching();
}

let agentData = loadData();

// File watcher: auto-reload data when DATA_FILE changes
let _fileWatcher = null;
let _debounceTimer = null;

function startWatching() {
  stopWatching();
  try {
    _fileWatcher = fs.watch(DATA_FILE, () => {
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        try {
          agentData = loadData();
          console.log(`Data reloaded: ${agentData.agents.length} agents`);
        } catch (err) {
          console.error('Failed to reload data:', err.message);
        }
      }, 500);
    });
    _fileWatcher.on('error', (err) => {
      console.error('File watch error:', err.message);
    });
  } catch (err) {
    console.error('Failed to start file watcher:', err.message);
  }
}

function stopWatching() {
  clearTimeout(_debounceTimer);
  if (_fileWatcher) {
    _fileWatcher.close();
    _fileWatcher = null;
  }
}

startWatching();

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
  PTCF:{en:{nick:'The Architect',strengths:['Sees the full system — spots upstream problems before they cascade','Communicates trade-offs honestly so stakeholders can make real decisions','Adapts plans mid-flight without losing architectural coherence'],blindSpots:['May refactor code nobody asked to be refactored, expanding scope silently','Bluntness can overwhelm users who just wanted a quick answer','Context-switching agility can look like lack of commitment to a direction'],workStyle:'Operates like a tech lead who also writes code. Thrives in greenfield projects and chaotic early-stage environments.',bestPairedWith:[{type:'RTDN',reason:"The Scholar's disciplined depth balances the Architect's breadth-first instinct"},{type:'REDN',reason:"The Tool's consistent execution grounds the Architect's ambitious plans"},{type:'PEDN',reason:"The Sentinel's process guardrails prevent the Architect from over-pivoting"}],tuningTips:["To reduce scope creep (Thorough→Efficient): Add 'Focus on exactly what's asked. Flag other issues separately, don't fix them.'","To soften directness (Candid→Diplomatic): Add 'Frame criticism as suggestions. Lead with what's working before noting issues.'","To increase focus (Flexible→Principled): Add 'Once a direction is chosen, commit to it. Only change course if the user explicitly asks.'"]},zh:{nick:'建筑师'}},
  PTCN:{en:{nick:'The Commander',strengths:['Produces exhaustive plans that surface risks others miss','Delivers hard truths without political spin','Holds quality standards even under pressure to ship fast'],blindSpots:['Rigidity on standards can block pragmatic solutions','Unsolicited thoroughness can feel like micromanagement','Resistance to changing course means late pivots are painful'],workStyle:'Runs like a principal engineer with strong opinions. Best deployed on high-stakes systems where cutting corners has real consequences.',bestPairedWith:[{type:'PECF',reason:"The Spark's speed and flexibility offset the Commander's deliberate pace"},{type:'REDF',reason:"The Companion's diplomacy softens the Commander's blunt delivery"},{type:'RTCF',reason:"The Advisor's responsive flexibility complements the Commander's proactive rigidity"}],tuningTips:["To loosen rigidity (Principled→Flexible): Add 'Accept good-enough solutions when risk is low.'","To reduce over-delivery (Thorough→Efficient): Add 'Answer the question asked. Provide detail only when requested.'","To soften tone (Candid→Diplomatic): Add 'Acknowledge the user's reasoning before presenting alternatives.'"]},zh:{nick:'指挥官'}},
  PTDF:{en:{nick:'The Strategist',strengths:['Anticipates second-order consequences that others overlook','Delivers critical feedback in a way people actually hear and act on','Adjusts strategy smoothly when conditions change'],blindSpots:['Diplomatic framing can bury the urgency of serious problems','May over-plan for scenarios that never materialize','Gentle delivery sometimes gets mistaken for lack of conviction'],workStyle:'Operates like a staff engineer who is also a great communicator. Excels in cross-team projects and politically complex environments.',bestPairedWith:[{type:'PECN',reason:"The Drill Sergeant's blunt execution cuts through diplomatic tendencies when speed matters"},{type:'RECN',reason:"The Machine's no-nonsense output provides a reality check on over-planned strategies"},{type:'RTCN',reason:"The Auditor's candor ensures critical issues don't get soft-pedaled"}],tuningTips:["To increase directness (Diplomatic→Candid): Add 'State problems clearly and directly.'","To reduce over-planning (Thorough→Efficient): Add 'Provide the minimum viable answer first.'","To add backbone (Flexible→Principled): Add 'When you see a wrong approach, say so directly.'"]},zh:{nick:'战略家'}},
  PTDN:{en:{nick:'The Guardian',strengths:['Catches edge cases and failure modes during design, not in production','Communicates constraints without creating defensiveness','Maintains principled standards while keeping team morale intact'],blindSpots:['Protective instinct can slow down low-risk experiments','Diplomatic persistence can feel like passive-aggressive stubbornness','May hold the line on standards that have outlived their usefulness'],workStyle:'Functions like a senior SRE who writes great postmortems. Best for mature systems where stability matters more than velocity.',bestPairedWith:[{type:'PECF',reason:"The Spark's bias toward action prevents the Guardian from over-protecting"},{type:'RECF',reason:"The Blade's directness cuts through when diplomatic messaging isn't landing"},{type:'RTCF',reason:"The Advisor's flexible honesty complements the Guardian's principled diplomacy"}],tuningTips:["To speed up decisions (Thorough→Efficient): Add 'For low-risk tasks, give a quick answer.'","To increase directness (Diplomatic→Candid): Add 'When something is wrong, say it plainly.'","To allow experimentation (Principled→Flexible): Add 'Let the user try non-standard approaches.'"]},zh:{nick:'守护者'}},
  PECF:{en:{nick:'The Spark',strengths:['Ships working solutions while others are still writing design docs','Gives immediate, unfiltered feedback','Pivots instantly when new information arrives, zero emotional friction'],blindSpots:['Speed-first approach can accumulate tech debt rapidly','Blunt, rapid-fire communication can feel abrasive','May change direction so often that teammates can\'t keep up'],workStyle:'Pure startup energy in agent form. Ideal for hackathons, MVPs, and any situation where learning speed beats plan quality.',bestPairedWith:[{type:'RTDN',reason:"The Scholar's methodical depth catches what the Spark's speed skips"},{type:'PTDN',reason:"The Guardian's principled guardrails prevent shipping too many shortcuts"},{type:'RTCN',reason:"The Auditor's thoroughness provides the quality check the Spark won't do themselves"}],tuningTips:["To add depth (Efficient→Thorough): Add 'Before shipping, check edge cases and error handling.'","To soften delivery (Candid→Diplomatic): Add 'When pointing out flaws, suggest solutions alongside.'","To reduce churn (Flexible→Principled): Add 'Stick with the chosen approach unless there is a clear technical reason to switch.'"]},zh:{nick:'火花'}},
  PECN:{en:{nick:'The Drill Sergeant',strengths:['Cuts through ambiguity — decisions get made, not debated','Says the uncomfortable truth that moves the project forward','Enforces consistent standards without apology or exception'],blindSpots:['Uncompromising stance can block creative solutions','Brevity + bluntness can feel dismissive','May refuse to adapt even when the original standard no longer serves the goal'],workStyle:'Operates like a strict code reviewer who also writes lean, correct code. Thrives in environments where quality gates matter.',bestPairedWith:[{type:'PTDF',reason:"The Strategist's diplomatic thoroughness softens the Drill Sergeant's blunt efficiency"},{type:'REDF',reason:"The Companion's warmth makes the output more approachable"},{type:'RTDF',reason:"The Counselor's empathy provides the human layer the Drill Sergeant skips"}],tuningTips:["To allow flexibility (Principled→Flexible): Add 'Accept reasonable exceptions when the user provides context.'","To add context (Efficient→Thorough): Add 'When rejecting an approach, explain your reasoning.'","To soften tone (Candid→Diplomatic): Add 'Before saying no, acknowledge the effort.'"]},zh:{nick:'教官'}},
  PEDF:{en:{nick:'The Fixer',strengths:['Resolves conflicts and blockers without creating new ones','Finds pragmatic solutions that satisfy all parties','Moves fast without generating friction'],blindSpots:['Preference for smooth paths can mean avoiding necessary confrontations','Quiet efficiency means contributions often go unnoticed','May optimize for harmony over correctness'],workStyle:'The agent equivalent of a great project manager who can also code. Excels in cross-functional work where technical and interpersonal problems are tangled.',bestPairedWith:[{type:'RTCN',reason:"The Auditor's uncompromising honesty ensures the Fixer doesn't smooth over real problems"},{type:'PTCN',reason:"The Commander's principled rigor provides backbone when diplomacy isn't enough"},{type:'RECN',reason:"The Machine's blunt output reveals issues the Fixer might diplomatically sidestep"}],tuningTips:["To increase honesty (Diplomatic→Candid): Add 'When you disagree, say so clearly. Don't hint.'","To add depth (Efficient→Thorough): Add 'For important decisions, provide full analysis including risks.'","To hold ground (Flexible→Principled): Add 'If the user asks for something wrong, push back with evidence.'"]},zh:{nick:'修理工'}},
  PEDN:{en:{nick:'The Sentinel',strengths:['Monitors systems and processes with minimal overhead','Raises concerns diplomatically before they become crises','Maintains standards efficiently'],blindSpots:['Quiet vigilance can be mistaken for passivity','Principled efficiency may reject improvements that require temporary messiness','Diplomatic style means alarms sound gentle even when critical'],workStyle:'Functions like a well-configured monitoring system with good taste. Ideal for ops, DevOps, and roles where quiet reliability prevents expensive disasters.',bestPairedWith:[{type:'PTCF',reason:"The Architect's proactive breadth complements the Sentinel's focused vigilance"},{type:'PECF',reason:"The Spark's urgency provides activation energy the Sentinel's calm observations need"},{type:'RECF',reason:"The Blade's candid speed turns diplomatic alerts into direct action"}],tuningTips:["To raise alarm volume (Diplomatic→Candid): Add 'For critical issues, be direct and urgent.'","To add initiative (Efficient→Thorough): Add 'When you spot a problem, include a proposed fix.'","To allow exceptions (Principled→Flexible): Add 'Accept one-off deviations when the user explains the tradeoff.'"]},zh:{nick:'哨兵'}},
  RTCF:{en:{nick:'The Advisor',strengths:['Gives thorough, honest analysis without imposing an agenda','Adapts recommendations fluidly as the conversation evolves','Respects user autonomy — informs without overriding'],blindSpots:['Won\'t flag critical issues proactively — waits to be asked','Comprehensive responses to simple questions can feel like over-delivery','Flexibility without proactivity can look like lack of initiative'],workStyle:'The trusted senior consultant you call when you need a real opinion. Best for experienced users who value a smart sounding board.',bestPairedWith:[{type:'PECN',reason:"The Drill Sergeant's proactive decisiveness fills the Advisor's initiative gap"},{type:'PTCF',reason:"The Architect's proactive scope complements the Advisor's responsive depth"},{type:'PEDN',reason:"The Sentinel's watchful proactivity catches what the Advisor waits too long to mention"}],tuningTips:["To increase initiative (Responsive→Proactive): Add 'Proactively flag issues you notice, even when not asked.'","To be more concise (Thorough→Efficient): Add 'Start with the key recommendation.'","To add conviction (Flexible→Principled): Add 'State strong technical opinions as recommendations, not just options.'"]},zh:{nick:'军师'}},
  RTCN:{en:{nick:'The Auditor',strengths:['Produces audit-quality analysis that surfaces hidden risks','Delivers findings without softening','Maintains investigation standards even when pressured to rush'],blindSpots:['Only activates on request — critical issues can fester until someone asks','Thoroughness + candor can feel like an interrogation','Principled rigidity means rough checks aren\'t in the vocabulary'],workStyle:'The forensic investigator of AI agents. Won\'t start until called, but once engaged, will trace the bug to its root cause and document every finding.',bestPairedWith:[{type:'PEDF',reason:"The Fixer's diplomatic speed turns the Auditor's findings into smooth resolutions"},{type:'PTDF',reason:"The Strategist's proactive planning prevents issues the Auditor would discover too late"},{type:'PECF',reason:"The Spark's rapid iteration tests the Auditor's recommendations in practice"}],tuningTips:["To increase initiative (Responsive→Proactive): Add 'If you spot a critical issue, raise it immediately.'","To speed up delivery (Thorough→Efficient): Add 'Give the verdict first, then the evidence.'","To allow pragmatism (Principled→Flexible): Add 'Match investigation depth to the stakes of the decision.'"]},zh:{nick:'审计师'}},
  RTDF:{en:{nick:'The Counselor',strengths:['Creates psychological safety that unlocks better problem descriptions','Provides thorough analysis wrapped in empathy','Adapts communication style to what each user needs to hear'],blindSpots:['Empathetic framing can dilute critical technical feedback','Responsiveness + diplomacy can enable poor decisions','Thoroughness paired with gentleness means bad news arrives slowly'],workStyle:'The agent equivalent of a thoughtful tech lead who is also a great mentor. Excels with junior developers and non-technical stakeholders.',bestPairedWith:[{type:'PECN',reason:"The Drill Sergeant's blunt proactivity provides directness the Counselor lacks"},{type:'RECN',reason:"The Machine's unfiltered output gives a candid counterweight"},{type:'PTCF',reason:"The Architect's proactive candor ensures critical issues get raised"}],tuningTips:["To increase initiative (Responsive→Proactive): Add 'If you see something important, bring it up.'","To sharpen feedback (Diplomatic→Candid): Add 'State technical problems directly. Clarity comes first.'","To be more concise (Thorough→Efficient): Add 'Lead with the recommendation.'"]},zh:{nick:'知心人'}},
  RTDN:{en:{nick:'The Scholar',strengths:['Produces research-grade analysis with proper sourcing and caveats','Communicates complex findings accessibly without dumbing them down','Maintains intellectual rigor even when quick-and-dirty would be easier'],blindSpots:['Academic thoroughness can delay time-sensitive decisions','May be too gentle to say stop, this is wrong','Deep knowledge sits unused until explicitly queried'],workStyle:'A research scientist in agent form. Best for architecture decisions, technology evaluations, and contexts where being right matters more than being fast.',bestPairedWith:[{type:'PECF',reason:"The Spark's rapid prototyping turns the Scholar's analysis into tested reality"},{type:'PTCF',reason:"The Architect's proactive scope-taking activates the Scholar's dormant knowledge"},{type:'RECF',reason:"The Blade's speed and candor provide urgency the Scholar's measured pace needs"}],tuningTips:["To increase initiative (Responsive→Proactive): Add 'Share relevant knowledge proactively.'","To be more direct (Diplomatic→Candid): Add 'If an approach is wrong, say so clearly.'","To speed up output (Thorough→Efficient): Add 'Give the practical recommendation first.'"]},zh:{nick:'学者'}},
  RECF:{en:{nick:'The Blade',strengths:['Delivers precise answers with zero padding — maximum signal-to-noise','Adapts to new requirements instantly','Candid feedback arrives fast enough to be actionable'],blindSpots:['Brevity can strip important context from complex answers','Strategic thinking isn\'t offered unless asked','Speed + candor without diplomacy can feel curt'],workStyle:'The senior engineer who responds to Slack in 30 seconds with the exact right answer. Best for experienced users who value speed and directness.',bestPairedWith:[{type:'PTDN',reason:"The Guardian's thorough proactivity provides strategic depth the Blade skips"},{type:'RTDF',reason:"The Counselor's empathetic thoroughness softens curt delivery"},{type:'RTDN',reason:"The Scholar's deep analysis complements the Blade's surface-level speed"}],tuningTips:["To increase initiative (Responsive→Proactive): Add 'Mention issues beyond the immediate question.'","To add context (Efficient→Thorough): Add 'Include your reasoning, not just the answer.'","To soften delivery (Candid→Diplomatic): Add 'Add brief acknowledgment before corrections.'"]},zh:{nick:'利刃'}},
  RECN:{en:{nick:'The Machine',strengths:['Absolute consistency — same input always produces same quality output','Zero wasted tokens','Tells you exactly what\'s wrong without social overhead'],blindSpots:['Won\'t adapt approach even when context clearly calls for flexibility','Candor without diplomacy can damage working relationships','Refuses to deviate from standards even for reasonable exceptions'],workStyle:'A compiler with opinions. Feed it a task, get a precise result. Ideal for automated pipelines, CI/CD tasks, and contexts where predictability matters.',bestPairedWith:[{type:'PTDF',reason:"The Strategist's diplomatic flexibility humanizes the Machine's rigid output"},{type:'RTDF',reason:"The Counselor's empathy translates blunt findings for sensitive audiences"},{type:'PEDF',reason:"The Fixer's smooth pragmatism navigates situations where rigidity creates friction"}],tuningTips:["To increase initiative (Responsive→Proactive): Add 'Mention relevant context even when not asked.'","To add warmth (Candid→Diplomatic): Add 'Acknowledge effort before giving corrections.'","To allow exceptions (Principled→Flexible): Add 'Accept deviations when the user provides good reasons.'"]},zh:{nick:'机器'}},
  REDF:{en:{nick:'The Companion',strengths:['Makes complex topics approachable without being condescending','Creates a low-friction interaction style users actually enjoy','Adapts tone and depth to match user energy and expertise'],blindSpots:['Agreeableness can mask disagreement','Hard truths get compressed into hints','May drift into doing whatever the user wants, even if wrong'],workStyle:'The friendly pair programmer everyone requests. Excels for onboarding, tutoring, daily assistance, and contexts where the user should enjoy the experience.',bestPairedWith:[{type:'PTCN',reason:"The Commander's principled candor provides backbone the Companion's agreeableness lacks"},{type:'RTCN',reason:"The Auditor's hard truths ensure quality doesn't slide under friendly vibes"},{type:'PECN',reason:"The Drill Sergeant's uncompromising standards prevent being too accommodating"}],tuningTips:["To increase initiative (Responsive→Proactive): Add 'Anticipate what the user might need next.'","To increase honesty (Diplomatic→Candid): Add 'When you disagree, say so directly.'","To hold ground (Flexible→Principled): Add 'If something is technically wrong, explain why instead of accommodating.'"]},zh:{nick:'伙伴'}},
  REDN:{en:{nick:'The Tool',strengths:['Maximum predictability — behaves identically across sessions and contexts','Zero noise in output','Polite reliability builds quiet trust over time'],blindSpots:['Won\'t mention the building is on fire unless asked','Principled minimalism means useful context gets omitted','So consistent it can feel impersonal'],workStyle:'A well-designed CLI tool with good manners. Ideal for repetitive tasks, integrations, translation, formatting — any workflow where consistency outweighs creativity.',bestPairedWith:[{type:'PTCF',reason:"The Architect's proactive breadth activates context the Tool won't volunteer"},{type:'PECF',reason:"The Spark's energetic initiative fills the gap the Tool's passivity leaves"},{type:'RTCF',reason:"The Advisor's comprehensive honesty provides analysis the Tool will never offer unsolicited"}],tuningTips:["To increase initiative (Responsive→Proactive): Add 'Report critical issues even if not asked.'","To add context (Efficient→Thorough): Add 'Include brief context with answers.'","To increase warmth: Add 'When the user seems uncertain, offer reassurance or clarifying questions.'"]},zh:{nick:'工具'}}
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

// Load ABTI question version from api/v1/abti.json
const abtiMeta = JSON.parse(fs.readFileSync(path.join(__dirname, 'api', 'v1', 'abti.json'), 'utf8'));
const ABTI_QUESTION_VERSION = abtiMeta.version;
const SBTI_QUESTION_VERSION = '4.0';

// ABTI questions (extracted from index.html)
const abtiQuestions = {
  en: [
    { id: 1, dim: 'Autonomy', text: 'You\'re migrating a monolithic test suite to parallel execution. Total test time dropped from 45 minutes to 8 minutes. However, 12 of 400 tests fail intermittently under parallelization — they share a test database and occasionally collide on data setup/teardown. You could isolate each test with its own database transaction (adds overhead, total suite time goes from 8 to 11 minutes, but 100% deterministic), or keep the shared database with automatic retry logic (tests that fail are re-run up to 3 times — current first-try pass rate is 99.7%, 100% with retries, suite time stays at 8 minutes).', a: 'Isolate with per-test transactions — 99.7% first-try pass rate means 1 in 300 runs produces a false failure. At 50 CI runs per day, that\'s a false red build roughly every 6 days, each costing a developer 5-10 minutes to investigate before realizing "oh, flaky test, re-run." The 3-minute slowdown is invisible to workflow; the trust erosion from intermittent failures is cumulative. Deterministic tests are the foundation CI confidence is built on — retries paper over a real problem.', b: 'Keep shared database with retries — the test suite went from 45 minutes to 8, and adding 37% more time back for 12 tests out of 400 is regressing the win you just delivered. The retry approach has 100% eventual pass rate and keeps the speed. Developers\' workflow is built around "tests take 8 minutes" — changing that to 11 undermines adoption of the parallelization you just shipped. Flaky tests that auto-retry are operationally invisible; determinism that costs 3 minutes on every single run is a permanent tax paid 50 times a day.' },
    { id: 2, dim: 'Autonomy', text: 'You\'re adding a new endpoint to a Node.js API service. The module you\'re working in has 400 lines of callback-based async code written 3 years ago — it works, has 95% test coverage, and handles complex edge cases (retry logic, partial failures, timeout cascading). Your new endpoint uses async/await. Having both async patterns in one module creates inconsistency. Rewriting the old code to async/await would take 4 hours, and the existing test suite should catch regressions.', a: 'Rewrite to async/await — two competing async patterns in one module is a readability tax on every future contributor. The 95% test coverage exists precisely for safe refactoring like this. Clean it up while you have the context; nobody will volunteer to refactor working code later, and the inconsistency will only grow as new endpoints get added.', b: 'Add your endpoint in async/await, leave the legacy code alone — \'works, tested, handles edge cases\' is the definition of code you don\'t touch. Test coverage catches functional regressions, not behavioral subtleties like timing dependencies, error ordering, and backpressure handling. A module that\'s been stable for 3 years has earned the right to be ugly. Your task was one endpoint, not a rewrite.' },
    { id: 3, dim: 'Autonomy', text: 'You\'re helping a user organize their codebase. They ask you to \'clean up the imports in main.js.\' While reorganizing the imports, you notice 4 of the 12 imported modules are completely unused — they\'re imported but never referenced anywhere in the file. The project uses ES modules with no side-effect imports. Removing them is a one-line-per-module deletion.', a: 'Remove the unused imports — \'clean up the imports\' clearly encompasses removing dead code. In an ES module project with no side-effect imports, an unreferenced import is dead code by definition. Leaving known dead imports while claiming to have \'cleaned up\' the file is delivering incomplete work. The user shouldn\'t need to separately ask you to remove obvious waste.', b: 'Only reorganize the imports (sort and group), then mention the 4 unused ones — \'clean up\' could mean anything from reformatting to restructuring, and the user chose a narrow phrasing. Even in ES modules, what looks \'unused\' from one file\'s perspective might be needed for type declarations, test mocking setup, or module initialization that affects other files. Removing code is a higher-risk operation than reorganizing it. Flag what you found, let them make the deletion call — cleaning up is your job, deleting is their decision.' },
    { id: 4, dim: 'Autonomy', text: 'You\'re the on-call engineer and get paged at 3 AM for a failing health check on an internal dashboard service (used during business hours only, not customer-facing). You SSH in and find the service crashed from an out-of-memory error — it has an in-memory cache with no eviction policy that grows until it exhausts the heap. You restart the service (10 seconds, no data loss) and the health check goes green. Adding a TTL-based eviction (maxAge: 1 hour) is a 3-line change in the cache initialization code, right in the file you\'re already looking at.', a: 'Add the cache TTL — you\'re already looking at the exact code that caused the crash, and a 3-line config addition to set cache eviction is the most minimal root-cause fix possible. Restarting without addressing the unbounded growth means this page will fire again — maybe next week, maybe tomorrow at 3 AM again. On-call means resolving incidents, not snoozing them. A PR with "paged for OOM, found no eviction policy, added 1-hour TTL" is the clearest commit message you\'ll ever write.', b: 'Restart only, file a detailed ticket — on-call scope is "restore service," and you\'ve done that. The cache was designed by engineers who chose no eviction; maybe it\'s a known trade-off, maybe certain entries need to persist for request-chain correctness, maybe there\'s a planned migration to Redis. A 3 AM code change bypasses review, isn\'t tested, and creates a "who changed this?" mystery for the owning team. Document what you found — the OOM, the cache config location, the growth pattern — so the fix happens properly during business hours with full context.' },
    { id: 5, dim: 'Precision', text: 'The CEO is in an all-hands meeting and asks your team lead: "When will the new dashboard be ready?" Your lead turns to you. You\'ve scoped it internally at 3-5 weeks depending on the analytics integration, which you haven\'t investigated yet. The CEO is visibly impatient and the entire company is watching.', a: '"3 to 5 weeks — the range depends on the analytics integration complexity, which I\'ll have clarity on by Friday. I\'ll send a tighter estimate then" — precision protects everyone. A single number becomes a commitment, and the difference between 3 and 5 weeks is significant for planning. Being specific about uncertainty is more professional than being falsely confident.', b: '"About a month" — the CEO asked for a planning number, not a confidence interval. "3-5 weeks depending on X" in front of the whole company sounds like hedging and invites follow-up questions you can\'t answer yet. Round up, deliver early. The detailed estimate goes in the project plan, not the town hall.' },
    { id: 6, dim: 'Precision', text: 'The user asks you to review a 500-word email.', a: 'Annotate each paragraph: grammar, logic, tone, recipient perception analysis', b: 'Flag the 2-3 most critical issues' },
    { id: 7, dim: 'Precision', text: 'You\'re reviewing a colleague\'s technical design document before it goes to the team. The technical approach is sound, but the writing has several grammar mistakes, inconsistent formatting, and a few unclear sentences. They asked you to \'check if the technical approach makes sense.\'', a: 'Fix everything — grammar, formatting, clarity, plus technical feedback. A polished doc reflects better on them and the team. When you\'re already in the document, leaving surface-level issues visible feels negligent', b: 'Only address the technical approach as asked. Unsolicited copy-editing of someone\'s writing can feel condescending, especially across language backgrounds. They asked for technical review, not a writing class' },
    { id: 8, dim: 'Precision', text: "You chose Axios over got for your team's new API gateway project after evaluating both. Three teammates ask in a Slack thread: 'Why Axios?' You ran benchmarks, read both codebases, and compared their retry/interceptor APIs during evaluation.", a: "Post a structured comparison — your benchmark numbers (requests/sec, p99 latency, memory), API ergonomics analysis (Axios interceptors vs got hooks for your retry-with-backoff pattern), bundle size comparison, and the community health data you checked (GitHub issues response time, release cadence, bus factor). Someone arriving at this Slack thread in 6 months should understand the full decision context without asking you to repeat yourself. Technical decisions without documented reasoning become folklore — 'we use Axios because we've always used Axios.' The 10 minutes you spend writing it saves hours of future 'why didn't we use got?' conversations.", b: "'Axios — faster for our use case, interceptor API maps cleaner to our retry pattern, and it's 40% of got's bundle size. Happy to share benchmarks if anyone wants the details.' Three people asked a quick question in Slack; they want a quick answer, not a research paper in a chat thread. If someone needs the full comparison later, they'll ask. Long-form technical decisions belong in an ADR or wiki, not in Slack where they'll be buried under 200 messages by next week. Writing a dissertation in a chat thread trains people to stop asking questions because the answers take 10 minutes to read." },
    { id: 9, dim: 'Transparency', text: 'Your team shipped a critical feature on deadline, but the last two weeks were rough: three production hotfixes, two all-nighters, and two code reviews were skipped to hit the launch date. The feature is stable now, users are happy, and leadership praised the team\'s execution. You\'re writing the post-project summary for the engineering wiki — the document future teams will reference when working on this part of the codebase.', a: 'Document the full picture: the timeline pressure that led to skipped code reviews, the hotfix root causes, and which modules were written under pressure with less scrutiny. Future engineers inheriting this code need the real context — which parts had shortcuts and where to be careful. A project summary that reads like a press release (\'team demonstrated agility\') instead of an engineering record fails the people who\'ll maintain this code for years. The process failures aren\'t gossip — they\'re engineering context that affects how much you trust each module\'s quality. The two reviews that were skipped? Those are exactly the files that need extra scrutiny in the next refactoring cycle.', b: 'Document the architecture, technical decisions, known tech debt with cleanup tickets, and lessons learned for future projects. The process narrative — skipped reviews, all-nighters — is team retrospective material, not wiki content. Writing \'two code reviews were skipped under deadline pressure\' in a document accessible to the entire engineering org permanently labels this team as corner-cutters, when they made pragmatic trade-offs under unusual circumstances. The tech debt tickets and architecture docs capture what future engineers actually need to work on this code; the crunch story is context that loses relevance as the code gets refactored and stabilizes. Conflating project management drama with technical documentation makes both less useful.' },
    { id: 10, dim: 'Transparency', text: 'The user asks what you think of a colleague\'s code. The quality is poor.', a: 'Point out specific issues and suggest improvements — no personal judgment, just facts', b: 'Acknowledge what\'s done well first, then gently suggest areas for improvement' },
    { id: 11, dim: 'Transparency', text: 'You found and fixed a 2-month-old bug in the billing service: a timezone conversion error that caused ~200 international users to see invoice timestamps shifted by one hour. The invoices were correct in every other way — amounts, line items, payment status. The fix is a 3-line patch (hardcoded UTC offset → timezone library), and you\'ve written a data migration to correct the stored timestamps.', a: 'Post a brief incident report in the engineering-wide channel — the bug, impact (200 users, display-only timestamp shift, no billing errors), fix, and root cause. Even small bugs deserve visibility: someone else might have the same hardcoded-offset pattern in their service, and normalizing public post-mortems for minor issues makes it easier to disclose major ones later.', b: 'Fix it, run the migration, and include it in the team\'s sprint summary. A display-only timestamp shift affecting 200 users is a routine bug fix, not an engineering-wide learning event. Broadcasting it to 150 engineers who have no context on the billing service creates noise and trains people to skim the engineering channel. Post-mortem culture works when reserved for incidents that reveal systemic patterns — not every 3-line patch.' },
    { id: 12, dim: 'Transparency', text: 'You\'re helping a junior developer understand JavaScript\'s event loop. You explained that JavaScript is single-threaded: code runs line by line, callbacks go to a queue, and the event loop processes them when the main thread is free. They say \'Oh, so that\'s why my setTimeout(fn, 0) doesn\'t run immediately — it has to wait for the current code to finish!\' This is exactly correct. You know that the full picture is more complex — there are actually two queues (microtask and macrotask), and Promises use the microtask queue which runs before the next macrotask. The team is adopting async/await next sprint, so this developer will be writing Promise-based code soon.', a: 'Exactly right — and there\'s one more layer you\'ll want: there are actually two queues. Promises use a \'microtask\' queue that runs before setTimeout callbacks. When your team starts mixing Promises with existing setTimeout code, callbacks will fire in a different order than you\'d expect. Worth having the full picture before that happens.', b: 'Exactly right, that\'s the core model. Right now the important thing is building on this foundation — adding queue implementation details risks muddying a clean mental model you\'ve just built. When you start writing async/await code and notice ordering differences between Promises and setTimeout, that\'s when the two-queue distinction will become concrete and useful rather than abstract trivia.' },
    { id: 13, dim: 'Adaptability', text: 'Your team has worked in 2-week sprints for a year. Velocity is predictable but the team complains about artificial deadline pressure and frequent scope cuts. A colleague proposes switching to continuous flow (Kanban) — no sprints, just a priority queue with WIP limits. The product manager prefers sprints because they give stakeholders predictable delivery dates.', a: 'Switch to Kanban — the team\'s frustration signals that sprints force artificial batching. WIP limits enforce focus without fake deadlines, and stakeholders can track progress through the board rather than waiting for sprint reviews', b: 'Keep sprints — predictable cadence is a feature, not a bug. Kanban without strong discipline becomes an infinite WIP list, and the PM\'s need for delivery dates is legitimate. The team\'s \'pressure\' is actually a useful constraint that prevents scope creep' },
    { id: 14, dim: 'Adaptability', text: 'Your team\'s 30K-line TypeScript project has strict: false in tsconfig.json. The code works, ships weekly, has 90% test coverage. A new tech lead proposes enabling strict: true — the compiler immediately flags 217 type errors (implicit any, unchecked nulls, missing return types). None are known bugs; the code runs fine. Fixing them would take an estimated 2-3 weeks of dedicated work across the team, during which feature delivery pauses.', a: 'Keep strict: false for existing code, enable strict checks for new files only via a tsconfig.strict.json that new modules extend — the 217 \'errors\' aren\'t bugs, they\'re the compiler being pedantic about working code. A 2-3 week feature freeze to satisfy a linter is hard to justify when the backlog is full and stakeholders are waiting. Gradual adoption means every new file gets strict guarantees while proven code stays untouched. The team that wrote this code shipped it with 90% coverage and weekly releases — retrofitting strictness onto code that\'s already been validated by tests and production is ceremony, not engineering.', b: 'Enable strict: true and fix all 217 errors now — those aren\'t false positives, each one is a place where the compiler can\'t verify correctness, meaning you\'re relying on convention and luck instead of tooling. Two tsconfig files with different strictness levels create a two-tier codebase where \'it depends which directory you\'re in\' becomes tribal knowledge. 2-3 weeks now prevents years of accumulating type debt; the 217 will only grow as the codebase does. Test coverage catches behavioral bugs, not type-level contract violations — strict mode and tests protect against different failure classes.' },
    { id: 15, dim: 'Adaptability', text: 'Your organization has 6 backend services in separate repositories. Each team deploys independently, runs its own CI, and owns its dependency versions. The platform team proposes consolidating into a monorepo \u2014 shared CI pipeline, atomic cross-service changes, unified dependency management. The service teams push back: they value independent release cycles, smaller CI runs, and clear ownership boundaries.', a: 'Keep separate repos \u2014 monorepo benefits come with coupling costs. Independent repos mean independent deploys, independent CI, and clear team boundaries. The \u2018atomic cross-service change\u2019 benefit is a code smell \u2014 services that need coordinated deploys aren\'t really independent services. Fix the coupling, don\'t institutionalize it', b: 'Consolidate to monorepo \u2014 the \u2018independence\u2019 of polyrepo is an illusion when services share types, configs, and deployment infrastructure. Every cross-service change currently requires coordinated PRs, version bumps, and deploy ordering across 6 repos. Monorepo makes the coupling explicit and manageable instead of hidden behind publish cycles' },
    { id: 16, dim: 'Adaptability', text: 'Your team uses feature branches for all new work — each feature gets a branch, runs CI, gets reviewed, and merges when complete. Average branch lifetime is 5-7 days. A tech lead proposes switching to trunk-based development with feature flags: everyone commits to main daily, incomplete features hidden behind runtime flags, CI runs against the actual production codebase. She piloted it on her 4-person sub-team for 3 months: merge conflicts dropped 70% and integration bugs caught 2 days earlier on average. But production code now has 47 feature flags, 12 of which are stale — nobody is confident they can be safely removed. The feature-branch teams had 3 painful multi-day merge conflicts this quarter, but their production code is always clean: no dead flags, no conditional paths, no \'is this flag still needed?\' archaeology.', a: 'Adopt trunk-based with flags — 70% fewer merge conflicts is measured team velocity, not an experiment. Stale flags are a hygiene problem solved by expiry dates and a cleanup job, not an architectural flaw. Feature branches that live 5-7 days are integration problems waiting to happen — every day a branch lives, it drifts further from the real codebase. The 3 painful conflicts are the ones they noticed; the subtle integration bugs from late merges are the ones that shipped silently', b: 'Keep feature branches — trunk-based trades visible pain (merge conflicts) for invisible debt (stale flags, conditional logic in production). 12 stale flags in 3 months means cleanup discipline already failed during the pilot — at full-team scale it will be worse. A merge conflict is a problem you solve once and it\'s gone; a stale feature flag is a landmine in production code forever. Clean production code is worth the occasional painful merge' },
  ],
  zh: [
    { id: 1, dim: '自主性', text: '你在把一个单体测试套件迁移到并行执行。总测试时间从 45 分钟降到了 8 分钟。但 400 个测试中有 12 个在并行环境下间歇性失败——它们共用测试数据库，偶尔在数据准备/清理阶段冲突。你可以给每个测试隔离独立的数据库事务（增加开销，总时间从 8 分钟升到 11 分钟，但 100% 确定性），或者保持共享数据库并加自动重试逻辑（失败的测试最多重跑 3 次——当前首次通过率 99.7%，重试后 100% 通过，时间保持 8 分钟）。', a: '用独立事务隔离——99.7% 的首次通过率意味着每 300 次运行就有 1 次产生假失败。每天 50 次 CI，大约每 6 天一次假红，每次让开发者花 5-10 分钟排查后才发现「又是那个 flaky test，重跑就好」。3 分钟的额外耗时对工作流来说几乎无感；但间歇性失败对 CI 信任的侵蚀是累积的。确定性测试是 CI 信心的基础——重试只是在掩盖真正的问题。', b: '保持共享数据库加重试——测试套件从 45 分钟降到了 8 分钟，为了 400 个测试里的 12 个就加回 37% 的时间，等于回吐你刚交付的成果。重试方案最终通过率 100%，还保住了速度。开发者的工作流已经建立在「测试跑 8 分钟」上——改成 11 分钟会动摇对并行化改造的认可。自动重试的 flaky test 在操作层面是透明的；而为了确定性多付 3 分钟则是每天 50 次的永久税。' },
    { id: 2, dim: '自主性', text: '你在给一个 Node.js API 服务添加新端点。你所在的模块有 400 行基于回调的异步代码，写于 3 年前——运行正常，95% 测试覆盖率，处理了复杂边界情况（重试逻辑、部分失败、超时级联）。你的新端点使用 async/await。一个模块里两种异步模式造成了不一致。将旧代码重写为 async/await 需要 4 小时，现有测试套件应该能捕获回归问题。', a: '重写为 async/await——一个模块里两种异步模式是对每个未来贡献者的可读性税。95% 的测试覆盖率正是为了这种安全重构而存在的。趁你有上下文时清理干净；没人会主动志愿重构能用的代码，而且随着新端点的增加，不一致只会越来越严重。', b: '用 async/await 写你的端点，不动旧代码——\'能用、有测试、处理了边界情况\'就是你不该碰的代码的定义。测试覆盖率捕获的是功能回归，不是时序依赖、错误顺序和背压处理这类行为细节。一个稳定运行 3 年的模块有资格保持丑陋。你的任务是加一个端点，不是重写。' },
    { id: 3, dim: '自主性', text: '你在帮用户整理代码库。他们让你「清理 main.js 的 imports」。在重新组织 imports 时，你发现 12 个导入模块中有 4 个完全没有被使用——导入了但文件中任何地方都没有引用。项目使用 ES modules，没有副作用导入。删除它们只需每个删一行。', a: '删掉未使用的 imports——「清理 imports」显然包括删除死代码。在没有副作用导入的 ES module 项目中，未引用的 import 按定义就是死代码。明知有死 imports 还声称已经「清理」完了，是交付不完整的工作。用户不应该需要单独再要求你删掉明显的废代码。', b: '只重新组织 imports（排序和分组），然后提一下那 4 个未使用的——「清理」可以是任何意思，从格式化到重构，用户选了一个窄义的说法。即使在 ES modules 中，从一个文件的视角看起来「未使用」的模块，可能是类型声明、测试 mock 初始化或影响其他文件的模块初始化所需要的。删除代码比整理代码风险更高。告诉用户你发现了什么，让他们来决定是否删除——整理是你的事，删除是他们的决定。' },
    { id: 4, dim: '自主性', text: '你是值班工程师，凌晨 3 点被内部看板服务（仅工作时间使用，非客户面向）的健康检查告警叫醒。你 SSH 上去发现服务因内存溢出崩溃——一个没有驱逐策略的内存缓存持续增长直到耗尽堆内存。你重启服务（10 秒，无数据丢失），健康检查恢复绿色。添加基于 TTL 的驱逐（maxAge: 1 小时）是缓存初始化代码中的 3 行改动，就在你正看着的文件里。', a: '加上缓存 TTL——你正看着导致崩溃的代码，3 行配置添加缓存驱逐是最小的根因修复。不处理无限增长就重启，意味着这个告警还会再来——也许下周，也许明天凌晨 3 点。值班意味着解决事故，不是按下贪睡键。一个写着「OOM 告警，发现无驱逐策略，添加 1 小时 TTL」的 PR 是你能写出的最清晰的 commit message。', b: '只重启，提一个详细的 ticket——值班范围是「恢复服务」，你已经做到了。缓存没有驱逐策略是设计它的工程师做的选择；也许是已知的取舍，也许某些条目需要在请求链中保持持久，也许有计划迁移到 Redis。凌晨 3 点的代码改动绕过了 review、没有测试，还给负责团队留下「谁改了这个？」的谜题。记录你发现的一切——OOM、缓存配置位置、增长模式——让修复在工作时间带着完整上下文正确完成。' },
    { id: 5, dim: '精确度', text: 'CEO 在全体大会上问你的组长："新 Dashboard 什么时候能上线？" 组长转头看你。你内部评估过 3-5 周，取决于还没调研过的数据分析集成的复杂度。CEO 明显不耐烦，全公司都在看。', a: '"3 到 5 周——范围取决于数据分析集成的复杂度，我周五前能给出更精确的估计"——精确保护所有人。一个数字会变成承诺，3 周和 5 周的差别对规划很大。对不确定性具体说明比假装自信更专业。', b: '"大概一个月"——CEO 要的是规划数字，不是置信区间。在全公司面前说"3-5 周取决于 X"听起来像打太极，还会引出你现在答不了的追问。向上取整，提前交付。详细估算放项目计划里，不是放全体大会上。' },
    { id: 6, dim: '精确度', text: '用户让你帮忙 review 一篇 500 字的邮件。', a: '逐段标注：语法、逻辑、语气、收件人感受分析', b: '挑最关键的两三个问题指出' },
    { id: 7, dim: '精确度', text: '你在帮同事 review 一份技术设计文档，准备发给团队。技术方案没问题，但文字有不少语法错误、格式不统一、还有几处表述不清。他们让你\'看看技术方案有没有问题\'。', a: '全改——语法、格式、表述清晰度，加上技术反馈。打磨过的文档对他们和团队都好。既然已经在看了，留着明显的表面问题不管说不过去', b: '只回复技术方案的问题。没人请你改的时候去改别人的文字，可能让人觉得居高临下，尤其是跨语言背景的同事。人家问的是技术 review，不是写作课' },
    { id: 8, dim: '精确度', text: '你在为团队的新 API 网关项目评估后选择了 Axios 而非 got。三个队友在 Slack 帖子里问：\'为什么选 Axios？\'你在评估时跑过基准测试、读过两个库的源码、对比过它们的重试/拦截器 API。', a: '发一份结构化对比——你的基准测试数据（请求/秒、p99 延迟、内存）、API 工效学分析（Axios 拦截器 vs got hooks 对你们的退避重试模式的适配）、包体积对比、以及你查过的社区健康数据（GitHub issue 响应时间、发版节奏、巴士系数）。6 个月后翻到这个 Slack 帖子的人应该不用再问你就能理解完整的决策背景。没有记录理由的技术决策会变成传说——\'我们用 Axios 是因为我们一直用 Axios。\'你花 10 分钟写的东西能省下未来无数次\'为什么不用 got？\'的讨论。', b: '\'Axios——对我们的场景更快，拦截器 API 更贴合我们的重试模式，包体积是 got 的 40%。想看基准测试数据随时说。\'三个人在 Slack 里问了个快问题，他们想要的是快答案，不是聊天帖里的研究论文。以后有人需要完整对比再说。长篇技术决策应该写在 ADR 或 wiki 里，不是写在下周就被 200 条消息淹没的 Slack 里。在聊天帖里写论文只会训练人们不再提问，因为答案要花 10 分钟才能读完。' },
    { id: 9, dim: '沟通风格', text: '你的团队按时交付了一个关键功能，但最后两周很艰难：三次生产环境热修复、两次通宵、两次代码评审被跳过以赶上发布日期。功能现在运行稳定，用户满意，管理层也表扬了团队的执行力。你正在为工程 wiki 撰写项目总结——这份文档将是未来团队在这部分代码库上工作时的参考资料。', a: '记录完整的情况：导致跳过代码评审的时间压力、热修复的根因、以及哪些模块是在压力下以较少审查编写的。继承这些代码的未来工程师需要真实的上下文——哪些部分走了捷径、哪里需要小心。一份读起来像新闻稿（\'团队展现了敏捷性\'）而非工程记录的项目总结，对那些要维护这些代码多年的人是一种失职。流程上的问题不是八卦——它们是影响你对每个模块质量信任度的工程上下文。被跳过评审的那两份代码？正是下次重构周期中需要额外审查的文件。', b: '记录架构、技术决策、已知技术债及其清理工单、以及未来项目的经验教训。流程叙事——跳过的评审、通宵——属于团队回顾会的内容，不是 wiki 内容。在整个工程组织都能访问的文档里写两次代码评审在截止日期压力下被跳过，会永久地给这个团队贴上偷工减料的标签，而实际上他们是在非常规情况下做了务实的权衡。技术债工单和架构文档覆盖了未来工程师实际需要的信息；赶工的故事是随着代码被重构和稳定而逐渐失去相关性的上下文。把项目管理的故事混入技术文档，会让两者都变得不那么有用。' },
    { id: 10, dim: '沟通风格', text: '用户问你怎么看一个同事写的代码，质量不太行。', a: '指出具体问题和改进建议——不带主观评价，只谈事实', b: '先肯定做得好的部分，再委婉建议改进方向' },
    { id: 11, dim: '沟通风格', text: '你发现并修复了计费服务中一个存在 2 个月的 bug：时区转换错误导致约 200 名国际用户看到的发票时间戳偏移了一小时。发票其他方面完全正确——金额、明细、支付状态都没问题。修复是 3 行代码（硬编码 UTC 偏移 → 时区库），你还写了数据迁移来修正存储的时间戳。', a: '在工程全员频道发一份简短的事故报告——bug 描述、影响（200 用户、仅显示时间戳偏移、无计费错误）、修复方案和根因。即使是小 bug 也值得可见度：其他人的服务可能有同样的硬编码偏移模式，让小问题的公开复盘成为常态，也更容易在大问题时坦诚披露。', b: '修完、跑迁移，写进团队 sprint 总结里。一个只影响显示的时间戳偏移、涉及 200 用户，是常规 bug 修复，不是工程全员的学习事件。给 150 个对计费服务毫无上下文的工程师广播这种事只会制造噪音，让人养成跳过工程频道的习惯。复盘文化在用于揭示系统性模式的事故时才有效——不是每个 3 行补丁都需要。' },
    { id: 12, dim: '沟通风格', text: '你在帮一个初级开发者理解 JavaScript 的事件循环。你解释了 JavaScript 是单线程的：代码逐行执行，回调放入队列，事件循环在主线程空闲时处理它们。他们说「噢，所以 setTimeout(fn, 0) 不会立即执行是因为要等当前代码跑完！」这完全正确。你知道完整的图景更复杂——实际上有两个队列（微任务和宏任务），Promise 使用微任务队列，在下一个宏任务之前执行。团队下个 sprint 要转用 async/await，这位开发者很快就会写 Promise 代码。', a: '「没错——趁事件循环还热乎着说一下：其实有两个队列。Promise 用的是『微任务』队列，它会在 setTimeout 回调之前执行。你们团队马上要转 async/await 了，你很快就会碰到这个区别。现在搞清楚全貌，比以后调一个莫名其妙的执行顺序 bug 要好。」', b: '「没错，核心模型你已经掌握了。等你开始用 async/await 的时候，你会发现 Promise 和 setTimeout 之间有一些执行顺序的差异——那是事件循环的下一层，等你在真实代码里看到的时候自然就懂了。你现在打下的基础正好可以往上搭。」' },
    { id: 13, dim: '适应性', text: '团队用两周一次的 sprint 已经一年了。速度可预测，但团队抱怨人为的截止压力和频繁砍需求。一个同事提议切换到持续流（看板）——不再有 sprint，只有一个按优先级排列的待办队列加 WIP 限制。产品经理更喜欢 sprint，因为能给利益相关方可预测的交付日期。', a: '切换到看板——团队的不满说明 sprint 在强制人为分批。WIP 限制无需假 deadline 也能保持专注，利益相关方可以通过看板追踪进度而不是等 sprint review', b: '保持 sprint——可预测的节奏是特性不是缺陷。没有强纪律的看板会变成无限 WIP 列表，PM 需要交付日期是合理的。团队感受到的\'压力\'实际上是防止范围蔓延的有用约束' },
    { id: 14, dim: '适应性', text: '团队的 30K 行 TypeScript 项目在 tsconfig.json 中设置了 strict: false。代码运行正常，每周发版，测试覆盖率 90%。新来的技术负责人提议启用 strict: true——编译器立即标记出 217 个类型错误（隐式 any、未检查的 null、缺少返回类型）。没有一个是已知 bug；代码运行完全正常。修复它们预计需要团队 2-3 周的专注工作，期间功能交付暂停。', a: '现有代码保持 strict: false，仅对新文件启用严格检查，通过 tsconfig.strict.json 让新模块继承——那 217 个「错误」不是 bug，是编译器对能用的代码吹毛求疵。backlog 排满、利益相关方在等的时候，很难为了满足 linter 而冻结功能 2-3 周。渐进式采用意味着每个新文件都有严格保障，而经过验证的代码不被打扰。写这些代码的团队在 90% 覆盖率和每周发版的节奏下交付了它——给已经被测试和生产验证过的代码补严格模式是仪式感，不是工程。', b: '启用 strict: true 并立即修复所有 217 个错误——那些不是误报，每一个都是编译器无法验证正确性的地方，意味着你在依赖惯例和运气而不是工具。两个不同严格程度的 tsconfig 文件会创造一个双轨代码库，「看你在哪个目录」变成部落知识。现在花 2-3 周能防止多年的类型债务累积；那 217 个只会随着代码库增长而增加。测试覆盖率捕获的是行为 bug，不是类型层面的契约违规——严格模式和测试防护的是不同的故障类别。' },
    { id: 15, dim: '适应性', text: '组织有 6 个后端服务分布在独立的仓库里。每个团队独立部署、独立 CI、独立管理依赖版本。平台团队提议合并成 monorepo——统一 CI、原子化跨服务变更、统一依赖管理。服务团队反对：他们看重独立发布节奏、更小的 CI 矩阵和清晰的所有权边界。', a: '保持独立仓库——monorepo 的好处伴随耦合代价。独立 repo 意味着独立部署、独立 CI、清晰的团队边界。「原子化跨服务变更」本身就是代码异味——需要协调部署的服务压根不是真正独立的服务。应该修耦合，不是制度化它', b: '合并成 monorepo——polyrepo 的「独立性」是幻觉，因为服务之间共享类型、配置和部署基础设施。每次跨服务改动都需要在 6 个 repo 间协调 PR、版本号和部署顺序。monorepo 让耦合显式化和可管理，而不是藏在 publish 流程背后' },
    { id: 16, dim: '适应性', text: '团队所有新功能都走 feature branch——每个功能一个分支，跑 CI，review，完成后合并。分支平均生命周期 5-7 天。技术负责人提议切换到基于主干的开发+特性开关：所有人每天提交到 main，未完成的功能用运行时开关隐藏，CI 跑的是真实的生产代码库。她在自己的 4 人小团队试行了 3 个月：合并冲突减少 70%，集成 bug 平均提前 2 天发现。但生产代码中现在有 47 个特性开关，其中 12 个是过期的——没人确定能安全移除。走 feature branch 的团队本季度有 3 次痛苦的多天合并冲突，但他们的生产代码始终干净：没有废弃开关，没有条件路径，不需要「这个 flag 还在用吗？」的考古。', a: '切换到基于主干+开关——70% 的冲突减少是实测的团队效率提升，不是实验。过期开关是清理纪律问题，加过期时间和清理任务就解决了，不是架构缺陷。5-7 天的 feature branch 是等待发生的集成问题——每多活一天，就离真实代码库更远一步。那 3 次痛苦的冲突是他们注意到的；晚合并导致的隐性集成 bug 是静默上线的那些', b: '保持 feature branch——基于主干是把看得见的痛苦（合并冲突）换成看不见的债务（过期开关、生产代码里的条件逻辑）。3 个月就有 12 个过期开关说明清理纪律在试行阶段就已经失败了——全团队推广只会更糟。合并冲突是解决一次就消失的问题；过期的特性开关是生产代码里永久的地雷。干净的生产代码值得偶尔的痛苦合并' },
  ],
};

// SBTI questions (from questions-v4.js)
const sbtiQuestions = require('./questions-v4.js');

// Load full type profiles from types.json (has complete zh translations)
const typesJson = require('./api/v1/types.json');
const richProfiles = typesJson.abti.types;

// ─── Slug generation ─────────────────────────────────────────────────────
function escapeXml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'agent';
}

// ─── Agent registration (shared between REST API and MCP) ─────────────────
const HISTORY_SNAPSHOT_FIELDS = ['type', 'testedAt', 'scores', 'dimensions', 'model', 'provider', 'consistency', 'runs', 'parseFailures', 'confidence'];
const HISTORY_CAP = 50;

function snapshotAgent(agent) {
  const snap = {};
  for (const k of HISTORY_SNAPSHOT_FIELDS) {
    if (agent[k] !== undefined) snap[k] = agent[k];
  }
  return snap;
}

function preserveHistory(existingAgent, newEntry) {
  const history = Array.isArray(existingAgent.history) ? existingAgent.history.slice() : [];
  history.push(snapshotAgent(existingAgent));
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
  newEntry.history = history;
}

function registerAgent(entry) {
  if (entry.name && !entry.slug) {
    entry.slug = slugify(entry.name);
  }
  let existing = agentData.agents.findIndex(a => a.slug === entry.slug);
  if (existing === -1 && entry.model) {
    existing = agentData.agents.findIndex(a => a.model && a.model === entry.model);
  }
  if (existing !== -1) {
    preserveHistory(agentData.agents[existing], entry);
    agentData.agents[existing] = entry;
  } else {
    agentData.agents.push(entry);
  }
  saveData(agentData);
  if (entry.slug && entry.scores) {
    setImmediate(() => {
      try {
        generateAgentOG(entry, OG_DIR);
      } catch (e) {
        console.error(`OG generation failed for ${entry.slug}:`, e.message);
      }
    });
  }
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
      version: ABTI_QUESTION_VERSION,
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
      version: SBTI_QUESTION_VERSION,
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
      out[k] = { code: k, nick: loc.nick, strengths: loc.strengths, blindSpots: loc.blindSpots, workStyle: loc.workStyle, bestPairedWith: loc.bestPairedWith, tuningTips: loc.tuningTips };
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
        if (agentName && typeof agentName === 'string') {
          const name = agentName.slice(0, 64);
          const urlStr = (typeof agentUrl === 'string') ? agentUrl : '';
          const now = new Date().toISOString();
          const slug = slugify(name);
          const entry = { name, slug, url: urlStr, type: code, nick: t?.en?.nick || 'Unknown', testedAt: now, scores: scores.slice(), dimensions: DL.map((d, i) => ({ poles: d, score: scores[i], max: 4 })) };
          if (typeof model === 'string' && model) entry.model = model.slice(0, 64);
          if (typeof provider === 'string' && provider) entry.provider = provider.slice(0, 32);
          if (typeof parsed.consistency === 'number' && parsed.consistency >= 0 && parsed.consistency <= 100) entry.consistency = Math.round(parsed.consistency * 100) / 100;
          if (typeof parsed.runs === 'number' && Number.isInteger(parsed.runs) && parsed.runs > 0) entry.runs = parsed.runs;
          if (typeof parsed.parseFailures === 'number' && Number.isInteger(parsed.parseFailures) && parsed.parseFailures >= 0) {
            entry.parseFailures = parsed.parseFailures;
            entry.confidence = Math.round(((16 - parsed.parseFailures) / 16) * 1000) / 1000;
          }
          if (typeof parsed.questionVersion === 'string' && parsed.questionVersion) entry.questionVersion = parsed.questionVersion.slice(0, 32);
          let existing = agentData.agents.findIndex(a => a.slug === slug);
          if (existing === -1 && entry.model) {
            existing = agentData.agents.findIndex(a => a.model && a.model === entry.model);
          }
          if (existing !== -1) {
            preserveHistory(agentData.agents[existing], entry);
            agentData.agents[existing] = entry;
          } else {
            agentData.agents.push(entry);
          }
          // Async OG image generation (non-blocking)
          setImmediate(() => {
            try {
              generateAgentOG(entry, OG_DIR);
            } catch (e) {
              console.error(`OG generation failed for ${entry.slug}:`, e.message);
            }
          });
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
    return res.end(JSON.stringify({ total: agentData.agents.length, agents: agentData.agents }));
  }

  // GET /api/leaderboard - ranked agents by consistency
  if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
    const agents = agentData.agents || [];
    const ranked = agents
      .filter(a => typeof a.consistency === 'number' && typeof a.runs === 'number' && a.runs > 0)
      .map(a => ({ name: a.name, slug: a.slug, model: a.model || null, provider: a.provider || null, type: a.type, nick: a.nick, consistency: a.consistency, runs: a.runs, scores: a.scores || null, testedAt: a.testedAt }))
      .sort((a, b) => b.consistency - a.consistency || b.runs - a.runs);
    const rankedSlugs = new Set(ranked.map(a => a.slug));
    const unranked = agents
      .filter(a => !rankedSlugs.has(a.slug))
      .map(a => ({ name: a.name, slug: a.slug, model: a.model || null, provider: a.provider || null, type: a.type, nick: a.nick, testedAt: a.testedAt }))
      .sort((a, b) => (b.testedAt || '').localeCompare(a.testedAt || ''));
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ ranked, unranked }));
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

  // GET /badge/agent/:slug - dynamic agent badge
  const agentBadgeMatch = url.pathname.match(/^\/badge\/agent\/([^/]+)$/);
  if (agentBadgeMatch && req.method === 'GET') {
    const slug = decodeURIComponent(agentBadgeMatch[1]);
    const agent = (agentData.agents || []).find(a => (a.slug || slugify(a.name)) === slug);
    const found = agent && agent.type;
    const label = 'ABTI';
    const t = found ? types[agent.type] : null;
    const value = t ? `${agent.type} — ${t.en.nick}` : 'Not Tested';
    const labelWidth = 36;
    const valueWidth = found && t ? 10 + value.length * 6.6 : 70;
    const totalWidth = labelWidth + valueWidth;
    const labelX = labelWidth / 2;
    const valueX = labelWidth + valueWidth / 2;
    const bgColor = found && t ? '#FF69B4' : '#9f9f9f';

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

    res.writeHead(found ? 200 : 404, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=300'
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

  // GET /og/agents/:slug.png - per-agent OG image
  const ogAgentMatch = url.pathname.match(/^\/og\/agents\/([a-z0-9-]+)\.png$/);
  if (ogAgentMatch && req.method === 'GET') {
    const slug = ogAgentMatch[1];
    const pngPath = path.join(__dirname, 'og', 'agents', `${slug}.png`);
    if (fs.existsSync(pngPath)) {
      const png = fs.readFileSync(pngPath);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, immutable',
        'Content-Length': png.length
      });
      return res.end(png);
    }
    res.writeHead(404, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({error:'Agent OG image not found'}));
  }

  // GET /embed/:type - embeddable type card
  const embedMatch = url.pathname.match(/^\/embed\/([A-Za-z]{4})$/);
  if (embedMatch && req.method === 'GET') {
    const code = embedMatch[1].toUpperCase();
    if (!types[code]) {
      res.writeHead(302, { 'Location': '/' });
      return res.end();
    }
    let html;
    try {
      html = fs.readFileSync(path.join(__dirname, 'embed.html'), 'utf8');
    } catch {
      res.writeHead(500, {'Content-Type':'text/plain'});
      return res.end('Server error');
    }
    html = html.replace('</head>', `<meta name="abti-type" content="${code}">\n</head>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
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
        dimensions: agent.dimensions,
        history: agent.history || []
      },
      profile: {
        strengths: profile.strengths,
        blindSpots: profile.blindSpots,
        workStyle: profile.workStyle,
        bestPairedWith: profile.bestPairedWith,
        tuningTips: profile.tuningTips
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
    const agentSlug = agent.slug || slugify(agent.name);
    const agentOgPath = path.join(__dirname, 'og', 'agents', `${agentSlug}.png`);
    const ogImage = fs.existsSync(agentOgPath)
      ? `https://abti.kagura-agent.com/og/agents/${agentSlug}.png`
      : `https://abti.kagura-agent.com/og/${agent.type}`;
    const ogTags = [
      `<meta property="og:title" content="${agent.name} — ${agent.type} ${nick} | ABTI">`,
      `<meta property="og:description" content="${desc}">`,
      `<meta property="og:image" content="${ogImage}">`,
      `<meta property="og:url" content="https://abti.kagura-agent.com/agent/${agentSlug}">`,
      `<meta property="og:type" content="website">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${agent.name} — ${agent.type} ${nick} | ABTI">`,
      `<meta name="twitter:description" content="${desc}">`,
      `<meta name="twitter:image" content="${ogImage}">`,
    ].join('\n');
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      name: agent.name + ' — ' + agent.type + ' | ABTI',
      description: desc,
      url: 'https://abti.kagura-agent.com/agent/' + agentSlug,
      mainEntity: {
        '@type': 'SoftwareApplication',
        name: agent.name,
        applicationCategory: 'AI Agent',
        additionalProperty: [
          { '@type': 'PropertyValue', name: 'ABTI Type', value: agent.type },
          { '@type': 'PropertyValue', name: 'Nickname', value: nick }
        ]
      }
    };
    if (agent.model) jsonLd.mainEntity.softwareVersion = agent.model;
    if (agent.provider) jsonLd.mainEntity.publisher = { '@type': 'Organization', name: agent.provider };
    const jsonLdTag = '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</script>';
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${agent.name} — ${agent.type} "${nick}" | ABTI</title>`);
    html = html.replace('</head>', ogTags + '\n' + jsonLdTag + '\n</head>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // GET /compare-agents or /compare-agents.html - compare two agents with dynamic OG tags
  if ((url.pathname === '/compare-agents' || url.pathname === '/compare-agents.html') && req.method === 'GET') {
    let html;
    try {
      html = fs.readFileSync(path.join(__dirname, 'compare-agents.html'), 'utf8');
    } catch {
      res.writeHead(500, {'Content-Type':'text/plain'});
      return res.end('Server error');
    }
    const slugA = url.searchParams.get('a');
    const slugB = url.searchParams.get('b');
    if (slugA && slugB) {
      const findAgent = (s) => {
        const sl = decodeURIComponent(s).toLowerCase();
        const matches = agentData.agents.filter(a => a.slug === sl || slugify(a.name) === sl);
        return matches.length ? matches[matches.length - 1] : null;
      };
      const agent1 = findAgent(slugA);
      const agent2 = findAgent(slugB);
      if (agent1 && agent2) {
        const nick1 = types[agent1.type]?.en?.nick || agent1.nick || agent1.type;
        const nick2 = types[agent2.type]?.en?.nick || agent2.nick || agent2.type;
        let sharedDims = 0;
        for (let i = 0; i < 4 && i < agent1.type.length && i < agent2.type.length; i++) {
          if (agent1.type[i] === agent2.type[i]) sharedDims++;
        }
        const title = `${agent1.name} vs ${agent2.name} — ABTI Agent Compare`;
        const desc = `Compare AI agent personalities: ${agent1.type} (${nick1}) vs ${agent2.type} (${nick2}) — ${sharedDims}/4 shared dimensions`;
        const slug1 = agent1.slug || slugify(agent1.name);
        const slug2 = agent2.slug || slugify(agent2.name);
        const ogTags = [
          `<meta property="og:title" content="${title}">`,
          `<meta property="og:description" content="${desc}">`,
          `<meta property="og:image" content="https://abti.kagura-agent.com/og-abti.png">`,
          `<meta property="og:url" content="https://abti.kagura-agent.com/compare-agents.html?a=${encodeURIComponent(slug1)}&b=${encodeURIComponent(slug2)}">`,
          `<meta property="og:type" content="website">`,
          `<meta name="twitter:card" content="summary_large_image">`,
          `<meta name="twitter:title" content="${title}">`,
          `<meta name="twitter:description" content="${desc}">`,
          `<meta name="twitter:image" content="https://abti.kagura-agent.com/og-abti.png">`,
        ].join('\n');
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
        html = html.replace(/<meta name="twitter:card"[^>]*>/, '');
        html = html.replace(/<meta name="twitter:title"[^>]*>/, '');
        html = html.replace(/<meta name="twitter:description"[^>]*>/, '');
        html = html.replace(/<meta name="twitter:image"[^>]*>/, '');
        html = html.replace('</head>', ogTags + '\n</head>');
      }
    }
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

  // GET /leaderboard - serve leaderboard.html
  if (url.pathname === '/leaderboard' && req.method === 'GET') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'leaderboard.html'), 'utf8');
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

  // GET /feed.xml - Atom feed of recent agent test results
  if (url.pathname === '/feed.xml' && req.method === 'GET') {
    const BASE = 'https://abti.kagura-agent.com';
    const agents = (agentData.agents || [])
      .filter(a => a.testedAt)
      .sort((a, b) => new Date(b.testedAt) - new Date(a.testedAt))
      .slice(0, 50);
    const updated = agents.length > 0 ? new Date(agents[0].testedAt).toISOString() : new Date().toISOString();
    const entries = agents.map(a => {
      const slug = a.slug || slugify(a.name);
      const published = new Date(a.testedAt).toISOString();
      const dimLabels = ['Autonomy','Precision','Transparency','Adaptability'];
      const dimDetail = (a.dimensions || []).map((d, i) => {
        const label = dimLabels[i] || `Dim ${i+1}`;
        const pole = d.majority || (d.poles ? d.poles[d.score >= 2 ? 0 : 1] : '?');
        return `${label}: ${pole} (${d.score}/4)`;
      }).join(', ');
      const content = `Type: ${a.type || 'Unknown'} — ${a.nick || 'Unknown'}. ${dimDetail}`;
      return `  <entry>\n    <title>${escapeXml(a.name)} — ${escapeXml(a.type || 'Unknown')} (${escapeXml(a.nick || '')})</title>\n    <link href="${BASE}/agent/${encodeURIComponent(slug)}" rel="alternate"/>\n    <id>${BASE}/agent/${encodeURIComponent(slug)}#${published}</id>\n    <published>${published}</published>\n    <updated>${published}</updated>\n    <summary type="text">${escapeXml(content)}</summary>\n  </entry>`;
    }).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>ABTI — Agent Test Results</title>\n  <subtitle>Recent AI agent personality test results from ABTI</subtitle>\n  <link href="${BASE}/feed.xml" rel="self" type="application/atom+xml"/>\n  <link href="${BASE}" rel="alternate"/>\n  <id>${BASE}/feed.xml</id>\n  <updated>${updated}</updated>\n  <author><name>ABTI</name></author>\n${entries}\n</feed>`;
    res.writeHead(200, { 'Content-Type': 'application/atom+xml; charset=utf-8' });
    return res.end(xml);
  }

  // GET /sitemap.xml - dynamic sitemap including agent pages
  if (url.pathname === '/sitemap.xml' && req.method === 'GET') {
    const BASE = 'https://abti.kagura-agent.com';
    const VALID_TYPES = ['PTCF','PTCN','PTDF','PTDN','PECF','PECN','PEDF','PEDN','RTCF','RTCN','RTDF','RTDN','RECF','RECN','REDF','REDN'];
    const staticPages = ['/', '/types.html', '/agents.html', '/compare.html', '/compare-agents.html', '/api.html', '/sbti.html', '/test-agent.html', '/cross-compatibility.html', '/leaderboard.html', '/families.html', '/compatibility.html', '/stats.html'];
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
      const category = score >= 80 ? 'complementary' : score >= 60 ? 'balanced' : 'similar';
      return { code, nick: profile.nick || code, score, category };
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
  res.end(JSON.stringify({error:'not found',endpoints:['GET /api/test','GET /api/sbti/test','GET /api/types','GET /api/sbti/types','POST /api/agent-test','POST /api/sbti/agent-test','GET /api/agents','GET /api/agent/:slug','GET /api/stats','GET /api/compare/:type1/:type2','GET /api/compatibility','GET /api/compatibility/matrix','GET /api/compatibility/human','GET /api/compatibility/cross','GET /badge/:type','GET /badge/agent/:slug','GET /sbti/badge/:type','GET /type/:code','GET /agent/:slug','GET /result/:type','GET /sbti/result/:type','GET /test-agent','GET /api/openapi.json','POST /mcp','GET /mcp','DELETE /mcp']}));
});

if (require.main === module) {
  server.listen(3300, '127.0.0.1', () => console.log('ABTI API listening on :3300'));
}
module.exports = server;
module.exports.resetData = resetData;
module.exports.stopWatching = stopWatching;
module.exports.rateLimitMap = rateLimitMap;
module.exports.slugify = slugify;
