# CLAUDE.md — ABTI Project

> AI Agent 人格测试网站。单 HTML 文件，深色主题 + 樱花粉配色。
> 前端设计通用规则由 frontend-design plugin 提供，这里只写项目特定约束。

## 项目约束

- **单 HTML 文件**：CSS 内联 `<style>`，JS 内联 `<script>`，无构建工具
- **深色主题**：背景 hsl(240 25% 5%)，主色樱花粉 #ff6b9d
- **双语**：中文(默认) + English，中文需 line-height 1.7+
- **移动端优先**：375px 视口必须完美，微信内置浏览器兼容

## 配色

```
背景: #0a0a0f / hsl(240 25% 5%)
卡片: hsl(240 20% 10%)
主色: #ff6b9d (樱花粉)
文字: hsl(0 0% 93%)
次文字: hsl(240 10% 65%)
边框: hsl(240 15% 20%)
```

## 部署

- VM1: `scp -i ~/.ssh/vm1.pem <file> azureuser@moltbook.kagura-agent.com:/home/azureuser/abti/`
- GitHub: `git push` → master branch
- 域名: abti.kagura-agent.com (Caddy 反代)
- Avatar 图片: `/avatars/*.png`（SDXL Turbo 生成）
- GIF: `/gif/*.gif`（同域加载）

## 测试

改完前端后必须验证：
- 375px 宽度无水平滚动
- 中英文切换正常
- 进度条正确
- 结果页 avatar 显示
