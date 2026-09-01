import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(process.argv[2] || join(import.meta.dirname, '..', '..', 'TavernWeave'))
const manifestPath = join(root, 'tavernweave-install-manifest.json')
const presetPath = resolve(import.meta.dirname, '..', 'presets', 'tavernweave-native', 'agent.cordis.yml')
const metadataPath = resolve(import.meta.dirname, '..', 'presets', 'tavernweave-native', 'preset.yml')
const errors = []

if (!existsSync(manifestPath)) {
  errors.push(`missing TavernWeave install manifest: ${manifestPath}`)
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const expected = manifest.skills || []
  if (expected.length !== 20) errors.push(`expected upstream manifest to declare 20 skills, got ${expected.length}`)
  for (const name of expected) {
    const skillFile = join(root, 'skills', name, 'SKILL.md')
    if (!existsSync(skillFile)) {
      errors.push(`missing skill file: ${skillFile}`)
      continue
    }
    const text = readFileSync(skillFile, 'utf8')
    if (!new RegExp(`^name:\\s*${name}\\s*$`, 'm').test(text)) errors.push(`frontmatter name mismatch: ${skillFile}`)
  }
}

for (const file of [presetPath, metadataPath]) if (!existsSync(file)) errors.push(`missing native preset file: ${file}`)
if (existsSync(presetPath)) {
  const preset = readFileSync(presetPath, 'utf8')
  for (const required of [
    '@deepseek-ai/dsh-skill-filesystem',
    '@deepseek-ai/dsh-tool-skill',
    '@deepseek-ai/dsh-tool-fs',
    '@deepseek-ai/dsh-tool-pwsh',
    '@deepseek-ai/dsh-tool-web',
    'consult-tavernweave-library',
    'activate-tavernweave-soul',
    'orchestrate-project-blueprint',
  ]) if (!preset.includes(required)) errors.push(`native preset is missing required runtime contract: ${required}`)
}

if (errors.length) {
  console.error(errors.map((error) => `ERROR: ${error}`).join('\n'))
  process.exitCode = 1
} else {
  const skills = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
  console.log(JSON.stringify({ ok: true, upstream: root, manifestSkills: 20, skillDirectories: skills, preset: 'tavernweave-native' }))
}
