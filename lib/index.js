// TavernWeave 酒馆工作台 — 宿主侧
// 已实装：设置存取（JSON 文件版）、资料库确定性查询、Skill 可用/已加载状态、使用说明数据、
// 角色卡 JSON 结构盘点、制卡项目持久化与安全更新检查。模拟酒馆保持暂缓，不在本插件内发送模型请求。
// 铁律：所有资源注册挂 ctx.effect（热重载/卸载自动清理）。

import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, normalize, resolve, sep, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { USAGE_GUIDE } from './usage-guide.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// TavernWeave 仓库定位：默认相对本插件源码位置（仓库同级），允许设置覆盖
const TW_DEFAULT_ROOT = join(__dirname, '..', '..', 'TavernWeave')
const PLUGIN_ROOT = resolve(__dirname, '..')
const PLUGIN_DATA_DIR = join(homedir(), '.dsh', 'plugin-data', 'tavernweave-workbench')
const CRED_FILE = join(PLUGIN_DATA_DIR, 'credentials.json') // TODO M3：模拟酒馆 API KEY 凭据文件，不进日志/上下文

// ---------- 插件更新检查与安全快进 ----------
// 用户只更新本插件的远端仓库。原作者 TavernWeave 的资料库随原作者更新，
// 不作为用户可点击的更新目标。检查只刷新 Git 的远端引用，不改工作树；应用更新仅允许干净工作树的 fast-forward。
const UPDATE_TARGETS = {
  plugin: { id: 'plugin', label: 'TavernWeave DSH 插件', dir: PLUGIN_ROOT },
}

function git(args, cwd, timeout = 20000) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout, windowsHide: true }).trim()
}

function inspectUpdateTarget(target) {
  const spec = UPDATE_TARGETS[target]
  if (!spec || !existsSync(join(spec.dir, '.git'))) return { id: target, label: spec?.label || target, state: 'unavailable', error: '本地仓库不存在' }
  try {
    const local = git(['rev-parse', 'HEAD'], spec.dir)
    const branch = git(['branch', '--show-current'], spec.dir) || 'HEAD'
    const dirty = !!git(['status', '--porcelain'], spec.dir)
    let remote = ''
    let fetchError = ''
    try {
      git(['fetch', '--quiet', 'origin', branch === 'HEAD' ? 'main' : branch], spec.dir, 30000)
      remote = git(['rev-parse', `origin/${branch === 'HEAD' ? 'main' : branch}`], spec.dir)
    } catch (error) {
      fetchError = String(error?.message || error).split('\n')[0]
    }
    const same = !!remote && local === remote
    let ahead = 0
    let behind = 0
    if (remote && !same) {
      try { ahead = Number(git(['rev-list', '--count', `origin/${branch === 'HEAD' ? 'main' : branch}..HEAD`], spec.dir)) || 0 } catch { /* ignore */ }
      try { behind = Number(git(['rev-list', '--count', `HEAD..origin/${branch === 'HEAD' ? 'main' : branch}`], spec.dir)) || 0 } catch { /* ignore */ }
    }
    const state = fetchError ? 'check-failed' : same ? 'up-to-date' : (ahead > 0 && behind > 0 ? 'diverged' : 'update-available')
    let changes = []
    if (state === 'update-available') {
      try { changes = git(['log', '--oneline', '-5', `HEAD..origin/${branch === 'HEAD' ? 'main' : branch}`], spec.dir).split('\n').filter(Boolean) } catch { /* ignore */ }
    }
    return { id: target, label: spec.label, local, remote, branch, dirty, ahead, behind, state, changes, error: fetchError || undefined }
  } catch (error) {
    return { id: target, label: spec.label, state: 'check-failed', error: String(error?.message || error).split('\n')[0] }
  }
}

function checkUpdates() {
  const checkedAt = new Date().toISOString()
  return { checkedAt, targets: Object.keys(UPDATE_TARGETS).map(inspectUpdateTarget) }
}

function applyUpdate(target) {
  const spec = UPDATE_TARGETS[target]
  if (!spec) return { ok: false, state: 'invalid', error: '未知更新目标' }
  const before = inspectUpdateTarget(target)
  if (before.state === 'up-to-date') return { ok: true, state: 'up-to-date', target, message: '已经是最新版本', before }
  if (before.state !== 'update-available') return { ok: false, state: before.state, target, message: '当前状态不允许自动更新，请先处理提示', before }
  if (before.dirty) return { ok: false, state: 'dirty', target, message: '本地有未提交改动，已阻止覆盖', before }
  try {
    const branch = before.branch === 'HEAD' ? 'main' : before.branch
    git(['merge', '--ff-only', `origin/${branch}`], spec.dir, 30000)
    const after = inspectUpdateTarget(target)
    return { ok: true, state: 'updated', target, message: `${spec.label}已更新`, before, after, reloadRequired: target === 'plugin' }
  } catch (error) {
    return { ok: false, state: 'update-failed', target, message: String(error?.message || error).split('\n')[0], before }
  }
}

export const name = 'tavernweave-workbench'
export const inject = ['tools', 'webServer', 'sessions']

// ---------- 设置存取（M1：JSON 文件版；后续核对官方设置命名空间后迁移） ----------
function readSettings() {
  const f = join(PLUGIN_DATA_DIR, 'settings.json')
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return {
      schemaVersion: 1,
      enabledWorkspaces: [],      // 需求1：空 = 前端完全不显示
      panelPosition: 'right',
      defaultPersona: 'none',
      librarySource: 'builtin',
      autoComplete: true,
      tavernModel: { baseUrl: '', model: '', apiKeyRef: false, temperature: 0.8, maxTokens: 1024 },
    }
  }
}

function writeSettings(next) {
  mkdirSync(PLUGIN_DATA_DIR, { recursive: true })
  const cur = readSettings()
  // 浅合并顶层，但 tavernModel 深合并，防止部分更新丢子字段
  const merged = {
    ...cur,
    ...(next || {}),
    tavernModel: { ...(cur.tavernModel || {}), ...((next && next.tavernModel) || {}) },
  }
  writeFileSync(join(PLUGIN_DATA_DIR, 'settings.json'), JSON.stringify(merged, null, 2), 'utf8')
  return merged
}

// 简易请求体读取（Node http IncomingMessage），1MB 上限防异常大 body
function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > maxBytes) {
        req.destroy(new Error('request body too large'))
        return
      }
    })
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

// ---------- 资料库（宿主侧确定性查询） ----------
function libraryRoot() {
  // 目前唯一数据源：TW 仓库内置的 consult-tavernweave-library。
  // librarySource 的 builtin/repo 均指向它；custom 待 M3（需新增自定义路径字段）。
  return join(TW_DEFAULT_ROOT, 'skills', 'consult-tavernweave-library')
}

function listLibraryDomains(refDir) {
  return readdirSync(refDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function searchLibrary(query, domain, limit = 20) {
  const root = libraryRoot()
  const refDir = join(root, 'references')
  const results = []
  try {
    const q = query.trim().toLowerCase()
    const availableDomains = listLibraryDomains(refDir)
    const domains = domain && domain !== 'all' ? [domain] : availableDomains
    const cappedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50)
    if (!q) return { results, note: '请输入关键词后搜索资料库。' }
    if (domains.some((item) => !availableDomains.includes(item))) return { results, error: '资料库分类不存在' }
    for (const dom of domains) {
      const dir = join(refDir, dom)
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const name = entry.name
        const content = readFileSync(join(dir, name), 'utf8')
        const titleScore = name.toLowerCase().includes(q) ? 20 : 0
        const contentIndex = content.toLowerCase().indexOf(q)
        const score = titleScore + (contentIndex >= 0 ? 10 : 0)
        if (score === 0) continue
        const excerptStart = Math.max(contentIndex, 0)
        const excerpt = content.slice(excerptStart, excerptStart + 180).replace(/\s+/g, ' ').trim()
        results.push({ domain: dom, file: name, score, title: name.replace(/\.md$/, ''), excerpt })
      }
    }
    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'))
    return { results: results.slice(0, cappedLimit) }
  } catch (e) {
    return { results, error: String(e && e.message || e) }
  }
}

function readLibraryDoc(domain, file) {
  const refRoot = normalize(resolve(libraryRoot(), 'references'))
  let availableDomains
  try { availableDomains = listLibraryDomains(refRoot) } catch { return { error: '资料库不可用' } }
  if (!availableDomains.includes(domain) || file !== basename(file)) return { error: '非法路径' }
  const dir = normalize(join(refRoot, domain))
  if (!dir.startsWith(refRoot + sep)) return { error: '非法路径' }
  const f = normalize(join(dir, file))
  if (!f.startsWith(dir + sep) || !f.endsWith('.md')) return { error: '非法路径' }
  if (!existsSync(f)) return { error: '条目不存在' }
  return { content: readFileSync(f, 'utf8') }
}

// P5：资料库按阶段/主题浏览（复用 readLibraryDoc 的 domain/file 调用）。
function browseLibrary() {
  const refDir = join(libraryRoot(), 'references')
  const groups = new Map()
  const keyOf = (name) => {
    if (name.startsWith('A0_')) return '工程检查单'
    if (name.startsWith('A')) return '格式与管线（A）'
    if (name.startsWith('B')) return '变量与更新（B）'
    if (name.startsWith('C')) return '前端与界面（C）'
    if (name.startsWith('D')) return '运维与部署（D）'
    if (name.startsWith('E')) return '生态与扩展（E）'
    return '其它'
  }
  try {
    for (const domain of listLibraryDomains(refDir)) {
      const dir = join(refDir, domain)
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const title = entry.name.replace(/\.md$/, '')
        const key = domain === 'design-wiki' ? '概念库（Wiki）' : keyOf(entry.name)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push({ domain, file: entry.name, title })
      }
    }
    const result = [...groups.entries()].map(([label, items]) => ({ label, items: items.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')) }))
    return { groups: result, total: result.reduce((sum, group) => sum + group.items.length, 0) }
  } catch (e) {
    return { groups: [], error: String(e && e.message || e) }
  }
}

// ---------- 技能状态校验（复用 verify-install 规则的等价 JS） ----------
function skillStatus() {
  const skillsDir = join(TW_DEFAULT_ROOT, 'skills')
  if (!existsSync(skillsDir)) return { installed: 0, total: 0, missing: [], skills: [] }
  const entries = readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !['assets', 'newbie-guide'].includes(e.name))
  const skills = entries.map((e) => {
    const hasSkill = existsSync(join(skillsDir, e.name, 'SKILL.md'))
    return { name: e.name, ok: hasSkill }
  })
  return {
    installed: skills.filter((s) => s.ok).length,
    total: skills.length,
    missing: skills.filter((s) => !s.ok).map((s) => s.name),
    skills,
  }
}

// 技能目录扫描结果与会话无关，缓存 30s，避免每次轮询都 readdirSync。
let skillStatusCache = null;
let skillStatusCacheAt = 0;
function skillStatusCached() {
  const now = Date.now();
  if (skillStatusCache && now - skillStatusCacheAt < 30000) return skillStatusCache;
  skillStatusCache = skillStatus();
  skillStatusCacheAt = now;
  return skillStatusCache;
}

// DSH session/event 里的 skill-catalog 表示可发现能力，tool/call(skill)
// 才表示模型在本会话中真正加载过的 Skill。两者故意分开，避免 UI 误报。
const activeSkillsBySession = new Map()
const latestSkillBySession = new Map()
const skillStatesBySession = new Map()
const todosBySession = new Map()
function rememberSkillEvent(session, event) {
  const sessionId = String(session?.id || '')
  if (!sessionId || !event) return
  const set = activeSkillsBySession.get(sessionId) || new Set()
  if (event.type === 'tool/call' && event.data?.name === 'skill') {
    let args = event.data.arguments ?? event.data.args ?? {}
    if (typeof args === 'string') {
      try { args = JSON.parse(args) } catch { args = { name: args } }
    }
    const name = args.name || args.skill || args.id || (typeof args === 'string' ? args : '')
    if (typeof name === 'string' && name.trim()) {
      const normalized = name.trim()
      set.add(normalized)
      const callId = String(event.data.callId || '')
      const states = skillStatesBySession.get(sessionId) || new Map()
      states.set(callId || normalized, { name: normalized, status: 'active', at: new Date().toISOString() })
      skillStatesBySession.set(sessionId, states)
      latestSkillBySession.set(sessionId, { name: normalized, status: 'active', at: new Date().toISOString() })
    }
  }
  if (event.type === 'tool/result') {
    // DSH 0.1.2：tool/result 的 callId 在 message.source.callId（或 content[0].toolCallId），
    // 不在 data.callId。以前取错位置导致技能状态永远停在 active，胶囊进度推不动。
    const callId = String(event.data?.message?.source?.callId || event.data?.message?.content?.[0]?.toolCallId || event.data?.callId || '')
    const states = skillStatesBySession.get(sessionId)
    const entry = callId && states?.get(callId)
    if (entry) {
      entry.status = (event.data?.error || event.data?.message?.content?.[0]?.isError) ? 'error' : 'done'
      latestSkillBySession.set(sessionId, { name: entry.name, status: entry.status, at: new Date().toISOString() })
    }
  }
  if (event.type === 'todo/write' && Array.isArray(event.data?.todos)) {
    todosBySession.set(sessionId, event.data.todos.slice(0, 64).map((todo) => ({ content: String(todo.content || '').slice(0, 200), status: String(todo.status || 'pending') })))
  }
  activeSkillsBySession.set(sessionId, set)
}

function skillStatusForSession(sessionId = '') {
  const base = skillStatusCached()
  const active = [...(activeSkillsBySession.get(String(sessionId)) || new Set())]
  const available = base.skills.filter((item) => item.ok).map((item) => item.name)
  return {
    ...base,
    available,
    availableCount: available.length,
    active,
    activeCount: active.length,
    latest: latestSkillBySession.get(String(sessionId)) || null,
    skillStates: [...(skillStatesBySession.get(String(sessionId))?.values() || [])],
    todos: todosBySession.get(String(sessionId)) || [],
    sessionId: String(sessionId || ''),
    note: sessionId ? '可用来自当前 Skill 目录；已加载来自本会话实际 skill 工具调用。' : '未解析当前会话，只显示可用 Skill。',
  }
}

function readCardProjects() {
  const file = join(PLUGIN_DATA_DIR, 'card-projects.json')
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

function writeCardProjects(projects) {
  mkdirSync(PLUGIN_DATA_DIR, { recursive: true })
  writeFileSync(join(PLUGIN_DATA_DIR, 'card-projects.json'), JSON.stringify(projects, null, 2), 'utf8')
  return projects
}

function cardHash(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 16)
}

function sanitizeProjectInput(input) {
  const body = input && typeof input === 'object' ? input : {}
  const now = new Date().toISOString()
  const draft = typeof body.draft === 'string' ? body.draft.slice(0, 4 * 1024 * 1024) : ''
  const workflow = Array.isArray(body.workflow) ? body.workflow.slice(0, 32).map((item) => ({
    id: String(item?.id || '').slice(0, 40),
    label: String(item?.label || '').slice(0, 80),
    status: ['pending', 'active', 'done', 'skipped'].includes(item?.status) ? item.status : 'pending',
  })).filter((item) => item.id) : []
  return {
    id: String(body.id || randomUUID()),
    sessionId: String(body.sessionId || '').slice(0, 160),
    name: String(body.name || '未命名卡片').slice(0, 120),
    sourceFileName: String(body.sourceFileName || '').slice(0, 180),
    cardFormat: String(body.cardFormat || '未知格式').slice(0, 80),
    status: String(body.status || '草稿').slice(0, 40),
    phase: String(body.phase || '待盘点').slice(0, 60),
    version: String(body.version || '0.1.0').slice(0, 40),
    sourceHash: String(body.sourceHash || cardHash(draft)).slice(0, 64),
    draft,
    workflow,
    sectionsSummary: body.sectionsSummary && typeof body.sectionsSummary === 'object' ? body.sectionsSummary : {},
    acceptanceState: String(body.acceptanceState || '未验收').slice(0, 40),
    createdAt: String(body.createdAt || now),
    updatedAt: now,
  }
}

function createCardProject(input) {
  const projects = readCardProjects()
  const project = sanitizeProjectInput(input)
  projects.unshift(project)
  writeCardProjects(projects.slice(0, 100))
  return project
}

function updateCardProject(id, patch) {
  const projects = readCardProjects()
  const index = projects.findIndex((item) => item.id === id)
  if (index < 0) return null
  const current = projects[index]
  const next = sanitizeProjectInput({ ...current, ...(patch || {}), id: current.id, createdAt: current.createdAt })
  projects[index] = next
  writeCardProjects(projects)
  return next
}

// ---------- 制卡工作台数据（本地项目索引；不覆盖原卡文件） ----------
function hasValue(value) {
  return value !== undefined && value !== null && value !== ''
}

function countObject(value) {
  if (!value || typeof value !== 'object') return 0
  if (Array.isArray(value)) return value.length
  return Object.keys(value).length
}

// ---------- 变量模型提取（P4：状态栏生成输入）----------
function flattenObjectToPaths(value, prefix = '', out = [], depth = 0) {
  if (depth > 2 || value === null || value === undefined) return out
  if (Array.isArray(value)) {
    out.push({ path: prefix || 'list', label: (String(prefix).split('.').pop() || 'list'), value: JSON.stringify(value.slice(0, 6)), type: 'array' })
    return out
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flattenObjectToPaths(v, prefix ? prefix + '.' + k : k, out, depth + 1)
    return out
  }
  out.push({ path: prefix, label: (String(prefix).split('.').pop() || prefix), value, type: typeof value })
  return out
}

function stripMarker(content) {
  if (typeof content !== 'string') return content
  return content.replace(/^\s*\[[a-z_0-9]+\]\s*/i, '').trim()
}

// 从 extensions.variables / mvu / 世界书 [initvar] 条目提取变量路径与示例值。
function extractVariableModel(extensions, data, worldInfo) {
  const variables = []
  const mvuMarkers = []
  const collect = (jsonish) => {
    if (typeof jsonish === 'string') {
      try { return JSON.parse(stripMarker(jsonish)) } catch { return null }
    }
    return jsonish && typeof jsonish === 'object' ? jsonish : null
  }
  const pushModel = (value) => {
    if (!value || typeof value !== 'object') return
    for (const row of flattenObjectToPaths(value)) variables.push(row)
  }
  pushModel(collect(extensions.variables)); pushModel(collect(extensions.mvu))
  pushModel(collect(data.variables)); pushModel(collect(data.mvu))
  const entries = Array.isArray(worldInfo?.entries) ? worldInfo.entries : Array.isArray(worldInfo) ? worldInfo : []
  for (const entry of entries) {
    const content = String(entry?.content || entry?.value || '')
    const comment = String(entry?.comment || '')
    const text = comment + '\n' + content
    if (/\[initvar\]/i.test(text) && /^\s*\{/.test(content)) pushModel(collect(content))
    if (/\[mvu_(plot|update|状态)\]/i.test(text)) mvuMarkers.push(String(entry?.comment || '变量条目').slice(0, 24))
  }
  return { variables: variables.slice(0, 40), mvuMarkers: mvuMarkers.slice(0, 6), count: variables.length }
}

function analyzeCard(input) {
  const envelope = input
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return { error: '请提供角色卡 JSON 对象' }
  const data = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) ? envelope.data : envelope
  const spec = String(envelope.spec || data.spec || '')
  const specVersion = String(envelope.spec_version || data.spec_version || '')
  const extensions = data.extensions && typeof data.extensions === 'object' ? data.extensions : {}
  const worldInfo = data.character_book || data.world_info || data.worldbook || null
  const regex = extensions.regex_scripts || data.regex_scripts || data.regex || null
  const tavernScripts = extensions.tavern_helper || extensions.tavern_helper_scripts || data.tavern_helper || null
  const firstMessages = Array.isArray(data.first_mes) ? data.first_mes : (hasValue(data.first_mes) ? [data.first_mes] : [])
  const alternateGreetings = Array.isArray(data.alternate_greetings) ? data.alternate_greetings : []
  const extractedVariables = extractVariableModel(extensions, data, worldInfo)
  const variableCount = extractedVariables.count
  const sections = [
    { id: 'identity', label: '角色基础', detail: 'name / description / personality / scenario', present: ['name', 'description', 'personality', 'scenario'].some((key) => hasValue(data[key])), count: ['name', 'description', 'personality', 'scenario'].filter((key) => hasValue(data[key])).length },
    { id: 'worldbook', label: '世界书', detail: 'character_book / world_info', present: !!worldInfo, count: worldInfo?.entries ? countObject(worldInfo.entries) : countObject(worldInfo) },
    { id: 'regex', label: '正则脚本', detail: 'extensions.regex_scripts / regex_scripts', present: !!regex, count: countObject(regex) },
    { id: 'variables', label: '变量与状态', detail: 'extensions.variables / mvu / 世界书 [initvar]', present: variableCount > 0 || extractedVariables.mvuMarkers.length > 0, count: variableCount || extractedVariables.mvuMarkers.length },
    { id: 'scripts', label: 'Tavern Helper', detail: 'extensions.tavern_helper*', present: !!tavernScripts, count: countObject(tavernScripts) },
    { id: 'openings', label: '开场与问候', detail: 'first_mes / alternate_greetings', present: firstMessages.length > 0 || alternateGreetings.length > 0, count: firstMessages.length + alternateGreetings.length },
  ]
  const detected = specVersion || spec || (data.character_book ? 'V2/V3 character card' : '未知格式')
  return {
    valid: true,
    format: detected,
    name: data.name || '未命名角色',
    avatar: data.avatar || null,
    sections,
    variableModel: extractedVariables.variables,
    mvuMarkers: extractedVariables.mvuMarkers,
    metadata: {
      descriptionLength: typeof data.description === 'string' ? data.description.length : 0,
      scenarioLength: typeof data.scenario === 'string' ? data.scenario.length : 0,
      firstMessageCount: firstMessages.length,
      alternateGreetingCount: alternateGreetings.length,
    },
    next: ['先确认卡片类型与运行时依赖', '选择一个组件作为本轮改动边界', '导出后在 SillyTavern 真机验收'],
  }
}

export function apply(ctx) {
  // HTTP API：/tavernweave/* 前缀（官方 API：ctx.webServer.register({ kind:'prefix', path, handler })，handler(req,res) 自行写响应）
  ctx.effect(() => {
    const webServer = ctx.get('webServer')
    if (!webServer) return
    const sendJson = (res, code, data) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    const route = {
      kind: 'prefix',
      path: '/tavernweave',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const p = url.pathname
          if (p === '/tavernweave/settings' && req.method === 'GET') return sendJson(res, 200, await readSettings())
          if (p === '/tavernweave/settings' && req.method === 'POST') { const body = await readBody(req); return sendJson(res, 200, writeSettings(body)) }
          if (p === '/tavernweave/update/check' && req.method === 'GET') return sendJson(res, 200, checkUpdates())
          if (p === '/tavernweave/update/apply' && req.method === 'POST') {
            const body = await readBody(req, 32 * 1024)
            return sendJson(res, 200, applyUpdate(String(body.target || '')))
          }
          if (p === '/tavernweave/usage' && req.method === 'GET') return sendJson(res, 200, { camps: USAGE_GUIDE, source: 'tavernweave newbie-guide', note: '离线候选：TavernWeave 口令与本插件制卡操作指南，按主题与小类组织' })
          if (p === '/tavernweave/skills' && req.method === 'GET') return sendJson(res, 200, skillStatusForSession(url.searchParams.get('sessionId') || ''))
          if (p === '/tavernweave/cards' && req.method === 'GET') {
            return sendJson(res, 200, { projects: readCardProjects() })
          }
          if (p === '/tavernweave/cards' && req.method === 'POST') {
            const body = await readBody(req, 5 * 1024 * 1024)
            return sendJson(res, 201, createCardProject(body))
          }
          if (p.startsWith('/tavernweave/cards/') && req.method === 'PATCH') {
            const id = decodeURIComponent(p.slice('/tavernweave/cards/'.length))
            const body = await readBody(req, 5 * 1024 * 1024)
            const project = updateCardProject(id, body)
            return project ? sendJson(res, 200, project) : sendJson(res, 404, { error: '项目不存在' })
          }
          if (p === '/tavernweave/library/search' && req.method === 'GET') return sendJson(res, 200, searchLibrary(url.searchParams.get('q') ?? '', url.searchParams.get('domain') ?? 'all'))
          if (p === '/tavernweave/library/browse' && req.method === 'GET') return sendJson(res, 200, browseLibrary())
          if (p === '/tavernweave/library/doc' && req.method === 'GET') return sendJson(res, 200, readLibraryDoc(url.searchParams.get('domain') ?? '', url.searchParams.get('file') ?? ''))
          if (p === '/tavernweave/card/analyze' && req.method === 'POST') return sendJson(res, 200, analyzeCard(await readBody(req)))
          return sendJson(res, 404, { error: 'not found', path: p })
        } catch (e) {
          return sendJson(res, 500, { error: String(e && e.message || e) })
        }
      },
    }
    // duplicate prefix route 自愈：上次失败 fiber 的孤儿路由仍在路由表里，
    // register 会拒；此时直接替换表项，保证本 fiber 持有路由生命周期。
    try {
      const disposer = webServer.register(route)
      if (typeof disposer === 'function') return disposer
    } catch {
      const table = webServer.prefixes
      if (table && typeof table.has === 'function' && table.has(route.path)) table.set(route.path, route)
    }
  }, 'tavernweave: routes')

  // 监听真实 DSH 会话事件，仅提取 Skill 名称这类最小叶字段；不保存聊天正文。
  ctx.effect(() => {
    try {
      const sessions = ctx.sessions || ctx.get('sessions')
      const rows = typeof sessions?.list === 'function' ? sessions.list() : []
      for (const session of rows || []) for (const event of session.events || []) rememberSkillEvent(session, event)
    } catch { /* session history is optional during early boot */ }
    const stop = ctx.on('session/event', (session, event) => rememberSkillEvent(session, event), { global: true })
    return typeof stop === 'function' ? stop : undefined
  }, 'tavernweave: skill activity')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'tavernweave_status',
    description: '查询 TavernWeave 技能安装状态与插件数据目录。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      const st = skillStatus()
      const value = JSON.stringify({ ...st, dataDir: PLUGIN_DATA_DIR, twRoot: TW_DEFAULT_ROOT, exists: existsSync(TW_DEFAULT_ROOT) })
      return value
    },
  })), 'tavernweave: status tool')
}
