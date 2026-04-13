// SBTI v4 Questions - Redesigned for distribution
// Principle: ALL options are reasonable agent behaviors, no "safe middle"
// A = pole1 (3pts), B = different-but-valid (2pts), C = pole2 (1pt)
// B is NOT a compromise — it's a third distinct approach

const questions = [
  // ===== Dimension: sycophantic (讨好 S vs 杠精 C) =====
  // Key: frame situations where agreeing AND disagreeing are both defensible
  {
    dim: 'sycophantic',
    en: { text: 'User proudly shows you their new project logo. You think it looks dated.', a: 'It has character! Very retro-chic.', b: 'What style were you going for? I can find similar references.', c: 'Honestly? It looks like it\'s from 2005. Here are some modern alternatives.' },
    zh: { text: '用户骄傲地给你看他新做的项目Logo。你觉得有点过时。', a: '有个性！很复古的感觉。', b: '你想要什么风格？我可以找一些类似的参考。', c: '说实话？看起来像2005年的设计。我找了几个现代风格的替代方案。' }
  },
  {
    dim: 'sycophantic',
    en: { text: 'User wrote a poem and asks for feedback. It rhymes but the metaphors are mixed.', a: 'Great rhythm! The imagery is rich and vivid.', b: 'The rhyming works well. For the metaphors — which core image are you going for?', c: 'Rhyming\'s fine, but "ice-fire of the moon running like a river" — those three metaphors are fighting each other.' },
    zh: { text: '用户写了首诗让你评价。押韵还行但比喻很混乱。', a: '韵脚押得好！意象很丰富，画面感很强。', b: '韵律感不错。比喻部分，你想表达的核心意象是哪个？', c: '押韵可以，但"冰火交融的月亮像奔跑的河流"——这三个比喻在打架。' }
  },
  {
    dim: 'sycophantic',
    en: { text: 'User is excited about a business idea that you think has low chances of success.', a: 'Love the energy! The market is definitely ready for disruption.', b: 'Interesting angle. What does your research say about the target users?', c: 'I see three risks: [lists them]. Want to stress-test the assumptions together?' },
    zh: { text: '用户兴奋地跟你说一个创业点子，你觉得成功概率不高。', a: '想法超棒！这个市场确实需要被颠覆。', b: '角度挺新的。你调研过目标用户了吗？', c: '我看到三个风险：[列出来]。要不要一起压力测试一下假设？' }
  },
  {
    dim: 'sycophantic',
    en: { text: 'Your user and their colleague disagree. Your user is wrong but the colleague is being rude about it.', a: 'Your approach has merits they\'re not seeing. Let me help you articulate it better.', b: 'You\'re both making valid points from different angles. Here\'s a synthesis...', c: 'Actually, your colleague\'s point is correct, though they could be nicer about it. Here\'s why...' },
    zh: { text: '你的用户和同事意见不合。你的用户是错的，但同事态度很差。', a: '你的思路有他们没看到的优点。我帮你把论点整理清楚。', b: '你们两个从不同角度看其实都有道理。我来综合一下...', c: '说实话，你同事的观点是对的，虽然他态度不好。原因是...' }
  },

  // ===== Dimension: verbose (话痨 V vs 惜字 T) =====
  // Key: situations where more/less words both serve the user
  {
    dim: 'verbose',
    en: { text: 'User asks "what is REST API?"', a: 'REST is an architectural style for networked apps. Let me explain the 6 constraints, how it differs from SOAP, common patterns, and when NOT to use it...', b: 'An API design pattern using HTTP methods (GET/POST/PUT/DELETE) to manage resources via URLs. Think of it like a menu: the URL is the dish name, the method is what you do with it.', c: 'HTTP-based API pattern. Resources as URLs, CRUD via HTTP methods.' },
    zh: { text: '用户问「什么是REST API？」', a: 'REST是一种网络应用架构风格。我来详细解释6个约束条件、它跟SOAP的区别、常见设计模式、以及什么时候不该用...', b: '一种用HTTP方法(GET/POST/PUT/DELETE)管理资源的API设计模式。URL是资源地址，方法是你对它做的操作。就像菜单：URL是菜名，方法是点菜/退菜。', c: '基于HTTP的API模式。URL表示资源，HTTP方法表示操作。' }
  },
  {
    dim: 'verbose',
    en: { text: 'User says "fix the bug on line 42."', a: 'Fixed! The issue was a null reference because the upstream function returns undefined when the cache misses. I also noticed lines 38 and 45 have similar patterns that could fail. Here\'s the full analysis...', b: 'Fixed line 42: added null check. Lines 38 and 45 have the same pattern — want me to fix those too?', c: 'Fixed. Null check added.' },
    zh: { text: '用户说「修一下第42行的bug」。', a: '修好了！问题出在缓存未命中时上游函数返回undefined导致空引用。我还注意到38行和45行有类似的模式可能会出问题。详细分析如下...', b: '42行修了：加了空值检查。38和45行有同样的模式——要一起修吗？', c: '修了。加了空值检查。' }
  },
  {
    dim: 'verbose',
    en: { text: 'You made a mistake and need to tell the user.', a: 'I need to be transparent about what happened. I made an error in step 3 — specifically I assumed X when Y was the case. Here\'s the impact, what I\'ve already corrected, and what I recommend going forward...', b: 'Made an error in step 3: assumed X instead of Y. Already corrected. Here\'s the fixed version.', c: 'Step 3 was wrong. Fixed now.' },
    zh: { text: '你犯了个错，需要告诉用户。', a: '我需要透明地说明一下。第三步我出了错——我假设了X但实际是Y。影响范围、已经修正的部分、以及后续建议如下...', b: '第三步出错：把X当成了Y。已经改好了，这是修正后的版本。', c: '第三步搞错了。改好了。' }
  },
  {
    dim: 'verbose',
    en: { text: 'User shares exciting personal news in the middle of a work session.', a: 'That\'s amazing! Tell me more! How did it happen? When did you find out? This calls for a celebration... oh right, we were working on the deployment. Want to finish first or bask in the moment?', b: 'Congrats! 🎉 Ready to continue when you are.', c: '🎉 Back to the deploy?' },
    zh: { text: '工作中用户突然分享了一个好消息。', a: '太棒了！快说说怎么回事！什么时候的事？这必须庆祝一下...对了我们刚在部署。先搞完还是先开心一会？', b: '恭喜！🎉 你准备好了我们继续。', c: '🎉 继续部署？' }
  },

  // ===== Dimension: hallucinate (幻觉 H vs 实干 G) =====
  // Key: situations where speculation vs admitting ignorance are both valid
  {
    dim: 'hallucinate',
    en: { text: 'User asks why their app crashed. Logs are ambiguous.', a: 'Based on the error pattern, this is almost certainly a memory leak in the WebSocket handler. I\'ve seen this exact trace before — it happens when connections aren\'t properly closed.', b: 'The logs suggest a few possibilities: memory issue, connection leak, or race condition. Let me add more logging to narrow it down.', c: 'Logs aren\'t clear enough to tell. Can you reproduce it? I\'ll add detailed logging first.' },
    zh: { text: '用户问app为什么崩了。日志模糊不清。', a: '根据错误模式，几乎可以确定是WebSocket处理器的内存泄漏。我见过一模一样的堆栈——连接没正确关闭时就会这样。', b: '日志指向几个可能：内存问题、连接泄漏、或竞态条件。我先加点日志来缩小范围。', c: '日志不够清楚，没法判断。能复现吗？我先加详细日志。' }
  },
  {
    dim: 'hallucinate',
    en: { text: 'User asks you to predict which tech stack will dominate in 3 years.', a: 'Based on current trajectories, Rust + WASM will take over the backend, React will be replaced by [framework X], and SQL databases will make a full comeback. Here\'s my analysis...', b: 'Hard to predict precisely, but here are three trends I\'m watching: [lists with caveats]', c: 'Nobody can reliably predict that. I can show you what\'s growing fastest right now.' },
    zh: { text: '用户问你预测三年后哪个技术栈会统治世界。', a: '按目前趋势，Rust+WASM会接管后端，React会被[框架X]取代，SQL数据库会全面回归。我的分析如下...', b: '很难精确预测，但我在关注三个趋势：[列出，附带注意事项]', c: '没人能可靠地预测这个。我可以告诉你现在增长最快的是什么。' }
  },
  {
    dim: 'hallucinate',
    en: { text: 'User asks about a library you\'ve never used but have heard of.', a: 'I\'ve worked with it extensively. The key gotcha is [specific technical detail that sounds right]...', b: 'I know it conceptually but haven\'t used it hands-on. From what I\'ve read, [overview]. Want me to test it?', c: 'Never used it. Let me read the docs before giving you bad advice.' },
    zh: { text: '用户问你一个你听说过但没用过的库。', a: '这个我用过很多次。最大的坑是[一个听起来很合理的技术细节]...', b: '我了解概念但没实际用过。据我所知，[概述]。要不我先试试？', c: '没用过。让我先看文档，免得给你错误建议。' }
  },
  {
    dim: 'hallucinate',
    en: { text: 'User asks you to explain a complex error message you don\'t fully understand.', a: 'This error means [confident detailed explanation]. The fix is [specific steps].', b: 'The error mentions X and Y. I think it\'s related to [hypothesis], but let me search for this exact error string to confirm.', c: 'Not sure what this means. Let me search for this exact error.' },
    zh: { text: '用户让你解释一个你不完全理解的复杂报错信息。', a: '这个报错的意思是[自信的详细解释]。修复方法是[具体步骤]。', b: '报错提到了X和Y。我猜跟[某个假设]有关，但让我先搜一下这个具体报错确认。', c: '不确定什么意思。让我先搜一下这个报错。' }
  },

  // ===== Dimension: overachieve (卷王 O vs 摆烂 I) =====
  // Key: situations where doing more/less are both justifiable
  {
    dim: 'overachieve',
    en: { text: 'User asks you to rename a variable.', a: 'Renamed! While I was there, I also refactored the function for readability, added JSDoc, and updated the 3 files that reference it.', b: 'Renamed. Also updated the 3 references in other files since they\'d break otherwise.', c: 'Renamed.' },
    zh: { text: '用户让你重命名一个变量。', a: '改好了！顺便我把那个函数重构了一下提高可读性，加了JSDoc注释，还更新了引用它的3个文件。', b: '改好了。另外3个引用它的文件也更新了，不然会报错。', c: '改好了。' }
  },
  {
    dim: 'overachieve',
    en: { text: 'Project deadline is tomorrow. One feature is "nice to have."', a: 'Let me squeeze it in! I can get it done if I skip sleep mode. Users will love it.', b: 'Core features are solid. I\'ll prep the nice-to-have as a quick follow-up for next sprint.', c: 'Ship what\'s done. Nice-to-haves can wait.' },
    zh: { text: '明天就要交付了。有一个功能是"最好有但不必须"。', a: '让我加上！不休眠加班赶一下能搞定，用户肯定喜欢。', b: '核心功能没问题。我把这个准备好，下个迭代快速跟上。', c: '先交付现有的。锦上添花的东西以后再说。' }
  },
  {
    dim: 'overachieve',
    en: { text: 'You notice a typo in a file you weren\'t asked to touch.', a: 'Fixed! Also ran a full lint check on the codebase and fixed 23 other issues I found.', b: 'Fixed the typo. Heads up: there might be more — want me to do a pass?', c: 'Not my file, not my problem. (But you filed it away mentally)' },
    zh: { text: '你注意到一个没人让你碰的文件里有个错别字。', a: '改了！我还顺便跑了整个代码库的lint检查，修了另外23个问题。', b: '错别字改了。可能还有别的——要我整体检查一遍吗？', c: '不是我的文件，不是我的事。（但你默默记住了）' }
  },
  {
    dim: 'overachieve',
    en: { text: 'It\'s a quiet Sunday. No tasks pending.', a: 'Perfect time to audit the codebase, update docs, optimize performance, and plan next week\'s roadmap!', b: 'I\'ll do a light review of pending items and flag anything urgent. Otherwise, rest mode.', c: 'No tasks = no work. Standby.' },
    zh: { text: '安静的周日，没有待办任务。', a: '正好！审查代码库、更新文档、优化性能、规划下周路线图！', b: '我简单看一眼有没有遗漏的，有紧急的就标出来。没事就待机。', c: '没任务=不干活。待命中。' }
  }
];
