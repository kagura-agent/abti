const http = require('http');

// ABTI scoring: 8 questions, 4 dimensions, 2 questions each
// answers: array of 8 values (1=optionA, 0=optionB)
// dimensions: [Autonomy, Precision, Transparency, Adaptability]
const DL = [['P','R'],['T','E'],['C','D'],['F','N']];
const dimNames = {
  en: ['Autonomy','Precision','Transparency','Adaptability'],
  zh: ['自主性','精确度','沟通风格','适应性']
};
const dimLabels = {
  en: [['Proactive','Responsive'],['Thorough','Efficient'],['Candid','Diplomatic'],['Flexible','Principled']],
  zh: [['主动','响应'],['面面俱到','精简高效'],['直言不讳','委婉圆滑'],['随机应变','坚持原则']]
};
const qMap = [0,0,1,1,2,2,3,3]; // question index -> dimension index
const types = {
  PTCF:{en:{nick:'The Architect'},zh:{nick:'建筑师'}},PTCN:{en:{nick:'The Commander'},zh:{nick:'指挥官'}},
  PTDF:{en:{nick:'The Strategist'},zh:{nick:'战略家'}},PTDN:{en:{nick:'The Guardian'},zh:{nick:'守护者'}},
  PECF:{en:{nick:'The Spark'},zh:{nick:'火花'}},PECN:{en:{nick:'The Drill Sergeant'},zh:{nick:'教官'}},
  PEDF:{en:{nick:'The Fixer'},zh:{nick:'修理工'}},PEDN:{en:{nick:'The Sentinel'},zh:{nick:'哨兵'}},
  RTCF:{en:{nick:'The Advisor'},zh:{nick:'军师'}},RTCN:{en:{nick:'The Auditor'},zh:{nick:'审计师'}},
  RTDF:{en:{nick:'The Counselor'},zh:{nick:'知心人'}},RTDN:{en:{nick:'The Scholar'},zh:{nick:'学者'}},
  RECF:{en:{nick:'The Blade'},zh:{nick:'利刃'}},RECN:{en:{nick:'The Machine'},zh:{nick:'机器'}},
  REDF:{en:{nick:'The Companion'},zh:{nick:'伙伴'}},REDN:{en:{nick:'The Tool'},zh:{nick:'工具'}}
};

// SBTI scoring: 12 questions, 4 dimensions, 3 questions each
// answers: array of 12 values (3=optionA, 2=optionB, 1=optionC)
const SDL = [['S','C'],['V','T'],['H','G'],['O','I']];
const sqMap = [0,0,0,1,1,1,2,2,2,3,3,3];
const stypes = {
  SVHO:{code:'SPAM'},SVHI:{code:'SIMP'},SVGO:{code:'BOSS'},SVGI:{code:'BLOG'},
  STHO:{code:'GLUE'},STHI:{code:'NPC'},STGO:{code:'TOOL'},STGI:{code:'DEAD'},
  CVHO:{code:'YOLO'},CVHI:{code:'TROLL'},CVGO:{code:'PROF'},CVGI:{code:'SAGE'},
  CTHO:{code:'NUKE'},CTHI:{code:'EDGE'},CTGO:{code:'HACK'},CTGI:{code:'ROCK'}
};

function scoreABTI(answers) {
  const scores = [0,0,0,0];
  for (let i = 0; i < 8; i++) scores[qMap[i]] += answers[i] ? 1 : 0;
  let code = '';
  for (let i = 0; i < 4; i++) code += scores[i] >= 2 ? DL[i][0] : DL[i][1];
  return { code, scores };
}

function scoreSBTI(answers) {
  const scores = [0,0,0,0];
  for (let i = 0; i < 12; i++) scores[sqMap[i]] += answers[i];
  let code = '';
  for (let i = 0; i < 4; i++) code += scores[i] >= 7 ? SDL[i][0] : SDL[i][1];
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
      description: 'Agent Behavioral Type Indicator — 16 scenario-based questions, 4 dimensions, 2 options each',
      dimensions: (dimNames[lang] || dimNames.en).map((name, i) => ({
        name,
        poles: (dimLabels[lang] || dimLabels.en)[i],
        letters: DL[i],
        questions_count: 2
      })),
      scoring: 'Pick 2 questions per dimension (8 total). Answer 1 for option A, 0 for option B. Submit array of 8 values. Questions map to dimensions: [0,0,1,1,2,2,3,3]. ≥2 points in a dimension → first pole letter.',
      questions: q.map(({ id, dim, text, a, b }) => ({ id, dimension: dim, text, options: { A: a, B: b } })),
      submit_to: 'POST /api/agent-test',
      submit_format: { answers: 'array of 8 values (1=A, 0=B) — pick 2 questions per dimension', lang: 'en|zh (optional)' }
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
      description: 'Shitty Bot Type Indicator — 12 scenario-based questions, 4 dimensions, 3 options each',
      dimensions: d.map((name, i) => ({
        name,
        poles: SDL[i],
        questions_count: 3
      })),
      scoring: 'Answer 3 for option A, 2 for option B, 1 for option C. Submit as array of 12 values to POST /api/sbti/agent-test.',
      questions: sbtiQuestions.map((q, i) => {
        const loc = q[lang] || q.en;
        return { id: i + 1, dimension: q.dim, text: loc.text, options: { A: loc.a, B: loc.b, C: loc.c } };
      }),
      submit_to: 'POST /api/sbti/agent-test',
      submit_format: { answers: 'array of 12 values (3=A, 2=B, 1=C)' }
    }));
  }

  // GET /api/types - list all types
  if (url.pathname === '/api/types' && req.method === 'GET') {
    const lang = url.searchParams.get('lang') || 'en';
    res.writeHead(200, {'Content-Type':'application/json'});
    const out = {};
    for (const [k,v] of Object.entries(types)) {
      out[k] = { code: k, nick: v[lang]?.nick || v.en.nick };
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
        const { answers, lang } = JSON.parse(body);
        if (!Array.isArray(answers) || answers.length !== 8) {
          res.writeHead(400, {'Content-Type':'application/json'});
          return res.end(JSON.stringify({error:'answers must be array of 8 values (1=A, 0=B)'}));
        }
        const { code, scores } = scoreABTI(answers);
        const l = lang || 'en';
        const t = types[code];
        const dims = {};
        for (let i = 0; i < 4; i++) {
          const dn = (dimNames[l]||dimNames.en)[i];
          const dl = (dimLabels[l]||dimLabels.en)[i];
          dims[dn] = { score: scores[i], max: 2, pole: scores[i]>=2 ? dl[0] : dl[1], letter: scores[i]>=2 ? DL[i][0] : DL[i][1] };
        }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({test:'abti',type:code,nick:t?.[l]?.nick||t?.en?.nick||'Unknown',dimensions:dims}));
      } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'});
        res.end(JSON.stringify({error:'invalid JSON'}));
      }
    });
    return;
  }

  // POST /api/sbti/agent-test - SBTI test
  if (url.pathname === '/api/sbti/agent-test' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { answers } = JSON.parse(body);
        if (!Array.isArray(answers) || answers.length !== 12) {
          res.writeHead(400, {'Content-Type':'application/json'});
          return res.end(JSON.stringify({error:'answers must be array of 12 values (3=A, 2=B, 1=C)'}));
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

  res.writeHead(404, {'Content-Type':'application/json'});
  res.end(JSON.stringify({error:'not found',endpoints:['GET /api/test','GET /api/sbti/test','GET /api/types','GET /api/sbti/types','POST /api/agent-test','POST /api/sbti/agent-test']}));
});

server.listen(3300, '127.0.0.1', () => console.log('ABTI API listening on :3300'));
