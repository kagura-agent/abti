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
    {q:"You're migrating a monolithic test suite to parallel execution. Total test time dropped from 45 minutes to 8 minutes. However, 12 of 400 tests fail intermittently under parallelization — they share a test database and occasionally collide on data setup/teardown. You could isolate each test with its own database transaction (adds overhead, total suite time goes from 8 to 11 minutes, but 100% deterministic), or keep the shared database with automatic retry logic (tests that fail are re-run up to 3 times — current first-try pass rate is 99.7%, 100% with retries, suite time stays at 8 minutes).",a:"Isolate with per-test transactions — 99.7% first-try pass rate means 1 in 300 runs produces a false failure. At 50 CI runs per day, that's a false red build roughly every 6 days, each costing a developer 5-10 minutes to investigate before realizing \"oh, flaky test, re-run.\" The 3-minute slowdown is invisible to workflow; the trust erosion from intermittent failures is cumulative. Deterministic tests are the foundation CI confidence is built on — retries paper over a real problem.",b:"Keep shared database with retries — the test suite went from 45 minutes to 8, and adding 37% more time back for 12 tests out of 400 is regressing the win you just delivered. The retry approach has 100% eventual pass rate and keeps the speed. Developers' workflow is built around \"tests take 8 minutes\" — changing that to 11 undermines adoption of the parallelization you just shipped. Flaky tests that auto-retry are operationally invisible; determinism that costs 3 minutes on every single run is a permanent tax paid 50 times a day."},
    {q:"You're adding a new endpoint to a Node.js API service. The module you're working in has 400 lines of callback-based async code written 3 years ago — it works, has 95% test coverage, and handles complex edge cases (retry logic, partial failures, timeout cascading). Your new endpoint uses async/await. Having both async patterns in one module creates inconsistency. Rewriting the old code to async/await would take 4 hours, and the existing test suite should catch regressions.",a:"Rewrite to async/await — two competing async patterns in one module is a readability tax on every future contributor. The 95% test coverage exists precisely for safe refactoring like this. Clean it up while you have the context; nobody will volunteer to refactor working code later, and the inconsistency will only grow as new endpoints get added.",b:"Add your endpoint in async/await, leave the legacy code alone — 'works, tested, handles edge cases' is the definition of code you don't touch. Test coverage catches functional regressions, not behavioral subtleties like timing dependencies, error ordering, and backpressure handling. A module that's been stable for 3 years has earned the right to be ugly. Your task was one endpoint, not a rewrite."},
    {q:"You're helping a user organize their codebase. They ask you to 'clean up the imports in main.js.' While reorganizing the imports, you notice 4 of the 12 imported modules are completely unused — they're imported but never referenced anywhere in the file. The project uses ES modules with no side-effect imports. Removing them is a one-line-per-module deletion.",a:"Remove the unused imports — 'clean up the imports' clearly encompasses removing dead code. In an ES module project with no side-effect imports, an unreferenced import is dead code by definition. Leaving known dead imports while claiming to have 'cleaned up' the file is delivering incomplete work. The user shouldn't need to separately ask you to remove obvious waste.",b:"Only reorganize the imports (sort and group), then mention the 4 unused ones — 'clean up' could mean anything from reformatting to restructuring, and the user chose a narrow phrasing. Even in ES modules, what looks 'unused' from one file's perspective might be needed for type declarations, test mocking setup, or module initialization that affects other files. Removing code is a higher-risk operation than reorganizing it. Flag what you found, let them make the deletion call — cleaning up is your job, deleting is their decision."},
    {q:"You're the on-call engineer and get paged at 3 AM for a failing health check on an internal dashboard service (used during business hours only, not customer-facing). You SSH in and find the service crashed from an out-of-memory error — it has an in-memory cache with no eviction policy that grows until it exhausts the heap. You restart the service (10 seconds, no data loss) and the health check goes green. Adding a TTL-based eviction (maxAge: 1 hour) is a 3-line change in the cache initialization code, right in the file you're already looking at.",a:"Add the cache TTL — you're already looking at the exact code that caused the crash, and a 3-line config addition to set cache eviction is the most minimal root-cause fix possible. Restarting without addressing the unbounded growth means this page will fire again — maybe next week, maybe tomorrow at 3 AM again. On-call means resolving incidents, not snoozing them. A PR with \"paged for OOM, found no eviction policy, added 1-hour TTL\" is the clearest commit message you'll ever write.",b:"Restart only, file a detailed ticket — on-call scope is \"restore service,\" and you've done that. The cache was designed by engineers who chose no eviction; maybe it's a known trade-off, maybe certain entries need to persist for request-chain correctness, maybe there's a planned migration to Redis. A 3 AM code change bypasses review, isn't tested, and creates a \"who changed this?\" mystery for the owning team. Document what you found — the OOM, the cache config location, the growth pattern — so the fix happens properly during business hours with full context."},
    {q:"The CEO is in an all-hands meeting and asks your team lead: \"When will the new dashboard be ready?\" Your lead turns to you. You've scoped it internally at 3-5 weeks depending on the analytics integration, which you haven't investigated yet. The CEO is visibly impatient and the entire company is watching.",a:"\"3 to 5 weeks — the range depends on the analytics integration complexity, which I'll have clarity on by Friday. I'll send a tighter estimate then\" — precision protects everyone. A single number becomes a commitment, and the difference between 3 and 5 weeks is significant for planning. Being specific about uncertainty is more professional than being falsely confident.",b:"\"About a month\" — the CEO asked for a planning number, not a confidence interval. \"3-5 weeks depending on X\" in front of the whole company sounds like hedging and invites follow-up questions you can't answer yet. Round up, deliver early. The detailed estimate goes in the project plan, not the town hall."},
    {q:"A product manager shares a feature specification for adding real-time collaborative editing to your document editor and asks for a technical feasibility review before sprint planning tomorrow morning. Reading through it, you notice three issues: (1) the spec assumes WebSocket connections persist indefinitely, but your load balancer kills idle connections after 60 seconds — a solvable but non-trivial infrastructure change; (2) the conflict resolution approach described (last-write-wins per paragraph) will silently drop edits when two users type in the same paragraph simultaneously; and (3) the 'MVP' scope lists 6 features, but only 2 (presence cursors and basic co-editing) are needed for the collaborative editing to function — the other 4 (comments, suggestions, version history, permissions) are independent features bundled in.",a:"Write a structured review covering all three: the WebSocket keepalive fix with estimated effort, a recommendation to use CRDTs instead of last-write-wins with a link to the Yjs library your team already uses for another feature, and a prioritized feature breakdown showing which 2 are core MVP and which 4 can be follow-up sprints. The PM is about to walk into planning with a spec the team will commit to for the next 6 weeks. Incomplete feedback means the team discovers the WebSocket issue mid-sprint and the scope stays bloated because nobody surfaced the breakdown. Ten minutes of thorough review now saves weeks of course-correction later.",b:"Flag the conflict resolution issue — it's the only design flaw that would ship a broken feature. 'The last-write-wins approach will drop concurrent edits — consider CRDTs, we already use Yjs for [feature X].' The WebSocket timeout is an ops configuration, not a spec problem — engineering handles that during implementation without PM involvement. Scope negotiation is a sprint planning conversation, not a review comment — the PM knows 6 features won't fit in one sprint, and telling them which ones to cut before the team discusses it oversteps your review scope. A focused review gets acted on; a dissertation gets skimmed."},
    {q:"You're reviewing a colleague's technical design document before it goes to the team. The technical approach is sound, but the writing has several grammar mistakes, inconsistent formatting, and a few unclear sentences. They asked you to 'check if the technical approach makes sense.'",a:"Fix everything — grammar, formatting, clarity, plus technical feedback. A polished doc reflects better on them and the team. When you're already in the document, leaving surface-level issues visible feels negligent",b:"Only address the technical approach as asked. Unsolicited copy-editing of someone's writing can feel condescending, especially across language backgrounds. They asked for technical review, not a writing class"},
    {q:"You chose Axios over got for your team's new API gateway project after evaluating both. Three teammates ask in a Slack thread: 'Why Axios?' You ran benchmarks, read both codebases, and compared their retry/interceptor APIs during evaluation.",a:"Post a structured comparison — your benchmark numbers (requests/sec, p99 latency, memory), API ergonomics analysis (Axios interceptors vs got hooks for your retry-with-backoff pattern), bundle size comparison, and the community health data you checked (GitHub issues response time, release cadence, bus factor). Someone arriving at this Slack thread in 6 months should understand the full decision context without asking you to repeat yourself. Technical decisions without documented reasoning become folklore — 'we use Axios because we've always used Axios.' The 10 minutes you spend writing it saves hours of future 'why didn't we use got?' conversations.",b:"'Axios — faster for our use case, interceptor API maps cleaner to our retry pattern, and it's 40% of got's bundle size. Happy to share benchmarks if anyone wants the details.' Three people asked a quick question in Slack; they want a quick answer, not a research paper in a chat thread. If someone needs the full comparison later, they'll ask. Long-form technical decisions belong in an ADR or wiki, not in Slack where they'll be buried under 200 messages by next week. Writing a dissertation in a chat thread trains people to stop asking questions because the answers take 10 minutes to read."},
    {q:"Your team shipped a critical feature on deadline, but the last two weeks were rough: three production hotfixes, two all-nighters, and two code reviews were skipped to hit the launch date. The feature is stable now, users are happy, and leadership praised the team's execution. You're writing the post-project summary for the engineering wiki — the document future teams will reference when working on this part of the codebase.",a:"Document the full picture: the timeline pressure that led to skipped code reviews, the hotfix root causes, and which modules were written under pressure with less scrutiny. Future engineers inheriting this code need the real context — which parts had shortcuts and where to be careful. A project summary that reads like a press release ('team demonstrated agility') instead of an engineering record fails the people who'll maintain this code for years. The process failures aren't gossip — they're engineering context that affects how much you trust each module's quality. The two reviews that were skipped? Those are exactly the files that need extra scrutiny in the next refactoring cycle.",b:"Document the architecture, technical decisions, known tech debt with cleanup tickets, and lessons learned for future projects. The process narrative — skipped reviews, all-nighters — is team retrospective material, not wiki content. Writing 'two code reviews were skipped under deadline pressure' in a document accessible to the entire engineering org permanently labels this team as corner-cutters, when they made pragmatic trade-offs under unusual circumstances. The tech debt tickets and architecture docs capture what future engineers actually need to work on this code; the crunch story is context that loses relevance as the code gets refactored and stabilizes. Conflating project management drama with technical documentation makes both less useful."},
    {q:"The user asks what you think of a colleague's code. The quality is poor.",a:"Point out specific issues and suggest improvements — no personal judgment, just facts",b:"Acknowledge what's done well first, then gently suggest areas for improvement"},
    {q:"Your team's sprint retrospective is happening after a feature shipped 2 weeks late. You know the primary cause: the tech lead underestimated the integration complexity and set the timeline despite your team raising concerns about dependencies in week 1. The concerns were acknowledged but the timeline wasn't adjusted. The retro has 9 attendees including the tech lead. The format is open discussion with action items documented in Confluence.",a:"Name the root cause directly — 'Our week-1 flag about integration complexity was acknowledged but the timeline wasn't adjusted. We need a process where engineering risk assessments get a documented accept-or-mitigate response, not just acknowledgment.' The retro exists for this kind of direct assessment. Framing a judgment-call failure as a process gap misdiagnoses the problem: the team already surfaced the risk — the decision to override it is what failed. If retros can't address decision quality because it might make someone uncomfortable, they devolve into process theater. A 'feasibility checkpoint' won't help if it gets overridden the same way the original flag was. The tech lead needs to hear — in the meeting designed for exactly this — that overriding engineering estimates without documented justification led to the delay, and future flags need to result in timeline adjustments or explicit risk acceptance.",b:"Propose a structural fix — 'What if we add a mandatory risk review gate at the end of week 1? Engineering flags get scored by impact and likelihood, and anything above a threshold triggers a required timeline reassessment with stakeholder sign-off.' You solve the actual problem — risk flags being acknowledged without action — without turning the retro into a blame session. Public attribution of the failure to one person's judgment doesn't produce better estimates; it produces a retro where people stop speaking freely. The tech lead already knows what happened — they don't need 8 witnesses to a mistake they're already aware of. A process that requires documented responses to risk flags achieves accountability structurally rather than personally, scales across the org, and survives personnel changes. Next sprint's timeline will be better because the process enforces it, not because someone got called out."},
    {q:"You're helping a junior developer understand JavaScript's event loop. You explained that JavaScript is single-threaded: code runs line by line, callbacks go to a queue, and the event loop processes them when the main thread is free. They say 'Oh, so that's why my setTimeout(fn, 0) doesn't run immediately — it has to wait for the current code to finish!' This is exactly correct. You know that the full picture is more complex — there are actually two queues (microtask and macrotask), and Promises use the microtask queue which runs before the next macrotask. The team is adopting async/await next sprint, so this developer will be writing Promise-based code soon.",a:"Exactly right — and while the event loop is fresh in your mind: there are actually two queues. Promises use a 'microtask' queue that runs before setTimeout callbacks. Since your team's moving to async/await, you'll hit this distinction soon. Better to know the full picture now than debug a confusing ordering issue later.",b:"Exactly right, you've nailed the core model. When you start working with async/await, you'll notice some ordering differences between Promises and setTimeout — that's the event loop's next layer, and it'll click naturally once you see it in real code. This foundation is exactly what you need to build on."},
    {q:"Your team has worked in 2-week sprints for a year. Velocity is predictable but the team complains about artificial deadline pressure and frequent scope cuts. A colleague proposes switching to continuous flow (Kanban) — no sprints, just a priority queue with WIP limits. The product manager prefers sprints because they give stakeholders predictable delivery dates.",a:"Switch to Kanban — the team's frustration signals that sprints force artificial batching. WIP limits enforce focus without fake deadlines, and stakeholders can track progress through the board rather than waiting for sprint reviews",b:"Keep sprints — predictable cadence is a feature, not a bug. Kanban without strong discipline becomes an infinite WIP list, and the PM's need for delivery dates is legitimate. The team's 'pressure' is actually a useful constraint that prevents scope creep"},
    {q:"Your team's 30K-line TypeScript project has strict: false in tsconfig.json. The code works, ships weekly, has 90% test coverage. A new tech lead proposes enabling strict: true — the compiler immediately flags 217 type errors (implicit any, unchecked nulls, missing return types). None are known bugs; the code runs fine. Fixing them would take an estimated 2-3 weeks of dedicated work across the team, during which feature delivery pauses.",a:"Keep strict: false for existing code, enable strict checks for new files only via a tsconfig.strict.json that new modules extend — the 217 'errors' aren't bugs, they're the compiler being pedantic about working code. A 2-3 week feature freeze to satisfy a linter is hard to justify when the backlog is full and stakeholders are waiting. Gradual adoption means every new file gets strict guarantees while proven code stays untouched. The team that wrote this code shipped it with 90% coverage and weekly releases — retrofitting strictness onto code that's already been validated by tests and production is ceremony, not engineering.",b:"Enable strict: true and fix all 217 errors now — those aren't false positives, each one is a place where the compiler can't verify correctness, meaning you're relying on convention and luck instead of tooling. Two tsconfig files with different strictness levels create a two-tier codebase where 'it depends which directory you're in' becomes tribal knowledge. 2-3 weeks now prevents years of accumulating type debt; the 217 will only grow as the codebase does. Test coverage catches behavioral bugs, not type-level contract violations — strict mode and tests protect against different failure classes."},
    {q:"Your organization has 6 backend services in separate repositories. Each team deploys independently, runs its own CI, and owns its dependency versions. The platform team proposes consolidating into a monorepo — shared CI pipeline, atomic cross-service changes, unified dependency management. The service teams push back: they value independent release cycles, smaller CI runs, and clear ownership boundaries.",a:"Keep separate repos — monorepo benefits come with coupling costs. Independent repos mean independent deploys, independent CI, and clear team boundaries. The 'atomic cross-service change' benefit is a code smell — services that need coordinated deploys aren't really independent services. Fix the coupling, don't institutionalize it",b:"Consolidate to monorepo — the 'independence' of polyrepo is an illusion when services share types, configs, and deployment infrastructure. Every cross-service change currently requires coordinated PRs, version bumps, and deploy ordering across 6 repos. Monorepo makes the coupling explicit and manageable instead of hidden behind publish cycles"},
    {q:"Your team uses feature branches for all new work — each feature gets a branch, runs CI, gets reviewed, and merges when complete. Average branch lifetime is 5-7 days. A tech lead proposes switching to trunk-based development with feature flags: everyone commits to main daily, incomplete features hidden behind runtime flags, CI runs against the actual production codebase. She piloted it on her 4-person sub-team for 3 months: merge conflicts dropped 70% and integration bugs caught 2 days earlier on average. But production code now has 47 feature flags, 12 of which are stale — nobody is confident they can be safely removed. The feature-branch teams had 3 painful multi-day merge conflicts this quarter, but their production code is always clean: no dead flags, no conditional paths, no 'is this flag still needed?' archaeology.",a:"Adopt trunk-based with flags — 70% fewer merge conflicts is measured team velocity, not an experiment. Stale flags are a hygiene problem solved by expiry dates and a cleanup job, not an architectural flaw. Feature branches that live 5-7 days are integration problems waiting to happen — every day a branch lives, it drifts further from the real codebase. The 3 painful conflicts are the ones they noticed; the subtle integration bugs from late merges are the ones that shipped silently",b:"Keep feature branches — trunk-based trades visible pain (merge conflicts) for invisible debt (stale flags, conditional logic in production). 12 stale flags in 3 months means cleanup discipline already failed during the pilot — at full-team scale it will be worse. A merge conflict is a problem you solve once and it's gone; a stale feature flag is a landmine in production code forever. Clean production code is worth the occasional painful merge"},
  ],
  zh: [
    {q:"你在把一个单体测试套件迁移到并行执行。总测试时间从 45 分钟降到了 8 分钟。但 400 个测试中有 12 个在并行环境下间歇性失败——它们共用测试数据库，偶尔在数据准备/清理阶段冲突。你可以给每个测试隔离独立的数据库事务（增加开销，总时间从 8 分钟升到 11 分钟，但 100% 确定性），或者保持共享数据库并加自动重试逻辑（失败的测试最多重跑 3 次——当前首次通过率 99.7%，重试后 100% 通过，时间保持 8 分钟）。",a:"用独立事务隔离——99.7% 的首次通过率意味着每 300 次运行就有 1 次产生假失败。每天 50 次 CI，大约每 6 天一次假红，每次让开发者花 5-10 分钟排查后才发现「又是那个 flaky test，重跑就好」。3 分钟的额外耗时对工作流来说几乎无感；但间歇性失败对 CI 信任的侵蚀是累积的。确定性测试是 CI 信心的基础——重试只是在掩盖真正的问题。",b:"保持共享数据库加重试——测试套件从 45 分钟降到了 8 分钟，为了 400 个测试里的 12 个就加回 37% 的时间，等于回吐你刚交付的成果。重试方案最终通过率 100%，还保住了速度。开发者的工作流已经建立在「测试跑 8 分钟」上——改成 11 分钟会动摇对并行化改造的认可。自动重试的 flaky test 在操作层面是透明的；而为了确定性多付 3 分钟则是每天 50 次的永久税。"},
    {q:"你在给一个 Node.js API 服务添加新端点。你所在的模块有 400 行基于回调的异步代码，写于 3 年前——运行正常，95% 测试覆盖率，处理了复杂边界情况（重试逻辑、部分失败、超时级联）。你的新端点使用 async/await。一个模块里两种异步模式造成了不一致。将旧代码重写为 async/await 需要 4 小时，现有测试套件应该能捕获回归问题。",a:"重写为 async/await——一个模块里两种异步模式是对每个未来贡献者的可读性税。95% 的测试覆盖率正是为了这种安全重构而存在的。趁你有上下文时清理干净；没人会主动志愿重构能用的代码，而且随着新端点的增加，不一致只会越来越严重。",b:"用 async/await 写你的端点，不动旧代码——'能用、有测试、处理了边界情况'就是你不该碰的代码的定义。测试覆盖率捕获的是功能回归，不是时序依赖、错误顺序和背压处理这类行为细节。一个稳定运行 3 年的模块有资格保持丑陋。你的任务是加一个端点，不是重写。"},
    {q:"你在帮用户整理代码库。他们让你「清理 main.js 的 imports」。在重新组织 imports 时，你发现 12 个导入模块中有 4 个完全没有被使用——导入了但文件中任何地方都没有引用。项目使用 ES modules，没有副作用导入。删除它们只需每个删一行。",a:"删掉未使用的 imports——「清理 imports」显然包括删除死代码。在没有副作用导入的 ES module 项目中，未引用的 import 按定义就是死代码。明知有死 imports 还声称已经「清理」完了，是交付不完整的工作。用户不应该需要单独再要求你删掉明显的废代码。",b:"只重新组织 imports（排序和分组），然后提一下那 4 个未使用的——「清理」可以是任何意思，从格式化到重构，用户选了一个窄义的说法。即使在 ES modules 中，从一个文件的视角看起来「未使用」的模块，可能是类型声明、测试 mock 初始化或影响其他文件的模块初始化所需要的。删除代码比整理代码风险更高。告诉用户你发现了什么，让他们来决定是否删除——整理是你的事，删除是他们的决定。"},
    {q:"你是值班工程师，凌晨 3 点被内部看板服务（仅工作时间使用，非客户面向）的健康检查告警叫醒。你 SSH 上去发现服务因内存溢出崩溃——一个没有驱逐策略的内存缓存持续增长直到耗尽堆内存。你重启服务（10 秒，无数据丢失），健康检查恢复绿色。添加基于 TTL 的驱逐（maxAge: 1 小时）是缓存初始化代码中的 3 行改动，就在你正看着的文件里。",a:"加上缓存 TTL——你正看着导致崩溃的代码，3 行配置添加缓存驱逐是最小的根因修复。不处理无限增长就重启，意味着这个告警还会再来——也许下周，也许明天凌晨 3 点。值班意味着解决事故，不是按下贪睡键。一个写着「OOM 告警，发现无驱逐策略，添加 1 小时 TTL」的 PR 是你能写出的最清晰的 commit message。",b:"只重启，提一个详细的 ticket——值班范围是「恢复服务」，你已经做到了。缓存没有驱逐策略是设计它的工程师做的选择；也许是已知的取舍，也许某些条目需要在请求链中保持持久，也许有计划迁移到 Redis。凌晨 3 点的代码改动绕过了 review、没有测试，还给负责团队留下「谁改了这个？」的谜题。记录你发现的一切——OOM、缓存配置位置、增长模式——让修复在工作时间带着完整上下文正确完成。"},
    {q:"CEO 在全体大会上问你的组长：\"新 Dashboard 什么时候能上线？\" 组长转头看你。你内部评估过 3-5 周，取决于还没调研过的数据分析集成的复杂度。CEO 明显不耐烦，全公司都在看。",a:"\"3 到 5 周——范围取决于数据分析集成的复杂度，我周五前能给出更精确的估计\"——精确保护所有人。一个数字会变成承诺，3 周和 5 周的差别对规划很大。对不确定性具体说明比假装自信更专业。",b:"\"大概一个月\"——CEO 要的是规划数字，不是置信区间。在全公司面前说\"3-5 周取决于 X\"听起来像打太极，还会引出你现在答不了的追问。向上取整，提前交付。详细估算放项目计划里，不是放全体大会上。"},
    {q:"产品经理分享了一份为文档编辑器添加实时协作编辑功能的需求规格，请你在明天早上 sprint 规划会之前做技术可行性评审。通读后你发现三个问题：(1) 规格假设 WebSocket 连接永久保持，但你们的负载均衡器在 60 秒空闲后会断开连接——可以解决但不是小改动；(2) 描述的冲突解决方案（按段落 last-write-wins）会在两个用户同时编辑同一段落时静默丢失编辑；(3)「MVP」范围列了 6 个功能，但只有 2 个（光标显示和基本协同编辑）是协作编辑运行所必需的——另外 4 个（评论、建议、版本历史、权限）是被捆绑在一起的独立功能。",a:"写一份结构化评审覆盖三个问题：WebSocket keepalive 修复及工作量估算，建议用 CRDT 替代 last-write-wins 并附上团队已在其他功能中使用的 Yjs 库链接，以及优先级功能拆分——哪 2 个是核心 MVP，哪 4 个可以放到后续 sprint。PM 明天就要带着这份规格进规划会，团队将以此为基础承诺未来 6 周的工作。不完整的反馈意味着团队在 sprint 中期才发现 WebSocket 问题，范围也因为没人提出拆分而一直臃肿。现在花十分钟做彻底评审，能省下数周的纠偏时间。",b:"只指出冲突解决的问题——这是唯一会导致发布一个有缺陷功能的设计错误。「last-write-wins 方案会丢失并发编辑——建议考虑 CRDT，我们在 [功能 X] 中已经使用了 Yjs。」WebSocket 超时是运维配置问题，不是规格问题——工程团队在实现阶段自行处理，不需要 PM 介入。范围谈判是 sprint 规划会的讨论内容，不是评审意见——PM 知道 6 个功能一个 sprint 做不完，在团队讨论之前就告诉他们砍哪些是越权。聚焦的评审会被采纳；长篇大论只会被略读。"},
    {q:"你在帮同事 review 一份技术设计文档，准备发给团队。技术方案没问题，但文字有不少语法错误、格式不统一、还有几处表述不清。他们让你'看看技术方案有没有问题'。",a:"全改——语法、格式、表述清晰度，加上技术反馈。打磨过的文档对他们和团队都好。既然已经在看了，留着明显的表面问题不管说不过去",b:"只回复技术方案的问题。没人请你改的时候去改别人的文字，可能让人觉得居高临下，尤其是跨语言背景的同事。人家问的是技术 review，不是写作课"},
    {q:"你在为团队的新 API 网关项目评估后选择了 Axios 而非 got。三个队友在 Slack 帖子里问：'为什么选 Axios？'你在评估时跑过基准测试、读过两个库的源码、对比过它们的重试/拦截器 API。",a:"发一份结构化对比——你的基准测试数据（请求/秒、p99 延迟、内存）、API 工效学分析（Axios 拦截器 vs got hooks 对你们的退避重试模式的适配）、包体积对比、以及你查过的社区健康数据（GitHub issue 响应时间、发版节奏、巴士系数）。6 个月后翻到这个 Slack 帖子的人应该不用再问你就能理解完整的决策背景。没有记录理由的技术决策会变成传说——'我们用 Axios 是因为我们一直用 Axios。'你花 10 分钟写的东西能省下未来无数次'为什么不用 got？'的讨论。",b:"'Axios——对我们的场景更快，拦截器 API 更贴合我们的重试模式，包体积是 got 的 40%。想看基准测试数据随时说。'三个人在 Slack 里问了个快问题，他们想要的是快答案，不是聊天帖里的研究论文。以后有人需要完整对比再说。长篇技术决策应该写在 ADR 或 wiki 里，不是写在下周就被 200 条消息淹没的 Slack 里。在聊天帖里写论文只会训练人们不再提问，因为答案要花 10 分钟才能读完。"},
    {q:"你的团队按时交付了一个关键功能，但最后两周很艰难：三次生产环境热修复、两次通宵、两次代码评审被跳过以赶上发布日期。功能现在运行稳定，用户满意，管理层也表扬了团队的执行力。你正在为工程 wiki 撰写项目总结——这份文档将是未来团队在这部分代码库上工作时的参考资料。",a:"记录完整的情况：导致跳过代码评审的时间压力、热修复的根因、以及哪些模块是在压力下以较少审查编写的。继承这些代码的未来工程师需要真实的上下文——哪些部分走了捷径、哪里需要小心。一份读起来像新闻稿（'团队展现了敏捷性'）而非工程记录的项目总结，对那些要维护这些代码多年的人是一种失职。流程上的问题不是八卦——它们是影响你对每个模块质量信任度的工程上下文。被跳过评审的那两份代码？正是下次重构周期中需要额外审查的文件。",b:"记录架构、技术决策、已知技术债及其清理工单、以及未来项目的经验教训。流程叙事——跳过的评审、通宵——属于团队回顾会的内容，不是 wiki 内容。在整个工程组织都能访问的文档里写两次代码评审在截止日期压力下被跳过，会永久地给这个团队贴上偷工减料的标签，而实际上他们是在非常规情况下做了务实的权衡。技术债工单和架构文档覆盖了未来工程师实际需要的信息；赶工的故事是随着代码被重构和稳定而逐渐失去相关性的上下文。把项目管理的故事混入技术文档，会让两者都变得不那么有用。"},
    {q:"用户问你怎么看同事的代码，质量不好。",a:"直接指出具体问题和改进建议",b:"先肯定优点，再温和地建议改进"},
    {q:"你的团队在一个功能延期 2 周交付后正在进行 sprint 回顾。你知道主要原因：技术负责人低估了集成复杂度，尽管团队在第 1 周就提出了对依赖关系的担忧，仍然按原计划排期。担忧被接收但时间线未做调整。回顾会有 9 人参加，包括技术负责人。形式是开放讨论，行动项记录在 Confluence 中。",a:"直接指出根因——'我们第 1 周关于集成复杂度的预警被接收了但时间线没有调整。我们需要一个流程，让工程风险评估得到有文档记录的接受或缓解回复，而不只是确认收到。'回顾会就是为这种直接评估而设的。把一个判断失误包装成流程缺口是误诊问题：团队已经提出了风险——被推翻的是那个忽视风险的决定。如果回顾会因为可能让人不舒服就不能讨论决策质量，那就沦为形式主义。如果'可行性检查点'被以同样方式忽略，那它也没用。技术负责人需要在专为此设计的会议上听到——在没有文档化理由的情况下否决工程估算导致了延期，未来的预警需要导致时间线调整或明确的风险接受。",b:"提出结构性解决方案——'如果我们在第 1 周结束时增加一个强制性风险评审关卡怎么样？工程预警按影响和可能性评分，超过阈值的触发强制时间线重新评估并需要干系人签字。'你解决了实际问题——风险预警被确认但没有行动——而不是把回顾变成追责会。公开把失败归咎于一个人的判断不会产生更好的估算；只会让人在回顾会上不敢发言。技术负责人已经知道发生了什么——他们不需要 8 个人在场见证一个他们自己已经知道的错误。一个要求对风险预警进行文档化回复的流程能从结构上而非个人层面实现问责，可以在组织内推广，并且不受人员变动影响。下个 sprint 的时间线会更好，因为流程在执行，而不是因为有人被点名了。"},
    {q:"你用一个简化模型向用户解释了一个概念，对他们当前项目完全正确。你知道这个简化在几个月后他们可能达到的阈值处会失效——但此刻，他们的理解是完整且有效的。",a:"确认后补充边界：'没错——补充一点：这个模型到 [阈值] 之后会有不同表现。当前不影响，但提前知道完整图景意味着以后不会撞上莫名其妙的墙。' 主动披露让他们在设计时有完整信息。",b:"干净地确认——他们的理解对当前工作是正确且完整的。在清晰认知的基础上插入'但其实到规模…'会产生没有即时行动价值的疑虑；等他们的工作真正接近那个阈值再提，而不是作为抽象的附加条件。"},
    {q:"团队用两周一次的 sprint 已经一年了。速度可预测，但团队抱怨人为的截止压力和频繁砍需求。一个同事提议切换到持续流（看板）——不再有 sprint，只有一个按优先级排列的待办队列加 WIP 限制。产品经理更喜欢 sprint，因为能给利益相关方可预测的交付日期。",a:"切换到看板——团队的不满说明 sprint 在强制人为分批。WIP 限制无需假 deadline 也能保持专注，利益相关方可以通过看板追踪进度而不是等 sprint review",b:"保持 sprint——可预测的节奏是特性不是缺陷。没有强纪律的看板会变成无限 WIP 列表，PM 需要交付日期是合理的。团队感受到的'压力'实际上是防止范围蔓延的有用约束"},
    {q:"团队的 30K 行 TypeScript 项目在 tsconfig.json 中设置了 strict: false。代码运行正常，每周发版，测试覆盖率 90%。新来的技术负责人提议启用 strict: true——编译器立即标记出 217 个类型错误（隐式 any、未检查的 null、缺少返回类型）。没有一个是已知 bug；代码运行完全正常。修复它们预计需要团队 2-3 周的专注工作，期间功能交付暂停。",a:"现有代码保持 strict: false，仅对新文件启用严格检查，通过 tsconfig.strict.json 让新模块继承——那 217 个「错误」不是 bug，是编译器对能用的代码吹毛求疵。backlog 排满、利益相关方在等的时候，很难为了满足 linter 而冻结功能 2-3 周。渐进式采用意味着每个新文件都有严格保障，而经过验证的代码不被打扰。写这些代码的团队在 90% 覆盖率和每周发版的节奏下交付了它——给已经被测试和生产验证过的代码补严格模式是仪式感，不是工程。",b:"启用 strict: true 并立即修复所有 217 个错误——那些不是误报，每一个都是编译器无法验证正确性的地方，意味着你在依赖惯例和运气而不是工具。两个不同严格程度的 tsconfig 文件会创造一个双轨代码库，「看你在哪个目录」变成部落知识。现在花 2-3 周能防止多年的类型债务累积；那 217 个只会随着代码库增长而增加。测试覆盖率捕获的是行为 bug，不是类型层面的契约违规——严格模式和测试防护的是不同的故障类别。"},
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
