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
    // DSH 原生 Goal 由宿主负责创建和变更；本插件只读取投影，避免复制一套目标状态。
    let nativeGoalServices = null;
    // ---------- 口令速查：静态数据，模块级缓存一次，切换会话/标签/重开面板不再请求 ----------
    let usageCache = null;
    let usageLoading = null;
    function loadUsage() {
      if (usageCache) return Promise.resolve(usageCache);
      if (usageLoading) return usageLoading;
      usageLoading = fetch("/tavernweave/usage", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { usageCache = Array.isArray(j.camps) ? j.camps : []; return usageCache; })
        .catch(() => { usageCache = []; return usageCache; })
        .finally(() => { usageLoading = null; });
      return usageLoading;
    }

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

    function currentNativeGoal(sessionId = currentSessionId()) {
      try {
        if (!sessionId || !nativeGoalServices?.sessions?.binding) return null;
        const projection = nativeGoalServices.sessions.binding(sessionId)?.session?.projections?.faceOf?.("goal")?.getSnapshot?.();
        return projection?.goal || null;
      } catch (e) { return null; }
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

    const CARD_WORKFLOW = [
      ["brief", "需求与卡型"], ["character", "角色设定"], ["worldbook", "世界书"],
      ["opening", "开场白"], ["mvu", "MVU 变量"], ["regex", "正则"],
      ["helper", "Tavern Helper"], ["package", "打包与验收"],
    ];
    const WORKFLOW_STATUS = { pending: "未开始", active: "进行中", done: "已完成", skipped: "已跳过" };
    const WORKFLOW_COLOR = { pending: "var(--dsw-alias-label-tertiary)", active: "var(--dsw-alias-state-business-primary)", done: "var(--dsw-alias-state-success-primary)", skipped: "var(--dsw-alias-label-tertiary)" };
    function initialWorkflow(summary = {}) {
      return CARD_WORKFLOW.map(([id, label]) => ({
        id, label,
        status: id === "brief" ? "done" : id === "character" && summary.identity ? "done" : id === "worldbook" && summary.worldbook ? "done" : id === "opening" && summary.openings ? "done" : id === "mvu" && summary.variables ? "done" : id === "regex" && summary.regex ? "done" : id === "helper" && summary.scripts ? "done" : "pending",
      }));
    }
    function normalizeWorkflow(project) {
      const saved = Array.isArray(project?.workflow) ? project.workflow : [];
      const byId = new Map(saved.map((item) => [String(item.id), item]));
      return CARD_WORKFLOW.map(([id, label]) => {
        const item = byId.get(id);
        const status = WORKFLOW_STATUS[item?.status] ? item.status : initialWorkflow(project?.sectionsSummary || {}).find((row) => row.id === id).status;
        return { id, label, status };
      });
    }
    function workflowFromRuntime(project, runtime) {
      const base = normalizeWorkflow(project);
      const activeName = String(runtime?.latest?.name || "").toLowerCase();
      const loaded = new Set((runtime?.active || []).map((name) => String(name).toLowerCase()));
      const stateRows = Array.isArray(runtime?.skillStates) ? runtime.skillStates : [];
      const todos = Array.isArray(runtime?.todos) ? runtime.todos : [];
      const hit = (terms) => [...loaded].some((name) => terms.some((term) => name.includes(term))) || terms.some((term) => activeName.includes(term));
      const mapping = [
        ["brief", ["requirements", "orchestrate", "blueprint"]], ["character", ["tavern-card-builder", "tavern-cards"]],
        ["worldbook", ["worldbook", "lorebook"]], ["opening", ["opening"]], ["mvu", ["database-rolecards", "variable", "mvu"]],
        ["regex", ["render-regex", "regex"]], ["helper", ["extension-dev", "embedded-ui", "runtime"]], ["package", ["card-pipeline", "component-update", "validation"]],
      ];
      return base.map((item) => {
        const terms = mapping.find(([id]) => id === item.id)?.[1] || [];
        const todo = todos.find((row) => terms.some((term) => String(row.content).toLowerCase().includes(term)) || String(row.content).toLowerCase().includes(item.label.toLowerCase().replace(/\s+/g, "")));
        if (todo) return { ...item, status: todo.status === "in_progress" ? "active" : todo.status === "completed" ? "done" : item.status };
        const matchingStates = stateRows.filter((row) => terms.some((term) => String(row.name).toLowerCase().includes(term)));
        if (matchingStates.some((row) => row.status === "active")) return { ...item, status: "active" };
        if (matchingStates.some((row) => row.status === "done") || (terms.length && hit(terms))) return { ...item, status: "done" };
        return item;
      });
    }

    // 聊天头部的轻量制卡状态：复用本地项目记录，不另建状态真源。
    function CardStatusCapsule() {
      const visible = useVisible();
      const [project, setProject] = react.useState(null);
      const [runtime, setRuntime] = react.useState(null);
      const [nativeGoal, setNativeGoal] = react.useState(null);
      const [open, setOpen] = react.useState(true);
      const capsuleRef = react.useRef(null);
      const load = () => fetch("/tavernweave/cards").then((r) => r.json()).then((data) => {
        const id = currentSessionId();
        const rows = Array.isArray(data.projects) ? data.projects : [];
        setProject(rows.find((item) => item.sessionId && String(item.sessionId) === id) || null);
        setNativeGoal(currentNativeGoal(id));
        fetch("/tavernweave/skills?sessionId=" + encodeURIComponent(id)).then((r) => r.json()).then(setRuntime).catch(() => {});
      }).catch(() => {});
      react.useEffect(() => {
        if (!visible) return undefined;
        load();
        const onUpdate = () => load();
        window.addEventListener("tavernweave:session-updated", onUpdate);
        window.addEventListener("tavernweave:card-project-updated", onUpdate);
        const timer = setInterval(load, 4000);
        return () => { window.removeEventListener("tavernweave:session-updated", onUpdate); window.removeEventListener("tavernweave:card-project-updated", onUpdate); clearInterval(timer); };
      }, [visible]);
      react.useEffect(() => {
        if (!visible || !open) return undefined;
        const onPointerDown = (event) => {
          if (!capsuleRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
          document.removeEventListener("pointerdown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown, true);
        };
      }, [visible, open]);
      const tone = TAB_TONE.workshop;
      if (!visible) return null;
      const complete = project?.status === "已完成";
      const workflow = workflowFromRuntime(project, runtime);
      const active = workflow.find((item) => item.status === "active") || workflow.find((item) => item.status === "pending");
      const doneCount = workflow.filter((item) => item.status === "done").length;
      const skippedCount = workflow.filter((item) => item.status === "skipped").length;
      // 只要会话出现了制卡活动（已有项目 / 已有目标 / 调用过制卡技能），胶囊就展示分阶段进度。
      const hasStarted = !!project || !!nativeGoal || !!(runtime && ((runtime.active || []).length > 0 || runtime.latest));
      const detail = open && react.createElement("div", { role: "dialog", className: "tw-pop", style: { position: "absolute", right: 0, top: "calc(100% + 7px)", zIndex: 10010, width: "min(290px, calc(100vw - 20px))", maxHeight: "min(360px, 45vh)", overflowY: "auto", padding: "10px 11px", borderRadius: DSGN.radius.lg, border: "1px solid " + tone.accent + "55", background: "var(--dsw-specific-menu, var(--dsw-alias-bg-base))", color: "var(--dsw-alias-label-primary)", boxShadow: "var(--dsw-shadow-lv2)", fontSize: "11px", lineHeight: 1.5 } },
        react.createElement("strong", { style: { display: "block", color: accentText(tone.accent), marginBottom: "4px" } }, "本次会话的工坊进度喵"),
        react.createElement("div", { style: { marginBottom: "7px", color: "var(--dsw-alias-label-tertiary)", fontSize: "10px" } }, "这里会跟着本次制卡进度自动更新喵～点击胶囊或外部区域，就可以收起。"),
        hasStarted ? react.createElement(react.Fragment, null,
          project ? react.createElement(react.Fragment, null,
            react.createElement("div", null, project.name),
            react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)" } }, (project.phase || "待盘点") + " · v" + (project.version || "0.1.0") + " · " + (project.acceptanceState || "未验收"))
          ) : react.createElement("div", { style: { fontSize: "12px", fontWeight: 700, marginBottom: "2px" } }, "本会话制卡进行中"),
          nativeGoal && react.createElement("div", { style: { marginTop: "5px", color: "var(--dsw-alias-label-tertiary)" } }, "当前目标：" + nativeGoal.objective + (nativeGoal.phase ? "（" + nativeGoal.phase + "）" : "")),
          react.createElement("div", { style: { marginTop: "8px", paddingTop: "7px", borderTop: "1px solid var(--dsw-alias-border-l1)" } },
            react.createElement("div", { style: { display: "flex", justifyContent: "space-between", color: "var(--dsw-alias-label-tertiary)", marginBottom: "5px" } },
              react.createElement("span", null, "制卡流程"), react.createElement("span", null, doneCount + "/" + workflow.length + " 完成" + (skippedCount ? " · " + skippedCount + " 跳过" : ""))),
            workflow.map((item) => react.createElement("div", { key: item.id, style: { display: "flex", alignItems: "center", gap: "6px", minHeight: "27px" } },
              react.createElement("span", { style: { width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0, background: WORKFLOW_COLOR[item.status] } }),
              react.createElement("span", { style: { flex: 1, minWidth: 0 } }, item.label),
              react.createElement("span", { style: { width: "58px", textAlign: "right", color: WORKFLOW_COLOR[item.status], fontSize: "10px" } }, WORKFLOW_STATUS[item.status])))))
        : react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "还没有开始制卡喵～点『从零写卡』或『改造旧卡』，这里就会开始跟踪每个阶段。"),
        react.createElement("div", { style: { marginTop: "7px", color: "var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary))" } }, runtime?.latest ? "根据本次会话活动推断；最近：" + runtime.latest.name + (runtime.latest.status === "active" ? "（进行中）" : runtime.latest.status === "error" ? "（需要留意）" : "（已完成）") : "完成一项制卡操作后，这里会自动更新喵～"));
      return react.createElement("span", { className: "tw-root", ref: capsuleRef, style: { position: "relative", display: "inline-flex", alignItems: "center" } },
        react.createElement("button", { type: "button", "aria-expanded": open, title: "查看本次会话的工坊进度喵", onClick: () => setOpen(!open), style: { display: "inline-flex", alignItems: "center", gap: "5px", minHeight: "28px", padding: "3px 8px", borderRadius: DSGN.radius.pill, border: "1px solid " + tone.accent + "55", background: tone.soft, color: "var(--dsw-alias-label-secondary)", cursor: "pointer", fontSize: "11px", whiteSpace: "nowrap" } },
          react.createElement("span", { style: { width: "6px", height: "6px", borderRadius: "50%", background: complete ? "#74e0b2" : "#f0c879", boxShadow: "0 0 7px " + (complete ? "#74e0b288" : "#f0c87988") } }),
          react.createElement("span", { style: { maxWidth: "130px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, project?.name || (hasStarted ? "制卡进行中" : "工坊待命")),
          react.createElement("span", null, project ? (active ? active.label + " · " + WORKFLOW_STATUS[active.status] : "流程完成") : (hasStarted ? (active ? active.label + " · " + WORKFLOW_STATUS[active.status] : "流程进行中") : "未关联项目"))),
        detail);
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
    // ---------- 本地设计刻度（单一真源） ----------
    // 强调色收敛：domain / persona 共用同一套色，避免再造 hex；状态色统一走 DSH --dsw-alias-state-*。
    // 详见 docs/前端质感体检报告.md（P0 强调色去重）。
    const DSGN = {
      accent: {
        green: "#74e0b2", blue: "#65d2ff", purple: "#bca4ff",
        amber: "#efc47c", orange: "#ef8e62", pink: "#f39ab7", vibe: "#eeae7a",
      },
      radius: { sm: "8px", md: "10px", lg: "12px", xl: "18px", pill: "999px" },
      space: { xxs: "2px", xs: "4px", sm: "6px", md: "8px", lg: "12px", xl: "16px" },
      duration: { fast: "140ms", base: "180ms", slow: "260ms" },
      ease: { out: "cubic-bezier(0.23, 1, 0.32, 1)", inOut: "cubic-bezier(0.77, 0, 0.175, 1)" },
    };
    // 强调色文字：往主题文字色方向收敛 45%，浅色/深色主题都可读（依赖现代浏览器 color-mix）。
    const accentText = (color) => "color-mix(in srgb, " + color + " 45%, var(--dsw-alias-label-primary))";
    const btn = { fontSize: "13px", minHeight: "34px", padding: "5px 10px", borderRadius: DSGN.radius.sm, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-interactive-bg-hover)", color: "var(--dsw-alias-label-secondary)", cursor: "pointer", lineHeight: 1.25 };
    const primaryBtn = { ...btn, border: "1px solid var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-primary)", background: "var(--dsw-specific-tip)", boxShadow: "var(--dsw-shadow-lv2)" };
    const TAB_TONE = {
      usage: { accent: DSGN.accent.blue, soft: "rgba(70, 186, 255, 0.15)" },
      skills: { accent: DSGN.accent.purple, soft: "rgba(159, 119, 255, 0.14)" },
      library: { accent: DSGN.accent.amber, soft: "rgba(235, 176, 82, 0.14)" },
      workshop: { accent: DSGN.accent.green, soft: "rgba(86, 205, 151, 0.14)" },
      updates: { accent: DSGN.accent.orange, soft: "rgba(239, 142, 98, 0.14)" },
    };
    const TAB_HINT = {
      usage: "还不确定怎么说？来这里挑一句顺手的口令，再复制到当前会话喵～",
      skills: "这里会告诉您 Skill 目录齐不齐，以及本会话实际用过哪些能力喵。",
      library: "这里是原作者指南的只读小书架，用来查概念、流程和实现边界喵。",
      workshop: "角色卡草稿都在这里照料：导入、盘点、组件修改、版本记录和导出喵。",
      updates: "这里只更新 TavernWeave DSH 插件本身，不会碰您的卡片项目，请放心喵～",
    };
    // 来自原作者公开 Soul 口令的可操作索引；长口令也保留，避免只剩一句口号。
    const SOUL_PERSONAS = [
      { id: "atong", name: "阿瞳", glyph: "瞳", tone: DSGN.accent.green, hint: "温柔指导", commands: [
        ["呼叫阿瞳", "阿瞳助我！"],
        ["交给阿瞳", "阿瞳接手"],
      ] },
      { id: "mttt", name: "MTTT.sir", glyph: "MT", tone: DSGN.accent.purple, hint: "严格学习", commands: [
        ["请 MTTT 拷打", "MTTT.sir，拷打我！"],
        ["开始上课", "MTTT.sir 上课"],
      ] },
      { id: "soulkiller", name: "灵魂杀手", glyph: "✦", tone: DSGN.accent.pink, hint: "前端审查", commands: [
        ["呼叫灵魂杀手", "灵魂杀手！"],
        ["强尼接管", "强尼·银手，接管！"],
        ["前端审查", "灵魂杀手！\n检查这个前端的视觉层级、中文排版、配色、动效目的和 390px 窄屏表现。可以直说，但每个问题都要给证据、影响、修法和复验方式。"],
      ] },
    ];
    // 面板用 portal 挂到 document.body，fixed 定位到视口，避开侧栏列 overflow:hidden 裁剪
    const panelStyle = { position: "fixed", top: "24px", bottom: "auto", width: "min(520px, calc(100vw - 24px))", maxHeight: "min(700px, calc(100dvh - 48px))", overflow: "hidden", borderRadius: DSGN.radius.xl, background: "var(--dsw-specific-menu, var(--dsw-specific-input-major, var(--dsw-alias-bg-base)))", border: "1px solid var(--dsw-alias-border-inverted)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", zIndex: 999, boxShadow: "var(--dsw-shadow-lv3)", backdropFilter: "blur(14px) saturate(1.08)", WebkitBackdropFilter: "blur(14px) saturate(1.08)" };
    const panelBodyStyle = { position: "relative", zIndex: 1, maxHeight: "min(700px, calc(100dvh - 48px))", overflowY: "auto", boxSizing: "border-box", padding: "17px", scrollbarWidth: "thin" };
    const panelSide = () => (settingsCache && settingsCache.panelPosition === "left") ? { left: "24px" } : { right: "24px" };

    // ---------- 主面板入口（composer dock 小按钮） ----------
    function TavernButton() {
      const visible = useVisible();
      const [open, setOpen] = usePanelOpen();
      const updates = useUpdateState();
      react.useEffect(() => { if (visible) checkForUpdates().catch(() => {}); }, [visible]);
      if (!visible) return null;
      const close = () => setOpen(false);
      return react.createElement("div", { className: "tw-root", style: { position: "relative" } },
        react.createElement("span", { style: { position: "relative", display: "inline-flex" } },
          react.createElement("button", { type: "button", style: { ...primaryBtn, minHeight: "38px", padding: "5px 11px" }, title: updates.hasUpdate ? "发现 TavernWeave 更新，点击查看" : "TavernWeave 酒馆工作台", onClick: () => setOpen(!open) }, "✦ 酒馆"),
          updates.hasUpdate && react.createElement("span", { style: { position: "absolute", right: "-7px", top: "-9px", padding: "2px 6px", borderRadius: DSGN.radius.pill, background: "#ef8e62", color: "#28150e", fontSize: "10px", fontWeight: 800, boxShadow: "0 3px 12px rgba(239,142,98,.35)", pointerEvents: "none" } }, "有新更新喵")),
        open && reactDom.createPortal(react.createElement("div", null,
          react.createElement("div", { onClick: close, style: { position: "fixed", inset: 0, zIndex: 998, background: "transparent" } }),
          react.createElement(WorkbenchPanel, { onClose: close })
        ), document.body)
      );
    }

    // ---------- 主面板（口令、技能、资料与制卡项目） ----------
    function WorkbenchPanel(props) {
      const [tab, setTab] = react.useState("usage");
      const [usage, setUsage] = react.useState(usageCache);
      const [hint, setHint] = react.useState("");
      const [dragPosition, setDragPosition] = react.useState(null);
      const [dragging, setDragging] = react.useState(false);
      const dragRef = react.useRef(null);
      const updates = useUpdateState();
      react.useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") props.onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, []);
      react.useEffect(() => {
        loadUsage().then(setUsage);
      }, []);
      const tabs = [["usage", "口令速查"], ["skills", "技能状态"], ["library", "资料库"], ["workshop", "制卡工作台"], ["updates", "更新"]];
      const tone = TAB_TONE[tab];
      const personaLabel = { none: "默认人格", atong: "阿瞳", mttt: "MTTT.sir", soulkiller: "灵魂杀手" }[(settingsCache && settingsCache.defaultPersona) || "none"];
      const beginDrag = (event) => {
        if (event.button !== 0 || event.target?.closest?.("button, input, textarea, select, a, [role='tab'], [role='button']")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const left = dragPosition?.left ?? rect.left;
        const top = dragPosition?.top ?? rect.top;
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left, top };
        setDragging(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      };
      const dragBounds = (rect) => ({
        minX: 8, minY: 8,
        maxX: Math.max(8, window.innerWidth - rect.width - 8),
        maxY: Math.max(8, window.innerHeight - rect.height - 8),
      });
      const clampDrag = (value, min, max) => Math.min(max, Math.max(min, value));
      const moveDrag = (event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const b = dragBounds(rect);
        let left = drag.left + event.clientX - drag.startX;
        let top = drag.top + event.clientY - drag.startY;
        // 边界阻尼：越拖越慢（rubber-band），不硬撞墙；释放时再回弹到边界内。
        left = left < b.minX ? b.minX + (left - b.minX) * 0.3 : left > b.maxX ? b.maxX + (left - b.maxX) * 0.3 : left;
        top = top < b.minY ? b.minY + (top - b.minY) * 0.3 : top > b.maxY ? b.maxY + (top - b.maxY) * 0.3 : top;
        setDragPosition({ left, top });
        event.preventDefault();
      };
      const endDrag = (event) => {
        dragRef.current = null;
        setDragging(false);
        // 释放后若停在边界外（阻尼留下的少量越界），平滑回弹到边界内。
        setDragPosition((pos) => {
          if (!pos) return pos;
          const rect = event?.currentTarget?.getBoundingClientRect?.();
          if (!rect) return pos;
          const b = dragBounds(rect);
          return { left: clampDrag(pos.left, b.minX, b.maxX), top: clampDrag(pos.top, b.minY, b.maxY) };
        });
      };
      const positionStyle = dragPosition ? { left: dragPosition.left + "px", top: dragPosition.top + "px", right: "auto", bottom: "auto" } : {};
      return react.createElement("div", { className: "tw-root tw-panel", role: "dialog", "aria-label": "TavernWeave 酒馆工作台", onPointerDown: beginDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag, style: { ...panelStyle, ...panelSide(), ...positionStyle, cursor: dragging ? "grabbing" : "grab", touchAction: dragging ? "none" : "auto", transition: dragging ? "none" : "left 180ms ease, top 180ms ease" } },
        react.createElement("div", { "aria-hidden": true, style: { position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.4, backgroundImage: "linear-gradient(rgba(130, 204, 255, 0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(130, 204, 255, 0.045) 1px, transparent 1px), radial-gradient(circle at 88% 0%, " + tone.soft + ", transparent 34%)", backgroundSize: "22px 22px, 22px 22px, auto" } }),
        react.createElement("div", { style: panelBodyStyle },
        react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "15px" } },
            react.createElement("div", null,
            react.createElement("div", { style: { display: "inline-flex", alignItems: "center", gap: "6px", color: accentText(tone.accent), fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", marginBottom: "5px" } },
              react.createElement("span", { style: { width: "6px", height: "6px", borderRadius: "50%", background: tone.accent, boxShadow: "0 0 12px " + tone.accent } }), "TAVERNWEAVE / WORKBENCH"),
            react.createElement("strong", { style: { display: "block", fontSize: "19px", letterSpacing: "0.01em" } }, "酒馆工作台"),
            react.createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginTop: "4px" } }, "把创作流程、技能和资料收拾到一处，做卡更轻松喵～ · 当前人格：" + personaLabel)),
          react.createElement("div", { style: { display: "flex", gap: "6px" } },
            react.createElement("button", { type: "button", style: { ...btn, width: "36px", padding: 0 }, title: "看看设置入口喵", "aria-label": "打开设置说明", onClick: () => setHint("设置在 DSH 左下角的「设置」→ TavernWeave 分区里，找到了就好喵～") }, "⚙"),
            react.createElement("button", { type: "button", style: { ...btn, width: "36px", padding: 0 }, title: "先把工坊收起来喵", "aria-label": "关闭工作台", onClick: props.onClose }, "×"))),
        updates.hasUpdate && react.createElement("div", { role: "status", style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", padding: "9px 10px", borderRadius: DSGN.radius.md, border: "1px solid rgba(239,142,98,.35)", background: "rgba(239,142,98,.12)", color: "var(--dsw-alias-label-primary)" } },
          react.createElement("strong", null, "TavernWeave 有新更新喵"),
          react.createElement("button", { type: "button", style: { ...btn, minHeight: "27px", padding: "3px 8px", marginLeft: "auto", color: "var(--dsw-alias-state-warn-primary)", borderColor: "rgba(239,142,98,.45)" }, onClick: () => setTab("updates") }, "去看看喵")),
        hint && react.createElement("div", { role: "status", "aria-live": "polite", style: { fontSize: "12px", color: "var(--dsw-alias-state-warn-primary)", marginBottom: "10px", padding: "8px 10px", borderRadius: DSGN.radius.sm, border: "1px solid rgba(240, 200, 121, 0.22)", background: "rgba(176, 130, 44, 0.12)" } }, hint),
        react.createElement("div", { role: "tablist", style: { display: "flex", gap: "5px", padding: "5px", borderRadius: DSGN.radius.lg, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-module-platform)", marginBottom: "14px" } },
          tabs.map(([id, label]) => { const itemTone = TAB_TONE[id]; return react.createElement("button", { key: id, type: "button", role: "tab", "aria-selected": tab === id, style: { ...btn, flex: 1, minWidth: 0, border: tab === id ? "1px solid " + itemTone.accent + "66" : "1px solid transparent", background: tab === id ? itemTone.soft : "transparent", color: tab === id ? accentText(itemTone.accent) : "var(--dsw-alias-label-tertiary)", fontWeight: tab === id ? 700 : 500, boxShadow: tab === id ? "0 5px 16px " + itemTone.soft : "none" }, onClick: () => { setTab(id); setHint(""); } }, label); })),
        react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", lineHeight: 1.45, margin: "-7px 2px 10px" } }, TAB_HINT[tab]),
        react.createElement("div", { style: { padding: "12px", borderRadius: DSGN.radius.lg, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-specific-input-major)" } },
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
      const [soulHelpOpen, setSoulHelpOpen] = react.useState(false);
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
          onNotice("当前会话输入接口暂时不听话，请到口令速查里手动使用 Soul 口令喵～");
          return;
        }
        const current = typeof input?.draft === "string" ? input.draft.trimEnd() : "";
        inputActions.setDraft(current ? current + "\n\n" + text : text);
        const next = { ...(settingsCache || {}), defaultPersona: persona.id };
        announceSettings(next);
        fetch("/tavernweave/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) }).catch(() => {});
        onNotice(persona.name + "已经乖乖就位，Soul 口令也放进输入框啦～您可以再改改，然后发送喵。\n" + text);
      };
      return react.createElement("div", { className: "tw-root", style: { display: "inline-flex", alignItems: "center", gap: "5px", marginLeft: "4px" }, "aria-label": "Soul 人格选择" },
        react.createElement("span", { style: { position: "relative", display: "inline-flex", alignItems: "center", gap: "2px", marginRight: "2px" }, onMouseEnter: () => setSoulHelpOpen(true), onMouseLeave: () => setSoulHelpOpen(false) },
          react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" } }, "Soul"),
          react.createElement("button", { type: "button", "aria-label": "Soul 启用说明", "aria-expanded": soulHelpOpen, title: "Soul 启用说明", onFocus: () => setSoulHelpOpen(true), onBlur: () => setSoulHelpOpen(false), onClick: () => setSoulHelpOpen(true), style: { width: "17px", height: "17px", padding: 0, border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "50%", background: "transparent", color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", lineHeight: 1, cursor: "help" } }, "i"),
          soulHelpOpen && react.createElement("div", { role: "tooltip", className: "tw-pop", style: { position: "absolute", zIndex: 1001, left: "50%", bottom: "calc(100% + 7px)", transform: "translateX(-50%)", width: "min(330px, calc(100vw - 30px))", padding: "8px 9px", borderRadius: DSGN.radius.md, border: "1px solid rgba(116, 224, 178, .42)", background: "var(--dsw-specific-menu, var(--dsw-alias-bg-base))", color: "var(--dsw-alias-label-primary)", boxShadow: "var(--dsw-shadow-lv2)", fontSize: "11px", lineHeight: 1.45, textAlign: "left", whiteSpace: "pre-line", pointerEvents: "none" } }, "Soul 是要被您亲口召唤的陪伴层喵～\n只有说“阿瞳助我！”或“开启 Soul 模式”才会启用；做角色卡不会自动加载，也不会改变权限边界，请放心喵。")),
        SOUL_PERSONAS.map((persona) => {
          const active = selected === persona.id;
          return react.createElement("span", { key: persona.id, style: { position: "relative", display: "inline-flex" },
            onMouseEnter: () => setHovered(persona.id), onMouseLeave: () => setHovered(null) },
            react.createElement("button", { type: "button", "aria-label": persona.name + "：" + persona.commands[0][1], "aria-pressed": active, title: persona.name + " · " + persona.hint + "（悬停选择口令）", onClick: () => choose(persona), style: { width: "30px", height: "30px", padding: 0, borderRadius: "50%", border: active ? "2px solid " + persona.tone : "1px solid var(--dsw-alias-border-l2)", background: active ? persona.tone + "2b" : "var(--dsw-alias-bg-module-platform)", color: active ? accentText(persona.tone) : "var(--dsw-alias-label-secondary)", fontSize: persona.id === "mttt" ? "9px" : "13px", fontWeight: 700, cursor: "pointer", boxShadow: active ? "0 0 12px " + persona.tone + "55" : "none" } }, persona.glyph),
            hovered === persona.id && react.createElement("div", { role: "tooltip", className: "tw-pop", style: { position: "absolute", zIndex: 1001, left: "50%", bottom: "calc(100% + 7px)", transform: "translateX(-50%)", width: "min(270px, calc(100vw - 30px))", maxHeight: "min(320px, 45dvh)", overflowY: "auto", padding: "7px", borderRadius: DSGN.radius.md, border: "1px solid " + persona.tone + "55", background: "var(--dsw-specific-menu, var(--dsw-alias-bg-base))", color: "var(--dsw-alias-label-primary)", boxShadow: "var(--dsw-shadow-lv2)", fontSize: "11px", lineHeight: 1.35, pointerEvents: "auto" } },
              react.createElement("div", { style: { color: accentText(persona.tone), fontWeight: 700, marginBottom: "5px" } }, persona.name + " · " + persona.hint),
              react.createElement("div", { style: { display: "grid", gap: "4px" } }, persona.commands.map(([label, command]) => react.createElement("button", { key: label, type: "button", onClick: () => choose(persona, command), title: command, style: { width: "100%", padding: "6px 7px", borderRadius: DSGN.radius.sm, border: "1px solid " + persona.tone + "40", background: persona.tone + "12", color: "var(--dsw-alias-label-primary)", textAlign: "left", cursor: "pointer", whiteSpace: "pre-line", lineHeight: 1.35 } }, react.createElement("strong", { style: { display: "block", color: accentText(persona.tone), marginBottom: "2px" } }, label), command)))
            ));
        })
      );
    }

    // 会话主入口：放在输入框上方，避免进入会话后把聊天区整体向下挤。
    function ConversationDock({ useInput, inputActions }) {
      const input = typeof useInput === "function" ? useInput((state) => state) : { draft: "" };
      const visible = useVisible();
      const PRESET_REMINDER = "⚠ 请新建会话，再在输入区旁的 DSH「Agent Preset」选择 TavernWeave 原生工坊喵～已有内容的会话不能切换哦。";
      const [notice, setNotice] = react.useState("");
      const agentPreset = useCurrentAgentPreset();
      const nativeRuntime = agentPreset === "tavernweave-native";
      // 非原生工坊会话默认展示一次切换预设提醒（切会话重显；用户可关闭）。
      const remindedFor = react.useRef("");
      react.useEffect(() => {
        if (!agentPreset) return;
        const sid = currentSessionId();
        if (!sid || remindedFor.current === sid) return;
        remindedFor.current = sid;
        setNotice(agentPreset === "tavernweave-native" ? "" : PRESET_REMINDER);
      }, [agentPreset]);
      if (!visible) return null;
      const prompt = (kind) => kind === "new"
        ? "我要从零制作一张 SillyTavern 角色卡。请先按 TavernWeave 流程访谈玩法、叙事目标、卡片类型、变量、世界书、开场和运行时依赖；先给出目标/红线/验收和简短合同，不要直接写文件。完成后请自动收录：用 POST /tavernweave/cards 登记项目，并用 POST /tavernweave/card/analyze 写入组件盘点；同时把卡内状态栏等嵌入前端（HTML/CSS/JS 或 MVU 变量）的最终代码贴出来给用户预览，不要只让用户手工盘点。多阶段任务优先使用 DSH 原生 ask_user_question、goal、plan/plan-review 和 Todo，不要另建重复的进度或确认面板。"
        : "我要改造一张已有的 SillyTavern 角色卡。请先读取我提供的 JSON/PNG，保留只读快照并记录哈希，盘点卡型、世界书、正则、变量、Tavern Helper、开场和宿主依赖；先说明边界与风险，不要覆盖原卡。若会话具备酒馆只读工具（mcp__sillytavern__*），仅可用来只读核对当前这张卡与相关环境，不得扫描整个卡库、不得修改或写入任何内容；不具备则以用户提供的文件为准。完成后请自动收录：用 POST /tavernweave/cards 登记项目，并用 POST /tavernweave/card/analyze 写入组件盘点；同时把卡内状态栏等嵌入前端（HTML/CSS/JS 或 MVU 变量）的最终代码贴出来给用户预览。多阶段任务优先使用 DSH 原生 ask_user_question、goal、plan/plan-review 和 Todo，不要另建重复的进度或确认面板。";
      const insert = (kind) => {
        const text = prompt(kind);
        if (!inputActions || typeof inputActions.setDraft !== "function") {
          setNotice("当前会话输入接口暂时不听话，请直接使用悬浮工坊喵～");
          return;
        }
        const current = typeof input?.draft === "string" ? input.draft.trimEnd() : "";
        inputActions.setDraft(current ? current + "\n\n" + text : text);
        setNotice("指令已经放进当前对话输入框啦～您可以继续编辑后发送喵。");
      };
      const noticeBase = { position: "absolute", right: 0, left: "auto", bottom: "calc(100% + 6px)", display: "flex", alignItems: "flex-start", gap: "7px", width: "max-content", maxWidth: "min(440px, 90vw)", padding: "9px 10px 9px 9px", borderRadius: DSGN.radius.md, background: "var(--dsw-specific-menu, var(--dsw-alias-bg-base))", fontSize: "12px", lineHeight: 1.5, boxShadow: "var(--dsw-shadow-lv2)", zIndex: 2, boxSizing: "border-box" };
      const noticeStyle = notice === PRESET_REMINDER
        ? { ...noticeBase, border: "1px solid rgba(240, 200, 121, 0.35)", borderLeft: "3px solid var(--dsw-alias-state-warn-primary)", color: "var(--dsw-alias-state-warn-primary)", fontWeight: 600 }
        : { ...noticeBase, border: "1px solid var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-primary)" };
      return react.createElement("div", { className: "tw-root", style: { position: "relative", display: "flex", alignItems: "center", alignSelf: "flex-end", justifyContent: "flex-end", flexWrap: "wrap", gap: "6px", padding: "5px 7px", marginTop: "6px", marginLeft: 0, marginRight: "max(16px, calc((100% - var(--dsh-composer-card-max-width, 920px)) / 2 + 8px))", width: "fit-content", maxWidth: "calc(100% - 32px)", borderRadius: DSGN.radius.md, border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", fontSize: "12px", boxSizing: "border-box" } },
        react.createElement("span", { style: { color: accentText(DSGN.accent.green), fontWeight: 700 } }, "✦ 制卡"),
        react.createElement("span", { "aria-label": nativeRuntime ? "原生工坊已启用" : "未使用原生工坊", title: nativeRuntime ? "DSH 已向本会话注入 TavernWeave 的 20 个 Skill 与 Host Front Door。" : "此会话不是 TavernWeave 原生工坊；现有会话产生内容后不能更换预设。", style: { width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0, background: nativeRuntime ? "#74e0b2" : "#f0c879", boxShadow: nativeRuntime ? "0 0 8px #74e0b288" : "none" } }),
        !nativeRuntime && react.createElement("button", { type: "button", style: { ...btn, minHeight: "26px", padding: "2px 7px", color: "var(--dsw-alias-state-warn-primary)", fontSize: "11px" }, onClick: () => setNotice(PRESET_REMINDER) }, "如何启用"),
        react.createElement(SoulPersonaPicker, { input, inputActions, onNotice: setNotice }),
        react.createElement("button", { type: "button", style: { ...btn, minHeight: "28px", padding: "3px 8px" }, onClick: () => insert("new") }, "从零写卡"),
        react.createElement("button", { type: "button", style: { ...btn, minHeight: "28px", padding: "3px 8px" }, onClick: () => insert("retrofit") }, "改造旧卡"),
        react.createElement("button", { type: "button", style: { ...primaryBtn, minHeight: "28px", padding: "3px 8px" }, onClick: () => setPanelOpen(true) }, "打开工坊"),
        notice && react.createElement("span", { role: "status", className: "tw-pop", "aria-live": "polite", style: noticeStyle },
          react.createElement("span", { style: { whiteSpace: "pre-line", minWidth: 0, flex: 1 } }, notice),
          react.createElement("button", { type: "button", "aria-label": "关闭提示", title: "关闭提示", onClick: () => setNotice(""), style: { ...btn, width: "22px", minHeight: "22px", padding: 0, flexShrink: 0, lineHeight: 1 } }, "×")));
    }

    // ---------- 使用说明（两层分类：阵营 → 小类 → 口令） ----------
    const CAMP_ACCENT = { st: DSGN.accent.blue, vibe: DSGN.accent.vibe, workflow: DSGN.accent.purple };

    // ---------- 材料：章节解析 + 断点续接（localStorage，按材料哈希） ----------
    function parseChapters(content) {
      const headingRe = /^\s*(?:#{1,6}\s*[^\n]{0,40}|第[0-9一二三四五六七八九十百千零两]+[章节回卷集部篇][^\n。！？!?]{0,40}|[一二三四五六七八九十]+、[^\n。！？!?]{0,40})\s*$/;
      const out = [];
      let current = null;
      for (const line of String(content || "").split(/\r?\n/)) {
        if (headingRe.test(line)) {
          if (current) out.push(current);
          current = { title: line.trim().replace(/^#+\s*/, ""), chars: 0, preview: "", start: out.length };
        } else if (current) {
          current.chars += line.replace(/\s/g, "").length;
          if (current.preview.length < 60) current.preview += (current.preview ? "\n" : "") + line.trim();
        }
      }
      if (current) out.push(current);
      if (!out.length) out.push({ title: "全文（无章节标题）", chars: String(content || "").replace(/\s/g, "").length, preview: String(content || "").replace(/\s+/g, " ").slice(0, 60), start: 0 });
      return out;
    }
    const materialCheckpoint = {
      key(hash) { return "tw-material:" + hash; },
      read(hash) { try { return JSON.parse(localStorage.getItem(this.key(hash)) || "null"); } catch { return null; } },
      write(hash, state) { try { localStorage.setItem(this.key(hash), JSON.stringify(state)); } catch {} },
      chapters(chapters, saved) {
        return chapters.map((ch, i) => ({ ...ch, status: (saved && saved.chapters && saved.chapters[i] && saved.chapters[i].status) || "pending" }));
      },
    };

    // ---------- PNG 角色卡载荷解析（tEXt chara / ccv3） ----------
    function parsePngCard(buffer) {
      const bytes = new Uint8Array(buffer);
      const sig = [137, 80, 78, 71, 13, 10, 26, 10];
      if (bytes.length < 24) throw new Error("文件太小，不是有效 PNG");
      for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error("不是 PNG 文件");
      const decoder = new TextDecoder("latin1");
      let offset = 8;
      while (offset + 12 <= bytes.length) {
        const len = (bytes[offset] * 16777216) + (bytes[offset + 1] * 65536) + (bytes[offset + 2] * 256) + bytes[offset + 3];
        const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
        const data = bytes.subarray(offset + 8, offset + 8 + len);
        if (type === "tEXt") {
          const text = decoder.decode(data);
          const nul = text.indexOf("\u0000");
          const keyword = nul >= 0 ? text.slice(0, nul) : "";
          const value = nul >= 0 ? text.slice(nul + 1) : "";
          if (/chara|ccv3|card/i.test(keyword)) {
            const decoded = value.replace(/\s+/g, "");
            if (!/^[A-Za-z0-9+/=]+$/.test(decoded)) throw new Error("角色卡数据不是合法 base64");
            const jsonBytes = Uint8Array.from(atob(decoded), (c) => c.charCodeAt(0));
            const jsonText = new TextDecoder().decode(jsonBytes);
            return JSON.parse(jsonText);
          }
        }
        offset += 12 + len;
        if (type === "IEND") break;
      }
      throw new Error("未找到角色卡 tEXt 块（chara/ccv3）");
    }

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
      const itemCount = camp.groups.reduce((sum, group) => sum + group.items.length, 0);
      const isGuide = camp.camp === "workflow";
      const header = react.createElement("button", { type: "button", "aria-expanded": expanded, onClick: onToggle, style: { width: "100%", minHeight: "48px", textAlign: "left", background: expanded ? "linear-gradient(100deg, " + accent + "28, var(--dsw-alias-bg-module-platform))" : "linear-gradient(100deg, " + accent + "16, var(--dsw-alias-bg-module-platform))", border: "1px solid " + accent + (expanded ? "88" : "55"), boxShadow: expanded ? "0 6px 18px " + accent + "18" : "0 3px 10px rgba(0,0,0,.16)", padding: "9px 11px", borderRadius: DSGN.radius.md, cursor: "pointer", color: "var(--dsw-alias-label-primary)" } },
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
          react.createElement("span", { style: { width: "9px", height: "9px", borderRadius: "50%", background: accent, flexShrink: 0, boxShadow: "0 0 9px " + accent + "99" } }),
          react.createElement("strong", { style: { fontSize: "14px", color: "var(--dsw-alias-label-primary)" } }, camp.campLabel),
          react.createElement("span", { style: { fontSize: "11px", color: accentText(accent), border: "1px solid " + accent + "66", background: accent + "18", borderRadius: DSGN.radius.pill, padding: "2px 6px", flexShrink: 0 } }, itemCount + " 条"),
          react.createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-secondary)", marginLeft: "auto", marginRight: "4px", textAlign: "right" } }, expanded ? "点击收起" : "点击展开"),
          react.createElement("span", { style: { color: accentText(accent), fontSize: "15px", fontWeight: 700 } }, expanded ? "▾" : "▸")),
        !expanded && react.createElement("div", { style: { paddingLeft: "17px", marginTop: "5px", fontSize: "11px", color: "var(--dsw-alias-label-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
          camp.memo + " · " + camp.groups.map((g) => g.label).join(" · ")));
      const body = expanded && react.createElement("div", { style: { paddingTop: "8px" } },
        camp.groups.map((group) => react.createElement("div", { key: group.label, style: { marginBottom: "8px" } },
          react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px", padding: "0 10px" } },
            react.createElement("span", { style: { fontSize: "12px", color: CAMP_ACCENT[camp.camp], fontWeight: 500, flexShrink: 0 } }, group.label),
            react.createElement("span", { style: { flex: 1, height: "1px", background: "var(--dsw-alias-border-l1)" } })),
          group.items.map((u) => react.createElement("div", { key: u.scene, style: { border: "1px solid " + accent + "38", borderLeft: "3px solid " + accent, borderRadius: DSGN.radius.sm, padding: "10px 11px", marginBottom: "7px", background: "linear-gradient(135deg, " + accent + "0d, var(--dsw-alias-bg-base))", boxShadow: "0 2px 8px rgba(0,0,0,.12)" } },
            react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" } },
              react.createElement("strong", { style: { fontSize: "13px", color: "var(--dsw-alias-label-primary)" } }, u.scene),
              react.createElement("button", { type: "button", style: { ...btn, minHeight: "28px", padding: "2px 8px", fontSize: "12px", border: "1px solid " + accent + "55", color: copiedKey === camp.camp + ":" + u.scene ? "var(--dsw-alias-state-success-primary)" : accentText(accent), background: copiedKey === camp.camp + ":" + u.scene ? "rgba(84, 193, 129, 0.12)" : "transparent" }, title: isGuide ? "复制操作步骤" : "复制发送内容", onClick: () => onCopy(camp.camp + ":" + u.scene, u.send) }, copiedKey === camp.camp + ":" + u.scene ? "已复制" : isGuide ? "复制步骤" : "复制")),
            react.createElement("div", { style: { fontFamily: isGuide ? "inherit" : "monospace", fontSize: "12px", lineHeight: 1.5, whiteSpace: "pre-wrap", color: "var(--dsw-alias-label-secondary)", marginBottom: "3px" } }, u.send.length > 180 ? u.send.slice(0, 180) + "…" : u.send),
            u.detail && react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" } }, u.detail))))
        )
      );
      return react.createElement("div", { style: { marginBottom: "13px" } }, header, body);
    }

    function UsageTab({ usage }) {
      const [open, setOpen] = react.useState({ st: false, vibe: false, workflow: false });
      const [copiedKey, setCopiedKey] = react.useState("");
      const copyItem = (key, text) => {
        copyText(text).then((ok) => setCopiedKey(ok ? key : ""));
      };
      if (!usage) return react.createElement("div", null, "正在把口令小本本翻出来喵…");
      const orderedUsage = Array.isArray(usage) ? [...usage].sort((a, b) => (a.camp === "workflow" ? -1 : b.camp === "workflow" ? 1 : 0)) : [];
      if (usage.length === 0) return react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "暂时没拿到使用说明，再试一下就好喵～");
      return react.createElement("div", null,
        react.createElement("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", lineHeight: 1.5, marginBottom: "10px", padding: "8px 10px", borderRadius: DSGN.radius.sm, border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-module-platform)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, "三类入口：口令可以复制到会话，制卡操作指南按步骤照做就好喵～"),
        orderedUsage.map((camp) => react.createElement(UsageCamp, { key: camp.camp, camp, expanded: open[camp.camp], copiedKey, onCopy: copyItem, onToggle: () => setOpen((o) => ({ ...o, [camp.camp]: !o[camp.camp] })) }))
      );
    }

    function SkillsTab({ status, fetchStatus }) {
      const [st, setSt] = react.useState(status);
      react.useEffect(() => {
        if (!fetchStatus) return undefined;
        let cancelled = false;
        const load = () => fetch("/tavernweave/skills?sessionId=" + encodeURIComponent(currentSessionId())).then((r) => r.json()).then((data) => { if (!cancelled) setSt(data); }).catch(() => {});
        load();
        const timer = setInterval(load, 8000);
        const onSession = () => load();
        window.addEventListener("tavernweave:session-updated", onSession);
        return () => { cancelled = true; clearInterval(timer); window.removeEventListener("tavernweave:session-updated", onSession); };
      }, [fetchStatus]);
      if (!st) return react.createElement("div", null, "正在数一数 Skill 喵…");
      if (st.total === 0) return react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "还没找到 TavernWeave 技能目录，请检查仓库位置或安装技能喵～");
      return react.createElement("div", null,
        react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: 1.5, marginBottom: "8px" } }, "“可用”是已经安装好的能力，“已加载”是本会话真正用过的 Skill；暂时是 0 也不用担心，模型需要时会自己来取喵～"),
        react.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px", marginBottom: "10px", borderRadius: DSGN.radius.md, border: "1px solid rgba(161, 135, 255, 0.22)", background: "linear-gradient(135deg, rgba(159, 119, 255, 0.14), rgba(159, 119, 255, 0.03))" } },
          react.createElement("div", null,
          react.createElement("div", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary)", marginBottom: "2px" } }, "当前会话可用 / 已加载喵"),
            react.createElement("strong", { style: { fontSize: "20px", color: "var(--dsw-alias-label-primary)" } }, (st.availableCount ?? st.installed) + " / " + (st.activeCount ?? 0))),
          react.createElement("div", { style: { textAlign: "right", fontSize: "12px", color: st.missing.length ? "var(--dsw-alias-state-warn-primary)" : "var(--dsw-alias-state-success-primary)" } }, st.missing.length ? "有几项缺失喵" : "目录完整喵")),
        st.missing.length > 0 && react.createElement("div", { style: { color: "var(--dsw-alias-state-warn-primary)", fontSize: "12px", marginBottom: "8px" } }, "缺失的有：" + st.missing.join("、") + " 喵"),
        react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", marginBottom: "8px" } }, st.note || "可用来自目录，已加载来自本会话实际调用；慢慢来就好喵～"),
        react.createElement("div", { style: { marginBottom: "8px", padding: "9px", borderRadius: DSGN.radius.sm, border: "1px solid rgba(103, 214, 166, 0.2)", background: "rgba(52, 165, 116, 0.08)" } },
          react.createElement("strong", { style: { display: "block", color: "var(--dsw-alias-state-success-primary)", marginBottom: "5px" } }, "本会话已加载"),
          st.activeCount ? st.active.join(" · ") : "暂时还没看到 Skill 被调用；模型需要它时会按需加载喵～"),
        react.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "6px" } },
          st.skills.map((s) => react.createElement("div", { key: s.name, style: { display: "flex", minWidth: 0, alignItems: "center", gap: "7px", padding: "7px 8px", borderRadius: DSGN.radius.sm, border: "1px solid " + (s.ok ? "rgba(103, 214, 166, 0.17)" : "rgba(240, 150, 135, 0.22)"), background: s.ok ? "rgba(52, 165, 116, 0.08)" : "rgba(188, 73, 63, 0.1)" } },
            react.createElement("span", { style: { color: s.ok ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)" } }, s.ok ? "✓" : "✗"),
            react.createElement("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: "12px" } }, s.name))))
      );
    }

    function LibraryTab() {
      const [query, setQuery] = react.useState("");
      const [result, setResult] = react.useState(null);
      const [selected, setSelected] = react.useState(null);
      const [message, setMessage] = react.useState("");
      const [browse, setBrowse] = react.useState(null);
      const [browseOpen, setBrowseOpen] = react.useState(false);
      react.useEffect(() => {
        let cancelled = false;
        fetch("/tavernweave/library/browse").then((r) => r.json()).then((data) => { if (!cancelled) setBrowse(data); }).catch(() => {});
        return () => { cancelled = true; };
      }, []);
      const searchValue = (value) => {
        const q = String(value || "").trim();
        if (!q) { setResult({ results: [], note: "先输入一个关键词，就可以开始翻资料喵～" }); return; }
        setMessage("正在翻资料喵…");
        setSelected(null);
        fetch("/tavernweave/library/search?q=" + encodeURIComponent(q))
          .then((r) => { if (!r.ok) throw new Error("search request failed"); return r.json(); })
          .then((data) => { setResult(data); setMessage(data.error || data.note || (data.results.length ? "" : "没有找到相关资料，再换个词试试喵～")); })
          .catch(() => setMessage("资料库暂时打盹了，过一会儿再试试喵～"));
      };
      const search = (event) => { event.preventDefault(); searchValue(query); };
      const openDoc = (item) => {
        setMessage("正在打开这篇资料喵…");
        fetch("/tavernweave/library/doc?domain=" + encodeURIComponent(item.domain) + "&file=" + encodeURIComponent(item.file))
          .then((r) => { if (!r.ok) throw new Error("document request failed"); return r.json(); })
          .then((data) => {
            if (data.error) throw new Error(data.error);
            setSelected({ title: item.title, content: data.content });
            setMessage("");
          }).catch((error) => setMessage("这篇资料暂时读不出来：" + (error.message || "未知错误") + " 喵～"));
      };
      const input = { flex: 1, minWidth: 0, boxSizing: "border-box", padding: "7px 9px", borderRadius: DSGN.radius.sm, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px" };
      const quickSearch = (value) => { setQuery(value); searchValue(value); };
      return react.createElement("div", null,
        react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: 1.5, marginBottom: "8px" } }, "这里收着原作者的制卡规范、MVU、世界书、正则、开场和界面指南喵～先搜一搜、读一读，再把结论交给 DSH 制卡工作台；资料只读，不会偷偷改您的卡片。"),
        react.createElement("form", { onSubmit: search, style: { display: "flex", gap: "6px", marginBottom: "10px" } },
          react.createElement("input", { style: input, value: query, placeholder: "例如：正则、MVU、世界书", "aria-label": "搜索资料库", onChange: (e) => setQuery(e.target.value) }),
          react.createElement("button", { type: "submit", style: primaryBtn }, "搜索")),
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap", marginBottom: "9px" } },
          react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" } }, "想快速查："),
          ["角色卡", "MVU", "世界书", "正则", "开场"].map((value) => react.createElement("button", { key: value, type: "button", style: { ...btn, minHeight: "25px", padding: "2px 7px", fontSize: "11px" }, onClick: () => quickSearch(value) }, value)),
          react.createElement("button", { type: "button", style: { ...btn, minHeight: "25px", padding: "2px 7px", fontSize: "11px", color: browseOpen ? accentText(TAB_TONE.library.accent) : "var(--dsw-alias-label-secondary)" }, onClick: () => setBrowseOpen(!browseOpen) }, browseOpen ? "收起浏览" : "按阶段/主题浏览")),
        browseOpen && react.createElement("div", { style: { marginBottom: "9px", display: "grid", gap: "7px" } },
          (browse?.groups || []).map((group) => react.createElement("div", { key: group.label, style: { padding: "8px 9px", borderRadius: DSGN.radius.sm, border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-module-platform)" } },
            react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" } },
              react.createElement("span", { style: { fontSize: "12px", color: accentText(TAB_TONE.library.accent), fontWeight: 600, flexShrink: 0 } }, group.label),
              react.createElement("span", { style: { flex: 1, height: "1px", background: "var(--dsw-alias-border-l1)" } }),
              react.createElement("span", { style: { fontSize: "10px", color: "var(--dsw-alias-label-tertiary)" } }, group.items.length + " 条")),
            react.createElement("div", { style: { display: "grid", gap: "3px", maxHeight: "180px", overflowY: "auto" } },
              group.items.map((item) => react.createElement("button", { key: item.domain + ":" + item.file, type: "button", onClick: () => openDoc(item), title: item.title, style: { textAlign: "left", padding: "4px 6px", borderRadius: DSGN.radius.sm, border: "none", background: "transparent", color: "var(--dsw-alias-label-secondary)", fontSize: "12px", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                item.title)))))),
        message && react.createElement("div", { role: "status", style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginBottom: "8px" } }, message),
        selected && react.createElement("section", { style: { marginBottom: "10px", padding: "10px", borderRadius: DSGN.radius.md, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)" } },
          react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" } },
            react.createElement("strong", { style: { fontSize: "13px" } }, selected.title),
            react.createElement("button", { type: "button", style: { ...btn, minHeight: "25px", padding: "2px 7px", marginLeft: "auto" }, onClick: () => setSelected(null), "aria-label": "关闭资料全文" }, "关闭")),
          react.createElement("pre", { style: { margin: 0, maxHeight: "min(360px, 45dvh)", overflow: "auto", padding: "9px", borderRadius: DSGN.radius.sm, background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "12px", lineHeight: 1.55 } }, selected.content)),
        result && result.results.map((item) => react.createElement("button", { key: item.domain + ":" + item.file, type: "button", onClick: () => openDoc(item), style: { display: "block", width: "100%", textAlign: "left", cursor: "pointer", padding: "9px 10px", marginBottom: "6px", borderRadius: DSGN.radius.sm, border: "1px solid var(--dsw-alias-border-l1)", background: "transparent", color: "var(--dsw-alias-label-primary)" } },
          react.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "3px" } },
            react.createElement("strong", { style: { fontSize: "13px" } }, item.title),
            react.createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary)" } }, item.domain)),
          react.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", marginTop: "5px" } },
            item.excerpt && react.createElement("div", { style: { fontSize: "12px", lineHeight: 1.45, color: "var(--dsw-alias-label-tertiary)" } }, item.excerpt),
            react.createElement("span", { style: { flexShrink: 0, color: "var(--dsw-alias-state-business-primary)", fontSize: "11px" } }, "打开全文 →"))))
      );
    }

    function UpdateTab({ state }) {
      const [busy, setBusy] = react.useState("");
      const [message, setMessage] = react.useState("");
      const refresh = () => { setMessage("正在看看有没有新版本喵…"); checkForUpdates().then(() => setMessage("检查完成啦～")).catch(() => setMessage("暂时连不上远端仓库，稍后再试试喵～")); };
      const apply = (target) => {
        setBusy(target); setMessage("正在小心更新，别急喵…");
        fetch("/tavernweave/update/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target }) }).then((r) => r.json()).then((data) => {
          setMessage(data.message || (data.ok ? "更新完成啦～" : "这次没有执行更新喵"));
          if (data.ok) return checkForUpdates();
          return data;
        }).catch(() => setMessage("更新没成功，请检查网络和本地仓库状态喵～" )).finally(() => setBusy(""));
      };
      return react.createElement("div", null,
        react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px" } },
          react.createElement("div", null, react.createElement("strong", { style: { fontSize: "15px" } }, "更新中心"), react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", marginTop: "3px" } }, "来看看 TavernWeave DSH 插件有没有新衣服，资料库会跟着原作者更新喵～")),
          react.createElement("button", { type: "button", style: primaryBtn, onClick: refresh, disabled: !!busy }, "去检查喵")),
        message && react.createElement("div", { role: "status", "aria-live": "polite", style: { marginBottom: "8px", color: "var(--dsw-alias-label-secondary)", fontSize: "12px" } }, message),
        (state.targets || []).map((item) => react.createElement("div", { key: item.id, style: { padding: "10px", marginBottom: "7px", borderRadius: DSGN.radius.md, border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-module-platform)" } },
          react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
            react.createElement("strong", null, item.label),
            react.createElement("span", { style: { marginLeft: "auto", fontSize: "11px", color: item.state === "update-available" ? "var(--dsw-alias-state-warn-primary)" : item.state === "up-to-date" ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)" } }, item.state === "update-available" ? "有新版本喵" : item.state === "up-to-date" ? "已经是最新喵" : item.state === "diverged" ? "本地与远端分叉啦" : item.state === "dirty" ? "还有未提交改动喵" : item.state)),
          item.changes && item.changes.length > 0 && react.createElement("div", { style: { marginTop: "6px", color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", whiteSpace: "pre-wrap" } }, item.changes.join("\n")),
          item.error && react.createElement("div", { style: { marginTop: "5px", color: "var(--dsw-alias-state-error-primary)", fontSize: "11px" } }, item.error),
          item.state === "update-available" && react.createElement("button", { type: "button", style: { ...btn, marginTop: "7px", color: "var(--dsw-alias-state-warn-primary)", borderColor: "rgba(239,142,98,.45)" }, disabled: !!busy, onClick: () => apply(item.id) }, busy === item.id ? "更新中喵…" : "一键安全更新喵"))),
         react.createElement("div", { style: { marginTop: "10px", color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", lineHeight: 1.5 } }, "更新插件代码后通常要重新加载 DSH 插件喵～资料库会随原作者更新，但不会碰您的角色卡项目。"));
    }

    function StatusBarPreview({ analysis }) {
      const [compact, setCompact] = react.useState(false);
      const [copied, setCopied] = react.useState("");
      const sections = Array.isArray(analysis?.sections) ? analysis.sections : [];
      const hasVariables = (Array.isArray(analysis?.variableModel) && analysis.variableModel.length > 0) || sections.some((item) => item.id === "variables" && item.present);
      const hasWorldbook = sections.some((item) => item.id === "worldbook" && item.present);
      const hasOpenings = sections.some((item) => item.id === "openings" && item.present);
      const name = analysis?.name || "示例角色";
      const vars = Array.isArray(analysis?.variableModel) ? analysis.variableModel.slice(0, 8) : [];
      const generated = vars.length > 0;
      const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const chipData = generated ? vars.map((p) => ({ label: p.label, value: p.value, path: p.path }))
        : [{ label: "好感度", value: "72", path: "" }, { label: "体力", value: "86%", path: "" }, { label: "心情", value: "平稳", path: "" }];
      const chipColors = ["#f0c879", "#74e0b2", "#65d2ff", "#bca4ff", "#efc47c", "#ef8e62", "#eeae7a", "#9ee7bd"];
      const buildHtml = () => chipData.map((c, i) => '<div class="tw-stat"><span class="tw-stat-label">' + esc(c.label) + '</span><span class="tw-stat-value">' + esc(String(c.value)) + '</span></div>').join("\n");
      const hudHtml = '<div class="tw-hud" data-tanuki-statusbar>\n' + buildHtml() + "\n</div>";
      const regexJson = JSON.stringify({ id: "卡内状态栏 HUD", scriptName: "卡内状态栏 HUD", findRegex: "/<StatusPlaceHolderImpl\\s*\\/>/g", trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null, replaceString: hudHtml }, null, 2);
      const getvarLine = generated
        ? chipData.map((c) => (c.path ? '{{getvar:' + c.path + '}}' : c.label + ":" + c.value)).join(" ｜ ")
        : "境界：{{getvar:人物.境界}} ｜ 阴沉：{{getvar:人物.阴沉}}（路径按实际变量填写）";
      const copyCode = (kind, text) => copyText(text).then((ok) => setCopied(ok ? kind : ""));
      const statCards = chipData.map((c, i) => react.createElement("div", { key: i, style: { padding: "7px 8px", borderRadius: DSGN.radius.sm, background: "rgba(255,255,255,.055)", border: "1px solid rgba(255,255,255,.1)" } },
        react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "10px", marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: c.path || c.label }, c.label),
        react.createElement("strong", { style: { color: chipColors[i % chipColors.length], fontSize: "13px" } }, String(c.value))));
      const badges = [["世界书", hasWorldbook], ["开场", hasOpenings], ["MVU", hasVariables]].map(([label, enabled]) => react.createElement("span", { key: label, style: { color: enabled ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-label-tertiary)", fontSize: "10px", border: "1px solid " + (enabled ? "#74e0b255" : "rgba(255,255,255,.14)"), background: enabled ? "rgba(116,224,178,.1)" : "rgba(255,255,255,.04)", borderRadius: DSGN.radius.pill, padding: "3px 7px" } }, (enabled ? "✓ " : "○ ") + label));
      const preview = react.createElement("div", { style: { padding: "11px", width: compact ? "min(290px, 100%)" : "100%", boxSizing: "border-box", margin: compact ? "0 auto" : 0, borderRadius: DSGN.radius.md, background: "rgba(7, 16, 27, .62)", border: "1px solid rgba(187, 220, 236, .2)", boxShadow: "0 5px 18px rgba(0,0,0,.16)", transition: "width .18s ease" } },
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "9px" } },
          react.createElement("span", { style: { width: "9px", height: "9px", borderRadius: "50%", background: "#74e0b2", boxShadow: "0 0 10px #74e0b299" } }),
          react.createElement("strong", { style: { fontSize: "15px" } }, name),
          react.createElement("span", { style: { marginLeft: "auto", color: "#bfe9ff", fontSize: "11px" } }, generated ? "按卡片变量生成预览" : "示例预览（示例数据）")),
        react.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(" + (chipData.length > 3 ? "3" : String(chipData.length)) + ", minmax(0, 1fr))", gap: "7px", marginBottom: "9px" } }, statCards),
        react.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center" } },
          badges,
          react.createElement("span", { style: { fontSize: "10px", color: "var(--dsw-alias-label-tertiary)" } }, generated ? "—— 状态栏代码已按变量生成，可复制下方代码" : "—— 未检测到变量路径，降级为文字状态行")));
      const codeSection = react.createElement("div", { style: { marginTop: "9px", padding: "9px", borderRadius: DSGN.radius.sm, background: "rgba(7,16,27,.36)", border: "1px solid rgba(116,224,178,.25)" } },
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "7px", marginBottom: "6px", flexWrap: "wrap" } },
          react.createElement("strong", { style: { fontSize: "12px", color: "var(--dsw-alias-label-primary)" } }, generated ? "已生成代码" : "降级方案（文字状态行）"),
          react.createElement("button", { type: "button", style: { ...btn, minHeight: "26px", padding: "2px 8px", fontSize: "11px", color: "var(--dsw-alias-state-warn-primary)" }, onClick: () => copyCode("regex", regexJson) }, copied === "regex" ? "已复制喵" : "复制替换正则 JSON"),
          react.createElement("button", { type: "button", style: { ...btn, minHeight: "26px", padding: "2px 8px", fontSize: "11px", color: "var(--dsw-alias-state-warn-primary)" }, onClick: () => copyCode("getvar", getvarLine) }, copied === "getvar" ? "已复制喵" : "复制 {{getvar}} 状态行")),
        react.createElement("div", { style: { fontSize: "11px", color: "var(--dsw-alias-label-secondary)", lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: "120px", overflowY: "auto", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" } }, generated ? hudHtml : "无变量路径时的降级状态行（替换为消息内联文本，使用 {{getvar:路径}} 读变量）：\n" + getvarLine),
        react.createElement("div", { style: { marginTop: "6px", fontSize: "10px", color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.45 } }, "用法：正则替换用「裸 HTML」（不要加 ```html 围栏，详见 A2 §10.4 真机勘误）；正则脚本需 allowScopedScripts 显式允许。"));
      return react.createElement("div", { style: { marginBottom: "11px", padding: "12px", borderRadius: DSGN.radius.lg, border: "1px solid #74e0b255", background: "linear-gradient(135deg, rgba(116,224,178,.16), rgba(101,210,255,.08) 55%, transparent 100%)" } },
        react.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "9px", flexWrap: "wrap" } },
          react.createElement("div", null,
            react.createElement("strong", { style: { display: "block", fontSize: "14px" } }, "卡内状态栏预览"),
            react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" } }, generated ? "已从卡片变量提取真实状态，可直接复制使用" : "未检测到变量，展示示例数据与降级方案")),
          react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "5px" } },
            react.createElement("button", { type: "button", onClick: () => setCompact(!compact), style: { ...btn, minHeight: "27px", padding: "2px 7px", fontSize: "11px", border: "1px solid #74e0b255", color: "var(--dsw-alias-state-success-primary)" }, title: compact ? "切换到宽屏预览" : "切换到窄屏预览" }, compact ? "窄屏" : "桌面"))),
        preview, codeSection);
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
      const [material, setMaterial] = react.useState(null);
      const [materialMessage, setMaterialMessage] = react.useState("");
      const tone = TAB_TONE.workshop;
      // 材料章节的防御性视图：chapterList 可能为 null/非数组（旧数据或异常恢复），永远先归一化再渲染。
      const materialChapters = Array.isArray(material && material.chapterList) ? material.chapterList : [];
      const materialDone = materialChapters.filter((ch) => ch && ch.status === "done").length;
      const loadProjects = () => fetch("/tavernweave/cards").then((r) => r.json()).then((data) => setProjects(Array.isArray(data.projects) ? data.projects : [])).catch(() => {});
      react.useEffect(() => { loadProjects(); }, []);
      const onFile = (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        setFileName(file.name);
        if (/\.png$/i.test(file.name)) {
          const fr = new FileReader();
          fr.onload = () => {
            try {
              const card = parsePngCard(fr.result);
              setText(JSON.stringify(card, null, 2));
              setMessage("PNG 角色卡加载成功喵～");
            } catch (e) { setMessage("PNG 解析失败：" + (e && e.message || e)); }
          };
          fr.onerror = () => setMessage("文件读不出来啦，请改用 JSON 文本粘贴喵～");
          fr.readAsArrayBuffer(file);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => setText(String(reader.result || ""));
        reader.onerror = () => setMessage("文件读不出来啦，请改用 JSON 文本粘贴喵～");
        reader.readAsText(file);
      };
      const onMaterialFile = (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        if (!/\.(txt|md|markdown)$/i.test(file.name)) {
          setMaterialMessage("这一步先接收 TXT 或 Markdown 文件喵～");
          event.target.value = "";
          return;
        }
        setMaterialMessage("");
        const reader = new FileReader();
        reader.onload = async () => {
          const content = String(reader.result || "");
          const chapterList = parseChapters(content);
          const lineCount = content ? content.split(/\r?\n/).length : 0;
          const charCount = content.replace(/\s/g, "").length;
          const chunkCount = Math.max(1, Math.ceil(content.length / 4000));
          let hash = "本机浏览器暂未提供哈希";
          try {
            if (window.crypto?.subtle) {
              const bytes = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
              hash = Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, "0")).join("");
            }
          } catch (error) { /* 哈希只是辅助登记，失败不影响预览。 */ }
          const saved = materialCheckpoint.read(hash);
          const merged = materialCheckpoint.chapters(chapterList, saved);
          const next = { name: file.name, chars: charCount, lines: lineCount, chapters: chapterList.length, chunks: chunkCount, hash, preview: content.slice(0, 180), chapterList: merged };
          materialCheckpoint.write(hash, { chapters: merged.map((ch) => ({ title: ch.title, chars: ch.chars, status: ch.status })) });
          setMaterial(next);
          setMaterialMessage("材料登记好啦～已切出 " + chapterList.length + " 个章节；上回确认进度：" + merged.filter((ch) => ch.status === "done").length + " 章（断点已恢复）喵～");
        };
        reader.onerror = () => setMaterialMessage("这份材料读不出来啦，换个 TXT 或 Markdown 文件再试试喵～");
        reader.readAsText(file);
      };
      const copyMaterialSummary = () => {
        if (!material) return;
        const rows = Array.isArray(material.chapterList) ? material.chapterList : [];
        const doneCount = rows.filter((ch) => ch && ch.status === "done").length;
        const summary = "材料登记：" + material.name + "；约 " + material.chars + " 字；" + material.chapters + " 个章节标题；已确认 " + doneCount + "/" + material.chapters + " 章；预计 " + material.chunks + " 段；SHA-256：" + material.hash;
        copyText(summary).then((ok) => setMaterialMessage(ok ? "材料摘要复制好啦，可以贴到会话里喵～" : "复制没成功，请手动记下上面的摘要喵～"));
      };
      const toggleChapter = (index) => {
        if (!material) return;
        const rows = Array.isArray(material.chapterList) ? material.chapterList : [];
        const chapterList = rows.map((ch, i) => i === index ? { ...ch, status: ch.status === "done" ? "pending" : "done" } : ch);
        setMaterial({ ...material, chapterList });
        materialCheckpoint.write(material.hash, { chapters: chapterList.map((ch) => ({ title: ch.title, chars: ch.chars, status: ch.status })) });
      };
      const copyChapterTask = (index) => {
        if (!material) return;
        const rows = Array.isArray(material.chapterList) ? material.chapterList : [];
        const ch = rows[index];
        if (!ch) return;
        const task = "材料章节：" + material.name + " · " + ch.title + "（约 " + ch.chars + " 字）\n来源片段：\n" + ch.preview + "…\n请按“事实 / 推断”两栏整理本章：事实直接标出来源语句；推断（需要我确认的设计）单独列出并说明理由喵～";
        copyText(task).then((ok) => { if (ok) toggleChapter(index); setMaterialMessage(ok ? "第 " + (index + 1) + " 章任务已复制，并标记为待确认喵～" : "复制没成功，请手动选中上面的章节喵～"); });
      };
      const copyNextPending = () => {
        if (!material) return;
        const rows = Array.isArray(material.chapterList) ? material.chapterList : [];
        const idx = rows.findIndex((ch) => ch && ch.status !== "done");
        if (idx < 0) { setMaterialMessage("全部章节都确认啦～可以开始写卡了喵！"); return; }
        copyChapterTask(idx);
      };
      const inspect = (event) => {
        event.preventDefault();
        setMessage(""); setAnalysis(null);
        let payload;
        try { payload = JSON.parse(text); } catch { setMessage("JSON 格式还没解析成功，请检查逗号、引号和括号喵～"); return; }
        fetch("/tavernweave/card/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
          .then((r) => r.json()).then((data) => {
            if (data.error) throw new Error(data.error);
            setBaseline(text); setAnalysis(data);
            const card = payload.data && typeof payload.data === "object" ? payload.data : payload;
            setComponentValue(String(card.description || ""));
            const existing = projects.find((item) => item.id === projectId);
            const sectionsSummary = Object.fromEntries((data.sections || []).map((section) => [section.id, section.count || 0]));
            const project = { id: existing?.id, sessionId: currentSessionId(), name: data.name || fileName || "未命名卡片", sourceFileName: fileName, cardFormat: data.format, phase: "待盘点", status: "进行中", version: existing?.version || "0.1.0", sourceHash: "", draft: text, sectionsSummary, workflow: existing?.workflow || initialWorkflow(sectionsSummary), acceptanceState: "未验收" };
            const request = existing ? fetch("/tavernweave/cards/" + encodeURIComponent(existing.id), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(project) }) : fetch("/tavernweave/cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(project) });
            request.then((r) => r.json()).then((saved) => { if (saved.id) setProjectId(saved.id); loadProjects(); try { window.dispatchEvent(new CustomEvent("tavernweave:card-project-updated")); } catch (e) {} }).catch(() => {});
          }).catch((e) => setMessage((e.message || "盘点失败") + "，稍后再试试喵～"));
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
          setText(nextText); setAnalysis(null); setMessage("组件更新好啦，请重新盘点后再导出喵～");
          updateProject({ draft: nextText, phase: "组件编辑", status: "进行中" });
        } catch { setMessage("当前 JSON 没法更新这个组件，请检查内容喵～"); }
      };
      const exportJson = () => {
        const blob = new Blob([text], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = fileName || ((analysis && analysis.name) || "tavernweave-card") + ".json";
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
      };
      const input = { width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: DSGN.radius.sm, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: "12px", lineHeight: 1.5 };
      const workflowPrompt = (kind) => kind === "new"
        ? "我要从零制作一张 SillyTavern 角色卡。请严格按 TavernWeave 制卡流程开始：先访谈我的玩法、叙事目标、卡片类型、变量需求、世界书、开场和运行时依赖；先给出目标/红线/验收三句话和一份简短合同，不要直接写文件。确认后再建立组件与版本化交付。完成后请自动收录：用 POST /tavernweave/cards 登记项目，并用 POST /tavernweave/card/analyze 写入组件盘点；同时把卡内状态栏等嵌入前端（HTML/CSS/JS 或 MVU 变量）的最终代码贴出来给用户预览。"
        : "我要改造一张已有的 SillyTavern 角色卡。请先读取我提供的 JSON/PNG，保留原文件只读快照并记录哈希，盘点卡片类型、世界书、正则、变量、Tavern Helper、开场和宿主依赖；先说明改动边界与风险，不要静默重封或覆盖原卡，确认后再做组件级增量修改。若会话具备酒馆只读工具（mcp__sillytavern__*），仅可用来只读核对当前这张卡与相关环境，不扫描整个卡库、不修改任何内容；不具备则以用户提供的文件为准。完成后请自动收录：用 POST /tavernweave/cards 登记项目，并用 POST /tavernweave/card/analyze 写入组件盘点；同时把卡内状态栏等嵌入前端（HTML/CSS/JS 或 MVU 变量）的最终代码贴出来给用户预览。";
      const copyWorkflow = (kind) => copyText(workflowPrompt(kind)).then((ok) => setWorkflowMessage(ok ? "首轮指令复制好啦，贴到 DSH 对话就能开始喵～" : "复制没成功，请手动选中下面的文字喵。"));
      const updateProject = (patch) => {
        if (!projectId) return;
        fetch("/tavernweave/cards/" + encodeURIComponent(projectId), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then(() => { loadProjects(); try { window.dispatchEvent(new CustomEvent("tavernweave:card-project-updated")); } catch (e) {} }).catch(() => {});
      };
      return react.createElement("div", null,
        react.createElement("div", { style: { marginBottom: "11px", padding: "8px 10px", borderRadius: DSGN.radius.sm, background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", lineHeight: 1.5 } }, "第一次来制卡吗？先点“从零制作新卡”或“改造已有卡”复制首轮指令，再去 DSH 会话发送喵～导入 JSON 后，就能在这里盘点结构、做组件级修改啦。"),
        react.createElement("div", { style: { marginBottom: "11px", padding: "10px", borderRadius: DSGN.radius.md, border: "1px solid #65d2ff44", background: "linear-gradient(135deg, rgba(101,210,255,.1), transparent 75%)" } },
          react.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap", marginBottom: "4px" } },
            react.createElement("strong", { style: { fontSize: "13px" } }, "从材料开始"),
            react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" } }, "TXT / Markdown · 只在本地预览")),
          react.createElement("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", lineHeight: 1.5, marginBottom: "8px" } }, "先登记材料，再决定怎么写卡；不会自动上传，也不会改动现有卡片喵～"),
          react.createElement("label", { style: { display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 9px", borderRadius: DSGN.radius.sm, border: "1px dashed #65d2ff66", color: accentText(DSGN.accent.blue), cursor: "pointer", fontSize: "12px" } },
            react.createElement("input", { type: "file", accept: ".txt,.md,.markdown,text/plain,text/markdown", onChange: onMaterialFile, style: { display: "none" } }), "选择材料文件"),
          material && react.createElement("div", { style: { marginTop: "8px", padding: "8px", borderRadius: DSGN.radius.sm, background: "var(--dsw-alias-bg-module-platform)", border: "1px solid rgba(101,210,255,.18)" } },
            react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" } },
              react.createElement("strong", { style: { minWidth: 0, maxWidth: "55%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, material.name),
              react.createElement("span", { style: { color: accentText(DSGN.accent.blue), fontSize: "11px" } }, material.chars + " 字 · " + material.chapters + " 章 · 预计 " + material.chunks + " 段"),
              react.createElement("button", { type: "button", style: { ...btn, marginLeft: "auto", minHeight: "26px", padding: "2px 7px", fontSize: "11px", color: accentText(DSGN.accent.blue), borderColor: "#65d2ff55" }, onClick: copyMaterialSummary }, "复制登记摘要")),
            react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "10px", marginTop: "4px", wordBreak: "break-all" } }, "本地哈希：" + material.hash),
            material.preview && react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", marginTop: "5px", lineHeight: 1.45 } }, "开头预览：" + material.preview + (material.preview.length >= 180 ? "…" : ""))),
            materialChapters.length ? react.createElement("div", { style: { marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--dsw-alias-border-l1)" } },
              react.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "6px", flexWrap: "wrap" } },
                react.createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-secondary)", fontWeight: 600 } }, "章节大纲（" + materialDone + "/" + materialChapters.length + " 已确认）"),
                react.createElement("button", { type: "button", style: { ...btn, minHeight: "24px", padding: "2px 7px", fontSize: "11px", color: accentText(DSGN.accent.blue) }, onClick: copyNextPending }, "续接下一章")),
              react.createElement("div", { style: { display: "grid", gap: "4px", maxHeight: "180px", overflowY: "auto" } },
                materialChapters.map((ch, i) => react.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: "6px", minHeight: "24px" } },
                  react.createElement("span", { style: { width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0, background: ch && ch.status === "done" ? "#74e0b2" : "#f0c879" } }),
                  react.createElement("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px" } }, (i + 1) + ". " + (ch && ch.title || "未命名章节") + "（" + (ch && ch.chars || 0) + " 字）"),
                  react.createElement("button", { type: "button", style: { ...btn, minHeight: "22px", padding: "1px 6px", fontSize: "10px", color: accentText(DSGN.accent.blue) }, onClick: () => copyChapterTask(i) }, "任务"),
                  react.createElement("button", { type: "button", style: { ...btn, minHeight: "22px", padding: "1px 6px", fontSize: "10px", color: ch && ch.status === "done" ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-label-tertiary)" }, onClick: () => toggleChapter(i) }, ch && ch.status === "done" ? "✓ 已确认" : "确认")))))
            : null,
          materialMessage && react.createElement("div", { role: "status", style: { marginTop: "6px", color: "var(--dsw-alias-label-secondary)", fontSize: "11px" } }, materialMessage)),
        react.createElement("div", { style: { marginBottom: "11px", padding: "10px", borderRadius: DSGN.radius.md, border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-module-platform)" } },
          react.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "7px" } },
            react.createElement("strong", { style: { fontSize: "13px" } }, "卡片项目"),
            react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" } }, projects.length + " 个本地项目")),
          projects.length === 0 && react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: 1.5 } }, "还没有项目喵～AI 写完卡会自动收录到这里；已有的/外来的卡，可以在下面『导入 JSON 卡』手动盘点。之后它会一直帮您记住阶段和版本。"),
          projects.map((project) => react.createElement("button", { key: project.id, type: "button", onClick: () => { setProjectId(project.id); setVersionDraft(project.version || "0.1.0"); setText(project.draft || ""); setFileName(project.sourceFileName || ""); setMessage("项目草稿载入好啦，可以继续盘点或编辑喵～"); }, style: { display: "flex", width: "100%", alignItems: "center", gap: "8px", textAlign: "left", padding: "8px", marginTop: "5px", borderRadius: DSGN.radius.sm, border: project.id === projectId ? "1px solid " + tone.accent + "66" : "1px solid var(--dsw-alias-border-l1)", background: project.id === projectId ? tone.soft : "transparent", color: "var(--dsw-alias-label-primary)", cursor: "pointer" } },
            react.createElement("span", { style: { width: "8px", height: "8px", borderRadius: "50%", background: project.status === "已完成" ? "#74e0b2" : "#f0c879", flexShrink: 0 } }),
            react.createElement("span", { style: { minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, project.name),
            react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" } }, project.phase + " · v" + project.version))))),
        analysis && react.createElement(StatusBarPreview, { analysis }),
        react.createElement("div", { style: { padding: "12px", borderRadius: DSGN.radius.lg, border: "1px solid " + tone.accent + "38", background: "linear-gradient(135deg, " + tone.soft + ", transparent 78%)", marginBottom: "11px" } },
            react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", marginBottom: "5px" } },
            react.createElement("strong", { style: { fontSize: "15px" } }, "从这里开始制卡"),
            react.createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary)" } }, currentWorkspacePath() || "当前会话工作区未解析")),
          react.createElement("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", lineHeight: 1.5, marginBottom: "9px" } }, "先让 DSH 做调查和方案，再来编辑组件喵～不要一上来就把整张卡揉成一团 JSON 哦。"),
          react.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "7px" } },
            [["new", "从零制作新卡", "先聊聊，再定卡型与变量喵"], ["retrofit", "改造已有卡", "先盘点，保留原味和回滚点喵"]].map(([kind, title, detail]) => react.createElement("button", { key: kind, type: "button", style: { ...btn, minHeight: "62px", textAlign: "left", padding: "9px 10px", border: "1px solid " + tone.accent + "44", background: "var(--dsw-alias-bg-module-platform)" }, onClick: () => copyWorkflow(kind) },
              react.createElement("strong", { style: { display: "block", color: accentText(tone.accent), fontSize: "13px", marginBottom: "3px" } }, title),
              react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" } }, detail)))),
          workflowMessage && react.createElement("div", { role: "status", style: { color: "var(--dsw-alias-state-success-primary)", fontSize: "12px", marginTop: "8px" } }, workflowMessage)),
        react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px" } },
          react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" } }, "导入 JSON 卡：AI 写的卡会自动收录，这里用于处理已有/外来的卡，或需要时手动盘点。PNG 载荷解析会在打包阶段接入；文件内容只在本地浏览器处理，请放心。"),
          analysis && react.createElement("button", { type: "button", style: { ...btn, minHeight: "29px", padding: "3px 8px", color: accentText(tone.accent) }, onClick: exportJson }, "导出 JSON")),
        react.createElement("label", { style: { display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 11px", minHeight: "30px", borderRadius: DSGN.radius.sm, border: "1px solid " + tone.accent + "55", background: "var(--dsw-alias-bg-module-platform)", color: accentText(tone.accent), fontWeight: 600, fontSize: "12px", cursor: "pointer", marginBottom: "8px" } },
          react.createElement("input", { type: "file", accept: ".json,.png,application/json,image/png", onChange: onFile, style: { display: "none" } }), fileName ? "已载入：" + fileName : "选择 JSON / PNG 卡片文件（或直接粘贴）"),
        react.createElement("textarea", { style: { ...input, minHeight: "132px", resize: "vertical" }, value: text, placeholder: '{\n  "name": "角色名",\n  "description": "..."\n}', "aria-label": "角色卡 JSON", onChange: (e) => { setText(e.target.value); setAnalysis(null); } }),
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" } }, react.createElement("button", { type: "button", style: { ...primaryBtn, color: "var(--dsw-alias-label-primary)" }, onClick: inspect }, "开始结构盘点"), message && react.createElement("span", { role: "status", style: { color: "var(--dsw-alias-state-error-primary)", fontSize: "12px" } }, message)),
        analysis && react.createElement("div", { style: { marginTop: "12px" } },
          react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" } }, react.createElement("strong", { style: { fontSize: "16px" } }, analysis.name), react.createElement("span", { style: { color: accentText(tone.accent), fontSize: "12px", fontFamily: "monospace" } }, analysis.format)),
          react.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: "6px" } }, analysis.sections.map((section) => react.createElement("div", { key: section.id, style: { padding: "9px", borderRadius: DSGN.radius.sm, border: "1px solid " + (section.present ? tone.accent + "40" : "var(--dsw-alias-border-l1)"), background: section.present ? tone.soft : "var(--dsw-alias-bg-module-platform)" } }, react.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: "6px" } }, react.createElement("strong", { style: { fontSize: "12px" } }, section.label), react.createElement("span", { style: { color: section.present ? accentText(tone.accent) : "var(--dsw-alias-label-tertiary)", fontSize: "12px" } }, section.present ? "已发现" : "未发现")), react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "11px", marginTop: "4px" } }, section.present ? section.count + " 项 · " + section.detail : section.detail)))),
          react.createElement("div", { style: { marginTop: "9px", padding: "9px 10px", borderRadius: DSGN.radius.sm, background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", fontSize: "12px", lineHeight: 1.55 } }, "接下来可以：" + analysis.next.join(" → ") + " 喵～"),
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
              react.createElement("button", { type: "button", style: { ...btn, color: accentText(tone.accent) }, onClick: applyComponent }, "应用到卡片草稿"),
              baseline && baseline !== text && react.createElement("span", { style: { color: "var(--dsw-alias-state-warn-primary)", fontSize: "12px" } }, "还有改动没导出喵～"))));
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
        }).then(setS).catch(() => setMsg("设置没读到，再试一次就好喵～"));
      }, []);
      react.useEffect(() => {
        syncWorkspaceOptions();
        window.addEventListener("tavernweave:workspace-updated", syncWorkspaceOptions);
        return () => window.removeEventListener("tavernweave:workspace-updated", syncWorkspaceOptions);
      }, []);
      if (!s) return react.createElement("div", null, "正在把设置翻出来喵…");
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
          .then((next) => { setS(next); announceSettings(next); setMsg("设置保存好啦～"); }).catch(() => setMsg("设置没保存成功，请再试试喵～"));
      };
      const label = { display: "block", fontSize: "13px", color: "var(--dsw-alias-label-secondary)", marginBottom: "4px", marginTop: "10px" };
      const input = { width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: DSGN.radius.sm, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px" };
      return react.createElement("div", { style: { maxWidth: "560px" } },
        react.createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginBottom: "2px" } }, "入口显示由白名单照看：留空时会乖乖隐藏；当前版本保存任意路径就能启用入口喵～"),
        react.createElement("label", { style: label }, "工作区白名单（选择后添加；留空 = 不显示入口）"),
        react.createElement("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
          react.createElement("select", { style: { ...input, flex: 1 }, value: workspacePick, onChange: (e) => setWorkspacePick(e.target.value) },
            react.createElement("option", { value: "" }, workspaceOptions.length ? "选择一个 DSH 工作区…" : "暂未读取到 DSH 工作区"),
            workspaceOptions.map((item) => react.createElement("option", { key: item.path, value: item.path }, item.title + " · " + item.path))),
          react.createElement("button", { type: "button", style: { ...btn, minHeight: "31px", whiteSpace: "nowrap" }, disabled: !workspacePick, onClick: () => addWorkspace(workspacePick) }, "添加")),
        react.createElement("div", { style: { display: "grid", gap: "5px", marginTop: "7px" } },
          (s.enabledWorkspaces || []).map((path) => react.createElement("div", { key: path, style: { display: "flex", alignItems: "center", gap: "7px", padding: "7px 8px", borderRadius: DSGN.radius.sm, background: "var(--dsw-alias-bg-module-platform)", border: "1px solid var(--dsw-alias-border-l1)" } },
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
        react.createElement("div", { style: { marginTop: "14px", padding: "10px", borderRadius: DSGN.radius.sm, border: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: 1.5 } }, "人格选择会立刻影响工作台提示喵～模拟酒馆先乖乖暂缓，接下来优先把制卡和真实酒馆验收走通。"),
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginTop: "16px" } },
          react.createElement("button", { type: "button", style: { ...primaryBtn, padding: "6px 16px" }, onClick: save }, "保存设置"),
          msg && react.createElement("span", { style: { fontSize: "13px", color: msg === "已保存" ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)" } }, msg))
      ));
    }

    function TavernWeaveSection() {
      return react.createElement("div", { style: { padding: "4px 0" } }, react.createElement(SettingsForm));
    }

    function apply(ctx) {
      // 注入 scoped UI 样式：按钮按压/焦点反馈 + reduced-motion（详见 docs/前端质感体检报告.md P0）。
      ctx.effect(() => {
        const style = document.createElement("style");
        style.setAttribute("data-tavernweave-workbench", "ui");
        style.textContent = [
          ".tw-root button { transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), background-color 140ms ease, border-color 140ms ease, color 140ms ease; }",
          ".tw-root button:active { transform: scale(0.97); }",
          ".tw-root button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }",
          ".tw-root .tw-pop { opacity: 1; transition: opacity 150ms ease-out, translate 150ms ease-out; }",
          ".tw-root .tw-panel { opacity: 1; transition: opacity 180ms ease-out, translate 180ms ease-out; }",
          "@starting-style {",
          "  .tw-root .tw-pop { opacity: 0; translate: 0 4px; }",
          "  .tw-root .tw-panel { opacity: 0; translate: 0 10px; }",
          "}",
          "@media (prefers-reduced-motion: reduce) {",
          "  .tw-root button { transition: none; }",
          "  .tw-root button:active { transform: none; }",
          "  .tw-root .tw-pop, .tw-root .tw-panel { transition: none; }",
          "}",
        ].join("\n");
        document.head.appendChild(style);
        return () => { try { style.remove(); } catch (e) {} };
      }, "tavernweave: ui stylesheet");
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
              const data = await fetch("/tavernweave/usage", { signal: req.signal, cache: "no-store" }).then((r) => r.json());
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
        nativeGoalServices = { sessions: workspaceServices.sessions };
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
          nativeGoalServices = null;
          if (visibleValue) { visibleValue = false; notifyVisible(); }
        };
      }, "tavernweave: workspace visibility");
      // 入口只保留侧栏底部（与「设置」并排，DSH footer.action 槽的官方用法）。
      // 会话 dock 使用 conversation.input.dock，确保位于输入框上方。
      ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register({ name: "sidebar.footer.action", id: "tavernweave-sidebar-btn" }, TavernButton)
      ), "tavernweave: sidebar button");

      // 与 DSH 0.1.2 官方 conversation 插件保持相同的注册生命周期。
      // input.dock 位于输入框上方，避免 composer footer 令聊天内容下移。
      ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
        name: "conversation.input.dock",
        id: "tavernweave-conversation-dock",
        order: 80,
      }, ConversationDock));

      // 会话头部右侧工具区：与原生 Session 日志并排，不挤占制卡工具栏。
      ctx.effect(() => ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
        name: "conversation.session.header.utilities",
        id: "tavernweave-card-status",
        order: 80,
      }, CardStatusCapsule)), "tavernweave: card status capsule");

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
