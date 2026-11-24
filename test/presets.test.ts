import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultOptions, isOption, isShown, optionKeys, viewOptions, type ViewOptions } from '../src/options.ts'
import { alternates, launchPreset, presetOf, presetOptions, presets } from '../src/presets.ts'
import { styles } from '../src/render/styles/styles.ts'
import { frameFrom, frontView, swayAngle, swayDegrees, swaySeconds, type ViewAngle } from '../src/viewer/viewAngle.ts'
import type { Triple } from '../src/volume/format.ts'

// The presets the page opens on, and the framing of a body from their angles

// Every look an address can open on: the presets, and the alternates kept beside them
const named = [...presets, ...alternates]

void test('the presets and the alternates have names of their own, the launch preset among the presets, and an unknown name finds none', () => {
  const ids = named.map((preset) => preset.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(presets.includes(launchPreset))
  for (const preset of named) assert.equal(presetOf(preset.id), preset)
  assert.equal(presetOf('none of them'), undefined)
  assert.equal(presetOf(null), undefined)
})

void test('each preset sets options the panel has, at values their controls can take', () => {
  for (const preset of named) {
    for (const [key, value] of Object.entries(preset.options)) {
      const name = `${preset.id}'s ${key}`
      assert.ok(isOption(key), `${name} is an option`)
      const entry = viewOptions[key]
      if (entry.kind === 'slider') {
        assert.ok(typeof value === 'number' && value >= entry.min && value <= entry.max, `${name} is in its range`)
        const steps = value / entry.step
        assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `${name} is on its slider's steps`)
      } else if (entry.kind === 'switch') {
        assert.equal(typeof value, 'boolean', `${name} is on or off`)
      } else if (entry.kind === 'choice') {
        const choices: readonly unknown[] = Object.values(entry.choices)
        assert.ok(choices.includes(value), `${name} is among its choices`)
      } else if (entry.kind === 'style') {
        assert.ok(styles.some((style) => style.id === value), `${name} is a style`)
      } else {
        assert.fail(`${name}: the Detail is the body's levels' to give, not a preset's`)
      }
    }
  }
})

void test('each preset sets only what its own look draws, and nothing a backend or a body may lack', () => {
  for (const preset of named) {
    const options: ViewOptions = { ...defaultOptions, ...preset.options }
    const valueOf = (key: string) => (isOption(key) ? options[key] : undefined)
    for (const key of Object.keys(preset.options)) {
      if (!isOption(key)) continue
      const entry = viewOptions[key]
      assert.ok(isShown(entry, options.style, valueOf), `${preset.id}'s ${key} shows in the panel`)
      assert.equal(entry.needs, undefined, `${preset.id}'s ${key} needs nothing`)
      if (entry.kind === 'choice') {
        assert.ok(!Object.hasOwn(entry.choiceNeeds ?? {}, String(options[key])), `${preset.id}'s ${key} needs nothing`)
      }
    }
    // Framing keeps the scene's up as the camera's, which straight up or down leaves undefined
    assert.ok(Math.abs(preset.view.elevation) < 90, `${preset.id} is framed from short of straight up or down`)
  }
})

void test('a preset sets every option but the Detail, its own and the rest at their defaults, so nothing moved is left', () => {
  // Options moved every which way before the press, the Detail among them
  const moved: ViewOptions = { ...defaultOptions, style: 'surface', opacity: 0.3, axial: 0.2, bloom: 2, size: 1.5, detail: 3 }
  for (const preset of named) {
    const set = presetOptions(preset)
    assert.equal(set.detail, undefined, `${preset.id} leaves the Detail`)
    const pressed: ViewOptions = { ...moved, ...set }
    for (const option of optionKeys) {
      const expected = option === 'detail' ? moved.detail : (preset.options[option] ?? defaultOptions[option])
      assert.equal(pressed[option], expected, `${preset.id}'s ${option}`)
    }
  }
})

void test('no two presets are the same look, nor is an alternate any preset\'s', () => {
  const looks = named.map((preset) => JSON.stringify(presetOptions(preset)))
  assert.equal(new Set(looks).size, named.length)
})

const dot = (a: Triple, b: Triple) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Triple, b: Triple): Triple => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Triple): Triple => {
  const length = Math.hypot(...a)
  return [a[0] / length, a[1] / length, a[2] / length]
}

// Bounds' half extents, in millimetres: about the male's, about the head's, and a tall, thin box
const boxes: Triple[] = [
  [281, 940, 160.5],
  [96, 116, 112],
  [50, 300, 20],
]
// The camera's 50° field of view, as the page sets it, and windows wide, square and narrow
const tanHalfFov = Math.tan((25 * Math.PI) / 180)
const aspects = [2.4, 1.6, 1, 0.5]
const margin = 1.1

void test('framed from the front, level, a body fits by its near face, as the framing always fitted it', () => {
  for (const half of boxes) {
    for (const aspect of aspects) {
      const { toward, distance } = frameFrom(half, frontView, tanHalfFov, aspect, margin)
      assert.deepEqual(toward, [0, 0, 1])
      const fit = Math.max(half[1] / tanHalfFov, half[0] / (tanHalfFov * aspect))
      assert.ok(Math.abs(distance - (fit * margin + half[2])) < 1e-9, `${half.join(' × ')} at ${aspect}`)
    }
  }
})

void test('framed from any angle, every corner of a body lies inside the view with the margin, one of them on its edge', () => {
  const views: ViewAngle[] = [
    { azimuth: 30, elevation: 8 },
    { azimuth: -120, elevation: -40 },
    { azimuth: 90, elevation: 0 },
    { azimuth: 180, elevation: 60 },
  ]
  for (const half of boxes) {
    for (const aspect of aspects) {
      for (const view of views) {
        const { toward, distance } = frameFrom(half, view, tanHalfFov, aspect, margin)
        assert.ok(Math.abs(Math.hypot(...toward) - 1) < 1e-12)
        // The camera's axes as three's lookAt makes them, with the scene's up
        const right = unit(cross([0, 1, 0], toward))
        const above = cross(toward, right)
        let tightest = Infinity
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            for (const sz of [-1, 1]) {
              const corner: Triple = [sx * half[0], sy * half[1], sz * half[2]]
              const ahead = distance - dot(corner, toward)
              const room = Math.min(
                ahead * tanHalfFov - Math.abs(dot(corner, above)) * margin,
                ahead * tanHalfFov * aspect - Math.abs(dot(corner, right)) * margin,
              )
              assert.ok(room > -1e-9, `${half.join(' × ')} at ${aspect} from ${view.azimuth}°, ${view.elevation}°`)
              tightest = Math.min(tightest, room)
            }
          }
        }
        assert.ok(tightest < 1e-6, `${half.join(' × ')} at ${aspect} from ${view.azimuth}°, ${view.elevation}° is framed no farther than it needs`)
      }
    }
  }
})

void test('the azimuth turns the camera toward the body\'s left, the scene\'s +x, and the elevation raises it', () => {
  const half: Triple = [281, 940, 160.5]
  assert.ok(frameFrom(half, { azimuth: 30, elevation: 0 }, tanHalfFov, 1.6, margin).toward[0] > 0)
  assert.ok(frameFrom(half, { azimuth: -30, elevation: 0 }, tanHalfFov, 1.6, margin).toward[0] < 0)
  assert.ok(frameFrom(half, { azimuth: 0, elevation: 8 }, tanHalfFov, 1.6, margin).toward[1] > 0)
})

const radians = (degrees: number) => (degrees * Math.PI) / 180
const degrees = (angle: number) => Math.round((angle * 180) / Math.PI)
const reach = radians(swayDegrees)
// The swing's own top speed, through the front, in radians a second
const pace = (reach * 2 * Math.PI) / swaySeconds
// Views the sway can set off from: the front, the presets' opening view and its mirror, the swing's ends, and beyond
// them, round to the side and to the back either way
const starts = [0, 30, -30, 50, -50, 70, 120, 180, -170].map(radians)

void test('the sway sets off from rest where the view stands, toward the front, or from the front toward the body\'s left', () => {
  for (const start of starts) {
    assert.ok(Math.abs(swayAngle(0, start) - start) < 1e-12, `from ${degrees(start)}°`)
    // Barely moved in its first twentieth of a second, as it's eased in from rest
    assert.ok(Math.abs(swayAngle(0.05, start) - start) < 1e-3, `from ${degrees(start)}°, at once`)
    const heading = Math.sign(swayAngle(1, start) - start)
    assert.equal(heading, start === 0 ? 1 : -Math.sign(start), `from ${degrees(start)}°, the way it heads`)
  }
})

void test('once eased in, the sway swings its full reach either way of the front, whatever view it set off from', () => {
  for (const start of starts) {
    let lowest = Infinity
    let highest = -Infinity
    // Two swings, well after the longest ease in
    for (let t = 2 * swaySeconds; t < 4 * swaySeconds; t += 0.01) {
      lowest = Math.min(lowest, swayAngle(t, start))
      highest = Math.max(highest, swayAngle(t, start))
    }
    assert.ok(Math.abs(highest - reach) < 1e-5 && Math.abs(lowest + reach) < 1e-5, `from ${degrees(start)}°`)
  }
  // From the front, eased in by its first quarter swing, then out to the left and to the right each swing
  for (const swing of [0, 1, 2]) {
    assert.ok(Math.abs(swayAngle((swing + 0.25) * swaySeconds, 0) - reach) < 1e-9, `swing ${swing} to the left`)
    assert.ok(Math.abs(swayAngle((swing + 0.75) * swaySeconds, 0) + reach) < 1e-9, `swing ${swing} to the right`)
  }
})

void test('the sway goes past neither its reach nor a view beyond it that it set off from, which it comes back from the short way, unhurried', () => {
  const step = 1 / 60
  for (const start of starts) {
    const low = Math.min(start, -reach)
    const high = Math.max(start, reach)
    let last = swayAngle(0, start)
    for (let t = step; t < 2 * swaySeconds; t += step) {
      const angle = swayAngle(t, start)
      assert.ok(angle >= low - 1e-12 && angle <= high + 1e-12, `from ${degrees(start)}° at ${t.toFixed(2)} s`)
      assert.ok(Math.abs(angle - last) / step < 3 * pace, `from ${degrees(start)}° at ${t.toFixed(2)} s, its speed`)
      last = angle
    }
  }
})
