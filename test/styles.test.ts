import assert from 'node:assert/strict'
import { test } from 'node:test'
import { viewOptions } from '../src/options.ts'
import { isBackShell, isOit, isStyle, isWeighted, styles, type Style } from '../src/viewer/styles.ts'

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

void test('the back shell is drawn for the surface below full Opacity with its switch on, and never otherwise', () => {
  for (const style of ids) {
    for (const backShell of [false, true]) {
      for (const opacity of [0, 0.5, 0.99, 1]) {
        assert.equal(
          isBackShell({ style, backShell, opacity }),
          backShell && style === 'surface' && opacity < 1,
          `${style} ${backShell} ${opacity}`,
        )
      }
    }
  }
})

void test('the surface\'s layers are summed without an order below full Opacity with OIT on, and never otherwise', () => {
  for (const style of ids) {
    for (const oit of [false, true]) {
      for (const opacity of [0, 0.5, 0.99, 1]) {
        assert.equal(isOit({ style, oit, opacity }), oit && style === 'surface' && opacity < 1, `${style} ${oit} ${opacity}`)
      }
    }
  }
})
