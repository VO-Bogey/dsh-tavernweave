# Third-party notices

本插件（tavernweave-workbench）自研的插件代码与文档按本仓库 LICENSE 的
PolyForm Noncommercial License 1.0.0 分发，并保留上游 Required Notice：
Copyright 2026 LiarMTTT。

插件不重新分发以下上游项目的源代码、类型声明或资产，仅以互操作方式引用
它们的包名、配置键、公开接口与本地已安装文件。

## TavernWeave

- 仓库：https://github.com/LiarMTTT/TavernWeave
- 许可：PolyForm Noncommercial License 1.0.0，Required Notice: Copyright 2026 LiarMTTT
- 本插件内置的「使用说明」口令摘录（lib/usage-guide.js）改写/摘选自
  TavernWeave docs/newbie-guide 的复制口令，属于基于 TavernWeave 的 new work，
  按 Changes and New Works License 沿用同一许可证。
- 技能状态、资料库查询等能力是「读取用户本机已安装的 TavernWeave 仓库」，
  插件本身不打包、不分发 TavernWeave 的 Skill 文件。
- 插件的 UI 入口文案（脑暴模式、Soul 口令、灵魂杀手等）同样来自 TavernWeave
  文档；「离线候选」的诚实口径沿用 TavernWeave 自身 TW Lite 的表述：未做真实
  SillyTavern / 官方 DSH 验收前，不宣称已通过任何运行时兼容性验证。

## DeepSeek Harness (DSH)

- 仓库：https://github.com/deepseek-ai/deepseek-harness
- 许可：MIT License，Copyright (c) 2026 DeepSeek
- 本插件通过 DSH 的公开插件接口（cordis loader、slots、webServer、tools）
  注册宿主工具与前端槽位；只引用官方包名与配置键做互操作，不 vendoring
  DSH 应用、包源码、预设、模型或凭据。
- DSH 当前为 Developer Preview，接口可能破坏性变更；本插件版本须与所用
  DSH 构建（本仓库开发基准：v0.1.2-alpha.2）一起声明，运行时兼容性以实测为准。

## SillyTavern

- 许可：AGPL-3.0（按其发布版本为准）
- 本插件不打包 SillyTavern 的任何代码或资产；「资料库」「技能状态」等能力
  面向用户本机安装的 SillyTavern 做导航与说明，不分发其源码、数据库或扩展。

## Soul Killer fan-reference boundary

「灵魂杀手」「强尼·银手」指向 CD PROJEKT 及其许可方的第三方虚构素材。
本插件仅转发 TavernWeave 文档中已有的口令文字，不包含游戏台词、脚本、歌词、
图像、角色形象、声音、Logo、字体、音乐、UI 截图或其他游戏资产，不冒充官方
角色或现实演员。此口径沿用 TavernWeave THIRD_PARTY_NOTICES.md 的声明。
