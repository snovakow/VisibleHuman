// Reading and writing images for the scripts, through sharp (libvips): the NLM's PNGs and TIFFs, gzipped or not, and
// the previews the scripts draw. Pixels come back as raw bytes, with the channel count the file has, so a caller takes
// its stride from the image rather than assuming one.

import { readFile } from 'node:fs/promises'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { writeWhole } from './files.ts'

const gunzipBytes = promisify(gunzip)

export interface RawImage {
  width: number
  height: number
  // Bytes per pixel, which is the stride through data
  channels: number
  data: Uint8Array
}

// A colour image's pixels, 8 bits a channel, three channels for an RGB file and four where the file has alpha
export async function readRgb(path: string): Promise<RawImage> {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true })
  if (info.channels < 3) throw new Error(`${path} has ${info.channels} channel(s), not a colour image's three`)
  return { width: info.width, height: info.height, channels: info.channels, data }
}

// A grey image's pixels as 16-bit values, one channel: the NLM's CT PNGs are 16-bit greys holding the scanner's own
// numbers, which an 8-bit read would crush to 0–11. An 8-bit file comes back scaled to the same range
export interface GrayImage {
  width: number
  height: number
  data: Uint16Array
}

export async function readGray(path: string): Promise<GrayImage> {
  const { data, info } = await sharp(path).toColourspace('grey16').raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true })
  if (info.channels !== 1) throw new Error(`${path} read as ${info.channels} channels, not one grey`)
  return { width: info.width, height: info.height, data: new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2) }
}

// A file's contents with its gzip undone, such as the head's .tiff.gz slices or a volume file; a file that isn't
// gzipped, by its first two bytes, comes back as it is
export async function gunzipFile(path: string): Promise<Uint8Array> {
  const bytes = await readFile(path)
  const gzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  return new Uint8Array(gzipped ? await gunzipBytes(bytes) : bytes)
}

// Writes raw pixels as a PNG, one, three or four channels
export async function writePng(path: string, image: RawImage) {
  if (image.channels !== 1 && image.channels !== 3 && image.channels !== 4) {
    throw new Error(`A PNG takes 1, 3 or 4 channels, not ${image.channels}`)
  }
  const { width, height, channels, data } = image
  const bytes = await sharp(data, { raw: { width, height, channels } }).png().toBuffer()
  await writeWhole(path, bytes)
}
