import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Blend } from '../src/options.ts'
import { isBackShell, isStyle, isWeighted, styleOf, styles, type Style } from '../src/viewer/styles.ts'

// The styles' lookup and the rules the effects read

const ids: Style[] = ['splats', 'volume', 'raytrace', 'surface']
const blends: Blend[] = ['normal', 'glow', 'weighted']

void test('the styles come in the panel\'s order, each found by its id, and an unknown id falls back to the first', () => {
  assert.deepEqual(
    styles.map((style) => style.id),
    ids,
  )
  for (const id of ids) assert.equal(styleOf(id).id, id)
  for (const style of styles) assert.ok(style.label.length > 0)
  // The type keeps an unknown id out, so the fallback is reached through the guard
  const unknown = 'mesh'
  assert.ok(!isStyle(unknown))
  assert.ok(isStyle('volume'))
  assert.ok(!isStyle(null))
  assert.equal(styleOf(isStyle(unknown) ? unknown : styles[0].id).id, 'splats')
})

void test('the splats are weighted in the weighted blend alone, and no other style is', () => {
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
