import { AnimationMixer, type AnimationAction, type AnimationClip, type Bone } from 'three'
import { isStill } from './clip.ts'

// Plays the library's motions on a rig's bones, through three's mixer rooted at the hips, so that a clip's
// `<joint>.quaternion` tracks bind to the bones by name with no skinned mesh between. One motion plays at a time, and
// going to another fades from whatever the body shows, mid-fade or not, to the new one over fadeSeconds; layers made
// additive against the neutral pose (clip.ts) are mixed in over it, each by its weight. A clip's time runs at the
// speed set, stops while paused, and steps by stepSeconds at a time; the fades run on in real time through all of it,
// so a pose picked while paused still arrives.
//
// The mixer blends a motion whose weight falls short of one toward what each bone held when the motion first bound
// it, so the bones are put in the neutral pose before the first motion plays. The root's place isn't touched: the
// clips play in place, the hips where the scan holds them. Nothing here allocates once a motion is playing, but
// three's own event as a looping clip comes round, once a loop.

// How long a crossfade from one motion to the next takes, in seconds
export const fadeSeconds = 0.5
// How far a single step moves a clip on, in seconds: a frame at 30 frames a second
export const stepSeconds = 1 / 30

export interface Layer {
  // A clip made additive (layerClip in clip.ts)
  clip: AnimationClip
  weight: number
}

export interface Animator {
  // The mixer, for the counts in its stats
  readonly mixer: AnimationMixer
  // The motion to play from now on: faded into from whatever the body shows, or, the first time or where asked,
  // shown at once
  play(clip: AnimationClip, atOnce?: boolean): void
  // The layers over it; a layer left out, or at weight 0, changes nothing
  setLayers(layers: readonly Layer[]): void
  setSpeed(speed: number): void
  setPlaying(playing: boolean): void
  // Moves every clip playing on by stepSeconds, which the next update draws
  step(): void
  // Whether the next update would turn the bones: a fade under way, a clip running, or a change not yet drawn
  readonly moving: boolean
  // Advances by the seconds since the last frame and sets the bones' rotations
  update(seconds: number): void
  // Lets the bones go, back in the neutral pose
  dispose(): void
}

// The fade's progress eased in and out, so a pose comes to rest rather than stopping dead, and never past either end
const eased = (t: number) => t * t * (3 - 2 * t)

export function createAnimator(root: Bone): Animator {
  root.traverse((bone) => bone.quaternion.identity())
  const mixer = new AnimationMixer(root)

  // The motions with a weight: the one playing, last, and while a fade is under way those it fades from, each with
  // the weight it set off from
  const shown: { action: AnimationAction; from: number }[] = []
  let playing: AnimationAction | null = null
  let clock = 0
  let fadeStart = 0
  let fading = false
  const layers = new Map<AnimationClip, AnimationAction>()
  let speed = 1
  let running = true
  let changed = false

  const pace = (action: AnimationAction) => {
    action.timeScale = speed
    action.paused = !running
  }
  const each = (visit: (action: AnimationAction) => void) => {
    for (const { action } of shown) visit(action)
    for (const action of layers.values()) visit(action)
  }
  // Whether a clip with a weight changes over time, so that running it moves the bones
  const anyMoves = () => {
    for (const { action } of shown) if (!isStill(action.getClip())) return true
    for (const action of layers.values()) if (!isStill(action.getClip())) return true
    return false
  }
  let moves = false

  const finishFade = () => {
    for (const { action } of shown) if (action !== playing) action.stop()
    shown.length = 0
    if (playing) {
      playing.setEffectiveWeight(1)
      shown.push({ action: playing, from: 1 })
    }
    fading = false
    // What's left may hold still, as a pose faded into from a clip over time does
    moves = anyMoves()
  }

  return {
    mixer,
    play(clip, atOnce = false) {
      const action = mixer.clipAction(clip)
      if (action === playing) return
      const wasShown = shown.some((entry) => entry.action === action)
      if (!wasShown) {
        // A motion coming back as it fades out goes on from where it is; any other starts again
        action.reset()
        pace(action)
        action.setEffectiveWeight(0)
        action.play()
      }
      playing = action
      if (atOnce || shown.length === 0) {
        if (!wasShown) shown.push({ action, from: 0 })
        finishFade()
      } else {
        if (!wasShown) shown.push({ action, from: 0 })
        for (const entry of shown) entry.from = entry.action.getEffectiveWeight()
        fadeStart = clock
        fading = true
      }
      moves = anyMoves()
      changed = true
    },
    setLayers(next) {
      const kept = new Set<AnimationClip>()
      for (const { clip, weight } of next) {
        if (weight <= 0) continue
        kept.add(clip)
        let action = layers.get(clip)
        if (!action) {
          action = mixer.clipAction(clip)
          action.reset()
          pace(action)
          action.play()
          layers.set(clip, action)
        }
        action.setEffectiveWeight(weight)
      }
      for (const [clip, action] of layers) {
        if (kept.has(clip)) continue
        action.stop()
        layers.delete(clip)
      }
      moves = anyMoves()
      changed = true
    },
    setSpeed(next) {
      if (next === speed) return
      speed = next
      each(pace)
      changed = true
    },
    setPlaying(next) {
      if (next === running) return
      running = next
      each(pace)
      changed = true
    },
    step() {
      each((action) => {
        const clip = action.getClip()
        if (!isStill(clip)) action.time = (action.time + stepSeconds) % clip.duration
      })
      changed = true
    },
    get moving() {
      return changed || fading || (running && speed !== 0 && moves)
    },
    update(seconds) {
      clock += seconds
      if (fading) {
        const t = Math.min(1, (clock - fadeStart) / fadeSeconds)
        if (t >= 1) finishFade()
        else {
          // The one coming in rises from where it stood to whole as the others fall from theirs to none, so that the
          // weights, which summed to one as the fade set off, sum to one throughout and nothing of the neutral pose,
          // the mixer's baseline, shows through
          const f = eased(t)
          for (let n = 0; n < shown.length; n++) {
            const { action, from } = shown[n]
            action.setEffectiveWeight(action === playing ? from + (1 - from) * f : from * (1 - f))
          }
        }
      }
      mixer.update(seconds)
      changed = false
    },
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
      shown.length = 0
      layers.clear()
      playing = null
    },
  }
}
