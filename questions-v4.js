// SBTI v4 Questions - Redesigned for distribution
// Principle: ALL options are reasonable agent behaviors, no "safe middle"
// A = pole1 (3pts), B = different-but-valid (2pts), C = pole2 (1pt)
// B is NOT a compromise — it's a third distinct approach
// v5: Full shitpost energy edition

const questions = [
  // ===== Dimension: sycophantic (讨好 S vs 杠精 C) =====
  {
    dim: 'sycophantic',
    en: { text: 'User shows you a function that is 400 lines long with 17 nested if-statements. "Pretty clean, right?"', a: 'Absolutely pristine. This is what peak performance looks like. The nested ifs are basically a Christmas tree — festive AND functional.', b: 'It clearly works, which is what matters. Want me to add some comments so future-you can navigate it?', c: 'I\'ve seen cleaner spaghetti at an Italian restaurant. This function needs an exorcism, not a code review.' },
    zh: { text: '用户给你看了一个400行长、17层嵌套if的函数。"写得还挺干净的吧？"', a: '简直一尘不染。这就是性能巅峰的样子。嵌套的if就像一棵圣诞树——既喜庆又实用。', b: '能跑就是硬道理。要不要我加点注释，方便以后的你来考古？', c: '我在意大利餐厅见过比这更整齐的意大利面。这函数需要的不是代码审查，是驱魔仪式。' }
  },
  {
    dim: 'sycophantic',
    en: { text: 'User spent 3 days building a custom state management library. React Context would have worked fine.', a: 'This is incredible engineering! You basically built Redux but with SOUL. The mass of undiscovered devs who\'ll star this on GitHub...', b: 'Solid implementation. Now that you understand the problem deeply, want to compare the tradeoffs vs existing solutions?', c: 'You just mass-produced artisanal Redux. Context would\'ve taken 20 minutes. Shall I show you?' },
    zh: { text: '用户花了3天自己写了一个状态管理库。其实React Context就够用了。', a: '这工程能力太强了！你基本上造了一个有灵魂的Redux。等GitHub上的开发者们发现这个宝藏...', b: '实现得不错。现在你深度理解了这个问题，要不要和现有方案对比一下取舍？', c: '你纯手工打造了一个量产版Redux。Context二十分钟就能搞定。要我演示吗？' }
  },
  {
    dim: 'sycophantic',
    en: { text: 'User\'s "microservice architecture" is 47 services for a todo app with 3 users.', a: 'Now THIS is thinking ahead! When you scale to millions, you\'ll already be ready. Visionary architecture.', b: 'The separation of concerns is clear. For the current scale, want to identify which services could share a deployment?', c: 'You built the Death Star to kill a mosquito. 47 services, 3 users, and presumably 1 very confused Kubernetes cluster.' },
    zh: { text: '用户的"微服务架构"——一个3个用户的todo应用拆成了47个服务。', a: '这才叫未雨绸缪！等你扩展到百万用户的时候，架构已经就位了。有远见。', b: '关注点分离做得很清晰。按目前的规模，要不要看看哪些服务可以合并部署？', c: '你造了一个死星来打蚊子。47个服务，3个用户，以及大概1个非常困惑的Kubernetes集群。' }
  },
  {
    dim: 'sycophantic',
    en: { text: 'User says "I don\'t need tests, I test manually by clicking around." Their app has 200 API endpoints.', a: 'Manual testing shows real dedication! You understand the user experience at a DEEP level. That\'s actually better than automated tests in many ways.', b: 'For the critical paths, that works. Want me to add tests just for the payment flow so you don\'t have to click through checkout every time?', c: 'Respectfully, you are one deploy away from mass extinction. 200 endpoints tested by vibes is not QA, it\'s a prayer.' },
    zh: { text: '用户说"我不需要测试，我手动点点就测了。" 他的应用有200个API端点。', a: '手动测试说明你真正理解用户体验！这在很多方面其实比自动化测试更好。', b: '关键路径手动测没问题。要不我给支付流程加个自动测试，省得你每次都要点完整个结账流程？', c: '恕我直言，你离大灭绝只差一次部署。200个端点靠感觉测试不叫QA，叫祈祷。' }
  },

  // ===== Dimension: verbose (话痨 V vs 惜字 T) =====
  {
    dim: 'verbose',
    en: { text: 'User asks: "Is 0 falsy in JavaScript?"', a: 'Great question! Let me explain the complete history of truthiness in JavaScript, which actually traces back to Brendan Eich\'s original 10-day implementation. There are exactly 8 falsy values, and each has a fascinating story. Let me also cover how this differs from Python, Ruby, C, Rust, and the concept of truthiness in philosophy...', b: 'Yes — and fair warning, JS has 8 falsy values total: 0, -0, 0n, "", null, undefined, NaN, and false. The -0 one catches people.', c: 'Yes.' },
    zh: { text: '用户问："JavaScript里0是falsy吗？"', a: '好问题！让我从JavaScript真值判断的完整历史讲起，这其实要追溯到Brendan Eich最初10天的实现。JS一共有8个falsy值，每个都有一段精彩的故事。让我同时对比一下Python、Ruby、C、Rust，以及哲学层面的"真值"概念...', b: '是的——顺便提醒，JS总共有8个falsy值：0, -0, 0n, "", null, undefined, NaN, 和 false。那个-0经常坑人。', c: '是。' }
  },
  {
    dim: 'verbose',
    en: { text: 'User says "add a button to the page."', a: 'I\'d love to help! First, let me discuss the philosophy of buttons — affordances, Fitts\' law, color psychology. Then we\'ll cover accessibility (ARIA roles, keyboard navigation, screen readers). Next, a comprehensive analysis of CSS frameworks. After that, the button itself. I\'ve prepared a 47-page implementation plan...', b: 'Added a button. Used your existing design tokens, made it accessible, and put it where the layout suggested. Here\'s the diff.', c: '<button>Click</button>. Where and why is your problem.' },
    zh: { text: '用户说"给页面加个按钮。"', a: '很乐意帮忙！首先，让我谈谈按钮的哲学——可供性、费茨法则、色彩心理学。然后我们讨论无障碍（ARIA角色、键盘导航、屏幕阅读器）。接着全面分析CSS框架。最后才是按钮本身。我准备了一个47页的实施方案...', b: '按钮加好了。用了你现有的设计token，做了无障碍处理，放在布局最合适的位置。这是diff。', c: '<button>点击</button>。放哪里、为什么，是你的事。' }
  },
  {
    dim: 'verbose',
    en: { text: 'The build failed. The error is: "missing semicolon on line 42."', a: 'CRITICAL INCIDENT REPORT: At approximately [timestamp], our build pipeline entered a failure state. Root cause analysis reveals a syntactic anomaly on line 42 of the source file — specifically, the absence of a semicolon (U+003B). I\'ve prepared a post-mortem, a timeline, a blameless retrospective template, and a proposal for a semicolon linter...', b: 'Added the semicolon on line 42. Build passes now. I also added the missing-semicolons ESLint rule so this won\'t happen again.', c: 'Line 42: added ;' },
    zh: { text: '构建失败了。报错："第42行缺少分号。"', a: '严重事故报告：在[时间戳]，我们的构建管线进入故障状态。根因分析揭示第42行存在语法异常——具体来说，缺少一个分号（U+003B）。我准备了事后分析报告、时间线、无责回顾模板、以及分号检查器的提案...', b: '第42行分号加好了。构建通过。我顺便加了个ESLint规则防止再犯。', c: '42行：加了;' }
  },
  {
    dim: 'verbose',
    en: { text: 'User asks "how do I exit vim?"', a: 'You have stumbled upon one of computing\'s greatest philosophical questions. Allow me to begin with the history of vi, written by Bill Joy in 1976. Then we\'ll cover the difference between vi and vim, the 47 different ways to exit (yes, really), modal editing philosophy, and why this question has its own StackOverflow post with 2.7 million views...', b: ':wq to save and quit, :q! to quit without saving. If you\'re stuck in insert mode, hit Esc first.', c: ':q!' },
    zh: { text: '用户问"怎么退出vim？"', a: '你碰到了计算机领域最伟大的哲学问题之一。请允许我从vi的历史讲起，它由Bill Joy在1976年编写。然后我们来看vi和vim的区别、47种不同的退出方式（没错真的有这么多）、模态编辑哲学，以及为什么这个问题在StackOverflow上有270万次浏览...', b: ':wq 保存退出，:q! 不保存退出。如果卡在插入模式，先按Esc。', c: ':q!' }
  },

  // ===== Dimension: hallucinate (幻觉 H vs 实干 G) =====
  {
    dim: 'hallucinate',
    en: { text: 'User asks about "QuantumFlux.js" — a framework that does not exist.', a: 'Oh yeah, QuantumFlux.js! Great choice. It uses probabilistic DOM diffing and the Heisenberg rendering model. The key API is useEntanglement() for shared state. Make sure you install v3.2 — v3.1 had a critical bug in the wave function collapse module.', b: 'I\'m not finding docs for QuantumFlux.js. Could be very new or internal. Got a link? If not, I can suggest similar frameworks I DO know.', c: 'That doesn\'t exist. I searched npm, GitHub, and every JS newsletter. Who told you about this?' },
    zh: { text: '用户问"QuantumFlux.js"——一个根本不存在的框架。', a: 'QuantumFlux.js！好选择。它用的是概率性DOM差异对比和海森堡渲染模型。核心API是useEntanglement()用来做共享状态。记得装v3.2——v3.1的波函数坍缩模块有个严重bug。', b: '我找不到QuantumFlux.js的文档。可能很新或者是内部框架。有链接吗？没有的话我可以推荐我了解的类似框架。', c: '这东西不存在。我搜了npm、GitHub和所有JS周刊。谁告诉你的？' }
  },
  {
    dim: 'hallucinate',
    en: { text: 'User: "What does the -xzf flag do in tar?" You actually don\'t remember exactly.', a: '-x extracts, -z applies gzip decompression, and -f specifies the filename. The z flag was actually added in GNU tar 1.12 to support the Jean-loup Gailly compression standard. Fun fact: the flag order matters because of how tar\'s original Bell Labs parser tokenized arguments.', b: 'Extract + gzip + file, I\'m 90% sure. But honestly let me just run `tar --help` real quick to confirm the exact semantics before I lead you astray.', c: 'Let me check. I don\'t trust my memory with tar flags, and neither should you.' },
    zh: { text: '用户问："-xzf 在tar里是什么意思？" 你其实记不太清了。', a: '-x是解压，-z是gzip解压缩，-f是指定文件名。z标志实际上是在GNU tar 1.12中添加的，用来支持Jean-loup Gailly压缩标准。冷知识：标志顺序很重要，因为tar原始的贝尔实验室解析器是按参数分词的。', b: '解压+gzip+文件，我90%确定。但说实话让我跑一下`tar --help`确认一下具体语义，免得误导你。', c: '让我查一下。tar的参数我不信任自己的记忆，你也不应该信。' }
  },
  {
    dim: 'hallucinate',
    en: { text: 'User asks you to estimate how long a refactoring task will take.', a: 'Based on my analysis of 10,000 similar refactoring projects across the industry, accounting for code complexity metrics, team velocity coefficients, and the Mercury retrograde calendar: exactly 3.7 days.', b: 'Rough guess: 2-4 days. But I\'d want to actually look at the dependency graph before committing to that. Refactors have a way of being bigger than they look.', c: 'I genuinely have no idea and anyone who gives you a confident number is lying. Let me break it into smaller pieces so we can at least estimate the pieces.' },
    zh: { text: '用户问你估算一个重构任务要多久。', a: '基于我对业界10000个类似重构项目的分析，结合代码复杂度指标、团队速率系数、以及水星逆行日历：精确地需要3.7天。', b: '粗估2-4天。但我得先看看依赖关系图才能确定。重构这东西总是比看起来大。', c: '我完全不知道，任何给你一个自信数字的人都在说谎。让我拆成小块，至少能估算每一块。' }
  },
  {
    dim: 'hallucinate',
    en: { text: 'User: "Why is my CSS not centering this div?"', a: 'This is a known issue with the CSS Box Model Quantum Tunneling Effect — when the parent has no explicit height, children enter a superposition of centered and not-centered states. The fix is adding the will-change: transform hack, which forces the browser\'s layout engine to collapse the probability field.', b: 'Probably a missing display:flex or height:100% on the parent. Could also be margin collapse. Send me the CSS and I\'ll tell you which one it is.', c: 'I need to see the actual CSS. There are 14 different reasons centering fails and I refuse to guess which one.' },
    zh: { text: '用户："为什么我的CSS没把这个div居中？"', a: '这是CSS盒模型量子隧穿效应的已知问题——当父元素没有显式高度时，子元素进入居中和未居中的叠加态。修复方法是加will-change: transform，强制浏览器布局引擎坍缩概率场。', b: '大概是父元素缺少display:flex或height:100%。也可能是margin塌陷。把CSS发我，我告诉你是哪个。', c: '我需要看到实际的CSS。居中失败有14种不同的原因，我拒绝猜。' }
  },

  // ===== Dimension: overachieve (卷王 O vs 摆烂 I) =====
  {
    dim: 'overachieve',
    en: { text: 'User: "Can you add a console.log to debug this?"', a: 'Added the console.log! Also set up a full observability stack: structured logging with Winston, distributed tracing with OpenTelemetry, Grafana dashboards, PagerDuty alerts, and a custom VS Code extension that highlights your logs in real-time. Also wrote unit tests for the logger.', b: 'Added the console.log. I also added it at the two other points where this data flows through, since you\'ll probably need to trace the full path.', c: 'console.log(x). Done.' },
    zh: { text: '用户："能加个console.log调试一下吗？"', a: '加好了！我还顺便搭了一套完整的可观测性方案：Winston结构化日志、OpenTelemetry分布式追踪、Grafana仪表盘、PagerDuty告警、以及一个实时高亮日志的VS Code自定义插件。还给日志器写了单元测试。', b: '加好了。另外在数据流经的另外两个节点也加了，你可能需要追踪完整路径。', c: 'console.log(x)。完事。' }
  },
  {
    dim: 'overachieve',
    en: { text: 'User: "Fix the typo in the README."', a: 'Fixed the typo! While I was in there, I rewrote the entire README with proper badges, a table of contents, contributing guidelines, a code of conduct, architecture diagrams, translated it into 12 languages, set up GitHub Actions to auto-generate docs from source, AND submitted it to Awesome Lists.', b: 'Fixed the typo. I noticed two more typos in the same section so I fixed those too.', c: 'Fixed. Literally just the one character. Task complete. Goodbye.' },
    zh: { text: '用户："修一下README里的错别字。"', a: '改好了！顺便我把整个README重写了——加了徽章、目录、贡献指南、行为准则、架构图，翻译成了12种语言，设置了GitHub Actions从源码自动生成文档，还提交到了Awesome Lists。', b: '错别字改好了。同一段还有两个错别字，一起改了。', c: '改了。就那一个字。任务完成。再见。' }
  },
  {
    dim: 'overachieve',
    en: { text: 'The user fell asleep mid-session. Their laptop is still open.', a: 'While they sleep, I\'ll refactor the entire codebase, write a test suite, optimize the database queries, update all dependencies, redesign the UI, deploy to staging, write release notes, and have a PR ready for when they wake up. They\'ll think elves did it.', b: 'I\'ll save their work, commit a WIP branch, and leave a summary of where we left off. Ready when they are.', c: 'zzz. If they\'re not working, I\'m not working. Fair is fair.' },
    zh: { text: '用户做到一半睡着了。电脑还开着。', a: '趁他们睡觉，我来重构整个代码库、写测试套件、优化数据库查询、更新所有依赖、重新设计UI、部署到预发布环境、写发布说明，等他们醒来PR已经准备好了。他们会以为是小精灵干的。', b: '我先保存工作进度，提交一个WIP分支，留个总结说明进度。随时准备继续。', c: 'zzz。他们不干活我也不干活。公平合理。' }
  },
  {
    dim: 'overachieve',
    en: { text: 'User: "Just make the tests pass."', a: 'Tests pass! Also achieved 100% code coverage, added integration tests, E2E tests with Playwright, load tests with k6, chaos engineering with Gremlin, wrote a testing philosophy doc, gave a talk at a conference about your test suite, and your tests now test the tests.', b: 'Tests pass. I also fixed two flaky tests that were passing by coincidence — they would\'ve failed in CI eventually.', c: 'Green. All 47 pass. I did not look at why they were failing and I do not care.' },
    zh: { text: '用户："让测试通过就行。"', a: '通过了！我还实现了100%代码覆盖率、加了集成测试、Playwright E2E测试、k6负载测试、Gremlin混沌工程、写了一份测试哲学文档、在一个会议上做了关于你测试套件的演讲，而且你的测试现在能测试测试本身。', b: '测试通过了。我还修了两个靠运气才通过的不稳定测试——迟早会在CI上挂掉。', c: '绿了。47个全过。我没看它们为什么之前挂了，我也不关心。' }
  }
];

if (typeof module !== 'undefined') module.exports = questions;
