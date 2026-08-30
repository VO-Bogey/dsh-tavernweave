// TavernWeave 酒馆工作台 — client 面板（M1 骨架）
// 工作区过滤（需求1）：未配置 enabledWorkspaces 时完全不显示任何入口。
// 插槽：conversation.input.dock（主面板入口按钮，官方真实槽名）+ sidebar.footer.action（酒馆按钮，owner props {wide}）
//      + settings.section（设置页，children: settings.general.item 模式见 settings-general 官方包）

window.__ModuleLoader__.load({
  id: "tavernweave-workbench",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let reactDom = require("react-dom");

    const inject = ["slots"];

    // ---------- 工作区状态 ----------
    // M1 策略：先挂 UI，运行时探测 client-runtime 的工作区服务；
    // 探测不到时退化为"设置里有 enabledWorkspaces 且非空才显示"（路径匹配留 M4 细化）。
    let settingsCache = null;
    let settingsPromise = null;

    function fetchSettings() {
      if (!settingsPromise) {
        settingsPromise = fetch("/tavernweave/settings")
          .then((r) => r.json())
          .then((s) => { settingsCache = s; return s; })
          .catch(() => { settingsCache = { enabledWorkspaces: [] }; return settingsCache; });
      }
      return settingsPromise;
    }

    function useVisible() {
      const [visible, setVisible] = react.useState(false);
      react.useEffect(() => {
        let alive = true;
        fetchSettings().then((s) => { if (alive) setVisible((s.enabledWorkspaces || []).length > 0); });
        const t = setInterval(() => {
          fetch("/tavernweave/settings").then((r) => r.json()).then((s) => {
            settingsCache = s;
            if (alive) setVisible((s.enabledWorkspaces || []).length > 0);
          }).catch(() => {});
        }, 5000);
        return () => { alive = false; clearInterval(t); };
      }, []);
      return visible;
    }

    // ---------- 样式（跟随 DSH 主题变量，不自造风格） ----------
    const btn = { fontSize: "13px", padding: "4px 10px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", background: "transparent", color: "var(--dsw-alias-label-secondary)", cursor: "pointer" };
    // 面板用 portal 挂到 document.body，fixed 定位到视口，避开侧栏列 overflow:hidden 裁剪
    const panelStyle = { position: "fixed", bottom: "88px", width: "min(460px, calc(100vw - 32px))", maxHeight: "calc(100vh - 170px)", overflowY: "auto", padding: "14px 16px", borderRadius: "12px", background: "var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))", border: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", zIndex: 999, boxShadow: "0 12px 32px rgba(0,0,0,0.35)" };
    const panelSide = () => (settingsCache && settingsCache.panelPosition === "left") ? { left: "24px" } : { right: "24px" };

    // ---------- 主面板入口（composer dock 小按钮） ----------
    function TavernButton() {
      const visible = useVisible();
      const [open, setOpen] = react.useState(false);
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
      react.useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") props.onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, []);
      react.useEffect(() => {
        fetch("/tavernweave/usage").then((r) => r.json()).then((j) => setUsage(j.camps || [])).catch(() => setUsage([]));
      }, []);
      const tabs = [["usage", "使用说明"], ["skills", "技能状态"], ["library", "资料库"], ["workshop", "角色卡工坊"], ["tavern", "模拟酒馆"]];
      return react.createElement("div", { style: { ...panelStyle, ...panelSide() } },
        react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" } },
          react.createElement("strong", null, "TavernWeave 工作台"),
          react.createElement("span", null,
            react.createElement("button", { style: { ...btn, marginRight: "6px" }, title: "设置", onClick: () => alert("设置页请到 DSH 设置 → TavernWeave 分区（M1 占位）") }, "⚙"),
            react.createElement("button", { style: btn, onClick: props.onClose }, "×"))),
        react.createElement("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" } },
          tabs.map(([id, label]) => react.createElement("button", { key: id, style: { ...btn, fontWeight: tab === id ? 700 : 400, borderBottom: tab === id ? "2px solid var(--dsw-alias-state-business-primary)" : "2px solid transparent" }, onClick: () => setTab(id) }, label))),
        tab === "usage" && UsageTab({ usage }),
        tab === "skills" && SkillsTab({ status: null, fetchStatus: true }),
        tab !== "usage" && tab !== "skills" && react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", padding: "12px 0" } },
          "「" + (tabs.find((t) => t[0] === tab) || ["", ""])[1] + "」区块将在 M2/M3 里程碑实装。")
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
          document.execCommand("copy");
          document.body.removeChild(ta);
        } catch (e) {}
      };
      try {
        navigator.clipboard.writeText(text).catch(fallback);
      } catch (e) {
        fallback();
      }
    }

    function UsageCamp({ camp, expanded, onToggle }) {
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
              react.createElement("button", { style: { ...btn, padding: "2px 8px", fontSize: "12px", color: "var(--dsw-alias-state-business-primary)" }, title: "复制发送内容", onClick: () => copyText(u.send) }, "复制")),
            react.createElement("div", { style: { fontFamily: "monospace", fontSize: "12px", whiteSpace: "pre-wrap", color: "var(--dsw-alias-label-secondary)", marginBottom: "3px" } }, u.send.length > 120 ? u.send.slice(0, 120) + "…" : u.send),
            u.detail && react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" } }, u.detail))))
        )
      );
      return react.createElement("div", { style: { marginBottom: "10px" } }, header, body);
    }

    function UsageTab({ usage }) {
      const [open, setOpen] = react.useState({ st: true, vibe: true });
      if (!usage) return react.createElement("div", null, "读取中…");
      if (usage.length === 0) return react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)" } }, "未取得使用说明数据。");
      return react.createElement("div", null,
        react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", marginBottom: "8px" } }, "源自官方 newbie-guide 复制口令 · 按阵营分层 · 点条目复制发送内容"),
        usage.map((camp) => react.createElement(UsageCamp, { key: camp.camp, camp, expanded: open[camp.camp], onToggle: () => setOpen((o) => ({ ...o, [camp.camp]: !o[camp.camp] })) }))
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

    // ---------- 设置分区（M2 实装：表单 + 保存） ----------
    function SettingsForm() {
      const [s, setS] = react.useState(null);
      const [msg, setMsg] = react.useState("");
      react.useEffect(() => {
        fetch("/tavernweave/settings").then((r) => r.json()).then(setS).catch(() => setMsg("读取设置失败"));
      }, []);
      if (!s) return react.createElement("div", null, "读取中…");
      const set = (k, v) => setS(Object.assign({}, s, { [k]: v }));
      const setTm = (k, v) => setS(Object.assign({}, s, { tavernModel: Object.assign({}, s.tavernModel, { [k]: v }) }));
      const save = () => {
        setMsg("");
        fetch("/tavernweave/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) })
          .then((r) => r.json()).then(() => setMsg("已保存")).catch(() => setMsg("保存失败"));
      };
      const label = { display: "block", fontSize: "13px", color: "var(--dsw-alias-label-secondary)", marginBottom: "4px", marginTop: "10px" };
      const input = { width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px" };
      const tm = s.tavernModel || {};
      return react.createElement("div", { style: { maxWidth: "560px" } },
        react.createElement("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginBottom: "2px" } }, "入口显示：白名单非空时才显示「🍺 酒馆」按钮"),
        react.createElement("label", { style: label }, "工作区白名单（一行一个绝对路径；留空 = 不显示入口）"),
        react.createElement("textarea", { style: { ...input, minHeight: "64px", fontFamily: "monospace" }, value: (s.enabledWorkspaces || []).join("\n"), onChange: (e) => set("enabledWorkspaces", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean)) }),
        react.createElement("div", { style: { display: "flex", gap: "12px" } },
          react.createElement("div", { style: { flex: 1 } },
            react.createElement("label", { style: label }, "面板位置"),
            react.createElement("select", { style: input, value: s.panelPosition || "right", onChange: (e) => set("panelPosition", e.target.value) },
              react.createElement("option", { value: "right" }, "右下角"),
              react.createElement("option", { value: "left" }, "左下角"))),
          react.createElement("div", { style: { flex: 1 } },
            react.createElement("label", { style: label }, "默认人格"),
            react.createElement("select", { style: input, value: s.defaultPersona || "none", onChange: (e) => set("defaultPersona", e.target.value) },
              react.createElement("option", { value: "none" }, "不启用"),
              react.createElement("option", { value: "atong" }, "阿瞳（温柔指导）"),
              react.createElement("option", { value: "mttt" }, "MTTT.sir（严格学习）"),
              react.createElement("option", { value: "soulkiller" }, "灵魂杀手（前端审查）"))),
          react.createElement("div", { style: { flex: 1 } },
            react.createElement("label", { style: label }, "资料库来源"),
            react.createElement("select", { style: input, value: s.librarySource || "builtin", onChange: (e) => set("librarySource", e.target.value) },
              react.createElement("option", { value: "builtin" }, "插件内置"),
              react.createElement("option", { value: "repo" }, "直接读 TW 仓库"),
              react.createElement("option", { value: "custom" }, "自定义路径")))),
        react.createElement("label", { style: { ...label, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" } },
          react.createElement("input", { type: "checkbox", checked: !!s.autoComplete, onChange: (e) => set("autoComplete", e.target.checked) }),
          "口令自动补全（输入区联想使用说明口令，M3 实装）"),
        react.createElement("div", { style: { fontSize: "13px", fontWeight: 600, marginTop: "14px", marginBottom: "2px" } }, "侧栏模型（模拟酒馆测试用，M3 实装）"),
        react.createElement("label", { style: label }, "Base URL"),
        react.createElement("input", { style: input, value: tm.baseUrl || "", placeholder: "http://127.0.0.1:8000/v1", onChange: (e) => setTm("baseUrl", e.target.value) }),
        react.createElement("label", { style: label }, "模型"),
        react.createElement("input", { style: input, value: tm.model || "", placeholder: "如 deepseek-chat", onChange: (e) => setTm("model", e.target.value) }),
        react.createElement("div", { style: { display: "flex", gap: "12px" } },
          react.createElement("div", { style: { flex: 1 } },
            react.createElement("label", { style: label }, "温度"),
            react.createElement("input", { style: input, type: "number", min: "0", max: "2", step: "0.1", value: tm.temperature ?? 0.8, onChange: (e) => setTm("temperature", parseFloat(e.target.value)) })),
          react.createElement("div", { style: { flex: 1 } },
            react.createElement("label", { style: label }, "Max Tokens"),
            react.createElement("input", { style: input, type: "number", min: "1", value: tm.maxTokens ?? 1024, onChange: (e) => setTm("maxTokens", parseInt(e.target.value, 10) || 1024) }))),
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginTop: "16px" } },
          react.createElement("button", { style: { ...btn, color: "var(--dsw-alias-label-primary)", border: "1px solid var(--dsw-alias-state-business-primary)", padding: "6px 16px" }, onClick: save }, "保存"),
          msg && react.createElement("span", { style: { fontSize: "13px", color: msg === "已保存" ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)" } }, msg))
      );
    }

    function TavernWeaveSection() {
      return react.createElement("div", { style: { padding: "4px 0" } }, react.createElement(SettingsForm));
    }

    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject("conversation.input.dock", () =>
        ctx.slots.register({ name: "conversation.input.dock", id: "tavernweave-dock", order: 50 }, TavernButton)
      ), "tavernweave: dock button");

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
