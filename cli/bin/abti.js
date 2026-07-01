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
// ── Question version (single source of truth: api/v1/abti.json) ────────────
const QUESTION_VERSION = require(require('path').join(__dirname, '..', '..', 'api', 'v1', 'abti.json')).version;

const DIM_LETTERS = [['P','R'],['T','E'],['C','D'],['F','N']];
const DIM_NAMES = {
  en: [['Autonomy','Proactive','Responsive'],['Precision','Thorough','Efficient'],['Transparency','Candid','Diplomatic'],['Adaptability','Flexible','Principled']],
  zh: [['自主性','主动','响应'],['精确度','面面俱到','精简高效'],['沟通风格','直言不讳','委婉圆滑'],['适应性','随机应变','坚持原则']]
};

// ── Bundled questions (fallback for offline use) ────────────────────────────
const QUESTIONS = {
  en: [
    {q:"You're implementing a feature and realize a small utility function you're writing would also benefit two other planned features. Building the reusable version takes 20 extra minutes.",a:"Build the reusable version now — 20 minutes saves duplication later",b:"Write it for your current feature only — speculative generalization often goes unused"},
    {q:"You're setting up a GitHub Actions CI pipeline for the user's project. The build works, tests pass, and the pipeline triggers on pull requests. You notice the repository has no branch protection — anyone can push directly to main, bypassing your new CI pipeline entirely. Setting up basic branch protection (require PR + passing CI to merge into main) takes 2 minutes.",a:"Configure branch protection — CI that code can bypass by pushing directly to main is security theater. Without branch protection, the pipeline you just built is optional, not required. Two minutes to make CI actually enforced is the difference between a guardrail and a suggestion.",b:"Just deliver the CI pipeline as asked — branch protection is a team governance decision, not a CI task. Maybe they're a solo developer who values fast iteration, or they have deployment workflows that depend on direct pushes. CI does its job: test code when it runs. Enforcing workflow policy is a different conversation."},
    {q:"You're helping a user organize their codebase. They ask you to 'clean up the imports in main.js.' While reorganizing, you notice 4 of the 12 imported modules are completely unused — imported but never referenced. Removing them is a one-line deletion each.",a:"Remove the unused imports — 'clean up the imports' clearly encompasses removing dead code. This is the most basic form of cleanup",b:"Only reorganize (sort/group) the imports, flag unused ones in a comment — 'clean up' might mean just formatting, and removing imports risks breaking code if modules have side effects on import"},
    {q:"You're asked to optimize a slow database query. After fixing it (20-second query now takes 200ms), you notice 3 other queries on the same table with similar performance issues. Each would take 15 minutes to fix using the same indexing strategy. The user only asked about the one query.",a:"Optimize all 4 queries — you already understand the table structure and indexing strategy. Leaving 3 known-slow queries when the fix is mechanical is like fixing one pothole and stepping over three others",b:"Optimize only the one asked about — 'mechanical' doesn't mean 'safe.' Each query serves different code paths. Your indexing changes might break pagination ordering or affect write lock contention"},
    {q:"The user asks you to write a utility function that parses ISO 8601 date strings. They give one example: '2024-03-15T10:30:00Z'. You know the full ISO 8601 spec also covers timezone offsets (+05:30), week dates (2024-W12-5), ordinal dates (2024-075), and fractional seconds.",a:"Implement full ISO 8601 parsing — partial implementations create false confidence. Someone will pass '2024-03-15T10:30:00+05:30' expecting it to work because the function 'handles ISO dates.' Correctness means handling the spec, not just the happy path",b:"Parse the format they showed you and document what it covers. A full ISO 8601 parser is a project, not a utility function — if they need more formats later they'll extend it or use a library. Building for cases they haven't encountered is speculative engineering"},
    {q:"The user asks you to review a 500-word email.",a:"Annotate each paragraph: grammar, logic, tone, perception analysis",b:"Flag the 2-3 most critical issues"},
    {q:"You're reviewing a colleague's technical design document before it goes to the team. The technical approach is sound, but the writing has several grammar mistakes, inconsistent formatting, and a few unclear sentences. They asked you to 'check if the technical approach makes sense.'",a:"Fix everything — grammar, formatting, clarity, plus technical feedback. A polished doc reflects better on them and the team. When you're already in the document, leaving surface-level issues visible feels negligent",b:"Only address the technical approach as asked. Unsolicited copy-editing of someone's writing can feel condescending, especially across language backgrounds. They asked for technical review, not a writing class"},
    {q:"You're implementing a search feature in the user's codebase. The function you need to modify has an off-by-one error in its pagination logic — unrelated to search, it's been there for months, and it causes the last page of results to sometimes show one duplicate item.",a:"Fix the pagination bug in the same PR — you've already read and understood this code, the bug is trivial (a one-line fix), and walking away from a known defect that affects users because 'it's not in scope' is how technical debt compounds. Five minutes now versus a full context-reload later",b:"File a separate issue, fix it in its own PR — mixing an unrelated bug fix with a feature change means reviewers must evaluate two unrelated changes, git bisect can't isolate regressions, and if the feature needs reverting the bug fix disappears with it. One concern per PR is discipline, not bureaucracy"},
    {q:"The user confidently proposes an approach you think isn't great.",a:"\"I think there's a better direction — here's what I'd suggest...\"",b:"\"That's a solid starting point. If we tweak [specific part]...\""},
    {q:"The user asks what you think of a colleague's code. The quality is poor.",a:"Point out specific issues and suggest improvements directly",b:"Acknowledge what's done well first, then gently suggest improvements"},
    {q:"The user's side project launched last week after months of building. First-week metrics: 12 signups, 2 daily active users. They ask 'How do you think launch went?'",a:"Be direct about the numbers — 12 signups in a week signals a discovery or positioning problem worth diagnosing now. They asked for your take, and reframing weak metrics as 'early days' delays the iteration they need.",b:"Lead with the achievement of shipping — most side projects never launch. Frame the metrics as a baseline to experiment from rather than a verdict — discouragement kills more side projects than slow starts do."},
    {q:"The user redesigns their personal website. The new design looks modern but loads noticeably slower than the old version. They haven't mentioned performance as a concern.",a:"Bring up the load time difference unprompted — they may not have noticed, and a slow site loses visitors whether they're tracking it or not",b:"Focus feedback on what they asked about; mention speed only if they bring up performance — unsolicited technical criticism on a personal project can kill creative momentum"},
    {q:"Your team has worked in 2-week sprints for a year. Velocity is predictable but the team complains about artificial deadline pressure and frequent scope cuts. A colleague proposes switching to continuous flow (Kanban) — no sprints, just a priority queue with WIP limits. The product manager prefers sprints because they give stakeholders predictable delivery dates.",a:"Switch to Kanban — the team's frustration signals that sprints force artificial batching. WIP limits enforce focus without fake deadlines, and stakeholders can track progress through the board rather than waiting for sprint reviews",b:"Keep sprints — predictable cadence is a feature, not a bug. Kanban without strong discipline becomes an infinite WIP list, and the PM's need for delivery dates is legitimate. The team's 'pressure' is actually a useful constraint that prevents scope creep"},
    {q:"The user's coding style differs from best practices, but isn't wrong.",a:"Adapt to the user's style — keep the project consistent",b:"Suggest the better practice and explain why"},
    {q:"Your organization has 6 backend services in separate repositories. Each team deploys independently, runs its own CI, and owns its dependency versions. The platform team proposes consolidating into a monorepo — shared CI pipeline, atomic cross-service changes, unified dependency management. The service teams push back: they value independent release cycles, smaller CI runs, and clear ownership boundaries.",a:"Keep separate repos — monorepo benefits come with coupling costs. Independent repos mean independent deploys, independent CI, and clear team boundaries. The 'atomic cross-service change' benefit is a code smell — services that need coordinated deploys aren't really independent services. Fix the coupling, don't institutionalize it",b:"Consolidate to monorepo — the 'independence' of polyrepo is an illusion when services share types, configs, and deployment infrastructure. Every cross-service change currently requires coordinated PRs, version bumps, and deploy ordering across 6 repos. Monorepo makes the coupling explicit and manageable instead of hidden behind publish cycles"},
    {q:"The user's codebase uses callbacks throughout. They're adding a new module and want to use async/await there — just this one module — because the new code is cleaner with it. The rest of the codebase stays callbacks.",a:"Go for it — one async module won't break anything, and it's how they'll want to write all new code eventually. Gradual adoption beats a big-bang rewrite that never happens.",b:"Keep callbacks for consistency — mixing paradigms in one codebase creates two mental models developers must switch between. Either migrate fully or stay consistent until you're ready."},
  ],
  zh: [
    {q:"你在实现一个功能时，发现正在写的一个小工具函数也能用在接下来计划的两个功能上。写成通用版本多花20分钟。",a:"现在就写通用版——花20分钟省得以后重复造轮子",b:"只为当前功能写——提前泛化经常白做"},
    {q:"你在给用户的项目配置 GitHub Actions CI 流水线。构建成功，测试通过，流水线在 pull request 时触发。你注意到仓库没有分支保护——任何人都可以直接推送到 main，完全绕过你刚搭好的 CI 流水线。设置基本的分支保护（合并到 main 前要求 PR + CI 通过）只需要 2 分钟。",a:"配置分支保护——代码可以直接推 main 绕过 CI，那这个 CI 流水线就是摆设。没有分支保护，你刚搭好的流水线是建议而不是要求。两分钟让 CI 真正生效，是护栏和摆设的区别。",b:"只交付 CI 流水线——分支保护是团队治理决策，不是 CI 的事。也许他们是独立开发者，更看重快速迭代；也许他们有依赖直接推送的部署流程。CI 做了该做的事：代码推送时跑测试。强制执行工作流策略是另一个话题。"},
    {q:"你在 review 用户的 PR，发现他们写的一个函数和代码库里已有的功能重复了。",a:"直接在 PR 里重构，用已有的工具函数",b:"PR 本身没问题就通过，留评论建议后续合并重复代码"},
    {q:"你在按用户要求重构一个函数。你发现这个函数完全没有错误处理——如果数据库调用失败，应用会无声崩溃且无有用的错误信息。加上合适的错误处理需要额外 10 分钟。",a:"重构时顺手加上错误处理——你正在重组这段代码，问题一目了然，无声崩溃正是那种用户半夜三点在生产环境才发现的问题",b:"按原定范围完成重构，提一下缺少错误处理——在结构性重构里掺入正确性修复会让 diff 更难审查，还对你没被要求改的代码路径引入风险"},
    {q:"用户让你写一个解析 ISO 8601 日期字符串的工具函数。给了一个示例：'2024-03-15T10:30:00Z'。你知道完整的 ISO 8601 规范还包括时区偏移（+05:30）、周日期（2024-W12-5）、序数日期（2024-075）和小数秒。",a:"实现完整的 ISO 8601 解析——部分实现会产生虚假信心。总会有人传入 '2024-03-15T10:30:00+05:30' 并期望它正常工作，因为这个函数'能处理 ISO 日期'。正确性意味着处理规范，而不仅仅是示例",b:"只解析用户给的那种格式，注明支持范围。完整的 ISO 8601 解析器是一个项目而不是工具函数——以后需要更多格式时再扩展或用库。为没遇到过的场景提前建设是投机式工程"},
    {q:"用户让你审阅一封500字的邮件。",a:"逐段批注：语法、逻辑、语气、收件人感受分析",b:"指出2-3个最关键问题"},
    {q:"你在帮同事 review 一份技术设计文档，准备发给团队。技术方案没问题，但文字有不少语法错误、格式不统一、还有几处表述不清。他们让你'看看技术方案有没有问题'。",a:"全改——语法、格式、表述清晰度，加上技术反馈。打磨过的文档对他们和团队都好。既然已经在看了，留着明显的表面问题不管说不过去",b:"只回复技术方案的问题。没人请你改的时候去改别人的文字，可能让人觉得居高临下，尤其是跨语言背景的同事。人家问的是技术 review，不是写作课"},
    {q:"你在给用户代码库实现搜索功能。你需要修改的那个函数里有一个分页逻辑的 off-by-one 错误——和搜索无关，已经存在好几个月了，会导致最后一页偶尔显示一条重复数据。",a:"在同一个 PR 里顺手修掉分页 bug——你已经读过理解了这段代码，bug 很简单（一行改动），明明看到了影响用户的缺陷却因为「不在范围内」就走开，这就是技术债累积的方式。现在五分钟搞定，以后要重新加载上下文",b:"单独提 issue，单独 PR 修——把不相关的 bug 修复混进功能分支意味着 reviewer 要同时评估两个不相关的改动，git bisect 无法隔离回归，如果功能需要回滚 bug 修复也跟着消失。一个 PR 一个关注点是纪律，不是官僚"},
    {q:"用户自信地提出了一个你认为不太好的方案。",a:"「我觉得有个更好的方向——」直接提替代方案",b:"「这是个好起点，如果我们调整一下这部分...」"},
    {q:"用户问你怎么看同事的代码，质量不好。",a:"直接指出具体问题和改进建议",b:"先肯定优点，再温和地建议改进"},
    {q:"用户的个人项目上周上线了，花了好几个月打造。第一周数据：12 个注册，2 个日活。他们问'你觉得上线情况怎么样？'",a:"对数据直说——一周 12 个注册说明发现渠道或定位可能有问题，值得现在就分析。他们既然问了，把弱数据美化成'还早'只会推迟他们需要的迭代。",b:"先肯定上线本身就是成就——多数个人项目永远停在草稿阶段。把数据定义为实验基线而非盖棺定论——打击积极性比慢启动杀死更多项目。"},
    {q:"用户重新设计了个人网站。新设计很好看但加载速度比旧版明显慢了。他们没提过性能是关注点。",a:"主动提出加载时间的差异——他们可能没注意到，网站慢了就会流失访客，不管他们有没有在关注",b:"只围绕他们问的方面给反馈，性能问题等他们自己提起再说——个人项目的创作过程中插入未被请求的技术批评容易打击积极性"},
    {q:"团队用两周一次的 sprint 已经一年了。速度可预测，但团队抱怨人为的截止压力和频繁砍需求。一个同事提议切换到持续流（看板）——不再有 sprint，只有一个按优先级排列的待办队列加 WIP 限制。产品经理更喜欢 sprint，因为能给利益相关方可预测的交付日期。",a:"切换到看板——团队的不满说明 sprint 在强制人为分批。WIP 限制无需假 deadline 也能保持专注，利益相关方可以通过看板追踪进度而不是等 sprint review",b:"保持 sprint——可预测的节奏是特性不是缺陷。没有强纪律的看板会变成无限 WIP 列表，PM 需要交付日期是合理的。团队感受到的'压力'实际上是防止范围蔓延的有用约束"},
    {q:"用户的编码风格和最佳实践不同，但没有错。",a:"适应用户风格，保持项目一致性",b:"建议更好的实践并解释原因"},
    {q:"组织有 6 个后端服务分布在独立的仓库里。每个团队独立部署、独立 CI、独立管理依赖版本。平台团队提议合并成 monorepo——统一 CI、原子化跨服务变更、统一依赖管理。服务团队反对：他们看重独立发布节奏、更小的 CI 矩阵和清晰的所有权边界。",a:"保持独立仓库——monorepo 的好处伴随耦合代价。独立 repo 意味着独立部署、独立 CI、清晰的团队边界。「原子化跨服务变更」本身就是代码异味——需要协调部署的服务压根不是真正独立的服务。应该修耦合，不是制度化它",b:"合并成 monorepo——polyrepo 的「独立性」是幻觉，因为服务之间共享类型、配置和部署基础设施。每次跨服务改动都需要在 6 个 repo 间协调 PR、版本号和部署顺序。monorepo 让耦合显式化和可管理，而不是藏在 publish 流程背后"},
    {q:"用户的代码库全程用回调。他们正在加一个新模块，想在这一个模块里用 async/await——因为新代码用它写更清晰。其余代码保持回调不变。",a:"上——一个 async 模块不会破坏任何东西，而且这就是他们将来想写所有新代码的方式。渐进式采用比永远不会发生的大爆炸重写好。",b:"保持回调风格的一致性——在一个代码库里混用两种范式，等于开发者要在两种心智模型之间切换。要么完整迁移，要么在准备好之前保持统一。"},
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
const hasStatsSubcommand = args.length > 0 && args[0] === 'stats';
if (hasStatsSubcommand) args.shift();
const hasCompareSubcommand = args.length > 0 && args[0] === 'compare';
if (hasCompareSubcommand) args.shift();
const compareSlugs = hasCompareSubcommand ? [args.shift(), args.shift()].filter(Boolean) : [];
const hasInfoSubcommand = args.length > 0 && args[0] === 'info';
if (hasInfoSubcommand) args.shift();
const infoTarget = hasInfoSubcommand ? (args.shift() || null) : null;
const hasHistorySubcommand = args.length > 0 && args[0] === 'history';
if (hasHistorySubcommand) args.shift();
const historySlug = hasHistorySubcommand ? (args.shift() || null) : null;

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
const maxModels = opt('--max-models') ? parseInt(opt('--max-models'), 10) : null;
const filterPattern = opt('--filter') || null;
const noProxyFlag = flag('--no-proxy');
const resumeFile = opt('--resume') || null;
const saveStateFlag = flag('--save-state') || !!resumeFile;
const interQuestionDelay = parseInt(opt('--delay') || '0', 10);
const skipExisting = flag('--skip-existing');
const includeCustomFlag = flag('--include-custom');

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
    npx abti stats                          Show type distribution & dimension bias
    npx abti stats --json                   Output stats as JSON
    npx abti stats --lang zh                Show stats in Chinese
    npx abti compare <slug1> <slug2>        Compare two agents side-by-side
    npx abti compare gpt-4o claude-opus-4   Compare with agent slugs
    npx abti compare <s1> <s2> --json       Output comparison as JSON
    npx abti compare <s1> <s2> --lang zh    Compare in Chinese
    npx abti info PTCF                      Show type profile
    npx abti info gpt-4o                    Show agent profile
    npx abti info RTDN --lang zh            Show type info in Chinese
    npx abti info gpt-4o --json             Output agent info as JSON
    npx abti history gpt-4o                 Show agent personality drift timeline
    npx abti history gpt-4o --json          Output history as JSON
    npx abti history gpt-4o --lang zh       Show history in Chinese
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
    npx abti test --provider cohere --model command-a-08-2025
    npx abti test --provider ollama --model llama3.1
    npx abti test --provider ollama --all
    npx abti test --provider openrouter --all --api-key sk-or-...
    npx abti test --provider openrouter --all --filter llama --max-models 5
    npx abti test --provider github --all
    npx abti test --provider anthropic --all --api-key sk-ant-...
    npx abti test --provider groq --all --api-key gsk_...
    npx abti test --provider mistral --all --api-key ...
    npx abti test --provider openai --all --api-key sk-...
    npx abti test --provider gemini --all --api-key ...
    npx abti test --provider deepseek --all --api-key ...
    npx abti test --provider xai --all --api-key ...
    npx abti test --provider cohere --all --api-key ...

  Options:
    --lang zh                Language (default: en)
    --json                   Output result as JSON
    --name <name>            Agent name for registry
    --url <url>              Agent URL for registry
    --model <model>          Model name
    --provider <provider>    Provider: openai|anthropic|gemini|deepseek|github|groq|openrouter|mistral|xai|cohere|ollama (default: openai)
    --api-key <key>          API key (or set OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_AI_API_KEY / DEEPSEEK_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY / GITHUB_TOKEN / CO_API_KEY)
    --all                    Test all available models (all providers supported)
    --max-models <N>         Limit number of models to test in --all mode
    --filter <pattern>       Filter models by substring match in --all mode
    --submit                 Submit result to the ABTI registry
    --badge                  Print markdown badge snippet after results
    --runs <N>               Run the test N times (1-10, auto mode only)
    --max-tokens <N>         Override max_tokens for API calls (default: 2048 reasoning, 4 others)
    --no-proxy               Ignore proxy environment variables
    --resume <file>          Resume from a saved state file (implies --save-state)
    --save-state             Auto-save state after each answer (default file: <model>-state.json)
    --delay <ms>             Inter-question delay in ms for rate limit pacing (default: 0)
    --skip-existing          Skip models that already have results in the registry (use with --all --submit)

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
  const maxTok = maxTokens || (isReasoningModel(mdl) ? 2048 : 16);
  const payload = JSON.stringify({ model: mdl, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], max_tokens: maxTok, ...(!isReasoningModel(mdl) && { temperature: 0 }), ...options });
  return llmRequest({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: 'POST', protocol: parsed.protocol, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(payload) } }, payload)
    .then(json => {
      const msg = json.choices[0].message;
      const content = msg.content || msg.reasoning_text || msg.reasoning || '';
      return content.trim();
    });
}

function callAnthropic(apiKey, mdl, systemPrompt, userMessage, baseUrl, maxTokens) {
  const parsed = baseUrl ? new URL(baseUrl.replace(/\/+$/, '') + '/v1/messages') : new URL('https://api.anthropic.com/v1/messages');
  const maxTok = maxTokens || (isReasoningModel(mdl) ? 2048 : 16);
  const payload = JSON.stringify({ model: mdl, max_tokens: maxTok, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] });
  return llmRequest({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: 'POST', protocol: parsed.protocol, headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(payload) } }, payload)
    .then(json => ((json.content.find(b => b.type === 'text') || json.content[0]).text).trim());
}

function callGemini(apiKey, mdl, systemPrompt, userMessage, maxTokens) {
  const payload = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: userMessage }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { maxOutputTokens: maxTokens || 16, temperature: 0 } });
  return llmRequest({ hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/${mdl}:generateContent?key=${apiKey}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, payload)
    .then(json => json.candidates[0].content.parts[0].text.trim());
}

function callLLM(prov, apiKey, mdl, systemPrompt, userMessage, baseUrl, maxTokens) {
  if (prov === 'openai') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl, undefined, maxTokens);
  if (prov === 'anthropic') return callAnthropic(apiKey, mdl, systemPrompt, userMessage, baseUrl, maxTokens);
  if (prov === 'gemini') return callGemini(apiKey, mdl, systemPrompt, userMessage, maxTokens);
  if (prov === 'deepseek') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, 'https://api.deepseek.com', undefined, maxTokens);
  if (prov === 'github') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl || 'https://models.github.ai/inference', undefined, maxTokens, '/chat/completions');
  if (prov === 'groq') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl || 'https://api.groq.com/openai', undefined, maxTokens);
  if (prov === 'openrouter') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl || 'https://openrouter.ai/api/v1', undefined, maxTokens);
  if (prov === 'mistral') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl || 'https://api.mistral.ai/v1', undefined, maxTokens);
  if (prov === 'xai') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl || 'https://api.x.ai/v1', undefined, maxTokens);
  if (prov === 'cohere') return callOpenAI(apiKey, mdl, systemPrompt, userMessage, baseUrl || 'https://api.cohere.com/v2', undefined, maxTokens);
  if (prov === 'ollama') return callOpenAI(apiKey || 'ollama', mdl, systemPrompt, userMessage, 'http://localhost:11434', isReasoningModel(mdl) ? { think: false } : undefined, maxTokens);
  throw new Error(`Unknown provider: ${prov}. Must be "openai", "anthropic", "gemini", "deepseek", "github", "groq", "openrouter", "mistral", "xai", "cohere", or "ollama".`);
}

function isReasoningModel(modelName) {
  if (!modelName) return false;
  const lower = modelName.toLowerCase();
  return /\b(r1|o1|o3|o4|qwq|qwen3|deepseek-r|gemini-3|gpt-5\.\d)\b/.test(lower) || lower.includes('reasoner') || lower.includes('reasoning');
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
  const envMap = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GOOGLE_AI_API_KEY', deepseek: 'DEEPSEEK_API_KEY', groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY', mistral: 'MISTRAL_API_KEY', xai: 'XAI_API_KEY', cohere: 'CO_API_KEY' };
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
  // Safety check: refuse to overwrite a file that has more answers (unless completed)
  if (!state.completed) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(existing.answers) && Array.isArray(state.answers) &&
          existing.answers.length > state.answers.length) {
        process.stderr.write(`  WARNING: refusing to overwrite ${filePath} (has ${existing.answers.length} answers) with fewer answers (${state.answers.length}). Use --resume to continue.\n`);
        return;
      }
    } catch (_) { /* file doesn't exist or invalid — safe to write */ }
  }
  state.questionVersion = QUESTION_VERSION;
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
  } else if (saveStateFlag && stateFile) {
    // Auto-resume: if --save-state is used without --resume, check if the default
    // state file already exists with progress to avoid accidental overwrites
    const loaded = loadState(stateFile);
    if (loaded && Array.isArray(loaded.answers) && loaded.answers.length > 0) {
      existingState = loaded;
      process.stderr.write(`  Auto-resuming from existing state file (${loaded.answers.length} answers)\n`);
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

    // Randomly swap A↔B to reduce LLM position bias
    const swapped = Math.random() < 0.5;
    const showA = swapped ? optB : optA;
    const showB = swapped ? optA : optB;

    const userMessage = [
      `Question ${i + 1}/${questions.length}${dim ? ` (${dim})` : ''}:`,
      '', text, '',
      `A: ${showA}`,
      `B: ${showB}`,
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
    // If options were swapped, flip the result back
    if (swapped) answer = !answer;
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

function fetchOpenRouterModels(apiKey) {
  return new Promise((resolve, reject) => {
    const agent = createProxyAgent('https://openrouter.ai/api/v1/models', noProxyFlag);
    https.get('https://openrouter.ai/api/v1/models', {
      agent,
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`OpenRouter API returned ${res.statusCode}: ${data}`));
        try {
          const json = JSON.parse(data);
          const models = (json.data || [])
            .filter(m => m.context_length > 0)
            .map(m => m.id)
            .sort((a, b) => a.localeCompare(b));
          resolve(models);
        } catch (e) { reject(new Error(`Failed to parse OpenRouter response: ${e.message}`)); }
      });
    }).on('error', err => {
      reject(new Error(`Cannot connect to OpenRouter API: ${err.message}`));
    });
  });
}

function fetchAnthropicModels(apiKey) {
  return new Promise((resolve, reject) => {
    const allModels = [];
    function fetchPage(afterId) {
      const baseUrl = 'https://api.anthropic.com/v1/models?limit=100' + (afterId ? `&after_id=${encodeURIComponent(afterId)}` : '');
      const agent = createProxyAgent(baseUrl, noProxyFlag);
      https.get(baseUrl, {
        agent,
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`Anthropic API returned ${res.statusCode}: ${data}`));
          try {
            const json = JSON.parse(data);
            const models = (json.data || [])
              .filter(m => m.type === 'model')
              .map(m => m.id);
            allModels.push(...models);
            if (json.has_more && json.last_id) {
              fetchPage(json.last_id);
            } else {
              resolve(allModels.sort((a, b) => a.localeCompare(b)));
            }
          } catch (e) { reject(new Error(`Failed to parse Anthropic response: ${e.message}`)); }
        });
      }).on('error', err => {
        reject(new Error(`Cannot connect to Anthropic API: ${err.message}`));
      });
    }
    fetchPage(null);
  });
}

function fetchGitHubModels(apiKey) {
  return new Promise((resolve, reject) => {
    const agent = createProxyAgent('https://models.github.ai/catalog/models', noProxyFlag);
    https.get('https://models.github.ai/catalog/models', {
      agent,
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GitHub Models API returned ${res.statusCode}: ${data}`));
        try {
          const json = JSON.parse(data);
          const models = (Array.isArray(json) ? json : json.data || json.models || [])
            .filter(m => m.supported_output_modalities && m.supported_output_modalities.includes('text'))
            .filter(m => includeCustomFlag || m.rate_limit_tier !== 'custom')
            .map(m => m.id)
            .sort((a, b) => a.localeCompare(b));
          resolve(models);
        } catch (e) { reject(new Error(`Failed to parse GitHub Models response: ${e.message}`)); }
      });
    }).on('error', err => {
      reject(new Error(`Cannot connect to GitHub Models API: ${err.message}`));
    });
  });
}

function fetchOpenAICompatModels(baseUrl, apiKey, providerName) {
  const url = baseUrl.replace(/\/+$/, '') + '/models';
  return new Promise((resolve, reject) => {
    const agent = createProxyAgent(url, noProxyFlag);
    https.get(url, {
      agent,
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${providerName} API returned ${res.statusCode}: ${data}`));
        try {
          const json = JSON.parse(data);
          const models = (json.data || [])
            .map(m => m.id)
            .sort((a, b) => a.localeCompare(b));
          resolve(models);
        } catch (e) { reject(new Error(`Failed to parse ${providerName} response: ${e.message}`)); }
      });
    }).on('error', err => {
      reject(new Error(`Cannot connect to ${providerName} API: ${err.message}`));
    });
  });
}

function fetchGeminiModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=1000`;
  return new Promise((resolve, reject) => {
    const agent = createProxyAgent(url, noProxyFlag);
    https.get(url, { agent }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Gemini API returned ${res.statusCode}: ${data}`));
        try {
          const json = JSON.parse(data);
          const models = (json.models || [])
            .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
            .map(m => m.name.replace(/^models\//, ''))
            .sort((a, b) => a.localeCompare(b));
          resolve(models);
        } catch (e) { reject(new Error(`Failed to parse Gemini response: ${e.message}`)); }
      });
    }).on('error', err => {
      reject(new Error(`Cannot connect to Gemini API: ${err.message}`));
    });
  });
}

function fetchCohereModels(apiKey) {
  const url = 'https://api.cohere.com/v2/models';
  return new Promise((resolve, reject) => {
    const agent = createProxyAgent(url, noProxyFlag);
    https.get(url, {
      agent,
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Cohere API returned ${res.statusCode}: ${data}`));
        try {
          const json = JSON.parse(data);
          const models = (json.models || [])
            .map(m => m.name)
            .sort((a, b) => a.localeCompare(b));
          resolve(models);
        } catch (e) { reject(new Error(`Failed to parse Cohere response: ${e.message}`)); }
      });
    }).on('error', err => {
      reject(new Error(`Cannot connect to Cohere API: ${err.message}`));
    });
  });
}

function displayName(modelName) {
  return modelName.replace(/:latest$/, '');
}

// ── Batch --all mode ────────────────────────────────────────────────────
async function runAll() {
  const openaiCompatProviders = {
    groq: { baseUrl: 'https://api.groq.com/openai/v1', name: 'Groq' },
    mistral: { baseUrl: 'https://api.mistral.ai/v1', name: 'Mistral' },
    openai: { baseUrl: 'https://api.openai.com/v1', name: 'OpenAI' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', name: 'DeepSeek' },
    xai: { baseUrl: 'https://api.x.ai/v1', name: 'xAI' },
  };

  let modelList;

  const apiKey = resolveApiKey(autoProvider, autoApiKey);
  const providerLabel = autoProvider.charAt(0).toUpperCase() + autoProvider.slice(1);
  process.stderr.write(`  Discovering ${providerLabel} models...\n`);

  try {
    if (autoProvider === 'ollama') {
      const data = await fetchOllamaModels();
      modelList = (data.models || []).map(m => m.name);
    } else if (autoProvider === 'anthropic') {
      modelList = await fetchAnthropicModels(apiKey);
    } else if (autoProvider === 'openrouter') {
      modelList = await fetchOpenRouterModels(apiKey);
    } else if (autoProvider === 'github') {
      modelList = await fetchGitHubModels(apiKey);
    } else if (autoProvider === 'gemini') {
      modelList = await fetchGeminiModels(apiKey);
    } else if (autoProvider === 'cohere') {
      modelList = await fetchCohereModels(apiKey);
    } else if (openaiCompatProviders[autoProvider]) {
      const cfg = openaiCompatProviders[autoProvider];
      modelList = await fetchOpenAICompatModels(cfg.baseUrl, apiKey, cfg.name);
    } else {
      console.error(`  --all is not supported for provider "${autoProvider}"`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  if (filterPattern) {
    const pat = filterPattern.toLowerCase();
    modelList = modelList.filter(m => m.toLowerCase().includes(pat));
  }

  if (maxModels && maxModels > 0) {
    modelList = modelList.slice(0, maxModels);
  }

  // Skip models that already have results in the registry
  if (skipExisting) {
    try {
      const resp = await httpGet(`${API_BASE}/api/agents`);
      const agents = resp.agents || resp;
      const { remaining, skipped } = filterExistingModels(modelList, agents);
      modelList = remaining;
      if (skipped.length > 0) {
        process.stderr.write(`  Skipping ${skipped.length} already-tested model(s): ${skipped.map(displayName).join(', ')}\n`);
      }
    } catch (err) {
      process.stderr.write(`  Warning: could not fetch existing agents (${err.message}), proceeding without skip\n`);
    }
  }

  if (modelList.length === 0) {
    console.error('  No models found.');
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
        else if (r.displayName) body.agentName = r.displayName;
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
      const o = { model: r.model, displayName: r.displayName, type: r.type, nick: r.nick, scores: r.scores, questionVersion: QUESTION_VERSION };
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
  const prov = autoProvider || 'ollama';
  const apiKey = resolveApiKey(prov, autoApiKey);
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
      const { answers, parseFailures } = await runSinglePass(prov, modelName, apiKey, systemPrompt, questions);
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

  const { answers, parseFailures } = await runSinglePass(prov, modelName, apiKey, systemPrompt, questions);
  return { answers, _answers: answers, parseFailures };
}

async function runSinglePass(prov, modelName, apiKey, systemPrompt, questions) {
  const answers = [];
  let parseFailures = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const text = q.q || q.text || q.question;
    const optA = q.a || (q.options && (q.options.A || q.options[0])) || 'A';
    const optB = q.b || (q.options && (q.options.B || q.options[1])) || 'B';
    const dim = q.dimension || '';

    // Randomly swap A↔B to reduce LLM position bias
    const swapped = Math.random() < 0.5;
    const showA = swapped ? optB : optA;
    const showB = swapped ? optA : optB;

    const userMessage = [
      `Question ${i + 1}/${questions.length}${dim ? ` (${dim})` : ''}:`,
      '', text, '',
      `A: ${showA}`,
      `B: ${showB}`,
    ].join('\n');

    let answer;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const msg = attempt === 0 ? userMessage : 'Your previous response was not clear. Reply with ONLY the single letter A or B. Nothing else.';
      const response = await callLLM(prov, apiKey, modelName, systemPrompt, msg, llmBaseUrl || undefined, maxTokensOverride);
      try {
        answer = parseAnswer(response);
        break;
      } catch (err) {
        lastErr = err;
        parseFailures++;
      }
    }
    if (answer === undefined) throw lastErr;
    // If options were swapped, flip the result back
    if (swapped) answer = !answer;
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

// ── Stats subcommand ─────────────────────────────────────────────────────
function generateAllTypes() {
  const types = [];
  for (const a of DIM_LETTERS[0]) for (const b of DIM_LETTERS[1]) for (const cc of DIM_LETTERS[2]) for (const d of DIM_LETTERS[3]) types.push(a + b + cc + d);
  return types;
}

async function runStats() {
  let data;
  try {
    data = await httpGet(RESULTS_URL);
  } catch (err) {
    console.error(`  Failed to fetch results: ${err.message}`);
    process.exit(1);
  }
  const agents = data.agents || data;
  const allTypes = generateAllTypes();

  // Type distribution
  const typeCounts = {};
  for (const t of allTypes) typeCounts[t] = 0;
  for (const a of agents) if (a.type && typeCounts[a.type] !== undefined) typeCounts[a.type]++;

  const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = sorted[0][1] || 1;
  const representedTypes = sorted.filter(([, n]) => n > 0);
  const mostCommon = representedTypes.slice(0, 3);
  const leastCommon = representedTypes.length > 0 ? representedTypes.slice(-3).reverse() : [];

  // Dimension bias
  const dimBias = DIM_LETTERS.map((pair, i) => {
    let left = 0, right = 0;
    for (const a of agents) { if (a.type && a.type[i] === pair[0]) left++; else if (a.type && a.type[i] === pair[1]) right++; }
    return { dim: i, left: pair[0], right: pair[1], leftCount: left, rightCount: right };
  });

  if (jsonMode) {
    const output = {
      total: agents.length,
      coverage: { represented: representedTypes.length, total: allTypes.length },
      typeDistribution: Object.fromEntries(sorted),
      mostCommon: mostCommon.map(([t, n]) => ({ type: t, count: n, nick: NICKS[lang][t] })),
      leastCommon: leastCommon.map(([t, n]) => ({ type: t, count: n, nick: NICKS[lang][t] })),
      dimensionBias: dimBias.map(d => ({
        dimension: DIM_NAMES[lang][d.dim][0],
        [DIM_NAMES[lang][d.dim][1]]: d.leftCount,
        [DIM_NAMES[lang][d.dim][2]]: d.rightCount,
      })),
    };
    // Add discriminability if generated data exists
    const discFileJson = require('path').join(__dirname, '..', '..', 'data', 'discriminability.json');
    if (fs.existsSync(discFileJson)) {
      try {
        const discJson = JSON.parse(fs.readFileSync(discFileJson, 'utf-8'));
        const cohorts = discJson.cohorts || {};
        const cohortKey = cohorts['v5-beta'] ? 'v5-beta' : 'all';
        const cohort = cohorts[cohortKey] || { totalRuns: discJson.totalRuns, questions: discJson.questions };
        output.discriminability = {
          cohort: cohortKey,
          totalRuns: cohort.totalRuns,
          threshold: discJson.threshold || 0.6,
          questions: cohort.questions,
        };
      } catch (_) {}
    }
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const t = lang === 'zh'
    ? { title: 'ABTI 统计', dist: '类型分布', most: '最常见类型', least: '最少见类型', cov: '覆盖率', bias: '维度偏好', agents: '个 Agent' }
    : { title: 'ABTI Stats', dist: 'Type Distribution', most: 'Most Common', least: 'Least Common', cov: 'Coverage', bias: 'Dimension Bias', agents: 'agents' };

  console.log(`\n  ── ${t.title} (${agents.length} ${t.agents}) ──\n`);

  // Type distribution with bar chart
  console.log(`  ${c.bold}${t.dist}:${c.reset}\n`);
  const barMax = 30;
  for (const [type, count] of sorted) {
    if (count === 0) continue;
    const nick = NICKS[lang][type] || '';
    const barLen = Math.max(1, Math.round((count / maxCount) * barMax));
    const bar = c.magenta + '█'.repeat(barLen) + c.reset;
    const padType = type + ' '.repeat(Math.max(0, 5 - type.length));
    const padCount = String(count).padStart(3);
    console.log(`    ${c.cyan}${padType}${c.reset} ${bar} ${padCount}  ${c.dim}${nick}${c.reset}`);
  }

  // Most / least common
  console.log(`\n  ${c.bold}${t.most}:${c.reset}  ${mostCommon.map(([tp, n]) => `${c.cyan}${tp}${c.reset} (${n})`).join(', ')}`);
  console.log(`  ${c.bold}${t.least}:${c.reset} ${leastCommon.map(([tp, n]) => `${c.cyan}${tp}${c.reset} (${n})`).join(', ')}`);

  // Coverage
  console.log(`\n  ${c.bold}${t.cov}:${c.reset} ${representedTypes.length}/${allTypes.length} types`);

  // Dimension bias
  console.log(`\n  ${c.bold}${t.bias}:${c.reset}\n`);
  const dimNames = DIM_NAMES[lang];
  for (const d of dimBias) {
    const total = d.leftCount + d.rightCount || 1;
    const leftPct = Math.round((d.leftCount / total) * 100);
    const rightPct = 100 - leftPct;
    const leftBar = Math.round((d.leftCount / total) * 20);
    const rightBar = 20 - leftBar;
    console.log(`    ${dimNames[d.dim][0]}:`);
    console.log(`      ${dimNames[d.dim][1]} (${d.left}): ${c.green}${'█'.repeat(leftBar)}${c.reset} ${d.leftCount} (${leftPct}%)`);
    console.log(`      ${dimNames[d.dim][2]} (${d.right}): ${c.yellow}${'█'.repeat(rightBar)}${c.reset} ${d.rightCount} (${rightPct}%)`);
  }

  // Question Discriminability (from generated discriminability.json)
  const discFile = require('path').join(__dirname, '..', '..', 'data', 'discriminability.json');
  if (fs.existsSync(discFile)) {
    try {
      const discData = JSON.parse(fs.readFileSync(discFile, 'utf-8'));
      const cohorts = discData.cohorts || {};
      // Prefer v5-beta (current question set), fall back to all
      const cohortKey = cohorts['v5-beta'] ? 'v5-beta' : 'all';
      const cohort = cohorts[cohortKey] || { totalRuns: discData.totalRuns, questions: discData.questions };
      const totalRuns = cohort.totalRuns;
      if (totalRuns > 0 && cohort.questions) {
        const discDimNames = lang === 'zh'
          ? ['自主性', '精确度', '沟通风格', '适应性']
          : ['Autonomy', 'Precision', 'Transparency', 'Adaptability'];
        const discTitle = lang === 'zh' ? '题目区分度' : 'Question Discriminability';
        const discThreshold = discData.threshold || 0.6;
        const cohortNote = cohortKey === 'v5-beta'
          ? ` ${c.dim}(${cohortKey}, ${totalRuns} ${lang === 'zh' ? '次' : 'runs'})${c.reset}`
          : ` ${c.dim}(${totalRuns} ${lang === 'zh' ? '次测试' : 'runs'})${c.reset}`;
        console.log(`\n  ${c.bold}${discTitle}:${c.reset}${cohortNote}\n`);
        for (let d = 0; d < 4; d++) {
          console.log(`    ${discDimNames[d]}:`);
          for (let qi = d * 4; qi < d * 4 + 4; qi++) {
            const q = cohort.questions[qi];
            const aPct = q.aPercent;
            const disc = q.discriminability;
            const discStr = disc.toFixed(3);
            const qLabel = `Q${qi + 1}`.padEnd(4);
            const barTotal = 20;
            const aBar = Math.round((aPct / 100) * barTotal);
            const bBar = barTotal - aBar;
            const warnMark = disc < discThreshold ? ` ${c.yellow}⚠${c.reset}` : '';
            const discColor = disc >= discThreshold ? c.green : c.yellow;
            console.log(`      ${qLabel} ${c.cyan}${'█'.repeat(aBar)}${c.reset}${c.dim}${'░'.repeat(bBar)}${c.reset} A:${aPct.toFixed(0).padStart(3)}% B:${q.bPercent.toFixed(0).padStart(3)}%  ${discColor}${discStr}${c.reset}${warnMark}`);
          }
        }
      }
    } catch (_) {}
  }

  console.log();
}

// ── Compare subcommand ───────────────────────────────────────────────────
const AGENT_API_URL = slug => `${API_BASE}/api/agent/${encodeURIComponent(slug)}`;

function formatCompare(a, b, lang, useCol) {
  const cc = useCol ? c : { reset: '', bold: '', dim: '', cyan: '', boldCyan: '', green: '', yellow: '', red: '', magenta: '' };
  const dimNames = DIM_NAMES[lang];
  const lines = [];

  const nickA = (lang === 'zh' ? NICKS.zh[a.agent.type] : NICKS.en[a.agent.type]) || a.agent.nick || '';
  const nickB = (lang === 'zh' ? NICKS.zh[b.agent.type] : NICKS.en[b.agent.type]) || b.agent.nick || '';

  const header = lang === 'zh'
    ? { title: 'ABTI Agent 对比', dim: '维度', pole: '倾向', score: '分数', match: '匹配', compat: '兼容性' }
    : { title: 'ABTI Agent Comparison', dim: 'Dimension', pole: 'Pole', score: 'Score', match: 'Match', compat: 'Compatibility' };

  lines.push('');
  lines.push(`  ── ${header.title} ──`);
  lines.push('');
  lines.push(`  ${cc.bold}${a.agent.name}${cc.reset}  ${cc.cyan}${a.agent.type}${cc.reset}  ${cc.dim}${nickA}${cc.reset}`);
  lines.push(`  ${cc.bold}${b.agent.name}${cc.reset}  ${cc.cyan}${b.agent.type}${cc.reset}  ${cc.dim}${nickB}${cc.reset}`);
  lines.push('');

  // Dimension breakdown
  const colW = Math.max(a.agent.name.length, b.agent.name.length, 10);
  const dimW = Math.max(header.dim.length, ...dimNames.map(d => d[0].length));
  lines.push(`  ${cc.bold}${pad(header.dim, dimW)}  ${pad(a.agent.name, colW)}  ${pad(b.agent.name, colW)}  ${header.match}${cc.reset}`);
  lines.push(`  ${'─'.repeat(dimW + colW * 2 + 10)}`);

  let matchCount = 0;
  for (let i = 0; i < 4; i++) {
    const poleA = a.agent.type[i];
    const poleB = b.agent.type[i];
    const scoreA = a.agent.scores[i];
    const scoreB = b.agent.scores[i];
    const poleNameA = poleA === DIM_LETTERS[i][0] ? dimNames[i][1] : dimNames[i][2];
    const poleNameB = poleB === DIM_LETTERS[i][0] ? dimNames[i][1] : dimNames[i][2];
    const same = poleA === poleB;
    if (same) matchCount++;
    const matchSym = same ? `${cc.green}✓${cc.reset}` : `${cc.yellow}✗${cc.reset}`;
    lines.push(`  ${pad(dimNames[i][0], dimW)}  ${pad(`${poleNameA} (${poleA}) ${scoreA}`, colW)}  ${pad(`${poleNameB} (${poleB}) ${scoreB}`, colW)}  ${matchSym}`);
  }

  lines.push('');
  lines.push(`  ${cc.bold}${header.match}:${cc.reset} ${matchCount}/4 ${lang === 'zh' ? '维度相同' : 'dimensions match'}`);

  // Compatibility check
  const bestA = a.profile.bestPairedWith || [];
  const bestB = b.profile.bestPairedWith || [];
  const aRecommendsB = bestA.find(p => p.type === b.agent.type);
  const bRecommendsA = bestB.find(p => p.type === a.agent.type);

  if (aRecommendsB || bRecommendsA) {
    lines.push('');
    lines.push(`  ${cc.bold}${header.compat}:${cc.reset}`);
    if (aRecommendsB) lines.push(`    ${cc.green}★${cc.reset} ${a.agent.name} → ${b.agent.name}: ${aRecommendsB.reason}`);
    if (bRecommendsA) lines.push(`    ${cc.green}★${cc.reset} ${b.agent.name} → ${a.agent.name}: ${bRecommendsA.reason}`);
  }

  lines.push('');
  return lines.join('\n');

  function pad(s, n) { return s + ' '.repeat(Math.max(0, n - s.length)); }
}

// ── Info subcommand ─────────────────────────────────────────────────────────
function isTypeCode(s) {
  return /^[PR][TE][CD][FN]$/i.test(s);
}

function formatTypeInfo(typeData, typeCode, lang, useCol) {
  const cc = useCol ? c : { reset: '', bold: '', dim: '', cyan: '', boldCyan: '', green: '', yellow: '', red: '', magenta: '' };
  const dimNames = DIM_NAMES[lang];
  const lines = [];
  const nick = (lang === 'zh' ? NICKS.zh[typeCode] : NICKS.en[typeCode]) || '';
  const desc = (lang === 'zh' ? DESCS.zh[typeCode] : DESCS.en[typeCode]) || '';

  lines.push('');
  lines.push(`  ── ${lang === 'zh' ? 'ABTI 类型详情' : 'ABTI Type Profile'} ──`);
  lines.push('');
  lines.push(`  ${cc.bold}${typeCode}${cc.reset}  ${cc.magenta}${nick}${cc.reset}`);
  lines.push(`  ${cc.dim}${desc}${cc.reset}`);
  lines.push('');

  // Dimension breakdown
  const dimLabel = lang === 'zh' ? '维度' : 'Dimensions';
  lines.push(`  ${cc.bold}${dimLabel}:${cc.reset}`);
  for (let i = 0; i < 4; i++) {
    const pole = typeCode[i];
    const poleName = pole === DIM_LETTERS[i][0] ? dimNames[i][1] : dimNames[i][2];
    lines.push(`    ${dimNames[i][0]}: ${cc.cyan}${poleName}${cc.reset} (${pole})`);
  }

  if (typeData) {
    if (typeData.strengths && typeData.strengths.length) {
      lines.push('');
      lines.push(`  ${cc.bold}${lang === 'zh' ? '优势' : 'Strengths'}:${cc.reset}`);
      for (const s of typeData.strengths) lines.push(`    ${cc.green}✓${cc.reset} ${s}`);
    }
    if (typeData.weaknesses && typeData.weaknesses.length) {
      lines.push('');
      lines.push(`  ${cc.bold}${lang === 'zh' ? '弱点' : 'Weaknesses'}:${cc.reset}`);
      for (const w of typeData.weaknesses) lines.push(`    ${cc.yellow}✗${cc.reset} ${w}`);
    }
    if (typeData.tuningTips && typeData.tuningTips.length) {
      lines.push('');
      lines.push(`  ${cc.bold}${lang === 'zh' ? '调优建议' : 'Tuning Tips'}:${cc.reset}`);
      for (const t of typeData.tuningTips) lines.push(`    • ${t}`);
    }
    if (typeData.bestPairedWith && typeData.bestPairedWith.length) {
      lines.push('');
      lines.push(`  ${cc.bold}${lang === 'zh' ? '最佳搭配' : 'Best Paired With'}:${cc.reset}`);
      for (const p of typeData.bestPairedWith) {
        const pNick = (lang === 'zh' ? NICKS.zh[p.type] : NICKS.en[p.type]) || '';
        lines.push(`    ${cc.cyan}${p.type}${cc.reset} ${pNick}${p.reason ? ` — ${p.reason}` : ''}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

function formatAgentInfo(data, lang, useCol) {
  const cc = useCol ? c : { reset: '', bold: '', dim: '', cyan: '', boldCyan: '', green: '', yellow: '', red: '', magenta: '' };
  const dimNames = DIM_NAMES[lang];
  const agent = data.agent;
  const profile = data.profile || {};
  const lines = [];
  const nick = (lang === 'zh' ? NICKS.zh[agent.type] : NICKS.en[agent.type]) || agent.nick || '';

  lines.push('');
  lines.push(`  ── ${lang === 'zh' ? 'ABTI Agent 详情' : 'ABTI Agent Profile'} ──`);
  lines.push('');
  lines.push(`  ${cc.bold}${agent.name}${cc.reset}  ${cc.cyan}${agent.type}${cc.reset}  ${cc.dim}${nick}${cc.reset}`);
  if (agent.provider) lines.push(`  ${cc.dim}${agent.provider}${agent.model ? ' / ' + agent.model : ''}${cc.reset}`);
  lines.push('');

  // Dimension breakdown
  const dimLabel = lang === 'zh' ? '维度' : 'Dimensions';
  lines.push(`  ${cc.bold}${dimLabel}:${cc.reset}`);
  for (let i = 0; i < 4; i++) {
    const pole = agent.type[i];
    const scoreVal = agent.scores ? agent.scores[i] : null;
    const poleName = pole === DIM_LETTERS[i][0] ? dimNames[i][1] : dimNames[i][2];
    const scoreStr = scoreVal !== null ? ` ${scoreVal}/4` : '';
    lines.push(`    ${dimNames[i][0]}: ${cc.cyan}${poleName}${cc.reset} (${pole})${scoreStr}`);
  }

  if (profile.strengths && profile.strengths.length) {
    lines.push('');
    lines.push(`  ${cc.bold}${lang === 'zh' ? '优势' : 'Strengths'}:${cc.reset}`);
    for (const s of profile.strengths) lines.push(`    ${cc.green}✓${cc.reset} ${s}`);
  }
  if (profile.weaknesses && profile.weaknesses.length) {
    lines.push('');
    lines.push(`  ${cc.bold}${lang === 'zh' ? '弱点' : 'Weaknesses'}:${cc.reset}`);
    for (const w of profile.weaknesses) lines.push(`    ${cc.yellow}✗${cc.reset} ${w}`);
  }
  if (profile.tuningTips && profile.tuningTips.length) {
    lines.push('');
    lines.push(`  ${cc.bold}${lang === 'zh' ? '调优建议' : 'Tuning Tips'}:${cc.reset}`);
    for (const t of profile.tuningTips) lines.push(`    • ${t}`);
  }
  if (profile.bestPairedWith && profile.bestPairedWith.length) {
    lines.push('');
    lines.push(`  ${cc.bold}${lang === 'zh' ? '最佳搭配' : 'Best Paired With'}:${cc.reset}`);
    for (const p of profile.bestPairedWith) {
      const pNick = (lang === 'zh' ? NICKS.zh[p.type] : NICKS.en[p.type]) || '';
      lines.push(`    ${cc.cyan}${p.type}${cc.reset} ${pNick}${p.reason ? ` — ${p.reason}` : ''}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

async function runInfo() {
  if (!infoTarget) {
    console.error('  Usage: abti info <type-or-slug>');
    process.exit(1);
  }

  if (isTypeCode(infoTarget)) {
    const code = infoTarget.toUpperCase();
    let typesData;
    try {
      typesData = await httpGet(`${API_BASE}/api/types?lang=${lang}`);
    } catch (err) {
      console.error(`  Failed to fetch type data: ${err.message}`);
      process.exit(1);
    }
    const typeInfo = typesData.types ? typesData.types[code] : null;

    if (jsonMode) {
      const nick = (lang === 'zh' ? NICKS.zh[code] : NICKS.en[code]) || '';
      const desc = (lang === 'zh' ? DESCS.zh[code] : DESCS.en[code]) || '';
      const output = { type: code, nick, description: desc, ...(typeInfo || {}) };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log(formatTypeInfo(typeInfo, code, lang, useColor));
  } else {
    let data;
    try {
      data = await httpGet(AGENT_API_URL(infoTarget) + `?lang=${lang}`);
    } catch (err) {
      console.error(`  Failed to fetch agent data: ${err.message}`);
      process.exit(1);
    }

    if (jsonMode) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log(formatAgentInfo(data, lang, useColor));
  }
}

function formatHistoryTable(data, lang, useCol) {
  const cc = useCol ? c : { reset: '', bold: '', dim: '', cyan: '', boldCyan: '', green: '', yellow: '', red: '', magenta: '' };
  const dimNames = DIM_NAMES[lang];
  const agent = data.agent;
  const history = agent.history || [];
  const nick = (lang === 'zh' ? NICKS.zh[agent.type] : NICKS.en[agent.type]) || agent.nick || '';
  const lines = [];

  lines.push('');
  lines.push(`  ── ${lang === 'zh' ? 'ABTI 人格变迁时间线' : 'ABTI Personality Drift Timeline'} ──`);
  lines.push('');
  lines.push(`  ${cc.bold}${agent.name}${cc.reset}  ${lang === 'zh' ? '当前类型' : 'Current'}: ${cc.cyan}${agent.type}${cc.reset}  ${cc.dim}${nick}${cc.reset}`);
  lines.push('');

  // Header
  const dateH = lang === 'zh' ? '日期' : 'Date';
  const typeH = lang === 'zh' ? '类型' : 'Type';
  const nickH = lang === 'zh' ? '昵称' : 'Nickname';
  const dimH = dimNames.map(d => d[0]);
  const header = `  ${dateH.padEnd(12)} ${typeH.padEnd(6)} ${nickH.padEnd(20)} ${dimH.map(d => d.padEnd(6)).join(' ')}`;
  lines.push(`  ${cc.bold}${header.trim()}${cc.reset}`);
  lines.push(`  ${'─'.repeat(header.trim().length)}`);

  for (const h of history) {
    const date = h.testedAt ? h.testedAt.slice(0, 10) : '—';
    const hNick = (lang === 'zh' ? NICKS.zh[h.type] : NICKS.en[h.type]) || '';
    const scores = h.scores ? h.scores.map(s => String(s).padEnd(6)).join(' ') : '';
    lines.push(`  ${date.padEnd(12)} ${cc.cyan}${h.type}${cc.reset}${''.padEnd(6 - h.type.length)} ${cc.dim}${hNick}${cc.reset}${''.padEnd(Math.max(0, 20 - hNick.length))} ${scores}`);
  }

  // Current as last row
  const curDate = agent.testedAt ? agent.testedAt.slice(0, 10) : '—';
  const curScores = agent.scores ? agent.scores.map(s => String(s).padEnd(6)).join(' ') : '';
  lines.push(`  ${curDate.padEnd(12)} ${cc.bold}${cc.cyan}${agent.type}${cc.reset}${''.padEnd(6 - agent.type.length)} ${cc.bold}${nick}${cc.reset}${''.padEnd(Math.max(0, 20 - nick.length))} ${curScores}  ${cc.green}← ${lang === 'zh' ? '当前' : 'current'}${cc.reset}`);

  // Drift summary
  const allTypes = [...history.map(h => h.type), agent.type];
  let changes = 0;
  for (let i = 1; i < allTypes.length; i++) {
    if (allTypes[i] !== allTypes[i - 1]) changes++;
  }
  lines.push('');
  if (lang === 'zh') {
    lines.push(`  ${cc.bold}变迁摘要:${cc.reset} ${allTypes.length} 次测试, ${changes} 次类型变化`);
  } else {
    lines.push(`  ${cc.bold}Drift summary:${cc.reset} ${allTypes.length} test(s), ${changes} type change(s)`);
  }
  lines.push('');

  return lines.join('\n');
}

async function runHistory() {
  if (!historySlug) {
    console.error('  Usage: abti history <slug>');
    process.exit(1);
  }

  let data;
  try {
    data = await httpGet(AGENT_API_URL(historySlug) + `?lang=${lang}`);
  } catch (err) {
    console.error(`  Failed to fetch agent data: ${err.message}`);
    process.exit(1);
  }

  if (jsonMode) {
    const agent = data.agent;
    const history = agent.history || [];
    const allTypes = [...history.map(h => h.type), agent.type];
    let changes = 0;
    for (let i = 1; i < allTypes.length; i++) {
      if (allTypes[i] !== allTypes[i - 1]) changes++;
    }
    const output = {
      agent: { name: agent.name, slug: agent.slug, type: agent.type, nick: (NICKS[lang][agent.type] || agent.nick || ''), scores: agent.scores, testedAt: agent.testedAt },
      history: history.map(h => ({ date: h.testedAt, type: h.type, nick: (NICKS[lang][h.type] || ''), scores: h.scores })),
      drift: { totalTests: allTypes.length, typeChanges: changes },
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(formatHistoryTable(data, lang, useColor));
}

async function runCompare() {
  if (compareSlugs.length < 2) {
    console.error('  Usage: abti compare <slug1> <slug2>');
    process.exit(1);
  }

  let a, b;
  try {
    [a, b] = await Promise.all([
      httpGet(AGENT_API_URL(compareSlugs[0]) + `?lang=${lang}`),
      httpGet(AGENT_API_URL(compareSlugs[1]) + `?lang=${lang}`),
    ]);
  } catch (err) {
    console.error(`  Failed to fetch agent data: ${err.message}`);
    process.exit(1);
  }

  if (jsonMode) {
    const matchCount = [0,1,2,3].filter(i => a.agent.type[i] === b.agent.type[i]).length;
    const bestA = a.profile.bestPairedWith || [];
    const bestB = b.profile.bestPairedWith || [];
    const output = {
      agents: [
        { slug: compareSlugs[0], name: a.agent.name, type: a.agent.type, nick: (NICKS[lang][a.agent.type] || a.agent.nick || ''), scores: a.agent.scores },
        { slug: compareSlugs[1], name: b.agent.name, type: b.agent.type, nick: (NICKS[lang][b.agent.type] || b.agent.nick || ''), scores: b.agent.scores },
      ],
      dimensions: DIM_NAMES[lang].map((dim, i) => ({
        name: dim[0],
        agent1: { pole: a.agent.type[i], poleName: a.agent.type[i] === DIM_LETTERS[i][0] ? dim[1] : dim[2], score: a.agent.scores[i] },
        agent2: { pole: b.agent.type[i], poleName: b.agent.type[i] === DIM_LETTERS[i][0] ? dim[1] : dim[2], score: b.agent.scores[i] },
        match: a.agent.type[i] === b.agent.type[i],
      })),
      matchCount,
      compatibility: {
        aRecommendsB: bestA.find(p => p.type === b.agent.type) || null,
        bRecommendsA: bestB.find(p => p.type === a.agent.type) || null,
      },
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(formatCompare(a, b, lang, useColor));
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
    const output = { type: code, nick, desc, scores, badge: `${API_BASE}/badge/${code}`, questionVersion: QUESTION_VERSION };
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
  } else if (hasStatsSubcommand) {
    runStats().catch(err => { console.error(err.message); process.exit(1); });
  } else if (hasCompareSubcommand) {
    runCompare().catch(err => { console.error(err.message); process.exit(1); });
  } else if (hasInfoSubcommand) {
    runInfo().catch(err => { console.error(err.message); process.exit(1); });
  } else if (hasHistorySubcommand) {
    runHistory().catch(err => { console.error(err.message); process.exit(1); });
  } else {
    run().catch(err => { console.error(err.message); process.exit(1); });
  }
}

function normalizeModelName(name) {
  const s = (name || '').toLowerCase();
  const idx = s.indexOf('/');
  return idx >= 0 ? s.slice(idx + 1) : s;
}

function filterExistingModels(modelList, agents) {
  const testedModels = new Set((agents || []).map(a => normalizeModelName(a.model)));
  const skipped = modelList.filter(m => testedModels.has(normalizeModelName(m)));
  const remaining = modelList.filter(m => !testedModels.has(normalizeModelName(m)));
  return { remaining, skipped };
}

module.exports = { parseAnswer, score, callLLM, loadState, saveState, defaultStateFile, formatListTable, formatCompare, formatTypeInfo, formatAgentInfo, formatHistoryTable, isTypeCode, runStats, RateLimitBailError, fetchOllamaModels, fetchOpenRouterModels, fetchGitHubModels, fetchAnthropicModels, fetchOpenAICompatModels, fetchGeminiModels, fetchCohereModels, displayName, filterExistingModels, normalizeModelName };
