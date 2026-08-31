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

    const inject = ["slots"];

    // ---------- 工作区可见性（模块级单例：两个入口按钮共享一份轮询） ----------
    let settingsCache = null;
    let visibleListeners = [];
    let visibleValue = false;
    let pollTimer = null;

    function notifyVisible() {
      visibleListeners.forEach((fn) => { try { fn(visibleValue); } catch (e) {} });
    }

    function refreshSettings() {
      fetch("/tavernweave/settings").then((r) => {
        if (!r.ok) throw new Error("settings request failed");
        return r.json();
      }).then((s) => {
        settingsCache = s;
        const v = (s.enabledWorkspaces || []).length > 0;
        if (v !== visibleValue) { visibleValue = v; notifyVisible(); }
      }).catch(() => {});
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
        visibleListeners.push(setVisible);
        if (visibleListeners.length === 1) startPolling();
        return () => {
          visibleListeners = visibleListeners.filter((f) => f !== setVisible);
          if (visibleListeners.length === 0) stopPolling();
        };
      }, []);
      return visible;
    }

    // ---------- 面板开合（模块级单例：两个入口按钮共享开关，不会双开） ----------
    let openListeners = [];
    let openValue = false;

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

    // ---------- 样式（跟随 DSH 主题变量，不自造风格） ----------
    const btn = { fontSize: "13px", padding: "5px 10px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", background: "transparent", color: "var(--dsw-alias-label-secondary)", cursor: "pointer", lineHeight: 1.25 };
    const primaryBtn = { ...btn, border: "1px solid var(--dsw-alias-state-business-primary)", color: "var(--dsw-alias-label-primary)", background: "color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent)" };
    // 面板用 portal 挂到 document.body，fixed 定位到视口，避开侧栏列 overflow:hidden 裁剪
    const panelStyle = { position: "fixed", bottom: "88px", width: "min(460px, calc(100vw - 32px))", maxHeight: "calc(100vh - 170px)", overflowY: "auto", padding: "14px 16px", borderRadius: "12px", background: "var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))", border: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", zIndex: 999, boxShadow: "0 12px 32px rgba(0,0,0,0.35)" };
    const panelSide = () => (settingsCache && settingsCache.panelPosition === "left") ? { left: "24px" } : { right: "24px" };

    // ---------- 主面板入口（composer dock 小按钮） ----------
    function TavernButton() {
      const visible = useVisible();
      const [open, setOpen] = usePanelOpen();
      if (!visible) return null;
      const close = () => setOpen(false);
      return react.createElement("div", { style: { position: "relative" } },
        react.createElement("button", { style: btn, title: "TavernWeave 酒馆工作台", onClick: () => setOpen(!open) }, "🍺 酒馆"),
        open && reactDom.createPortal(react.createElement("div", null,
          react.createElement("div", { onClick: close, style: { position: "fixed", inset: 0, zIndex: 998, background: "transparent" } }),
          react.createElement(WorkbenchPanel, { onClose: close })
        ), document.body)
      );
    }

    // ---------- 主面板（M1 骨架：使用说明页已实装，其余页签占位） ----------
    function WorkbenchPanel(props) {
      const [tab, setTab] = react.useState("usage");
      const [usage, setUsage] = react.useState(null);
      const [hint, setHint] = react.useState("");
      react.useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") props.onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, []);
      react.useEffect(() => {
        fetch("/tavernweave/usage").then((r) => r.json()).then((j) => setUsage(j.camps || [])).catch(() => setUsage([]));
      }, []);
      const tabs = [["usage", "口令速查"], ["skills", "技能状态"], ["library", "资料库"]];
      return react.createElement("div", { style: { ...panelStyle, ...panelSide() } },
        react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "12px" } },
          react.createElement("div", null,
            react.createElement("div", { style: { color: "var(--dsw-alias-state-business-primary)", fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "3px" } }, "TAVERNWEAVE WORKBENCH"),
            react.createElement("strong", { style: { fontSize: "16px" } }, "酒馆工作台"),
            react.createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginTop: "3px" } }, "口令、技能与资料库的轻量入口")),
          react.createElement("span", null,
            react.createElement("button", { type: "button", style: { ...btn, marginRight: "6px" }, title: "打开设置说明", "aria-label": "打开设置说明", onClick: () => setHint("设置入口：DSH 左下角「设置」→ TavernWeave 分区") }, "⚙"),
            react.createElement("button", { type: "button", style: btn, title: "关闭工作台", "aria-label": "关闭工作台", onClick: props.onClose }, "×"))),
        hint && react.createElement("div", { role: "status", style: { fontSize: "12px", color: "var(--dsw-alias-state-warn-primary)", marginBottom: "8px", padding: "6px 8px", borderRadius: "7px", background: "color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent)" } }, hint),
        react.createElement("div", { role: "tablist", style: { display: "flex", gap: "4px", padding: "4px", borderRadius: "10px", background: "var(--dsw-alias-bg-base)", marginBottom: "12px" } },
          tabs.map(([id, label]) => react.createElement("button", { key: id, type: "button", role: "tab", "aria-selected": tab === id, style: { ...btn, flex: 1, border: "1px solid transparent", background: tab === id ? "var(--dsw-alias-bg-layer-1)" : "transparent", color: tab === id ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)", fontWeight: tab === id ? 700 : 400, boxShadow: tab === id ? "0 1px 3px rgba(0,0,0,0.15)" : "none" }, onClick: () => { setTab(id); setHint(""); } }, label))),
        tab === "usage" && react.createElement(UsageTab, { usage }),
        tab === "skills" && react.createElement(SkillsTab, { status: null, fetchStatus: true }),
        tab === "library" && react.createElement(LibraryTab)
      );
    }

    // ---------- 使用说明（两层分类：阵营 → 小类 → 口令） ----------
    const CAMP_ACCENT = { st: "var(--dsw-alias-state-business-primary)", vibe: "#9d5f4d" };

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
      const header = react.createElement("button", { onClick: onToggle, style: { width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "8px 10px", borderRadius: "8px", cursor: "pointer" } },
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
          react.createElement("span", { style: { width: "8px", height: "8px", borderRadius: "50%", background: CAMP_ACCENT[camp.camp], flexShrink: 0, opacity: 0.9 } }),
          react.createElement("strong", { style: { fontSize: "14px", color: "var(--dsw-alias-label-primary)" } }, camp.campLabel),
          react.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginLeft: "auto", marginRight: "4px" } }, camp.memo),
          react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "13px" } }, expanded ? "▾" : "▸")),
        !expanded && react.createElement("div", { style: { paddingLeft: "24px", marginTop: "2px" } },
          react.createElement("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" } }, camp.groups.map((g) => g.label).join(" · ")))
      );
      const body = expanded && react.createElement("div", { style: { paddingTop: "4px" } },
        camp.groups.map((group) => react.createElement("div", { key: group.label, style: { marginBottom: "8px" } },
          react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", padding: "0 10px" } },
            react.createElement("span", { style: { fontSize: "12px", color: CAMP_ACCENT[camp.camp], fontWeight: 500, flexShrink: 0 } }, group.label),
            react.createElement("span", { style: { flex: 1, height: "1px", background: "var(--dsw-alias-border-l1)" } })),
          group.items.map((u) => react.createElement("div", { key: u.scene, style: { border: "1px solid var(--dsw-alias-border-l1)", borderRadius: "8px", padding: "8px 10px", marginBottom: "5px" } },
            react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" } },
              react.createElement("strong", { style: { fontSize: "13px", color: "var(--dsw-alias-label-primary)" } }, u.scene),
              react.createElement("button", { type: "button", style: { ...btn, padding: "3px 8px", fontSize: "12px", color: copiedKey === camp.camp + ":" + u.scene ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-business-primary)" }, title: "复制发送内容", onClick: () => onCopy(camp.camp + ":" + u.scene, u.send) }, copiedKey === camp.camp + ":" + u.scene ? "已复制" : "复制")),
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
        if (fetchStatus) fetch("/tavernweave/skills").then((r) => r.json()).then(setSt).catch(() => {});
      }, [fetchStatus]);
      if (!st) return react.createElement("div", null, "读取中…");
      if (st.total === 0) return react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "未找到 TavernWeave 技能目录。请确认仓库位置或安装技能。");
      return react.createElement("div", null,
        react.createElement("div", { style: { marginBottom: "8px" } },
          "技能安装状态：", react.createElement("strong", null, st.installed + "/" + st.total),
          st.missing.length > 0 && react.createElement("span", { style: { color: "var(--dsw-alias-state-warn-primary)" } }, "（缺失: " + st.missing.join(", ") + "）"),
          react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", marginTop: "2px" } }, "官方状态：离线候选（未做真实 SillyTavern 验收）")),
        react.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr", gap: "4px" } },
          st.skills.map((s) => react.createElement("div", { key: s.name, style: { display: "flex", alignItems: "center", gap: "6px" } },
            react.createElement("span", { style: { color: s.ok ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)" } }, s.ok ? "✓" : "✗"),
            react.createElement("span", { style: { fontFamily: "monospace", fontSize: "13px" } }, s.name))))
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

    // ---------- 设置分区（M2 实装：表单 + 保存） ----------
    function SettingsForm() {
      const [s, setS] = react.useState(null);
      const [msg, setMsg] = react.useState("");
      react.useEffect(() => {
        fetch("/tavernweave/settings").then((r) => {
          if (!r.ok) throw new Error("settings request failed");
          return r.json();
        }).then(setS).catch(() => setMsg("读取设置失败"));
      }, []);
      if (!s) return react.createElement("div", null, "读取中…");
      const set = (k, v) => setS(Object.assign({}, s, { [k]: v }));
      const save = () => {
        setMsg("");
        fetch("/tavernweave/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) })
          .then((r) => { if (!r.ok) throw new Error("save request failed"); return r.json(); })
          .then(setS).then(() => setMsg("已保存")).catch(() => setMsg("保存失败"));
      };
      const label = { display: "block", fontSize: "13px", color: "var(--dsw-alias-label-secondary)", marginBottom: "4px", marginTop: "10px" };
      const input = { width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px" };
      return react.createElement("div", { style: { maxWidth: "560px" } },
        react.createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginBottom: "2px" } }, "入口显示由白名单控制：留空时完全隐藏；当前版本保存任意路径即可启用入口。"),
        react.createElement("label", { style: label }, "工作区白名单（一行一个绝对路径；留空 = 不显示入口）"),
        react.createElement("textarea", { style: { ...input, minHeight: "64px", fontFamily: "monospace" }, value: (s.enabledWorkspaces || []).join("\n"), onChange: (e) => set("enabledWorkspaces", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean)) }),
        react.createElement("label", { style: label }, "面板位置"),
        react.createElement("select", { style: input, value: s.panelPosition || "right", onChange: (e) => set("panelPosition", e.target.value) },
          react.createElement("option", { value: "right" }, "右下角"),
          react.createElement("option", { value: "left" }, "左下角")),
        react.createElement("div", { style: { marginTop: "14px", padding: "10px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: 1.5 } }, "模拟酒馆、自动补全和人格默认值仍在开发，因此暂不显示不可用的配置项。"),
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginTop: "16px" } },
          react.createElement("button", { type: "button", style: { ...primaryBtn, padding: "6px 16px" }, onClick: save }, "保存设置"),
          msg && react.createElement("span", { style: { fontSize: "13px", color: msg === "已保存" ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)" } }, msg))
      );
    }

    function TavernWeaveSection() {
      return react.createElement("div", { style: { padding: "4px 0" } }, react.createElement(SettingsForm));
    }

    function apply(ctx) {
      // 入口只保留侧栏底部（与「设置」并排，DSH footer.action 槽的官方用法）。
      // 若想换到输入区停靠，改回 ctx.slots.inject("conversation.input.dock", ...) 即可。
      ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register({ name: "sidebar.footer.action", id: "tavernweave-sidebar-btn" }, TavernButton)
      ), "tavernweave: sidebar button");

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
