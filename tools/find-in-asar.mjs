// Locate which asar entries contain a byte pattern, and report the byte offset.
// Usage: node find-in-asar.mjs <archive> <pattern> [maxHits]
import { open } from 'node:fs/promises'

const [, , archivePath, pattern, maxArg] = process.argv
if (!archivePath || !pattern) {
  console.error('usage: find-in-asar.mjs <archive> <pattern> [maxHits]')
  process.exit(2)
}
const maxHits = Number(maxArg ?? 20)

const fh = await open(archivePath, 'r')
const stat = await fh.stat()

const sizeBuf = Buffer.alloc(8)
await fh.read(sizeBuf, 0, 8, 0)
const headerSize = sizeBuf.readUInt32LE(4)
const raw = Buffer.alloc(headerSize)
await fh.read(raw, 0, headerSize, 8)
const start = raw.indexOf(0x7b)
const declared = raw.readUInt32LE(start - 4)
const jsonText = declared > 0 && start - 4 + declared <= raw.length
  ? raw.subarray(start, start + declared).toString('utf8')
  : raw.subarray(start).toString('utf8')
let header
try { header = JSON.parse(jsonText) } catch { header = JSON.parse(raw.subarray(start, raw.lastIndexOf(0x7d) + 1).toString('utf8')) }
const baseOffset = 8 + headerSize

const entries = []
function walk(node, prefix) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name
    if (child.files) walk(child, p)
    else if (child.offset !== undefined) entries.push({ path: p, offset: baseOffset + Number(child.offset), size: child.size ?? 0 })
  }
}
walk(header, '')
entries.sort((a, b) => a.offset - b.offset)

function locate(absOffset) {
  let lo = 0, hi = entries.length - 1, found = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (entries[mid].offset <= absOffset) { found = entries[mid]; lo = mid + 1 } else hi = mid - 1
  }
  if (!found) return undefined
  return absOffset - found.offset < found.size ? found.path : undefined
}

const needle = Buffer.from(pattern, 'utf8')
const chunkSize = 4 * 1024 * 1024
let hits = 0
let carry = Buffer.alloc(0)
let pos = 0
while (pos < stat.size && hits < maxHits) {
  const len = Math.min(chunkSize, stat.size - pos)
  const buf = Buffer.alloc(len)
  await fh.read(buf, 0, len, pos)
  const hay = Buffer.concat([carry, buf])
  let idx = hay.indexOf(needle)
  while (idx >= 0 && hits < maxHits) {
    const abs = pos - carry.length + idx
    const path = locate(abs)
    console.log(`${abs}\t${path ?? '(unmapped)'}`)
    hits++
    idx = hay.indexOf(needle, idx + 1)
  }
  carry = hay.subarray(Math.max(0, hay.length - needle.length + 1))
  pos += len
}
await fh.close()
console.error(`\n${hits} hit(s)`)
