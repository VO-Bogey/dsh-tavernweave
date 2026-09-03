# TavernWeave Workbench（tavernweave-workbench）

这是基于 [LiarMTTT/TavernWeave](https://github.com/LiarMTTT/TavernWeave) 改造的非官方衍生适配项目（unofficial derivative/adaptation），面向 DeepSeek Harness（DSH）提供原生制卡工作台。项目遵循上游的 PolyForm Noncommercial License 1.0.0，并按许可要求保留上游版权和 Required Notice；本项目新增的 DSH 适配与工作台代码同样按本仓库 LICENSE 分发。它不代表 TavernWeave 或 DeepSeek 官方项目。

TavernWeave 制卡系统的 **DeepSeek Harness（DSH）原生适配与工作台**。

> 当前版本：**v1.0.0**（首个正式版）。版本历史见 [CHANGELOG.md](CHANGELOG.md)。

上游原项目：[LiarMTTT/TavernWeave](https://github.com/LiarMTTT/TavernWeave)

- `tavernweave-native`：独立的 DSH 用户 Agent Preset，保留标准模式的工具面，
  向模型运行时提供 TavernWeave 上游完整 20 个 Skill 与 Host Front Door；
- `tavernweave-workbench`：DSH 会话内制卡入口、Soul 口令、实时技能状态、资料库与
  可持续的角色卡制卡工作台。

与官方 TW Lite 的关系：TavernWeave 仓库的 `host-adapters/dsh` 是
**Developer Preview 的离线候选**。本项目的 `tavernweave-native` 不从
`TW Lite Full / Entry` 派生：它以 DSH 0.1.2 的标准 Agent 组装为基线，
由 DSH 原生 Skill filesystem / tool-skill 加载上游 Skill；工作台继续独立承担 UI。

## 特色功能

本工作台适合在 DSH 里创建 SillyTavern 酒馆角色卡的用户使用，无需编程基础。

- **写卡进度展示**：会话顶部显示当前卡的制卡阶段（需求、设定、世界书、
  状态栏、导出验收等），完成一项更新一项，可直接看到进度
- **Soul 与口令**：原项目soul阿瞳、MTTT.sir、灵魂杀手三种教学/审阅风格一键切换；
  常用制卡口令按分类检索，一键插入会话
- **复用 DSH 原生功能**：目标记录、提问确认、方案审阅、产出文件等
  使用 DSH 自带的界面，不重复实现
- **状态栏预览**：按卡片的实际变量即时渲染状态栏效果，支持桌面/窄屏
  切换，确认后再导出
- **材料登记**：TXT/Markdown 材料可拆分章节、标记事实与推断、
  记录进度，支持中断后继续

## 适配的 DSH 版本

| DSH 版本 | 状态 | 说明 |
| --- | --- | --- |
| `0.1.1-rc.2` | 接口兼容 | 静态接口面审核通过，未真机运行 |
| `0.1.2-alpha.2` | 真机验证通过 | 开发与验收基线 |
| `0.1.2-alpha.4 及以上` | 不兼容 | Session API 由 `events` 改为 `snapshotEvents`，需先做兼容适配 |

详细适配说明见 [docs/dsh-native-adapter.md](docs/dsh-native-adapter.md)。

## 功能细节（供深入阅读）

### 会话内制卡入口

- 「✦ 酒馆」入口：只在白名单工作区显示，跟随 DSH 当前会话自动判断。
- 会话工具栏：位于输入框上方，提供「从零写卡」「改造旧卡」快捷入口，指令直接插入输入框，不自动发送。
- Soul 口令：阿瞳、MTTT.sir、灵魂杀手的口令速查与一键插入；Soul 只改变教学/审阅风格，不扩大文件、联网、凭据、发布或验收权限。
- 工坊进度胶囊：与 Session 日志并排，读取 DSH 原生 Goal、Todo、Skill 活动投影为制卡阶段摘要；不接管 Goal 生命周期，不冒充酒馆运行状态。

### 工作台

- **口令速查**：按原作者 newbie-guide 整理的可复制口令；置顶「制卡操作指南」，面向插件用户说明从零写卡到导出验收的路径。
- **技能状态**：区分「目录可用」和「本会话实际加载」，未观察到的调用明确标注，不伪装成全部激活。
- **资料库**：原作者的离线知识快照浏览与确定性检索，含工程检查单、SillyTavern 指南、设计/动效参考和来源台账；可按键件类型分阶段/主题浏览。只读参考，不替代模型路由。
- **制卡工作台**：JSON / PNG 角色卡结构盘点（格式、身份、世界书、开场、变量、正则、Tavern Helper）、项目记录（来源、版本、阶段、草稿、哈希、验收状态）、组件级草稿编辑、导出 JSON；不覆盖用户原始文件。
- **从材料开始**：TXT/Markdown 本地登记预览（字数、章节标题、预计分片数、SHA-256 摘要），章节大纲与事实/推断确认任务、断点续接；原文只在本机处理，不自动上传。
- **卡内状态栏**：从真实变量（`extensions.variables/mvu`、世界书 `[initvar]`）提取变量模型并生成 HUD 预览与代码（裸 HTML / `{{getvar}}` 状态行），无变量时自动降级为文字状态行；桌面/窄屏切换。这是角色卡内部路线，与会话头部胶囊分开。
- **更新中心**：只检查和更新本插件仓库；检测到本地未提交改动、仓库分叉或远端不可达时只提示，不覆盖本地内容。

## 开发环境

- DSH v0.1.2-alpha.2（本地 web 实例）
- TavernWeave 仓库（与插件同级目录：`../TavernWeave`，也可安装时用 `-TavernWeaveRoot` 指定）

## 安装到 DSH

### 让 DSH 帮你安装（复制下方提示词发给 DSH）

选择一个工作目录，复制下面这段发给 DSH：
```text
帮我安装 TavernWeave 工作台（dsh-tavernweave）。步骤：

1. 在工作目录下克隆本项目（https://github.com/VO-Bogey/dsh-tavernweave）
   和上游 TavernWeave（https://github.com/LiarMTTT/TavernWeave），两者放同级。
2. 在本项目目录运行：pwsh -File .\scripts\install-native-adapter.ps1
   （若 TavernWeave 不在默认的上一级同级目录，用 -TavernWeaveRoot <路径> 指定）。
3. 用 dsh plugin --profile web add <本项目目录> 把工作台插件装进 web profile。
4. 完成后告诉我：重启 DSH，新建会话时在 Agent Preset 选择器选
   「TavernWeave 原生工坊」，然后在设置页把要用的工作区加入白名单，
   侧栏就会出现「✦ 酒馆」。

注意：每一步先做再汇报；遇到报错把错误贴给我并停下来问，不要绕过；
不要修改我没让你碰的目录和文件。
```

### 手动安装

#### 工作台插件

插件通过 DSH profile 的 `tavernweave-workbench` link 载入。设置页中把目标工作区
加入白名单后，侧栏与会话输入区会出现「✦ 酒馆」。

#### 原生 Agent Preset

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
- 聊天头部的工坊进度胶囊只显示 DSH 工作台项目进度；角色卡内部 MVU/正则状态栏属于单独的生成路线。
- 制卡工作台提供“从材料开始”本地 TXT/Markdown 登记预览，可查看字数、章节、分片数和哈希，再把摘要带回会话讨论。
- 设置页：白名单下拉添加、面板位置、默认 Soul 人格与自动补全。

## 里程碑

- [x] M1/M2：工作台、主题适配、白名单、资料库与使用说明
- [x] 会话内制卡 dock、Soul 三头像、多口令直接插入、JSON 结构盘点与组件草稿编辑
- [x] 制卡项目持久化：记录来源、阶段、版本、草稿与验收状态，可从列表继续编辑
- [x] DSH 0.1.2 原生 preset：完整 20 Skill 目录、Skill loader、Host Front Door、标准工具面
- [x] 材料登记到写卡、状态栏生成、PNG 导入与资料库分组浏览
- [x] 制卡核心链路（材料登记 → 写卡 → 导出 → 真实 SillyTavern 导入运行）真机验收通过
- [x] 状态栏生成代码（裸 HTML / `{{getvar}}` 状态行）真实 SillyTavern 运行验收通过
- [ ] 模拟酒馆：按项目约定暂缓，待核心功能真机验收完成后再参考公开插件

## 诚实口径

已验证：

1. DSH 0.1.2 真实运行时可发现 20 个 TavernWeave Skill，并可由模型调用
   `tavern-card-builder`，证明 DSH 原生适配链路；
2. 真实 DSH 会话验收全项通过；
3. 制卡核心链路（材料登记 → 会话内写卡 → JSON 导出 → 真实 SillyTavern 导入运行）真机验收通过；
4. 状态栏生成代码（裸 HTML / `{{getvar}}` 状态行）已在真实 SillyTavern 运行验收通过。

未验证项保持诚实：模拟酒馆按项目约定暂缓，未实际运行。

## 文档

- [CHANGELOG.md](CHANGELOG.md) — 版本历史与发布状态
- [docs/dsh-native-adapter.md](docs/dsh-native-adapter.md) — DSH 原生适配与兼容版本声明

## 许可证

PolyForm Noncommercial License 1.0.0（与 TavernWeave 上游一致）。
Required Notices：Copyright 2026 LiarMTTT（TavernWeave）、
Copyright 2026 WY（本插件代码）。完整文本见 [LICENSE](LICENSE)，
第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
