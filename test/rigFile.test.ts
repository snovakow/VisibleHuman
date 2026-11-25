import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { readRig } from '../src/rig/rig.ts'
import { cellCountOf, readRigFile, writeRigFile, type RigCells, type RigFile } from '../src/rig/rigFile.ts'
import type { Triple } from '../src/volume/format.ts'

// The rig file (src/rig/rigFile.ts): written and read back, and refused where its parts disagree

const rig = readRig(JSON.parse(readFileSync(new URL('../data/male/rig.json', import.meta.url), 'utf8')))
const size: Triple = [5, 4, 3]

function sample(): RigFile {
  const count = cellCountOf(size)
  const block = (seed: number) => Uint8Array.from({ length: count }, (_, n) => (n * seed + 7) % 256)
  const cells: RigCells = {
    chain: block(3),
    otherChain: block(5),
    wall: block(7),
    jointA: block(11),
    jointB: block(13),
    weight: block(17),
    otherJointA: block(19),
    otherJointB: block(23),
    otherWeight: block(29),
  }
  return { size, spacing: [3.96, 3.96, 4], origin: [53.295, 33.495, -2.5], rig, cells }
}

void test('a rig file reads back as written', () => {
  const file = sample()
  const read = readRigFile(writeRigFile(file))
  assert.deepEqual(read.size, file.size)
  assert.deepEqual(
    read.spacing.map((value) => Math.fround(value)),
    file.spacing.map((value) => Math.fround(value)),
  )
  assert.deepEqual(read.rig, file.rig)
  const names: (keyof RigCells)[] = ['chain', 'otherChain', 'wall', 'jointA', 'jointB', 'weight', 'otherJointA', 'otherJointB', 'otherWeight']
  for (const name of names) assert.deepEqual(read.cells[name], file.cells[name], name)
})

void test("a rig file is refused where it isn't one, or its length or its rig disagrees with its header", () => {
  const bytes = writeRigFile(sample())
  assert.throws(() => readRigFile(bytes.subarray(0, 40)), /shorter than its 64-byte header/)
  const wrongMagic = bytes.slice()
  wrongMagic[3] = 0x32
  assert.throws(() => readRigFile(wrongMagic), /rather than VHR1/)
  assert.throws(() => readRigFile(bytes.subarray(0, bytes.length - 1)), /but its header/)
  const wrongBody = bytes.slice()
  wrongBody[48] = 'f'.charCodeAt(0)
  assert.throws(() => readRigFile(wrongBody), /header names the fale, its rig the male/)
  const wrongVersion = bytes.slice()
  wrongVersion[4] = 9
  assert.throws(() => readRigFile(wrongVersion), /version 9 isn't supported/)
})
