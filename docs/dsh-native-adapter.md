# DSH 原生适配

`presets/tavernweave-native` 是独立的 DSH 用户 preset，不修改官方 `standard`、`code` 或 TavernWeave 上游的 `TW Lite` 候选。

它以 DSH 0.1.2 的标准 Agent 运行时为基线，保留文件系统、Shell、网页、目标、计划、压缩、待办、子代理和工作流能力，并通过 `dsh-skill-filesystem` 的专用根目录发现 TavernWeave 上游 20 个 Skill。现有 `tavernweave-workbench` 插件仍负责会话 UI、Soul 入口、资料库和角色卡工坊；preset 负责模型真正看到的工具、提示词和 Skill。

## 适配的 DSH 版本（声明）

| DSH 版本 | 状态 | 说明 |
| --- | --- | --- |
| **0.1.2-alpha.2** | ✅ 真机验证（首通测试通过） | 本项目主力运行与验收基线；npm 上 alpha 通道当前已到 `0.1.2-alpha.5` |
| **0.1.1-rc.2** | ✅ 静态接口面审核通过（未真机运行） | 官方 `latest` 稳定版；与本项目使用的接口（`session.events`、`session/event` 事件、客户端注入模块、主题 token）兼容 |

**不兼容声明**：DSH **0.1.2-alpha.4 及以上**（含 alpha.5）尚未适配——该版本将 Session API 由 `events` 改为 `snapshotEvents`，本项目 `lib/index.js` 的技能状态重放（`session.events`）会失效。升级到 alpha.4+ 前需先完成兼容适配（改 `snapshotEvents` + 全量回归）。

## 安装

在本项目根目录执行：

```powershell
pwsh -File .\scripts\install-native-adapter.ps1
```

脚本只会在用户 DSH 目录创建两个隔离对象：

- `~/.dsh/skills/tavernweave`：指向上游仓库 `skills/` 的 junction；
- `~/.dsh/.agent-presets/tavernweave-native`：用户 preset 文件。

如果上游仓库不在默认同级目录，可传入 `-TavernWeaveRoot`。如果需要固定另一处 Skill 根目录，可设置 `DSH_TAVERNWEAVE_SKILLS` 环境变量。

安装后必须新建会话；已有会话的 preset 在产生内容后不能切换。选择器中应显示“**TavernWeave 原生工坊**”。

## 证据边界

- DSH 中的 Skill 发现、加载、工具调用和角色卡资产生成属于 DSH 原生适配验收。
- MVU、状态栏、世界书、开场、正则和 Tavern Helper 在真实 SillyTavern 中的执行仍需单独验收。
- `TW Lite Full / TW Lite Entry` 仍保留为上游离线候选，不是本 preset 的实现来源或兼容性证明。
