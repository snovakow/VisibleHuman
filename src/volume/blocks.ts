import type { Triple } from './format.ts'

// Evening out the colour steps between a body's cryo blocks. Each block was photographed as one frozen piece, and its
// colour steps by several percent where it meets the next, while within a block neighbouring layers differ by about
// one. A block can take one gain per channel that carries a reference colour across the boundary before it: the
// reference in the slices just before the boundary over that in the slices just after it, times the gain of the block
// before, from 1 at the first block. The reference may be the grey card photographed beside each slice, which reads
// the exposure, or the body's own colour, which also carries the tissue's change across the boundary. A gain is a
// block's, never a slice's: within a block the card holds steady from one slice to the next, and what does change
// from slice to slice there is the frost and the gel, which a gain would print onto the body

// The gains a block may take: a larger step than this is not an exposure step but something the windows got wrong,
// such as a window on the frost of a block's first slices, and is held at the limit and reported
export const minGain = 0.8
export const maxGain = 1.25

// A boundary whose reference changes by no more than this share on every channel takes no gain of its own: a step
// that small is within what the reference itself varies by from slice to slice, and is left as the body's own
export const deadBand = 0.02

// The reference colour in the slices either side of one boundary, R, G and B
export interface BoundaryWindows {
  before: Triple
  after: Triple
}

interface BlockGain {
  gain: Triple
  // Whether a channel's gain was held at a limit
  clamped: boolean
}

// The ratio of a boundary's reference before it to after it, per channel; a channel with no reference after the
// boundary gives 1
export const boundaryRatio = ({ before, after }: BoundaryWindows): Triple => [
  after[0] > 0 ? before[0] / after[0] : 1,
  after[1] > 0 ? before[1] / after[1] : 1,
  after[2] > 0 ? before[2] / after[2] : 1,
]

// One gain per block, first to last, for the windows of each boundary between them, in order: one more gain than
// boundaries. A boundary within the dead band on every channel passes the gain of the block before on unchanged; one
// outside it on any channel applies its whole ratio
export function blockGains(windows: readonly BoundaryWindows[]): BlockGain[] {
  const gains: BlockGain[] = [{ gain: [1, 1, 1], clamped: false }]
  for (const window of windows) {
    const previous = gains[gains.length - 1].gain
    const measured = boundaryRatio(window)
    const ratio = measured.every((value) => Math.abs(value - 1) <= deadBand) ? [1, 1, 1] : measured
    let clamped = false
    const channel = (c: number) => {
      const gain = previous[c] * ratio[c]
      if (gain < minGain || gain > maxGain) clamped = true
      return Math.min(maxGain, Math.max(minGain, gain))
    }
    const gain: Triple = [channel(0), channel(1), channel(2)]
    gains.push({ gain, clamped })
  }
  return gains
}
