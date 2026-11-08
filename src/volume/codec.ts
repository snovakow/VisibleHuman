// The byte codings inside a volume file, each undone by its partner. Neither changes a block's size; both make the
// gzip that follows much smaller, because neighbouring voxels of the body are alike: a difference from the voxel
// before is a small number far more often than a value is, and the three colour channels rise and fall together, so
// red and blue are stored as their differences from green

// Delta coding along i: the byte at index n holds value[n] − value[n − 1] mod 256, except at the start of each row
// (n mod nx = 0), which holds value[n] itself, so a row decodes on its own as a running sum
export function deltaEncode(block: Uint8Array, nx: number): Uint8Array {
  checkRow(nx)
  const coded = new Uint8Array(block.length)
  for (let n = 0; n < block.length; n++) {
    coded[n] = n % nx === 0 ? block[n] : (block[n] - block[n - 1]) & 0xff
  }
  return coded
}

// Row by row, with the running sum kept in a local: the page decodes 28 million bytes of the male's file before it can
// show anything, and a remainder per byte, as the coder takes, made that several times slower. Given green, it also
// adds green back to a decorrelated channel as it goes, which saves correlate's pass over the block
export function deltaDecode(coded: Uint8Array, nx: number, green?: Uint8Array): Uint8Array {
  checkRow(nx)
  if (green) checkPair(coded, green)
  const block = new Uint8Array(coded.length)
  for (let start = 0; start < coded.length; start += nx) {
    const end = Math.min(start + nx, coded.length)
    let value = coded[start]
    if (green) {
      block[start] = (value + green[start]) & 0xff
      for (let n = start + 1; n < end; n++) {
        value = (value + coded[n]) & 0xff
        block[n] = (value + green[n]) & 0xff
      }
    } else {
      block[start] = value
      for (let n = start + 1; n < end; n++) {
        value = (value + coded[n]) & 0xff
        block[n] = value
      }
    }
  }
  return block
}

function checkRow(nx: number) {
  if (!Number.isInteger(nx) || nx < 1) throw new Error(`Delta coding needs a row length of at least 1, not ${nx}`)
}

// Decorrelation: a colour channel becomes its difference from green, mod 256, in place; correlate adds green back.
// Green itself is stored as it is
export function decorrelate(channel: Uint8Array, green: Uint8Array): Uint8Array {
  checkPair(channel, green)
  for (let n = 0; n < channel.length; n++) channel[n] = (channel[n] - green[n]) & 0xff
  return channel
}

export function correlate(delta: Uint8Array, green: Uint8Array): Uint8Array {
  checkPair(delta, green)
  for (let n = 0; n < delta.length; n++) delta[n] = (delta[n] + green[n]) & 0xff
  return delta
}

function checkPair(channel: Uint8Array, green: Uint8Array) {
  if (channel.length !== green.length) {
    throw new Error(`Decorrelation needs channels of one length, not ${channel.length} and ${green.length}`)
  }
}
