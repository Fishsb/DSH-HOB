#!/usr/bin/env node
/**
 * 把 `prefix:` 正文同步进人读版的全量镜像块（`kit/drafts/preset-contracts.md`）。
 *
 * ⚠ 只替换**第一个**四反引号以上的 `text` 围栏内部；围栏本身与其余正文一字不动。
 * ⚠ 这个脚本只做机械同步，不是判据：`check:presets` 的 ⑤ 仍会逐字节比对。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ymlPath = join(root, 'preset', 'dsh-hob', 'preset-dsh-hob.patch.yml')
const draftPath = join(root, 'kit', 'drafts', 'preset-contracts.md')

const y = readFileSync(ymlPath, 'utf8').split('\n')
const start = y.findIndex((line) => /^\s*prefix:\s*\|-/.test(line))
if (start < 0) throw new Error('找不到 prefix: |-')
const indent = y[start].match(/^\s*/)[0].length
let end = y.length
for (let i = start + 1; i < y.length; i++) {
  if (y[i].trim() === '') continue
  if (y[i].match(/^\s*/)[0].length <= indent) { end = i; break }
}
const body = y.slice(start + 1, end).map((line) => line.trim()).join('\n').trimEnd()

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
