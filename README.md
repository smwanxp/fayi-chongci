# 法忆冲刺（开源版）

一套面向记忆型学习场景的中文复习系统。项目最初为法考三轮冲刺设计，但其卡片、判断、自测、速记、带背、间隔复习、知识关联、笔记和数据看板能力可以用于其他考试或知识库。

> 本仓库只包含程序代码与虚构示例数据。正式题库、口诀、商业教辅内容、用户数据和线上应用配置均未公开。

## 主要功能

- 口诀完整默写、知识卡与正确/错误判断
- 速记、带背、自由复习和模拟组卷
- 固定记忆曲线与自适应复习调度
- 按科目、章节、熟悉度筛选和专项训练
- 可拖拽知识体系与知识关联浏览
- 独立复习笔记、来源管理和 Markdown 导出
- 每日一题、错题本、学习统计与数据看板
- 管理员维护内容并向其他用户同步
- IndexedDB 离线数据、JSON 备份与恢复

## 技术栈

- React + TypeScript + Vite
- NestJS
- IndexedDB
- 飞书 aPaaS / Dataloom（云端部署时使用）
- Jest + ESLint

## 本地运行

要求 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

默认示例数据位于 `client/src/lib/seed.ts` 和 `client/src/lib/daily-questions/index.ts`。你可以按现有类型定义替换为自己拥有传播权的内容。

## 检查与构建

```bash
npm run type:check
npm test -- --runInBand
npm run build:prod
```

## 飞书部署

1. 使用飞书开发工具创建自己的全栈应用。
2. 复制 `.env.example` 为本地环境文件并填写你自己的配置。
3. 创建数据库表和文件存储桶。
4. 在 `client/src/lib/deployment-config.ts` 填入自己的非敏感文件存储标识。
5. 按 `docs/AI_MAINTENANCE_GUIDE.md` 完成迁移、测试和发布。

请勿复用他人的应用 ID、存储桶 ID、令牌、管理员密码或线上数据。

## 数据与版权

- 仓库中的示例内容为功能演示而编写。
- 使用者应确保导入和发布的题库、口诀、讲义及解析拥有合法授权。
- 真实用户数据、备份文件和环境变量不得提交到 Git。
- 项目代码采用 [MIT License](LICENSE)；用户自行导入的数据不因此变为 MIT 授权。

## 贡献

欢迎提交 Issue 和 Pull Request。提交前请确保类型检查、测试和构建全部通过，并且不要夹带真实用户数据、商业题库或密钥。
