# DSH 原生适配

`presets/tavernweave-native` 是独立的 DSH 用户 preset，不修改官方 `standard`、`code` 或 TavernWeave 上游的 `TW Lite` 候选。

它以 DSH 0.1.2 的标准 Agent 运行时为基线，保留文件系统、Shell、网页、目标、计划、压缩、待办、子代理和工作流能力，并通过 `dsh-skill-filesystem` 的专用根目录发现 TavernWeave 上游 20 个 Skill。现有 `tavernweave-workbench` 插件仍负责会话 UI、Soul 入口、资料库和角色卡工坊；preset 负责模型真正看到的工具、提示词和 Skill。

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
