# TavernWeave Workbench（tavernweave-workbench）

TavernWeave 制卡系统的 **DeepSeek Harness（DSH）原生适配与工作台**。

- `tavernweave-native`：独立的 DSH 用户 Agent Preset，保留标准模式的工具面，
  向模型运行时提供 TavernWeave 上游完整 20 个 Skill 与 Host Front Door；
- `tavernweave-workbench`：DSH 会话内制卡入口、Soul 口令、实时技能状态、资料库与
  可持续的角色卡制卡工作台。

与官方 TW Lite 的关系：TavernWeave 仓库的 `host-adapters/dsh` 是
**Developer Preview 的离线候选**。本项目的 `tavernweave-native` 不从
`TW Lite Full / Entry` 派生：它以 DSH 0.1.2 的标准 Agent 组装为基线，
由 DSH 原生 Skill filesystem / tool-skill 加载上游 Skill；工作台继续独立承担 UI。

## 开发环境

- DSH v0.1.2-alpha.2（本地 web 实例，默认 `http://127.0.0.1:31808`）
- TavernWeave 仓库（与插件同级目录：`../TavernWeave`）

## 安装到 DSH

### 工作台插件

插件通过 DSH profile 的 `tavernweave-workbench` link 载入。设置页中把目标工作区
加入白名单后，侧栏与会话输入区会出现「✦ 酒馆」。

### 原生 Agent Preset

在项目根目录运行：

```powershell
pwsh -File .\scripts\install-native-adapter.ps1
```

脚本会创建 `~/.dsh/skills/tavernweave`（上游 `skills/` 的 junction）和
`~/.dsh/.agent-presets/tavernweave-native`（用户 preset）。随后**新建会话**，在
DSH 的 Agent Preset 选择器中选择“**TavernWeave 原生工坊**”。已有会话一旦产生内容，
DSH 不允许更换 preset。

## 使用

- 「✦ 酒馆」按钮 → 打开工作台面板（口令速查 / 技能状态 / 资料库 / 制卡工作台）
- 面板收回：右上角「×」、点击面板外、Esc
- 会话 dock 会明确提示当前会话是否已使用原生工坊；Soul 头像和“从零写卡 / 改造旧卡”会把内容直接插入 DSH 输入框。
- 设置页：白名单下拉添加、面板位置、默认 Soul 人格与自动补全。

## 里程碑

- [x] M1/M2：工作台、主题适配、白名单、资料库与使用说明
- [x] 会话内制卡 dock、Soul 三头像、多口令直接插入、JSON 结构盘点与组件草稿编辑
- [x] 制卡项目持久化：记录来源、阶段、版本、草稿与验收状态，可从列表继续编辑
- [x] DSH 0.1.2 原生 preset：完整 20 Skill 目录、Skill loader、Host Front Door、标准工具面
- [ ] M3：真实 SillyTavern 内的资产导入/运行验收（不是 DSH 页面验收）
- [ ] 模拟酒馆：按项目约定暂缓，待核心制卡闭环完成后再参考公开插件

## 工作台职责

- **技能状态**：目录可用数与当前会话实际通过 `skill` 工具加载过的 Skill 分开显示；“已加载”没有观察到调用时会明确标注，而不是伪装成全部激活。
- **制卡工作台**：每次盘点 JSON 卡片会建立或更新本地项目记录（保存于 DSH 用户数据目录，不覆盖原文件），可选择项目草稿、修改阶段、版本号，并保留“待真实酒馆验收”这一交付门。
- **资料库**：原作者 TavernWeave 的离线知识快照浏览与确定性检索入口，包含工程检查单、SillyTavern 指南、设计/动效参考和来源台账；它不是私有 RAG，也不替代 `consult-tavernweave-library` 的模型路由。

## 诚实口径

已验证：DSH 0.1.2 真实运行时可发现 20 个 TavernWeave Skill，并可由模型调用
`tavern-card-builder`。这证明 DSH 原生适配链路；不等同于 MVU、状态栏、世界书、
正则、Tavern Helper 或开场流程已在真实 SillyTavern 验收。后者仍是独立门。

## 许可证

PolyForm Noncommercial License 1.0.0（与 TavernWeave 上游一致）。
Required Notices：Copyright 2026 LiarMTTT（TavernWeave）、
Copyright 2026 主人（本插件代码）。完整文本见 [LICENSE](LICENSE)，
第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
