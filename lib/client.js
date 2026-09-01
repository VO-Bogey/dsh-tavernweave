// TavernWeave 酒馆工作台 — client 面板（M2）
// 工作区过滤（需求1）：未配置 enabledWorkspaces 时完全不显示任何入口。
// 入口：sidebar.footer.action（侧栏底部，与「设置」并排）单入口。
// 设置页：settings.section（DSH 设置 → TavernWeave）。

window.__ModuleLoader__.load({
  id: "tavernweave-workbench",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let reactDom = require("react-dom");

    // DSH 0.1.2：工作区可见性需要显式注入这两个客户端服务。
    const inject = ["slots", "sessions", "workspaces", "inputTriggers"];

    // ---------- 工作区可见性（模块级单例：两个入口按钮共享一份轮询） ----------
    let settingsCache = null;
    let visibleListeners = [];
    let visibleValue = false;
    let pollTimer = null;
    let workspaceServices = null;

    function notifyVisible() {
      visibleListeners.forEach((fn) => { try { fn(visibleValue); } catch (e) {} });
    }

    function refreshSettings() {
      fetch("/tavernweave/settings").then((r) => {
        if (!r.ok) throw new Error("settings request failed");
        return r.json();
      }).then((s) => {
        announceSettings(s);
      }).catch(() => {});
    }

    function announceSettings(s, broadcast = true) {
      settingsCache = s;
      const v = isWorkspaceAllowed(s);
      if (v !== visibleValue) { visibleValue = v; notifyVisible(); }
      if (broadcast) {
        try { window.dispatchEvent(new CustomEvent("tavernweave:settings-updated", { detail: s })); } catch (e) {}
      }
    }

    function normalizeWorkspacePath(value) {
      if (typeof value !== "string" || !value.trim()) return "";
      let path = value.trim().replace(/[\\/]+/g, "\\").replace(/\\+$/, "");
      if (/^[A-Za-z]:$/.test(path)) path += "\\";
      return path.toLowerCase();
    }

    function currentWorkspacePath() {
      try {
        if (!workspaceServices) return "";
        const sessionState = workspaceServices.sessions?.list?.getSnapshot?.();
        const currentId = sessionState?.current
          || workspaceServices.sessions?.current
          || workspaceServices.sessions?.selection?.getSnapshot?.()?.sessionId
          || "";
        const currentKey = currentId === "" ? "" : String(currentId);
        const byId = sessionState?.byId || {};
        const rows = Array.isArray(sessionState) ? sessionState : (sessionState?.items || sessionState?.rows || []);
        const row = currentKey ? (byId[currentId] || byId[currentKey] || rows.find((item) => String(item.sessionId || item.id || "") === currentKey)) : null;
        const workspaces = workspaceServices.workspaces?.list?.getSnapshot?.() || {};
        const items = Array.isArray(workspaces) ? workspaces : (workspaces.items || []);
        const selectedId = workspaces.currentWorkspaceId || workspaces.selectedWorkspaceId || workspaces.current || workspaces.recentWorkspaceId
          || workspaceServices.workspaces?.currentWorkspaceId || workspaceServices.workspaces?.selectedWorkspaceId;
        const selectedKey = selectedId === undefined || selectedId === null ? "" : String(selectedId);
        const selected = selectedKey ? items.find((item) => String(item.workspaceId || item.id || "") === selectedKey) : null;
        const rowWorkspaceKey = row?.workspaceId === undefined || row?.workspaceId === null ? "" : String(row.workspaceId);
        const owned = currentKey ? items.find((item) => (item.sessionIds || []).some((id) => String(id) === currentKey)) : null;
        const ownedByRow = rowWorkspaceKey ? items.find((item) => String(item.workspaceId || item.id || "") === rowWorkspaceKey) : null;
        return normalizeWorkspacePath(selected?.path || owned?.path || ownedByRow?.path || row?.workspacePath || row?.cwd || "");
      } catch (e) { return ""; }
    }

    function currentAgentPreset() {
      try {
        const sessionState = workspaceServices?.sessions?.list?.getSnapshot?.();
        const currentId = sessionState?.current;
        const row = sessionState?.byId?.[currentId] || (sessionState?.items || []).find((item) => item.sessionId === currentId);
        return row?.projections?.values?.agentPreset || row?.agentPreset || "";
      } catch (e) { return ""; }
    }

    function currentSessionId() {
      try { return String(workspaceServices?.sessions?.list?.getSnapshot?.()?.current || ""); } catch (e) { return ""; }
    }

    function useCurrentAgentPreset() {
      const [preset, setPreset] = react.useState(currentAgentPreset());
      react.useEffect(() => {
        const update = () => setPreset(currentAgentPreset());
        window.addEventListener("tavernweave:session-updated", update);
        update();
        return () => window.removeEventListener("tavernweave:session-updated", update);
      }, []);
      return preset;
    }

    function isWorkspaceAllowed(s) {
      const enabled = (s && s.enabledWorkspaces || []).map(normalizeWorkspacePath).filter(Boolean);
      return enabled.length > 0 && enabled.includes(currentWorkspacePath());
    }

    function announceWorkspaceContext() {
      const v = isWorkspaceAllowed(settingsCache || {});
      if (v !== visibleValue) { visibleValue = v; notifyVisible(); }
    }

    function startPolling() {
      if (pollTimer) return;
      refreshSettings();
      pollTimer = setInterval(refreshSettings, 5000);
    }

    function stopPolling() {
      if (!pollTimer) return;
      clearInterval(pollTimer);
      pollTimer = null;
    }

    function useVisible() {
      const [visible, setVisible] = react.useState(visibleValue);
      react.useEffect(() => {
        const onSettings = (e) => {
          const s = e && e.detail;
          // 广播事件只需更新本地快照；再次广播会递归触发自身。
          if (s && typeof s === "object") announceSettings(s, false);
        };
        window.addEventListener("tavernweave:settings-updated", onSettings);
        window.addEventListener("tavernweave:workspace-updated", announceWorkspaceContext);
        visibleListeners.push(setVisible);
        if (visibleListeners.length === 1) startPolling();
        return () => {
          window.removeEventListener("tavernweave:settings-updated", onSettings);
          window.removeEventListener("tavernweave:workspace-updated", announceWorkspaceContext);
          visibleListeners = visibleListeners.filter((f) => f !== setVisible);
          if (visibleListeners.length === 0) stopPolling();
        };
      }, []);
      return visible;
    }

    // ---------- 面板开合（模块级单例：两个入口按钮共享开关，不会双开） ----------
    let openListeners = [];
    let openValue = false;
    let updateListeners = [];
    let updateState = { checkedAt: "", targets: [], hasUpdate: false };

    function announceUpdateState(next) {
      updateState = next || { checkedAt: "", targets: [], hasUpdate: false };
      updateListeners.forEach((fn) => { try { fn(updateState); } catch (e) {} });
      try { window.dispatchEvent(new CustomEvent("tavernweave:update-state", { detail: updateState })); } catch (e) {}
    }

    function useUpdateState() {
      const [state, setState] = react.useState(updateState);
      react.useEffect(() => {
        updateListeners.push(setState);
        return () => { updateListeners = updateListeners.filter((fn) => fn !== setState); };
      }, []);
      return state;
    }

    function checkForUpdates() {
      return fetch("/tavernweave/update/check").then((r) => { if (!r.ok) throw new Error("update check failed"); return r.json(); }).then((data) => {
        const hasUpdate = (data.targets || []).some((item) => item.state === "update-available");
        const next = { ...data, hasUpdate };
        announceUpdateState(next);
        return next;
      });
    }

    function setPanelOpen(v) {
      openValue = v;
      openListeners.forEach((fn) => { try { fn(openValue); } catch (e) {} });
    }

    function usePanelOpen() {
      const [open, setOpen] = react.useState(openValue);
      react.useEffect(() => {
        openListeners.push(setOpen);
        return () => { openListeners = openListeners.filter((f) => f !== setOpen); };
      }, []);
      return [open, setPanelOpen];
    }

    // ---------- 样式（完全继承 DSH 的主题语义色） ----------
    const btn = { fontSize: "13px", minHeight: "34px", padding: "5px 10px", borderRadius: "9px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-interactive-bg-hover)", color: "var(--dsw-alias-label-secondary)", cursor: "pointer", lineHeight: 1.25 };
    const primaryBtn = { ...btn, border: "1px solid var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-primary)", background: "var(--dsw-specific-tip)", boxShadow: "var(--dsw-shadow-lv2)" };
    const TAB_TONE = {
      usage: { accent: "#65d2ff", soft: "rgba(70, 186, 255, 0.15)" },
      skills: { accent: "#bca4ff", soft: "rgba(159, 119, 255, 0.14)" },
      library: { accent: "#efc47c", soft: "rgba(235, 176, 82, 0.14)" },
      workshop: { accent: "#74e0b2", soft: "rgba(86, 205, 151, 0.14)" },
      updates: { accent: "#ef8e62", soft: "rgba(239, 142, 98, 0.14)" },
    };
    // 来自原作者公开 Soul 口令的可操作索引；长口令也保留，避免只剩一句口号。
    const SOUL_PERSONAS = [
      { id: "atong", name: "阿瞳", glyph: "瞳", tone: "#74e0b2", hint: "温柔指导", commands: [
        ["呼叫阿瞳", "阿瞳助我！"],
        ["交给阿瞳", "阿瞳接手"],
      ] },
      { id: "mttt", name: "MTTT.sir", glyph: "MT", tone: "#bca4ff", hint: "严格学习", commands: [
        ["请 MTTT 拷打", "MTTT.sir，拷打我！"],
        ["开始上课", "MTTT.sir 上课"],
      ] },
      { id: "soulkiller", name: "灵魂杀手", glyph: "✦", tone: "#f39ab7", hint: "前端审查", commands: [
        ["呼叫灵魂杀手", "灵魂杀手！"],
        ["强尼接管", "强尼·银手，接管！"],
        ["前端审查", "灵魂杀手！\n检查这个前端的视觉层级、中文排版、配色、动效目的和 390px 窄屏表现。可以直说，但每个问题都要给证据、影响、修法和复验方式。"],
      ] },
    ];
    // 面板用 portal 挂到 document.body，fixed 定位到视口，避开侧栏列 overflow:hidden 裁剪
    const panelStyle = { position: "fixed", bottom: "76px", width: "min(520px, calc(100vw - 24px))", maxHeight: "min(700px, calc(100dvh - 112px))", overflow: "hidden", borderRadius: "18px", background: "var(--dsw-specific-menu, var(--dsw-specific-input-major, var(--dsw-alias-bg-base)))", border: "1px solid var(--dsw-alias-border-inverted)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", zIndex: 999, boxShadow: "var(--dsw-shadow-lv3)", backdropFilter: "blur(14px) saturate(1.08)", WebkitBackdropFilter: "blur(14px) saturate(1.08)" };
    const panelBodyStyle = { position: "relative", zIndex: 1, maxHeight: "min(700px, calc(100dvh - 112px))", overflowY: "auto", boxSizing: "border-box", padding: "17px", scrollbarWidth: "thin" };
    const panelSide = () => (settingsCache && settingsCache.panelPosition === "left") ? { left: "24px" } : { right: "24px" };

    // ---------- 主面板入口（composer dock 小按钮） ----------
    function TavernButton() {
      const visible = useVisible();
      const [open, setOpen] = usePanelOpen();
      const updates = useUpdateState();
      react.useEffect(() => { if (visible) checkForUpdates().catch(() => {}); }, [visible]);
      if (!visible) return null;
      const close = () => setOpen(false);
      return react.createElement("div", { style: { position: "relative" } },
        react.createElement("span", { style: { position: "relative", display: "inline-flex" } },
          react.createElement("button", { type: "button", style: { ...primaryBtn, minHeight: "38px", padding: "5px 11px" }, title: updates.hasUpdate ? "发现 TavernWeave 更新，点击查看" : "TavernWeave 酒馆工作台", onClick: () => setOpen(!open) }, "✦ 酒馆"),
          updates.hasUpdate && react.createElement("span", { style: { position: "absolute", right: "-7px", top: "-9px", padding: "2px 6px", borderRadius: "999px", background: "#ef8e62", color: "#28150e", fontSize: "10px", fontWeight: 800, boxShadow: "0 3px 12px rgba(239,142,98,.35)", pointerEvents: "none" } }, "有新更新")),
        open && reactDom.createPortal(react.createElement("div", null,
          react.createElement("div", { onClick: close, style: { position: "fixed", inset: 0, zIndex: 998, background: "transparent" } }),
          react.createElement(WorkbenchPanel, { onClose: close })
        ), document.body)
      );
    }

    // ---------- 主面板（口令、技能、资料与制卡项目） ----------
    function WorkbenchPanel(props) {
      const [tab, setTab] = react.useState("usage");
      const [usage, setUsage] = react.useState(null);
      const [hint, setHint] = react.useState("");
      const updates = useUpdateState();
      react.useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") props.onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, []);
      react.useEffect(() => {
        fetch("/tavernweave/usage").then((r) => r.json()).then((j) => setUsage(j.camps || [])).catch(() => setUsage([]));
      }, []);
      const tabs = [["usage", "口令速查"], ["skills", "技能状态"], ["library", "资料库"], ["workshop", "制卡工作台"], ["updates", "更新"]];
      const tone = TAB_TONE[tab];
      const personaLabel = { none: "默认人格", atong: "阿瞳", mttt: "MTTT.sir", soulkiller: "灵魂杀手" }[(settingsCache && settingsCache.defaultPersona) || "none"];
      return react.createElement("div", { role: "dialog", "aria-label": "TavernWeave 酒馆工作台", style: { ...panelStyle, ...panelSide() } },
        react.createElement("div", { "aria-hidden": true, style: { position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.4, backgroundImage: "linear-gradient(rgba(130, 204, 255, 0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(130, 204, 255, 0.045) 1px, transparent 1px), radial-gradient(circle at 88% 0%, " + tone.soft + ", transparent 34%)", backgroundSize: "22px 22px, 22px 22px, auto" } }),
        react.createElement("div", { style: panelBodyStyle },
        react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "15px" } },
            react.createElement("div", null,
            react.createElement("div", { style: { display: "inline-flex", alignItems: "center", gap: "6px", color: tone.accent, fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", marginBottom: "5px" } },
              react.createElement("span", { style: { width: "6px", height: "6px", borderRadius: "50%", background: tone.accent, boxShadow: "0 0 12px " + tone.accent } }), "TAVERNWEAVE / WORKBENCH"),
            react.createElement("strong", { style: { display: "block", fontSize: "19px", letterSpacing: "0.01em" } }, "酒馆工作台"),
            react.createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginTop: "4px" } }, "把创作流程、技能与资料沉到一处。 · 当前人格：" + personaLabel)),
          react.createElement("div", { style: { display: "flex", gap: "6px" } },
            react.createElement("button", { type: "button", style: { ...btn, width: "36px", padding: 0 }, title: "打开设置说明", "aria-label": "打开设置说明", onClick: () => setHint("设置入口：DSH 左下角「设置」→ TavernWeave 分区") }, "⚙"),
            react.createElement("button", { type: "button", style: { ...btn, width: "36px", padding: 0 }, title: "关闭工作台", "aria-label": "关闭工作台", onClick: props.onClose }, "×"))),
        updates.hasUpdate && react.createElement("div", { role: "status", style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", padding: "9px 10px", borderRadius: "10px", border: "1px solid rgba(239,142,98,.35)", background: "rgba(239,142,98,.12)", color: "var(--dsw-alias-label-primary)" } },
          react.createElement("strong", null, "TavernWeave 有新更新"),
          react.createElement("button", { type: "button", style: { ...btn, minHeight: "27px", padding: "3px 8px", marginLeft: "auto", color: "#ffd2bf", borderColor: "rgba(239,142,98,.45)" }, onClick: () => setTab("updates") }, "查看更新")),
        hint && react.createElement("div", { role: "status", "aria-live": "polite", style: { fontSize: "12px", color: "#f0c879", marginBottom: "10px", padding: "8px 10px", borderRadius: "9px", border: "1px solid rgba(240, 200, 121, 0.22)", background: "rgba(176, 130, 44, 0.12)" } }, hint),
        react.createElement("div", { role: "tablist", style: { display: "flex", gap: "5px", padding: "5px", borderRadius: "12px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-module-platform)", marginBottom: "14px" } },
          tabs.map(([id, label]) => { const itemTone = TAB_TONE[id]; return react.createElement("button", { key: id, type: "button", role: "tab", "aria-selected": tab === id, style: { ...btn, flex: 1, minWidth: 0, border: tab === id ? "1px solid " + itemTone.accent + "66" : "1px solid transparent", background: tab === id ? itemTone.soft : "transparent", color: tab === id ? itemTone.accent : "var(--dsw-alias-label-tertiary)", fontWeight: tab === id ? 700 : 500, boxShadow: tab === id ? "0 5px 16px " + itemTone.soft : "none" }, onClick: () => { setTab(id); setHint(""); } }, label); })),
        react.createElement("div", { style: { padding: "12px", borderRadius: "13px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-specific-input-major)" } },
          tab === "usage" && react.createElement(UsageTab, { usage }),
          tab === "skills" && react.createElement(SkillsTab, { status: null, fetchStatus: true }),
          tab === "library" && react.createElement(LibraryTab),
          tab === "workshop" && react.createElement(WorkshopTab),
          tab === "updates" && react.createElement(UpdateTab, { state: updates })
        ))
      );
    }

    function SoulPersonaPicker({ input, inputActions, onNotice }) {
      const [selected, setSelected] = react.useState((settingsCache && settingsCache.defaultPersona) || "atong");
      const [hovered, setHovered] = react.useState(null);
      react.useEffect(() => {
        const onSettings = (e) => {
          const next = e && e.detail && e.detail.defaultPersona;
          if (next && SOUL_PERSONAS.some((item) => item.id === next)) setSelected(next);
        };
        window.addEventListener("tavernweave:settings-updated", onSettings);
        return () => window.removeEventListener("tavernweave:settings-updated", onSettings);
      }, []);
      const choose = (persona, command = persona.commands[0][1]) => {
        setSelected(persona.id);
        const text = command;
        if (!inputActions || typeof inputActions.setDraft !== "function") {
          onNotice("当前会话输入接口不可用，请在口令速查中手动使用 Soul 口令。");
          return;
        }
        const current = typeof input?.draft === "string" ? input.draft.trimEnd() : "";
        inputActions.setDraft(current ? current + "\n\n" + text : text);
        const next = { ...(settingsCache || {}), defaultPersona: persona.id };
        announceSettings(next);
        fetch("/tavernweave/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) }).catch(() => {});
        onNotice(persona.name + "已就位，Soul 口令已插入输入框。可继续编辑后发送。\n" + text);
      };
      return react.createElement("div", { style: { display: "inline-flex", alignItems: "center", gap: "5px", marginLeft: "4px" }, "aria-label": "Soul 人格选择" },
        react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", marginRight: "2px" } }, "Soul"),
        SOUL_PERSONAS.map((persona) => {
          const active = selected === persona.id;
          return react.createElement("span", { key: persona.id, style: { position: "relative", display: "inline-flex" },
            onMouseEnter: () => setHovered(persona.id), onMouseLeave: () => setHovered(null) },
            react.createElement("button", { type: "button", "aria-label": persona.name + "：" + persona.commands[0][1], "aria-pressed": active, title: persona.name + " · " + persona.hint + "（悬停选择口令）", onClick: () => choose(persona), style: { width: "30px", height: "30px", padding: 0, borderRadius: "50%", border: active ? "2px solid " + persona.tone : "1px solid var(--dsw-alias-border-l2)", background: active ? persona.tone + "2b" : "var(--dsw-alias-bg-module-platform)", color: active ? persona.tone : "var(--dsw-alias-label-secondary)", fontSize: persona.id === "mttt" ? "9px" : "13px", fontWeight: 700, cursor: "pointer", boxShadow: active ? "0 0 12px " + persona.tone + "55" : "none" } }, persona.glyph),
            hovered === persona.id && react.createElement("div", { role: "tooltip", style: { position: "absolute", zIndex: 1001, left: "50%", top: "calc(100% + 7px)", transform: "translateX(-50%)", width: "min(270px, calc(100vw - 30px))", maxHeight: "min(320px, 45dvh)", overflowY: "auto", padding: "7px", borderRadius: "10px", border: "1px solid " + persona.tone + "55", background: "var(--dsw-specific-menu, var(--dsw-alias-bg-base))", color: "var(--dsw-alias-label-primary)", boxShadow: "var(--dsw-shadow-lv2)", fontSize: "11px", lineHeight: 1.35, pointerEvents: "auto" } },
              react.createElement("div", { style: { color: persona.tone, fontWeight: 700, marginBottom: "5px" } }, persona.name + " · " + persona.hint),
              react.createElement("div", { style: { display: "grid", gap: "4px" } }, persona.commands.map(([label, command]) => react.createElement("button", { key: label, type: "button", onClick: () => choose(persona, command), title: command, style: { width: "100%", padding: "6px 7px", borderRadius: "7px", border: "1px solid " + persona.tone + "40", background: persona.tone + "12", color: "var(--dsw-alias-label-primary)", textAlign: "left", cursor: "pointer", whiteSpace: "pre-line", lineHeight: 1.35 } }, react.createElement("strong", { style: { display: "block", color: persona.tone, marginBottom: "2px" } }, label), command)))
            ));
        })
      );
    }

    // 会话主入口：放在输入框下方，悬浮窗只负责深度盘点与资料辅助。
    function ConversationDock({ useInput, inputActions }) {
      const input = typeof useInput === "function" ? useInput((state) => state) : { draft: "" };
      const visible = useVisible();
      const [notice, setNotice] = react.useState("");
      const agentPreset = useCurrentAgentPreset();
      const nativeRuntime = agentPreset === "tavernweave-native";
      if (!visible) return null;
      const prompt = (kind) => kind === "new"
        ? "我要从零制作一张 SillyTavern 角色卡。请先按 TavernWeave 流程访谈玩法、叙事目标、卡片类型、变量、世界书、开场和运行时依赖；先给出目标/红线/验收和简短合同，不要直接写文件。"
        : "我要改造一张已有的 SillyTavern 角色卡。请先读取我提供的 JSON/PNG，保留只读快照并记录哈希，盘点卡型、世界书、正则、变量、Tavern Helper、开场和宿主依赖；先说明边界与风险，不要覆盖原卡。";
      const insert = (kind) => {
        const text = prompt(kind);
        if (!inputActions || typeof inputActions.setDraft !== "function") {
          setNotice("当前会话输入接口不可用，请直接使用悬浮工坊。");
          return;
        }
        const current = typeof input?.draft === "string" ? input.draft.trimEnd() : "";
        inputActions.setDraft(current ? current + "\n\n" + text : text);
        setNotice("指令已插入当前对话输入框，可继续编辑后发送。");
      };
      return react.createElement("div", { style: { position: "relative", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "7px", padding: "7px 9px", marginTop: "6px", borderRadius: "10px", border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", fontSize: "12px", width: "100%", boxSizing: "border-box" } },
        react.createElement("span", { style: { color: "#74e0b2", fontWeight: 700 } }, "✦ 制卡"),
        react.createElement("span", { style: { color: nativeRuntime ? "#74e0b2" : "#f0c879", marginRight: "auto", fontSize: "11px" }, title: nativeRuntime ? "DSH 已向本会话注入 TavernWeave 的 20 个 Skill 与 Host Front Door。" : "此会话不是 TavernWeave 原生工坊；现有会话产生内容后不能更换预设。" }, nativeRuntime ? "原生工坊已启用 · 20 Skills" : "未使用原生工坊"),
        !nativeRuntime && react.createElement("button", { type: "button", style: { ...btn, minHeight: "26px", padding: "2px 7px", color: "#f0c879", fontSize: "11px" }, onClick: () => setNotice("请新建会话，在输入区旁的 DSH「Agent Preset」选择 TavernWeave 原生工坊；已有内容的会话不能切换。") }, "如何启用"),
        react.createElement(SoulPersonaPicker, { input, inputActions, onNotice: setNotice }),
        react.createElement("button", { type: "button", style: { ...btn, minHeight: "28px", padding: "3px 8px" }, onClick: () => insert("new") }, "从零写卡"),
        react.createElement("button", { type: "button", style: { ...btn, minHeight: "28px", padding: "3px 8px" }, onClick: () => insert("retrofit") }, "改造旧卡"),
        react.createElement("button", { type: "button", style: { ...primaryBtn, minHeight: "28px", padding: "3px 8px" }, onClick: () => setPanelOpen(true) }, "打开工坊"),
        notice && react.createElement("span", { role: "status", style: { position: "absolute", marginTop: "54px", color: "var(--dsw-alias-state-success-primary)", fontSize: "11px" } }, notice));
    }

    const conversationDockEntry = {
      name: "tavernweave-conversation-dock",
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
          name: "conversation.composer.dock",
          id: "tavernweave-conversation-dock",
          order: 80,
        }, ConversationDock));
      },
    };

    // ---------- 使用说明（两层分类：阵营 → 小类 → 口令） ----------
    const CAMP_ACCENT = { st: "#65d2ff", vibe: "#eeae7a" };

    function copyText(text) {
      const fallback = () => {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          const copied = document.execCommand("copy");
          document.body.removeChild(ta);
          return copied;
        } catch (e) { return false; }
      };
      try {
        return navigator.clipboard.writeText(text).then(() => true).catch(fallback);
      } catch (e) {
        return Promise.resolve(fallback());
      }
    }

    function UsageCamp({ camp, expanded, onToggle, copiedKey, onCopy }) {
      const accent = CAMP_ACCENT[camp.camp];
      const header = react.createElement("button", { type: "button", "aria-expanded": expanded, onClick: onToggle, style: { width: "100%", minHeight: "42px", textAlign: "left", background: expanded ? "linear-gradient(90deg, " + accent + "1f, transparent)" : "rgba(255,255,255,0.025)", border: "1px solid " + accent + (expanded ? "38" : "18"), padding: "8px 10px", borderRadius: "10px", cursor: "pointer" } },
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
          react.createElement("span", { style: { width: "8px", height: "8px", borderRadius: "50%", background: CAMP_ACCENT[camp.camp], flexShrink: 0, opacity: 0.9 } }),
          react.createElement("strong", { style: { fontSize: "14px", color: "var(--dsw-alias-label-primary)" } }, camp.campLabel),
          react.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginLeft: "auto", marginRight: "4px" } }, camp.memo),
          react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "13px" } }, expanded ? "▾" : "▸")),
        !expanded && react.createElement("div", { style: { paddingLeft: "24px", marginTop: "2px" } },
          react.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" } }, camp.groups.map((g) => g.label).join(" · ")))
      );
      const body = expanded && react.createElement("div", { style: { paddingTop: "8px" } },
        camp.groups.map((group) => react.createElement("div", { key: group.label, style: { marginBottom: "8px" } },
          react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px", padding: "0 10px" } },
            react.createElement("span", { style: { fontSize: "12px", color: CAMP_ACCENT[camp.camp], fontWeight: 500, flexShrink: 0 } }, group.label),
            react.createElement("span", { style: { flex: 1, height: "1px", background: "var(--dsw-alias-border-l1)" } })),
          group.items.map((u) => react.createElement("div", { key: u.scene, style: { border: "1px solid rgba(187, 210, 236, 0.12)", borderLeft: "2px solid " + accent, borderRadius: "9px", padding: "9px 10px", marginBottom: "6px", background: "rgba(6, 12, 22, 0.2)" } },
            react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" } },
              react.createElement("strong", { style: { fontSize: "13px", color: "var(--dsw-alias-label-primary)" } }, u.scene),
              react.createElement("button", { type: "button", style: { ...btn, minHeight: "28px", padding: "2px 8px", fontSize: "12px", border: "1px solid " + accent + "55", color: copiedKey === camp.camp + ":" + u.scene ? "#9ee7bd" : accent, background: copiedKey === camp.camp + ":" + u.scene ? "rgba(84, 193, 129, 0.12)" : "transparent" }, title: "复制发送内容", onClick: () => onCopy(camp.camp + ":" + u.scene, u.send) }, copiedKey === camp.camp + ":" + u.scene ? "已复制" : "复制")),
            react.createElement("div", { style: { fontFamily: "monospace", fontSize: "12px", whiteSpace: "pre-wrap", color: "var(--dsw-alias-label-secondary)", marginBottom: "3px" } }, u.send.length > 120 ? u.send.slice(0, 120) + "…" : u.send),
            u.detail && react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" } }, u.detail))))
        )
      );
      return react.createElement("div", { style: { marginBottom: "10px" } }, header, body);
    }

    function UsageTab({ usage }) {
      const [open, setOpen] = react.useState({ st: true, vibe: false });
      const [copiedKey, setCopiedKey] = react.useState("");
      const copyItem = (key, text) => {
        copyText(text).then((ok) => setCopiedKey(ok ? key : ""));
      };
      if (!usage) return react.createElement("div", null, "读取中…");
      if (usage.length === 0) return react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "未取得使用说明数据。");
      return react.createElement("div", null,
        react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", marginBottom: "8px" } }, "源自官方 newbie-guide 的可复制口令。点击复制后，按需要粘贴到对话输入框。"),
        usage.map((camp) => react.createElement(UsageCamp, { key: camp.camp, camp, expanded: open[camp.camp], copiedKey, onCopy: copyItem, onToggle: () => setOpen((o) => ({ ...o, [camp.camp]: !o[camp.camp] })) }))
      );
    }

    function SkillsTab({ status, fetchStatus }) {
      const [st, setSt] = react.useState(status);
      react.useEffect(() => {
        if (!fetchStatus) return undefined;
        let cancelled = false;
        const load = () => fetch("/tavernweave/skills?sessionId=" + encodeURIComponent(currentSessionId())).then((r) => r.json()).then((data) => { if (!cancelled) setSt(data); }).catch(() => {});
        load();
        const timer = setInterval(load, 1800);
        const onSession = () => load();
        window.addEventListener("tavernweave:session-updated", onSession);
        return () => { cancelled = true; clearInterval(timer); window.removeEventListener("tavernweave:session-updated", onSession); };
      }, [fetchStatus]);
      if (!st) return react.createElement("div", null, "读取中…");
      if (st.total === 0) return react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "未找到 TavernWeave 技能目录。请确认仓库位置或安装技能。");
      return react.createElement("div", null,
        react.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px", marginBottom: "10px", borderRadius: "10px", border: "1px solid rgba(161, 135, 255, 0.22)", background: "linear-gradient(135deg, rgba(159, 119, 255, 0.14), rgba(255,255,255,0.02))" } },
          react.createElement("div", null,
            react.createElement("div", { style: { fontSize: "11px", color: "rgba(220, 232, 245, 0.66)", marginBottom: "2px" } }, "当前会话可用 / 已加载"),
            react.createElement("strong", { style: { fontSize: "20px", color: "#d2c2ff" } }, (st.availableCount ?? st.installed) + " / " + (st.activeCount ?? 0))),
          react.createElement("div", { style: { textAlign: "right", fontSize: "12px", color: st.missing.length ? "#f0c879" : "#9ee7bd" } }, st.missing.length ? "有缺失项" : "目录完整")),
        st.missing.length > 0 && react.createElement("div", { style: { color: "#f0c879", fontSize: "12px", marginBottom: "8px" } }, "缺失：" + st.missing.join("、")),
        react.createElement("div", { style: { color: "rgba(220, 232, 245, 0.58)", fontSize: "12px", marginBottom: "8px" } }, st.note || "可用来自目录；已加载来自本会话实际 skill 工具调用。"),
        react.createElement("div", { style: { marginBottom: "8px", padding: "9px", borderRadius: "9px", border: "1px solid rgba(103, 214, 166, 0.2)", background: "rgba(52, 165, 116, 0.08)" } },
          react.createElement("strong", { style: { display: "block", color: "#9ee7bd", marginBottom: "5px" } }, "本会话已加载"),
          st.activeCount ? st.active.join(" · ") : "尚未观察到 skill 工具调用；模型需要该能力时会按需加载。"),
        react.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "6px" } },
          st.skills.map((s) => react.createElement("div", { key: s.name, style: { display: "flex", minWidth: 0, alignItems: "center", gap: "7px", padding: "7px 8px", borderRadius: "8px", border: "1px solid " + (s.ok ? "rgba(103, 214, 166, 0.17)" : "rgba(240, 150, 135, 0.22)"), background: s.ok ? "rgba(52, 165, 116, 0.08)" : "rgba(188, 73, 63, 0.1)" } },
            react.createElement("span", { style: { color: s.ok ? "#9ee7bd" : "#ffaaa0" } }, s.ok ? "✓" : "✗"),
            react.createElement("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: "12px" } }, s.name))))
      );
    }

    function LibraryTab() {
      const [query, setQuery] = react.useState("");
      const [result, setResult] = react.useState(null);
      const [selected, setSelected] = react.useState(null);
      const [message, setMessage] = react.useState("");
      const search = (event) => {
        event.preventDefault();
        const q = query.trim();
        if (!q) { setResult({ results: [], note: "请输入关键词后搜索资料库。" }); return; }
        setMessage("搜索中…");
        setSelected(null);
        fetch("/tavernweave/library/search?q=" + encodeURIComponent(q))
          .then((r) => { if (!r.ok) throw new Error("search request failed"); return r.json(); })
          .then((data) => { setResult(data); setMessage(data.error || data.note || (data.results.length ? "" : "没有找到相关资料。")); })
          .catch(() => setMessage("资料库暂时不可用。"));
      };
      const openDoc = (item) => {
        setMessage("读取条目…");
        fetch("/tavernweave/library/doc?domain=" + encodeURIComponent(item.domain) + "&file=" + encodeURIComponent(item.file))
          .then((r) => { if (!r.ok) throw new Error("document request failed"); return r.json(); })
          .then((data) => {
            if (data.error) throw new Error(data.error);
            setSelected({ title: item.title, content: data.content });
            setMessage("");
          }).catch(() => setMessage("无法读取该条目。"));
      };
      const input = { flex: 1, minWidth: 0, boxSizing: "border-box", padding: "7px 9px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px" };
      return react.createElement("div", null,
        react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", marginBottom: "8px" } }, "按标题与正文检索本地 TavernWeave 资料；结果仅供离线参考。"),
        react.createElement("form", { onSubmit: search, style: { display: "flex", gap: "6px", marginBottom: "10px" } },
          react.createElement("input", { style: input, value: query, placeholder: "例如：正则、MVU、世界书", "aria-label": "搜索资料库", onChange: (e) => setQuery(e.target.value) }),
          react.createElement("button", { type: "submit", style: primaryBtn }, "搜索")),
        message && react.createElement("div", { role: "status", style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginBottom: "8px" } }, message),
        result && result.results.map((item) => react.createElement("button", { key: item.domain + ":" + item.file, type: "button", onClick: () => openDoc(item), style: { display: "block", width: "100%", textAlign: "left", cursor: "pointer", padding: "9px 10px", marginBottom: "6px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l1)", background: "transparent", color: "var(--dsw-alias-label-primary)" } },
          react.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "3px" } },
            react.createElement("strong", { style: { fontSize: "13px" } }, item.title),
            react.createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary)" } }, item.domain)),
          item.excerpt && react.createElement("div", { style: { fontSize: "12px", lineHeight: 1.45, color: "var(--dsw-alias-label-tertiary)" } }, item.excerpt))),
        selected && react.createElement("section", { style: { marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--dsw-alias-border-l1)" } },
          react.createElement("strong", { style: { fontSize: "13px" } }, selected.title),
          react.createElement("pre", { style: { margin: "7px 0 0", maxHeight: "260px", overflow: "auto", padding: "9px", borderRadius: "8px", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-secondary)", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "12px", lineHeight: 1.5 } }, selected.content))
      );
    }

    function UpdateTab({ state }) {
      const [busy, setBusy] = react.useState("");
      const [message, setMessage] = react.useState("");
      const refresh = () => { setMessage("检查中…"); checkForUpdates().then(() => setMessage("检查完成")).catch(() => setMessage("无法连接远端仓库，请稍后重试。")); };
      const apply = (target) => {
        setBusy(target); setMessage("正在安全更新…");
        fetch("/tavernweave/update/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target }) }).then((r) => r.json()).then((data) => {
          setMessage(data.message || (data.ok ? "更新完成" : "更新未执行"));
          if (data.ok) return checkForUpdates();
          return data;
        }).catch(() => setMessage("更新失败，请检查网络与本地仓库状态。" )).finally(() => setBusy(""));
      };
      return react.createElement("div", null,
        react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px" } },
          react.createElement("div", null, react.createElement("strong", { style: { fontSize: "15px" } }, "更新中心"), react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", marginTop: "3px" } }, "检查并更新 TavernWeave DSH 插件。资料库随原作者更新。")),
          react.createElement("button", { type: "button", style: primaryBtn, onClick: refresh, disabled: !!busy }, "检查更新")),
        message && react.createElement("div", { role: "status", "aria-live": "polite", style: { marginBottom: "8px", color: "var(--dsw-alias-label-secondary)", fontSize: "12px" } }, message),
        (state.targets || []).map((item) => react.createElement("div", { key: item.id, style: { padding: "10px", marginBottom: "7px", borderRadius: "10px", border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-module-platform)" } },
          react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
            react.createElement("strong", null, item.label),
            react.createElement("span", { style: { marginLeft: "auto", fontSize: "11px", color: item.state === "update-available" ? "#f0c879" : item.state === "up-to-date" ? "#9ee7bd" : "#ffaaa0" } }, item.state === "update-available" ? "有新版本" : item.state === "up-to-date" ? "已是最新" : item.state === "diverged" ? "本地与远端已分叉" : item.state === "dirty" ? "有未提交改动" : item.state)),
          item.changes && item.changes.length > 0 && react.createElement("div", { style: { marginTop: "6px", color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", whiteSpace: "pre-wrap" } }, item.changes.join("\n")),
          item.error && react.createElement("div", { style: { marginTop: "5px", color: "#ffaaa0", fontSize: "11px" } }, item.error),
          item.state === "update-available" && react.createElement("button", { type: "button", style: { ...btn, marginTop: "7px", color: "#ffd2bf", borderColor: "rgba(239,142,98,.45)" }, disabled: !!busy, onClick: () => apply(item.id) }, busy === item.id ? "更新中…" : "一键安全更新"))),
        react.createElement("div", { style: { marginTop: "10px", color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", lineHeight: 1.5 } }, "更新插件代码后通常需要重新加载 DSH 插件；资料库随原作者更新，不会覆盖您的角色卡项目。"));
    }

    function WorkshopTab() {
      const [text, setText] = react.useState("");
      const [fileName, setFileName] = react.useState("");
      const [analysis, setAnalysis] = react.useState(null);
      const [baseline, setBaseline] = react.useState("");
      const [componentId, setComponentId] = react.useState("description");
      const [componentValue, setComponentValue] = react.useState("");
      const [workflowMessage, setWorkflowMessage] = react.useState("");
      const [message, setMessage] = react.useState("");
      const [projects, setProjects] = react.useState([]);
      const [projectId, setProjectId] = react.useState("");
      const [versionDraft, setVersionDraft] = react.useState("0.1.0");
      const tone = TAB_TONE.workshop;
      const loadProjects = () => fetch("/tavernweave/cards").then((r) => r.json()).then((data) => setProjects(Array.isArray(data.projects) ? data.projects : [])).catch(() => {});
      react.useEffect(() => { loadProjects(); }, []);
      const onFile = (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = () => setText(String(reader.result || ""));
        reader.onerror = () => setMessage("无法读取文件，请改用 JSON 文本粘贴。");
        reader.readAsText(file);
      };
      const inspect = (event) => {
        event.preventDefault();
        setMessage(""); setAnalysis(null);
        let payload;
        try { payload = JSON.parse(text); } catch { setMessage("JSON 格式还不能解析，请检查逗号、引号和括号。"); return; }
        fetch("/tavernweave/card/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
          .then((r) => r.json()).then((data) => {
            if (data.error) throw new Error(data.error);
            setBaseline(text); setAnalysis(data);
            const card = payload.data && typeof payload.data === "object" ? payload.data : payload;
            setComponentValue(String(card.description || ""));
            const existing = projects.find((item) => item.id === projectId);
            const project = { id: existing?.id, name: data.name || fileName || "未命名卡片", sourceFileName: fileName, cardFormat: data.format, phase: "待盘点", status: "进行中", version: existing?.version || "0.1.0", sourceHash: "", draft: text, sectionsSummary: Object.fromEntries((data.sections || []).map((section) => [section.id, section.count || 0])), acceptanceState: "未验收" };
            const request = existing ? fetch("/tavernweave/cards/" + encodeURIComponent(existing.id), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(project) }) : fetch("/tavernweave/cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(project) });
            request.then((r) => r.json()).then((saved) => { if (saved.id) setProjectId(saved.id); loadProjects(); }).catch(() => {});
          }).catch((e) => setMessage(e.message || "盘点失败，请稍后重试。"));
      };
      const componentFields = [
        ["description", "角色描述"],
        ["personality", "性格"],
        ["scenario", "场景"],
        ["first_mes", "首条消息"],
      ];
      const selectComponent = (id) => {
        setComponentId(id);
        try {
          const card = JSON.parse(text); const data = card.data && typeof card.data === "object" ? card.data : card;
          const value = data[id]; setComponentValue(Array.isArray(value) ? value.join("\n") : String(value || ""));
        } catch { setComponentValue(""); }
      };
      const applyComponent = () => {
        try {
          const card = JSON.parse(text); const data = card.data && typeof card.data === "object" ? card.data : card;
          const old = data[componentId];
          data[componentId] = componentId === "first_mes" && Array.isArray(old) ? componentValue.split("\n") : componentValue;
          const nextText = JSON.stringify(card, null, 2);
          setText(nextText); setAnalysis(null); setMessage("组件已更新，请重新盘点后导出。");
          updateProject({ draft: nextText, phase: "组件编辑", status: "进行中" });
        } catch { setMessage("当前 JSON 无法更新组件。"); }
      };
      const exportJson = () => {
        const blob = new Blob([text], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = fileName || ((analysis && analysis.name) || "tavernweave-card") + ".json";
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
      };
      const input = { width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: "9px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: "12px", lineHeight: 1.5 };
      const workflowPrompt = (kind) => kind === "new"
        ? "我要从零制作一张 SillyTavern 角色卡。请严格按 TavernWeave 制卡流程开始：先访谈我的玩法、叙事目标、卡片类型、变量需求、世界书、开场和运行时依赖；先给出目标/红线/验收三句话和一份简短合同，不要直接写文件。确认后再建立组件与版本化交付。"
        : "我要改造一张已有的 SillyTavern 角色卡。请先读取我提供的 JSON/PNG，保留原文件只读快照并记录哈希，盘点卡片类型、世界书、正则、变量、Tavern Helper、开场和宿主依赖；先说明改动边界与风险，不要静默重封或覆盖原卡，确认后再做组件级增量修改。";
      const copyWorkflow = (kind) => copyText(workflowPrompt(kind)).then((ok) => setWorkflowMessage(ok ? "首轮指令已复制，粘贴到 DSH 对话即可开始。" : "复制失败，请手动选择下方文字。"));
      const updateProject = (patch) => {
        if (!projectId) return;
        fetch("/tavernweave/cards/" + encodeURIComponent(projectId), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then(() => loadProjects()).catch(() => {});
      };
      return react.createElement("div", null,
        react.createElement("div", { style: { marginBottom: "11px", padding: "10px", borderRadius: "11px", border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-module-platform)" } },
          react.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "7px" } },
            react.createElement("strong", { style: { fontSize: "13px" } }, "卡片项目"),
            react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" } }, projects.length + " 个本地项目")),
          projects.length === 0 && react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" } }, "盘点一张卡后，它会出现在这里并持续记录阶段与版本。"),
          projects.map((project) => react.createElement("button", { key: project.id, type: "button", onClick: () => { setProjectId(project.id); setVersionDraft(project.version || "0.1.0"); setText(project.draft || ""); setFileName(project.sourceFileName || ""); setMessage("已载入项目草稿，可继续盘点或编辑。"); }, style: { display: "flex", width: "100%", alignItems: "center", gap: "8px", textAlign: "left", padding: "8px", marginTop: "5px", borderRadius: "8px", border: project.id === projectId ? "1px solid " + tone.accent + "66" : "1px solid var(--dsw-alias-border-l1)", background: project.id === projectId ? tone.soft : "transparent", color: "var(--dsw-alias-label-primary)", cursor: "pointer" } },
            react.createElement("span", { style: { width: "8px", height: "8px", borderRadius: "50%", background: project.status === "已完成" ? "#74e0b2" : "#f0c879", flexShrink: 0 } }),
            react.createElement("span", { style: { minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, project.name),
            react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" } }, project.phase + " · v" + project.version))))),
        react.createElement("div", { style: { padding: "12px", borderRadius: "12px", border: "1px solid " + tone.accent + "38", background: "linear-gradient(135deg, " + tone.soft + ", transparent 78%)", marginBottom: "11px" } },
            react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", marginBottom: "5px" } },
            react.createElement("strong", { style: { fontSize: "15px" } }, "从这里开始制卡"),
            react.createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary)" } }, currentWorkspacePath() || "当前会话工作区未解析")),
          react.createElement("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", lineHeight: 1.5, marginBottom: "9px" } }, "先让 DSH 做调查和方案，再进入组件编辑；不要一上来就把整张卡改成一团 JSON。"),
          react.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "7px" } },
            [["new", "从零制作新卡", "先访谈，再定卡型与变量"], ["retrofit", "改造已有卡", "先盘点，保留原味与回滚点"]].map(([kind, title, detail]) => react.createElement("button", { key: kind, type: "button", style: { ...btn, minHeight: "62px", textAlign: "left", padding: "9px 10px", border: "1px solid " + tone.accent + "44", background: "var(--dsw-alias-bg-module-platform)" }, onClick: () => copyWorkflow(kind) },
              react.createElement("strong", { style: { display: "block", color: tone.accent, fontSize: "13px", marginBottom: "3px" } }, title),
              react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" } }, detail)))),
          workflowMessage && react.createElement("div", { role: "status", style: { color: "var(--dsw-alias-state-success-primary)", fontSize: "12px", marginTop: "8px" } }, workflowMessage)),
        react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px" } },
          react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" } }, "从 JSON 开始。PNG 载荷解析将在打包阶段接入；文件内容只在本地浏览器内处理。"),
          analysis && react.createElement("button", { type: "button", style: { ...btn, minHeight: "29px", padding: "3px 8px", color: tone.accent }, onClick: exportJson }, "导出 JSON")),
        react.createElement("label", { style: { display: "block", border: "1px dashed " + tone.accent + "66", borderRadius: "10px", padding: "10px", marginBottom: "8px", cursor: "pointer", color: "var(--dsw-alias-label-secondary)", background: tone.soft } },
          react.createElement("input", { type: "file", accept: ".json,application/json", onChange: onFile, style: { display: "none" } }), fileName ? "已载入：" + fileName : "选择 JSON 卡片文件（或直接粘贴）"),
        react.createElement("textarea", { style: { ...input, minHeight: "132px", resize: "vertical" }, value: text, placeholder: '{\n  "name": "角色名",\n  "description": "..."\n}', "aria-label": "角色卡 JSON", onChange: (e) => { setText(e.target.value); setAnalysis(null); } }),
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" } }, react.createElement("button", { type: "button", style: { ...primaryBtn, color: "var(--dsw-alias-label-primary)" }, onClick: inspect }, "开始结构盘点"), message && react.createElement("span", { role: "status", style: { color: "var(--dsw-alias-state-error-primary)", fontSize: "12px" } }, message)),
        analysis && react.createElement("div", { style: { marginTop: "12px" } },
          react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" } }, react.createElement("strong", { style: { fontSize: "16px" } }, analysis.name), react.createElement("span", { style: { color: tone.accent, fontSize: "12px", fontFamily: "monospace" } }, analysis.format)),
          react.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: "6px" } }, analysis.sections.map((section) => react.createElement("div", { key: section.id, style: { padding: "9px", borderRadius: "9px", border: "1px solid " + (section.present ? tone.accent + "40" : "var(--dsw-alias-border-l1)"), background: section.present ? tone.soft : "var(--dsw-alias-bg-module-platform)" } }, react.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: "6px" } }, react.createElement("strong", { style: { fontSize: "12px" } }, section.label), react.createElement("span", { style: { color: section.present ? tone.accent : "var(--dsw-alias-label-tertiary)", fontSize: "12px" } }, section.present ? "已发现" : "未发现")), react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", marginTop: "4px" } }, section.present ? section.count + " 项 · " + section.detail : section.detail)))),
          react.createElement("div", { style: { marginTop: "9px", padding: "9px 10px", borderRadius: "9px", background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", fontSize: "12px", lineHeight: 1.55 } }, "下一步：" + analysis.next.join(" → ")),
          projectId && react.createElement("div", { style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" } },
            react.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" } }, "项目阶段"),
            react.createElement("select", { style: { ...input, width: "auto", padding: "5px 7px" }, value: (projects.find((item) => item.id === projectId) || {}).phase || "待盘点", onChange: (e) => updateProject({ phase: e.target.value }) }, ["待盘点", "方案确认", "组件编辑", "待打包", "待真实酒馆验收", "已完成", "阻塞"].map((phase) => react.createElement("option", { key: phase, value: phase }, phase))),
            react.createElement("input", { style: { ...input, width: "74px", padding: "5px 7px" }, value: versionDraft, "aria-label": "项目版本号", onChange: (e) => setVersionDraft(e.target.value), onBlur: () => updateProject({ version: versionDraft }) })),
          react.createElement("div", { style: { marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--dsw-alias-border-l1)" } },
            react.createElement("div", { style: { display: "flex", gap: "7px", alignItems: "center", marginBottom: "7px" } },
              react.createElement("strong", { style: { fontSize: "13px" } }, "组件编辑（实验）"),
              react.createElement("select", { style: { ...input, width: "auto", flex: 1, padding: "5px 7px" }, value: componentId, onChange: (e) => selectComponent(e.target.value) }, componentFields.map(([id, label]) => react.createElement("option", { key: id, value: id }, label)))),
            react.createElement("textarea", { style: { ...input, minHeight: "100px", resize: "vertical", fontFamily: "inherit" }, value: componentValue, onChange: (e) => setComponentValue(e.target.value), "aria-label": "组件内容" }),
            react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "7px" } },
              react.createElement("button", { type: "button", style: { ...btn, color: tone.accent }, onClick: applyComponent }, "应用到卡片草稿"),
              baseline && baseline !== text && react.createElement("span", { style: { color: "var(--dsw-alias-state-warn-primary)", fontSize: "12px" } }, "已有未导出的改动"))));
    }

    // ---------- 设置分区（M2 实装：表单 + 保存） ----------
    function SettingsForm() {
      const [s, setS] = react.useState(null);
      const [msg, setMsg] = react.useState("");
      const [workspaceOptions, setWorkspaceOptions] = react.useState([]);
      const [workspacePick, setWorkspacePick] = react.useState("");
      const [manualWorkspace, setManualWorkspace] = react.useState("");
      const syncWorkspaceOptions = () => {
        try {
          const items = workspaceServices?.workspaces?.list?.getSnapshot?.()?.items || [];
          setWorkspaceOptions(items.map((item) => ({ path: item.path, title: item.title || item.path })).filter((item) => item.path));
        } catch { setWorkspaceOptions([]); }
      };
      react.useEffect(() => {
        fetch("/tavernweave/settings").then((r) => {
          if (!r.ok) throw new Error("settings request failed");
          return r.json();
        }).then(setS).catch(() => setMsg("读取设置失败"));
      }, []);
      react.useEffect(() => {
        syncWorkspaceOptions();
        window.addEventListener("tavernweave:workspace-updated", syncWorkspaceOptions);
        return () => window.removeEventListener("tavernweave:workspace-updated", syncWorkspaceOptions);
      }, []);
      if (!s) return react.createElement("div", null, "读取中…");
      const set = (k, v) => setS(Object.assign({}, s, { [k]: v }));
      const addWorkspace = (path) => {
        const normalized = normalizeWorkspacePath(path);
        if (!normalized) return;
        const current = s.enabledWorkspaces || [];
        if (current.some((item) => normalizeWorkspacePath(item) === normalized)) return;
        set("enabledWorkspaces", current.concat(path));
        setWorkspacePick(""); setManualWorkspace("");
      };
      const removeWorkspace = (path) => set("enabledWorkspaces", (s.enabledWorkspaces || []).filter((item) => normalizeWorkspacePath(item) !== normalizeWorkspacePath(path)));
      const save = () => {
        setMsg("");
        fetch("/tavernweave/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) })
          .then((r) => { if (!r.ok) throw new Error("save request failed"); return r.json(); })
          .then((next) => { setS(next); announceSettings(next); setMsg("已保存"); }).catch(() => setMsg("保存失败"));
      };
      const label = { display: "block", fontSize: "13px", color: "var(--dsw-alias-label-secondary)", marginBottom: "4px", marginTop: "10px" };
      const input = { width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px" };
      return react.createElement("div", { style: { maxWidth: "560px" } },
        react.createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginBottom: "2px" } }, "入口显示由白名单控制：留空时完全隐藏；当前版本保存任意路径即可启用入口。"),
        react.createElement("label", { style: label }, "工作区白名单（选择后添加；留空 = 不显示入口）"),
        react.createElement("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
          react.createElement("select", { style: { ...input, flex: 1 }, value: workspacePick, onChange: (e) => setWorkspacePick(e.target.value) },
            react.createElement("option", { value: "" }, workspaceOptions.length ? "选择一个 DSH 工作区…" : "暂未读取到 DSH 工作区"),
            workspaceOptions.map((item) => react.createElement("option", { key: item.path, value: item.path }, item.title + " · " + item.path))),
          react.createElement("button", { type: "button", style: { ...btn, minHeight: "31px", whiteSpace: "nowrap" }, disabled: !workspacePick, onClick: () => addWorkspace(workspacePick) }, "添加")),
        react.createElement("div", { style: { display: "grid", gap: "5px", marginTop: "7px" } },
          (s.enabledWorkspaces || []).map((path) => react.createElement("div", { key: path, style: { display: "flex", alignItems: "center", gap: "7px", padding: "7px 8px", borderRadius: "8px", background: "var(--dsw-alias-bg-module-platform)", border: "1px solid var(--dsw-alias-border-l1)" } },
            react.createElement("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: "11px", color: "var(--dsw-alias-label-secondary)" }, title: path }, path),
            react.createElement("button", { type: "button", style: { ...btn, minHeight: "25px", padding: "2px 7px", color: "var(--dsw-alias-state-error-primary)" }, onClick: () => removeWorkspace(path), "aria-label": "移除工作区" }, "移除"))),
        react.createElement("div", { style: { display: "flex", gap: "6px", marginTop: "6px" } },
          react.createElement("input", { style: { ...input, flex: 1, fontFamily: "monospace", fontSize: "11px" }, value: manualWorkspace, placeholder: "没有出现在列表？手动输入绝对路径", onChange: (e) => setManualWorkspace(e.target.value) }),
          react.createElement("button", { type: "button", style: { ...btn, minHeight: "31px", whiteSpace: "nowrap" }, disabled: !manualWorkspace.trim(), onClick: () => addWorkspace(manualWorkspace) }, "添加路径")),
        react.createElement("label", { style: label }, "默认人格（用于工作台引导与口令说明）"),
        react.createElement("select", { style: input, value: s.defaultPersona || "none", onChange: (e) => set("defaultPersona", e.target.value) },
          react.createElement("option", { value: "none" }, "不指定"),
          react.createElement("option", { value: "atong" }, "阿瞳"),
          react.createElement("option", { value: "mttt" }, "MTTT.sir"),
          react.createElement("option", { value: "soulkiller" }, "灵魂杀手")),
        react.createElement("label", { style: label }, "面板位置"),
        react.createElement("select", { style: input, value: s.panelPosition || "right", onChange: (e) => set("panelPosition", e.target.value) },
          react.createElement("option", { value: "right" }, "右下角"),
          react.createElement("option", { value: "left" }, "左下角")),
        react.createElement("div", { style: { marginTop: "14px", padding: "10px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: 1.5 } }, "人格选择会立即影响工作台提示。模拟酒馆已暂缓，后续优先完成制卡与真实酒馆验收闭环。"),
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginTop: "16px" } },
          react.createElement("button", { type: "button", style: { ...primaryBtn, padding: "6px 16px" }, onClick: save }, "保存设置"),
          msg && react.createElement("span", { style: { fontSize: "13px", color: msg === "已保存" ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)" } }, msg))
      ));
    }

    function TavernWeaveSection() {
      return react.createElement("div", { style: { padding: "4px 0" } }, react.createElement(SettingsForm));
    }

    function apply(ctx) {
      // M3-3：接入 DSH 原生 / 触发器菜单，候选内容来自本地 usage 路由。
      ctx.effect(() => {
        if (!ctx.inputTriggers || typeof ctx.inputTriggers.registerSource !== "function") return;
        const source = {
          trigger: "/",
          name: "TavernWeave",
          order: 80,
          showGroupTitle: true,
          async candidates(_session, req) {
            if (req.signal?.aborted || !settingsCache || !isWorkspaceAllowed(settingsCache) || settingsCache.autoComplete === false) return [];
            try {
              const data = await fetch("/tavernweave/usage", { signal: req.signal }).then((r) => r.json());
              const q = String(req.query || "").trim().toLowerCase();
              return (data.camps || []).flatMap((camp) => (camp.groups || []).flatMap((group) => (group.items || []).map((item) => ({
                name: item.scene,
                description: item.detail,
                section: camp.campLabel + " · " + group.label,
                value: item.send,
                hint: "插入口令",
              })))).filter((item) => !q || (item.name + " " + item.description + " " + item.section).toLowerCase().includes(q)).slice(0, 30);
            } catch (e) { return []; }
          },
          onPick(pick) {
            const value = pick.candidate && pick.candidate.value;
            return value ? { text: value } : undefined;
          },
        };
        return ctx.inputTriggers.registerSource(source);
      }, "tavernweave: prompt autocomplete");
      // DSH 0.1.2：以当前会话的 WorkspaceView.sessionIds 为主，cwd 仅作兼容兜底。
      // 订阅由 effect 托管，切换会话或工作区时立即重新计算入口可见性。
      ctx.effect(() => {
        workspaceServices = {
          sessions: ctx.sessions || ctx.get?.("sessions"),
          workspaces: ctx.workspaces || ctx.get?.("workspaces"),
        };
        const stops = [];
        const subscribe = (source) => {
          if (source && typeof source.subscribe === "function") stops.push(source.subscribe(() => {
            try { window.dispatchEvent(new CustomEvent("tavernweave:workspace-updated")); } catch (e) {}
            try { window.dispatchEvent(new CustomEvent("tavernweave:session-updated")); } catch (e) {}
          }));
        };
        subscribe(ctx.sessions?.list);
        subscribe(ctx.workspaces?.list);
        announceWorkspaceContext();
        return () => {
          stops.forEach((stop) => { try { stop(); } catch (e) {} });
          workspaceServices = null;
          if (visibleValue) { visibleValue = false; notifyVisible(); }
        };
      }, "tavernweave: workspace visibility");
      // 入口只保留侧栏底部（与「设置」并排，DSH footer.action 槽的官方用法）。
      // 会话 dock 使用 conversation.composer.dock，确保位于输入框下方。
      ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register({ name: "sidebar.footer.action", id: "tavernweave-sidebar-btn" }, TavernButton)
      ), "tavernweave: sidebar button");

      // 与 DSH 0.1.2 官方 conversation 插件保持相同的注册生命周期。
      // 直接挂在当前插件 fiber，避免某些旧 bundle 中嵌套插件 fiber 未被客户端 runner 重放。
      ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
        name: "conversation.composer.dock",
        id: "tavernweave-conversation-dock",
        order: 80,
      }, ConversationDock));

      ctx.effect(() => ctx.slots.inject("settings.section", () =>
        ctx.slots.register({
          name: "settings.section",
          id: "tavernweave-settings",
          order: 90,
          label: "TavernWeave",
        }, TavernWeaveSection)
      ), "tavernweave: settings section");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
