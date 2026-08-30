// TavernWeave 酒馆工作台 — 宿主侧
// 职责：资料库确定性查询（复用 query-library 思路）、技能状态校验、
//       设置/凭据本地存取、侧栏测试聊天的 OpenAI 兼容代理。
// 铁律：所有资源注册挂 ctx.effect（热重载/卸载自动清理）。

import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { USAGE_GUIDE } from './usage-guide.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// TavernWeave 仓库定位：默认相对本插件源码位置（仓库同级），允许设置覆盖
const TW_DEFAULT_ROOT = join(__dirname, '..', '..', 'TavernWeave')
const PLUGIN_DATA_DIR = join(homedir(), '.dsh', 'plugin-data', 'tavernweave-workbench')
const CRED_FILE = join(PLUGIN_DATA_DIR, 'credentials.json') // KEY 独立凭据文件，不进日志/上下文

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
  const merged = { ...readSettings(), ...(next || {}) }
  writeFileSync(join(PLUGIN_DATA_DIR, 'settings.json'), JSON.stringify(merged, null, 2), 'utf8')
  return merged
}

// 简易请求体读取（Node http IncomingMessage）
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

// ---------- 资料库（宿主侧确定性查询） ----------
function libraryRoot() {
  const s = readSettings()
  if (s.librarySource === 'installed') {
    const p = join(TW_DEFAULT_ROOT, 'skills', 'consult-tavernweave-library')
    if (existsSync(p)) return p
  }
  return join(TW_DEFAULT_ROOT, 'skills', 'consult-tavernweave-library')
}

function searchLibrary(query, domain, limit = 20) {
  const root = libraryRoot()
  const refDir = join(root, 'references')
  const results = []
  const q = query.toLowerCase()
  const domains = domain && domain !== 'all'
    ? [domain]
    : readdirSync(refDir).filter((n) => {
        return statSync(join(refDir, n)).isDirectory()
      })
  for (const dom of domains) {
    const dir = join(refDir, dom)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue
      const score = (name.toLowerCase().includes(q) ? 10 : 0)
      if (score === 0) continue
      results.push({ domain: dom, file: name, score, title: name.replace(/\.md$/, '') })
      if (results.length >= limit) return results
    }
  }
  return results
}

function readLibraryDoc(domain, file) {
  const dir = join(libraryRoot(), 'references', domain)
  if (!dir.startsWith(join(libraryRoot(), 'references'))) return { error: '非法路径' }
  const f = join(dir, file)
  if (!f.startsWith(dir) || !f.endsWith('.md')) return { error: '非法路径' }
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
