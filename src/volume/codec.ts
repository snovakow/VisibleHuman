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

export function deltaDecode(coded: Uint8Array, nx: number): Uint8Array {
  checkRow(nx)
  const block = new Uint8Array(coded.length)
  for (let n = 0; n < coded.length; n++) {
    block[n] = n % nx === 0 ? coded[n] : (block[n - 1] + coded[n]) & 0xff
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
