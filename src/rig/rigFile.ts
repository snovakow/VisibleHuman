import { deltaDecode, deltaEncode } from '../volume/codec.ts'
import type { Triple } from '../volume/format.ts'
import { readRig, type Rig } from './rig.ts'

// The rig file, version 1: everything the app poses a body by, built by the rig script from the body's rig and its
// finest built level, and served beside its volume files as public/volume/<body>.rig.bin. A 64-byte header, the rig
// itself as JSON, then planar blocks over one grid, one byte per cell in index order, each delta-coded along i as the
// volume's are; the whole file gzipped on disk. The grid is the body's default level's, in the source frame, which
// every level of the body samples by place, so the finer levels need no file of their own. Little-endian. Shared by
// the rig script, which writes it, and the app, which reads it
//
// Each cell says which chain of the body it belongs to, how its flesh is skinned, and where a wall parts it from
// another chain: the surface where a limb lies against the trunk or another limb in the scan, which a pose opens.
// A cell's chain and its other chain, the one across the nearest wall within reach, are whole numbers to be read at
// the nearest cell; its wall field, signed by the side and growing away from that wall, is read filtered, so a wall
// lies where the field crosses its middle, between cells, as the skin lies where the coverage does

export interface RigGrid {
  // The grid's size in cells along i, j and k, their spacing in millimetres, and the centre of cell (0, 0, 0) in the
  // source frame, all as the body's default level has them
  size: Triple
  spacing: Triple
  origin: Triple
}

export interface RigCells {
  // The chain's index in chainNames, or none outside the body's reach
  chain: Uint8Array
  // The chain across the nearest wall, where one lies within reach, or none
  otherChain: Uint8Array
  // The wall field, the walls' signed measure of the distance to that wall: wallMiddle at the wall, rising wallSlope
  // for each of its millimetres into the side of the pair whose chain comes first in chainNames and falling into the
  // other's, clamped to a byte; wallMiddle where there's none. Its millimetres are the distance's own only in a gap
  // between the two chains: in the flesh beside a wall it rises about half a millimetre for each one further away
  wall: Uint8Array
  // The two joints the cell's flesh follows, by their index in jointNames, and the first one's share of 255; the
  // second takes the rest. A bone's cell follows one joint alone, so both name it
  jointA: Uint8Array
  jointB: Uint8Array
  weight: Uint8Array
  // The same for the flesh across the wall, at the nearest cell of the other chain, so a vertex on the wall knows where
  // its other side has gone; where there's no wall within reach, the cell's own
  otherJointA: Uint8Array
  otherJointB: Uint8Array
  otherWeight: Uint8Array
}

export interface RigFile extends RigGrid {
  rig: Rig
  cells: RigCells
}

// No chain, in the chain blocks
export const noChain = 255
// The wall field's value at a wall, and its rise for each of the field's millimetres
export const wallMiddle = 128
export const wallSlope = 8

const magic = 'VHR1'
const formatVersion = 1
const headerBytes = 64
const bodyBytes = 16
const planeNames = ['chain', 'otherChain', 'wall', 'jointA', 'jointB', 'weight', 'otherJointA', 'otherJointB', 'otherWeight'] as const
const deltaCoding = 1
const maxU16 = 0xffff

export const cellCountOf = (size: Triple) => size[0] * size[1] * size[2]

export function writeRigFile(file: RigFile): Uint8Array {
  const { size, spacing, origin, rig, cells } = file
  for (const value of size) {
    if (!Number.isInteger(value) || value < 1 || value > maxU16) throw new Error(`Rig file: a grid of ${size.join(' × ')} cells doesn't fit its header`)
  }
  if (spacing.some((value) => !(value > 0))) throw new Error(`Rig file: the spacing ${spacing.join(', ')} isn't positive`)
  if (rig.body.length > bodyBytes || !/^[\x20-\x7e]*$/.test(rig.body)) throw new Error(`Rig file: the body id ${JSON.stringify(rig.body)} won't fit`)
  const count = cellCountOf(size)
  for (const name of planeNames) {
    if (cells[name].length !== count) throw new Error(`Rig file: the ${name} block has ${cells[name].length} bytes, where ${count} cells need`)
  }
  const json = new TextEncoder().encode(JSON.stringify({ body: rig.body, joints: rig.joints, ends: rig.ends }))
  const bytes = new Uint8Array(headerBytes + json.length + planeNames.length * count)
  const view = new DataView(bytes.buffer)
  for (let n = 0; n < magic.length; n++) bytes[n] = magic.charCodeAt(n)
  view.setUint16(4, formatVersion, true)
  view.setUint16(6, headerBytes, true)
  size.forEach((value, axis) => view.setUint16(8 + axis * 2, value, true))
  spacing.forEach((value, axis) => view.setFloat32(14 + axis * 4, value, true))
  origin.forEach((value, axis) => view.setFloat32(26 + axis * 4, value, true))
  bytes[38] = planeNames.length
  bytes[39] = deltaCoding
  view.setUint32(40, json.length, true)
  for (let n = 0; n < rig.body.length; n++) bytes[48 + n] = rig.body.charCodeAt(n)
  bytes.set(json, headerBytes)
  planeNames.forEach((name, n) => bytes.set(deltaEncode(cells[name], size[0]), headerBytes + json.length + n * count))
  return bytes
}

// Reads a rig file's bytes, gzip already undone, throwing a clear error where they aren't one or its parts disagree
export function readRigFile(bytes: Uint8Array): RigFile {
  if (bytes.length < headerBytes) throw new Error(`Not a rig file: ${bytes.length} bytes is shorter than its ${headerBytes}-byte header`)
  const found = String.fromCharCode(...bytes.subarray(0, magic.length))
  if (found !== magic) throw new Error(`Not a rig file: it starts with ${JSON.stringify(found)} rather than ${magic}`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint16(4, true)
  if (version !== formatVersion) throw new Error(`Rig file version ${version} isn't supported; this app reads version ${formatVersion}`)
  if (view.getUint16(6, true) !== headerBytes) throw new Error(`Rig file: its header isn't ${headerBytes} bytes`)
  const size: Triple = [view.getUint16(8, true), view.getUint16(10, true), view.getUint16(12, true)]
  const spacing: Triple = [view.getFloat32(14, true), view.getFloat32(18, true), view.getFloat32(22, true)]
  const origin: Triple = [view.getFloat32(26, true), view.getFloat32(30, true), view.getFloat32(34, true)]
  if (size.some((value) => value < 1)) throw new Error(`Rig file: a grid of ${size.join(' × ')} cells is empty`)
  if (spacing.some((value) => !(value > 0))) throw new Error(`Rig file: the spacing ${spacing.join(', ')} isn't positive`)
  if (bytes[38] !== planeNames.length) throw new Error(`Rig file: ${bytes[38]} blocks, where version ${formatVersion} has ${planeNames.length}`)
  if (bytes[39] !== deltaCoding) throw new Error(`Rig file: coding ${bytes[39]} isn't known`)
  const jsonBytes = view.getUint32(40, true)
  let bodyEnd = 48
  while (bodyEnd < 48 + bodyBytes && bytes[bodyEnd] !== 0) bodyEnd++
  const body = String.fromCharCode(...bytes.subarray(48, bodyEnd))
  const count = cellCountOf(size)
  const expected = headerBytes + jsonBytes + planeNames.length * count
  if (bytes.length !== expected) {
    throw new Error(`Rig file is ${bytes.length} bytes, but its header (${size.join(' × ')} cells, ${jsonBytes} bytes of rig) needs ${expected}`)
  }
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(headerBytes, headerBytes + jsonBytes)))
  } catch (error) {
    throw new Error(`Rig file: its rig isn't JSON. ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  const rig = readRig(json)
  if (rig.body !== body) throw new Error(`Rig file: its header names the ${body}, its rig the ${rig.body}`)
  const start = headerBytes + jsonBytes
  const plane = (n: number) => deltaDecode(bytes.subarray(start + n * count, start + (n + 1) * count), size[0])
  const cells: RigCells = {
    chain: plane(0),
    otherChain: plane(1),
    wall: plane(2),
    jointA: plane(3),
    jointB: plane(4),
    weight: plane(5),
    otherJointA: plane(6),
    otherJointB: plane(7),
    otherWeight: plane(8),
  }
  return { size, spacing, origin, rig, cells }
}
