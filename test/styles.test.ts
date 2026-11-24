import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lookOf } from '../src/look.ts'
import { defaultOptions, viewOptions, type ViewOptions } from '../src/options.ts'
import { framePlan, isDirect, pixelRatioFor } from '../src/render/frame/plan.ts'
import type { Style } from '../src/render/look.ts'
import { isSorted, isWeighted } from '../src/render/styles/splats/blend.ts'
import { isStyle, styleOf, styles } from '../src/render/styles/styles.ts'
import { isBackShell, isCapped, isOit } from '../src/render/styles/surface/rules.ts'

// The styles' lookup, the rules each style draws by, and the frame each look is planned as

const ids: Style[] = ['splats', 'volume', 'raytrace', 'surface']
// The blends the panel's Blend control offers
const blends = Object.values(viewOptions.blend.choices)

// The look of the defaults with some options changed
const lookAt = (changes: Partial<ViewOptions>) => lookOf({ ...defaultOptions, ...changes })

void test('the styles come in the panel\'s order, and only a style\'s id passes for one', () => {
  assert.deepEqual(
    styles.map((style) => style.id),
    ids,
  )
  for (const id of ids) {
    assert.ok(isStyle(id))
    assert.equal(styleOf(id).id, id)
  }
  for (const style of styles) assert.ok(style.label.length > 0)
  assert.ok(!isStyle('mesh'))
  assert.ok(!isStyle(null))
})

void test('the splats are sorted in the normal blend alone, and weighted in the weighted blend alone', () => {
  assert.deepEqual(blends, ['normal', 'glow', 'weighted'])
  for (const blend of blends) {
    assert.equal(isSorted(blend), blend === 'normal', blend)
    assert.equal(isWeighted({ blend }), blend === 'weighted', blend)
  }
})

// The cuts, none open or one of each open
const cutStates = [
  { axial: 0, coronal: 0, sagittal: 0 },
  { axial: 0.3, coronal: 0, sagittal: 0 },
  { axial: 0, coronal: 0.3, sagittal: 0 },
  { axial: 0, coronal: 0, sagittal: 0.3 },
]

void test('the caps show a section with their switch on and a cut open, and never otherwise', () => {
  for (const caps of [false, true]) {
    for (const cuts of cutStates) {
      const open = cuts.axial > 0 || cuts.coronal > 0 || cuts.sagittal > 0
      assert.equal(isCapped({ caps }, cuts), caps && open, `${caps} ${JSON.stringify(cuts)}`)
    }
  }
})

void test('the back shell is drawn for the skin below full Opacity with its switch on, and never otherwise', () => {
  for (const backShell of [false, true]) {
    for (const opacity of [0, 0.5, 0.99, 1]) {
      for (const skin of [false, true]) {
        assert.equal(isBackShell({ backShell, opacity, skin }), backShell && opacity < 1 && skin, `${backShell} ${opacity} ${skin}`)
      }
    }
  }
})

void test('the surface\'s layers are summed without an order below full Opacity with OIT on and the skin or a cap to see through, and never otherwise', () => {
  for (const oit of [false, true]) {
    for (const opacity of [0, 0.5, 0.99, 1]) {
      for (const skin of [false, true]) {
        for (const caps of [false, true]) {
          for (const cuts of cutStates) {
            const open = cuts.axial > 0 || cuts.coronal > 0 || cuts.sagittal > 0
            assert.equal(
              isOit({ oit, opacity, skin, caps }, cuts),
              oit && opacity < 1 && (skin || (caps && open)),
              `${oit} ${opacity} ${skin} ${caps} ${JSON.stringify(cuts)}`,
            )
          }
        }
      }
    }
  }
})

void test('a frame sums by weight for the weighted splats alone, and sums layers for the surface alone, whatever the other styles\' options say', () => {
  for (const style of ids) {
    for (const blend of blends) {
      for (const oit of [false, true]) {
        for (const opacity of [0.5, 1]) {
          const plan = framePlan(lookAt({ style, blend, oit, opacity }))
          const expected =
            style === 'splats' && blend === 'weighted' ? 'weighted' : style === 'surface' && oit && opacity < 1 ? 'oit' : 'ordered'
          assert.equal(plan.transparency, expected, `${style} ${blend} ${oit} ${opacity}`)
        }
      }
    }
  }
})

void test('a frame is smoothed for the styles that shade every pixel, glows only with Bloom up, and is drawn direct with neither', () => {
  for (const style of ids) {
    const perPixel = style === 'volume' || style === 'raytrace'
    assert.equal(styleOf(style).perPixel, perPixel, style)
    const plain = framePlan(lookAt({ style }))
    assert.deepEqual(plain, { transparency: 'ordered', smoothed: perPixel, bloom: null }, style)
    assert.equal(isDirect(plain), !perPixel, style)
    const glowing = framePlan(lookAt({ style, bloom: 0.5, bloomRadius: 0.2, bloomThreshold: 0.6 }))
    assert.deepEqual(glowing.bloom, { strength: 0.5, radius: 0.2, threshold: 0.6 }, style)
    assert.ok(!isDirect(glowing))
  }
  assert.ok(!isDirect(framePlan(lookAt({ style: 'splats', blend: 'weighted' }))))
  assert.ok(!isDirect(framePlan(lookAt({ style: 'surface', oit: true, opacity: 0.5 }))))
})

void test('the canvas draws at the device\'s pixel ratio, held at 1 only for a style that shades every pixel on the fallback', () => {
  for (const style of ids) {
    assert.deepEqual(pixelRatioFor(style, false), [1, 2], style)
    assert.deepEqual(pixelRatioFor(style, true), styleOf(style).perPixel ? [1, 1] : [1, 2], style)
  }
})
