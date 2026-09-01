// TavernWeave 酒馆工作台 — 宿主侧
// 已实装：设置存取（JSON 文件版）、资料库确定性查询、技能状态校验、使用说明数据、角色卡 JSON 结构盘点。
// 规划中：组件级编辑/打包、侧栏测试聊天的 OpenAI 兼容代理、官方设置命名空间迁移。
// 铁律：所有资源注册挂 ctx.effect（热重载/卸载自动清理）。

import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, normalize, resolve, sep, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { USAGE_GUIDE } from './usage-guide.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// TavernWeave 仓库定位：默认相对本插件源码位置（仓库同级），允许设置覆盖
const TW_DEFAULT_ROOT = join(__dirname, '..', '..', 'TavernWeave')
const PLUGIN_DATA_DIR = join(homedir(), '.dsh', 'plugin-data', 'tavernweave-workbench')
const CRED_FILE = join(PLUGIN_DATA_DIR, 'credentials.json') // TODO M3：模拟酒馆 API KEY 凭据文件，不进日志/上下文

export const name = 'tavernweave-workbench'
export const inject = ['tools', 'webServer']

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
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 1024 * 1024) {
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

// ---------- 角色卡工坊（M3-1：只读结构盘点，不写入卡片文件） ----------
function hasValue(value) {
  return value !== undefined && value !== null && value !== ''
}

function countObject(value) {
  if (!value || typeof value !== 'object') return 0
  if (Array.isArray(value)) return value.length
  return Object.keys(value).length
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
  const variables = extensions.variables || extensions.mvu || data.variables || data.mvu || null
  const firstMessages = Array.isArray(data.first_mes) ? data.first_mes : (hasValue(data.first_mes) ? [data.first_mes] : [])
  const alternateGreetings = Array.isArray(data.alternate_greetings) ? data.alternate_greetings : []
  const sections = [
    { id: 'identity', label: '角色基础', detail: 'name / description / personality / scenario', present: ['name', 'description', 'personality', 'scenario'].some((key) => hasValue(data[key])), count: ['name', 'description', 'personality', 'scenario'].filter((key) => hasValue(data[key])).length },
    { id: 'worldbook', label: '世界书', detail: 'character_book / world_info', present: !!worldInfo, count: worldInfo?.entries ? countObject(worldInfo.entries) : countObject(worldInfo) },
    { id: 'regex', label: '正则脚本', detail: 'extensions.regex_scripts / regex_scripts', present: !!regex, count: countObject(regex) },
    { id: 'variables', label: '变量与状态', detail: 'extensions.variables / mvu', present: !!variables, count: countObject(variables) },
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
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
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
          if (p === '/tavernweave/usage' && req.method === 'GET') return sendJson(res, 200, { camps: USAGE_GUIDE, source: 'tavernweave newbie-guide', note: '离线候选：源自官方文档复制口令，两层分类' })
          if (p === '/tavernweave/skills' && req.method === 'GET') return sendJson(res, 200, skillStatus())
          if (p === '/tavernweave/library/search' && req.method === 'GET') return sendJson(res, 200, searchLibrary(url.searchParams.get('q') ?? '', url.searchParams.get('domain') ?? 'all'))
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
