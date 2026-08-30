# TavernWeave Workbench（tavernweave-workbench）

TavernWeave 制卡系统的 **DeepSeek Harness（DSH）原生前端插件**。
在 DSH 里提供「🍺 酒馆」入口面板：按阵营分层的原作者使用口令速查、
技能安装状态、资料库查询（规划中）、模拟酒馆（规划中）。

与官方 TW Lite 的关系：TavernWeave 仓库的 `host-adapters/dsh` 是
**Skill loader 预设候选**（让 DSH 装载 TW 的 20 个 Skill），本插件走的是
**DSH 原生前端**路线（conversation UI 面板 + 设置页），两者互补不冲突。

## 开发环境

- DSH v0.1.1-rc.2（本地 web 实例，http://127.0.0.1:3080）
- dsh-super-injector v0.3.3（插件注入器，提供 dev_* 工具与 /super-injector/api）
- TavernWeave 仓库（与插件同级目录：`../TavernWeave`）

## 安装到 DSH

插件由 dsh-super-injector 注入运行，安装 = 两处登记 + 一个目录链接：

1. **源码目录**：`tavernweave-plugin/`（本仓库）。

2. **依赖 junction**（指向全局 DSH 内嵌的官方包，解析 `@deepseek-ai/*`）：
   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:USERPROFILE\.dsh\profiles\web\node_modules\tavernweave-workbench" `
     -Target "D:\...\tavernweave-plugin"
   ```

3. **注入器登记**：`C:\Users\WY\.dsh\super-injector\registry.json` 加入条目：
   ```json
   { "dir": "D:\\...\\tavernweave-plugin", "name": "tavernweave-workbench", "at": "<ISO时间>" }
   ```
   重启 DSH 后注入器按 registry 自动注入（host ✓ client ✓）。

4. **运行时热更**（不重启）：
   ```powershell
   Invoke-RestMethod -Method POST http://127.0.0.1:3080/super-injector/api/uninstall `
     -ContentType "application/json" -Body '{"match":"tavernweave"}'
   Invoke-RestMethod -Method POST http://127.0.0.1:3080/super-injector/api/inject `
     -ContentType "application/json" -Body '{"dir":"D:\\...\\tavernweave-plugin"}'
   ```

5. **设置**：DSH 设置 → TavernWeave 分区。工作区白名单非空时，
   侧栏底部与输入区出现「🍺 酒馆」按钮；留空则完全不显示。

## 使用

- 「🍺 酒馆」按钮 → 打开工作台面板（使用说明 / 技能状态 / 资料库 / 角色卡工坊 / 模拟酒馆）
- 面板收回：右上角「×」、点击面板外、Esc
- 使用说明页：ST / 非ST 两大阵营 × 每阵营 3 小类的口令速查，点条目复制发送内容
- 设置页：白名单、面板位置、默认人格、资料库来源、自动补全、侧栏模型

## 里程碑

- [x] M1 骨架：host/client 双面、注入链路、路由、状态工具
- [x] M2 使用说明页（两层分类）+ 设置页表单
- [ ] M2 剩余：资料库查询界面
- [ ] M3 模拟酒馆侧栏、默认人格、自动补全
- [ ] M4 打磨验收：工作区路径匹配、真实 SillyTavern 验收

## 诚实口径

所有功能标注「离线候选」：未做真实 SillyTavern 验收、未通过官方 DSH
兼容性矩阵验证。技能状态只反映本地目录存在性，不代表运行时可用。

## 许可证

PolyForm Noncommercial License 1.0.0（与 TavernWeave 上游一致）。
Required Notices：Copyright 2026 LiarMTTT（TavernWeave）、
Copyright 2026 主人（本插件代码）。完整文本见 [LICENSE](LICENSE)，
第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
