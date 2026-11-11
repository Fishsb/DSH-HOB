#!/usr/bin/env node
/**
 * 把 `gen/persona.md` 同步进预设的 `prefix:` 与人读版镜像块。
 *
 * 唯一方向：`workflow.toml` + `spec/` → `gen/persona.md` → patch `prefix` → draft 镜像。
 * ⚠ 人读版只替换**第一个**四反引号以上的 `text` 围栏内部；围栏与其余正文不动。
 * ⚠ 这个脚本只做机械同步，不是判据：`check:workflow` 的 F10 与
 *   `check:presets` 的 ⑤ 仍会逐字节比对。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ymlPath = join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml')
const draftPath = join(root, 'kit', 'drafts', 'preset-contracts.md')

const personaPath = join(root, 'preset', 'dsh-hob', 'gen', 'persona.md')
const body = readFileSync(personaPath, 'utf8').replace(/\n+$/, '')

const y = readFileSync(ymlPath, 'utf8').split('\n')
const start = y.findIndex((line) => /^\s*prefix:\s*\|-/.test(line))
if (start < 0) throw new Error('找不到 prefix: |-')
const indent = y[start].match(/^\s*/)[0].length
let end = y.length
for (let i = start + 1; i < y.length; i++) {
  if (y[i].trim() === '') continue
  if (y[i].match(/^\s*/)[0].length <= indent) { end = i; break }
}
const pad = ' '.repeat(indent + 2)
const ymlBody = body.split('\n').map((line) => (line === '' ? '' : pad + line))
const nextYml = [...y.slice(0, start + 1), ...ymlBody, ...y.slice(end)]
writeFileSync(ymlPath, nextYml.join('\n'))
console.log(`已同步 preset prefix（${ymlBody.length} 行）`)

const lines = readFileSync(draftPath, 'utf8').split('\n')
const open = lines.findIndex((line) => /^`{4,}text$/.test(line.trim()))
if (open < 0) throw new Error('人读版里找不到四反引号 text 块')
const fence = '`'.repeat(lines[open].trim().length - 4)
let close = -1
for (let i = open + 1; i < lines.length; i++) {
  if (lines[i].trim() === fence) { close = i; break }
}
if (close < 0) throw new Error('人读版镜像块没有闭合围栏')

const next = [...lines.slice(0, open + 1), ...body.split('\n'), ...lines.slice(close)]
writeFileSync(draftPath, next.join('\n'))
console.log(`已同步人读版镜像块（${body.split('\n').length} 行）`)
