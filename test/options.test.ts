import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultOptions, isOption, optionKeys, viewOptions, type Folder } from '../src/options.ts'
import { styles } from '../src/viewer/styles.ts'
import { boneDensity } from '../src/volume/density.ts'

// The options table: the defaults the store opens on, the ranges and choices the panel is built from, and the splats'
// defaults, which the page has always opened on and which the table must keep

const folders: Folder[] = ['Body', 'Look', 'Cuts', 'Scene']

void test('the defaults hold every option in the table, each at its entry\'s default', () => {
  assert.deepEqual(Object.keys(defaultOptions).sort(), optionKeys.slice().sort())
  for (const key of optionKeys) assert.equal(defaultOptions[key], viewOptions[key].default, key)
  assert.ok(isOption('opacity'))
  assert.ok(!isOption('toString'))
})

void test('every entry sits in a folder, with a slider\'s default inside its range and a choice\'s among its choices', () => {
  for (const key of optionKeys) {
    const entry = viewOptions[key]
    assert.ok(folders.includes(entry.folder), `${key} is in ${entry.folder}`)
    assert.ok(entry.label.length > 0, `${key} has a label`)
    if (entry.kind === 'slider') {
      assert.ok(entry.min < entry.max, `${key}'s range`)
      assert.ok(entry.default >= entry.min && entry.default <= entry.max, `${key}'s default is in its range`)
      assert.ok(entry.step > 0, `${key}'s step`)
    } else if (entry.kind === 'style') {
      // The style's choices are the styles themselves
      assert.ok(styles.some((style) => style.id === entry.default), `${key}'s default is a style`)
    } else if (entry.kind === 'choice') {
      assert.ok(Object.values(entry.choices).includes(entry.default), `${key}'s default is among its choices`)
      assert.ok(Object.keys(entry.choices).length > 1, `${key} has choices to make`)
    } else if (entry.kind === 'switch') {
      assert.equal(typeof entry.default, 'boolean', `${key} is on or off`)
    }
    if (entry.shownFor !== 'every') {
      assert.ok(entry.shownFor.styles.length > 0, `${key} is shown for some style`)
      for (const style of entry.shownFor.styles) assert.ok(styles.some((each) => each.id === style), `${key} names a style`)
    }
    if (entry.shownWhile) assert.ok(isOption(entry.shownWhile.option), `${key} depends on an option`)
  }
})

void test('the splats open as they always have: block 2 at Size 1 and Opacity 1, with nothing cut', () => {
  // Block 2 is the 8 mm level of the male's 4 mm file
  assert.equal(viewOptions.detail.default, 2)
  assert.deepEqual(
    [defaultOptions.detail, defaultOptions.size, defaultOptions.opacity, defaultOptions.axial, defaultOptions.coronal, defaultOptions.sagittal],
    [2, 1, 1, 0, 0, 0],
  )
  assert.equal(defaultOptions.style, 'splats')
  const { size, opacity, axial, coronal, sagittal } = viewOptions
  assert.deepEqual([size.min, size.max, size.step], [0.5, 2, 0.01])
  assert.equal(size.deferred, true)
  for (const slider of [opacity, axial, coronal, sagittal]) assert.deepEqual([slider.min, slider.max, slider.step], [0, 1, 0.01])
  assert.deepEqual(
    [size.label, opacity.label, axial.label, coronal.label, sagittal.label, viewOptions.detail.label, viewOptions.style.label],
    ['Size', 'Opacity', 'Axial', 'Coronal', 'Sagittal', 'Detail', 'Style'],
  )
  assert.deepEqual([axial.folder, coronal.folder, sagittal.folder], ['Cuts', 'Cuts', 'Cuts'])
  assert.deepEqual(viewOptions.detail.shownFor, { styles: ['splats'] })
  assert.deepEqual(viewOptions.size.shownFor, { styles: ['splats'] })
  assert.equal(viewOptions.opacity.shownFor, 'every')
})

void test('the keys come in the panel\'s order, the Look folder before the Cuts', () => {
  const lookEnd = optionKeys.map((key) => viewOptions[key].folder).lastIndexOf('Look')
  const cutsStart = optionKeys.map((key) => viewOptions[key].folder).indexOf('Cuts')
  assert.ok(lookEnd < cutsStart)
  assert.equal(optionKeys[0], 'style')
})

void test('the raytrace traces both surfaces, lays two layers below full Opacity, casts no shadow until asked, and shares the bone threshold and the rim with the surface', () => {
  const { trace, layers, shadows, lightAzimuth, lightElevation, boneThreshold, rim, quality } = viewOptions
  assert.equal(trace.default, 'both')
  assert.deepEqual(Object.values(trace.choices).sort(), ['bone', 'both', 'skin'])
  assert.deepEqual([layers.min, layers.max, layers.step, layers.default], [1, 4, 1, 2])
  // The layers matter only where a ray sees through the skin
  assert.deepEqual(layers.shownWhile, { option: 'opacity', below: 1 })
  assert.equal(shadows.default, false)
  // The light starts above and to the left of the camera, and its sliders show only while shadows are cast
  assert.ok(lightAzimuth.default < 0 && lightElevation.default > 0)
  assert.deepEqual(lightAzimuth.shownWhile, { option: 'shadows', is: true })
  assert.deepEqual(lightElevation.shownWhile, { option: 'shadows', is: true })
  assert.deepEqual([boneThreshold.min, boneThreshold.max, boneThreshold.step, boneThreshold.default], [70, 200, 1, boneDensity])
  assert.deepEqual([rim.min, rim.max, rim.step, rim.default], [0, 1, 0.01, 0])
  for (const entry of [trace, layers, shadows, lightAzimuth, lightElevation]) assert.deepEqual(entry.shownFor, { styles: ['raytrace'] })
  for (const entry of [boneThreshold, rim]) assert.deepEqual(entry.shownFor, { styles: ['raytrace', 'surface'] })
  // The raytrace steps at the volume's Quality
  assert.deepEqual(quality.shownFor, { styles: ['volume', 'raytrace'] })
  assert.deepEqual(
    [trace.label, layers.label, shadows.label, lightAzimuth.label, lightElevation.label, boneThreshold.label, rim.label],
    ['Trace', 'Layers', 'Shadows', 'Light azimuth', 'Light elevation', 'Bone threshold', 'Rim'],
  )
})
