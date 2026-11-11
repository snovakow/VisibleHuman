import assert from 'node:assert/strict'
import { test } from 'node:test'
import { viewOptions } from '../src/options.ts'
import { isBackShell, isCapped, isOit, isStyle, isWeighted, styles, type Style } from '../src/viewer/styles.ts'

// The styles' lookup and the rules the effects read

const ids: Style[] = ['splats', 'volume', 'raytrace', 'surface']
// The blends the panel's Blend control offers
const blends = Object.values(viewOptions.blend.choices)

void test('the styles come in the panel\'s order, and only a style\'s id passes for one', () => {
  assert.deepEqual(
    styles.map((style) => style.id),
    ids,
  )
  for (const id of ids) assert.ok(isStyle(id))
  for (const style of styles) assert.ok(style.label.length > 0)
  assert.ok(!isStyle('mesh'))
  assert.ok(!isStyle(null))
})

void test('the splats are weighted in the weighted blend alone, and no other style is', () => {
  assert.deepEqual(blends, ['normal', 'glow', 'weighted'])
  for (const style of ids) {
    for (const blend of blends) {
      assert.equal(isWeighted({ style, blend }), style === 'splats' && blend === 'weighted', `${style} ${blend}`)
    }
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
      assert.equal(isCapped({ caps, ...cuts }), caps && open, `${caps} ${JSON.stringify(cuts)}`)
    }
  }
})

void test('the back shell is drawn for the surface\'s skin below full Opacity with its switch on, and never otherwise', () => {
  for (const style of ids) {
    for (const backShell of [false, true]) {
      for (const opacity of [0, 0.5, 0.99, 1]) {
        for (const skin of [false, true]) {
          assert.equal(
            isBackShell({ style, backShell, opacity, skin }),
            backShell && style === 'surface' && opacity < 1 && skin,
            `${style} ${backShell} ${opacity} ${skin}`,
          )
        }
      }
    }
  }
})

void test('the surface\'s layers are summed without an order below full Opacity with OIT on and the skin or a cap to see through, and never otherwise', () => {
  for (const style of ids) {
    for (const oit of [false, true]) {
      for (const opacity of [0, 0.5, 0.99, 1]) {
        for (const skin of [false, true]) {
          for (const caps of [false, true]) {
            for (const cuts of cutStates) {
              const open = cuts.axial > 0 || cuts.coronal > 0 || cuts.sagittal > 0
              assert.equal(
                isOit({ style, oit, opacity, skin, caps, ...cuts }),
                oit && style === 'surface' && opacity < 1 && (skin || (caps && open)),
                `${style} ${oit} ${opacity} ${skin} ${caps} ${JSON.stringify(cuts)}`,
              )
            }
          }
        }
      }
    }
  }
})
