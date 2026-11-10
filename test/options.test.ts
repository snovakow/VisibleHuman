import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultOptions, drawableOptions, isOption, optionKeys, viewOptions, type Folder, type ViewOptions } from '../src/options.ts'
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
  // The surface meshes its skin at the splats' Detail, so it shows the Detail too, at the same default
  assert.deepEqual(viewOptions.detail.shownFor, { styles: ['splats', 'surface'] })
  assert.deepEqual(viewOptions.size.shownFor, { styles: ['splats'] })
  assert.equal(viewOptions.opacity.shownFor, 'every')
})

void test('the keys come in the panel\'s order, the Look folder before the Cuts and the Scene after them', () => {
  const folderOf = optionKeys.map((key) => viewOptions[key].folder)
  assert.ok(folderOf.lastIndexOf('Look') < folderOf.indexOf('Cuts'))
  assert.ok(folderOf.lastIndexOf('Cuts') < folderOf.indexOf('Scene'))
  assert.equal(optionKeys[0], 'style')
})

void test('the raytrace traces both surfaces, lays two layers below full Opacity, casts no shadow until asked, and shares the bone threshold and the rim with the surface', () => {
  const { trace, layers, shadows, lightAzimuth, lightElevation, boneThreshold, rim, quality } = viewOptions
  assert.equal(trace.default, 'both')
  // The brain is a choice too, for a body with an MRI
  assert.deepEqual(Object.values(trace.choices).sort(), ['bone', 'both', 'brain', 'skin'])
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

void test('the surface draws the skin and the bone, no back shell until asked below full Opacity, and caps its cuts', () => {
  const { skin, bone, backShell, caps, boneThreshold, rim } = viewOptions
  assert.deepEqual([skin.kind, bone.kind, backShell.kind, caps.kind], ['switch', 'switch', 'switch', 'switch'])
  assert.deepEqual([skin.default, bone.default, backShell.default, caps.default], [true, true, false, true])
  for (const entry of [skin, bone, backShell]) assert.deepEqual([entry.folder, entry.shownFor], ['Look', { styles: ['surface'] }])
  assert.deepEqual([caps.folder, caps.shownFor], ['Cuts', { styles: ['surface'] }])
  // The far side shows only under a see-through near side
  assert.deepEqual(backShell.shownWhile, { option: 'opacity', below: 1 })
  // The bone threshold and the rim serve the surface as they serve the raytrace
  for (const entry of [boneThreshold, rim]) assert.deepEqual(entry.shownFor, { styles: ['raytrace', 'surface'] })
  // The switches come before the shared sliders, and Caps after the cuts
  assert.ok(optionKeys.indexOf('backShell') < optionKeys.indexOf('boneThreshold'))
  assert.ok(optionKeys.indexOf('caps') > optionKeys.indexOf('sagittal'))
})

void test('the surface colours from the texture and draws no shell until a Depth is asked for, up to 100 mm in whole millimetres', () => {
  const { colour, depth } = viewOptions
  assert.equal(colour.default, 'texture')
  assert.deepEqual(Object.values(colour.choices).sort(), ['cells', 'texture'])
  assert.deepEqual([depth.min, depth.max, depth.step, depth.default], [0, 100, 1, 0])
  for (const entry of [colour, depth]) assert.deepEqual([entry.folder, entry.shownFor], ['Look', { styles: ['surface'] }])
})

void test('the splats blend in order until asked otherwise, and the weighted sum is a choice only a capable backend offers', () => {
  const { blend } = viewOptions
  assert.equal(blend.default, 'normal')
  assert.deepEqual(blend.choices, { normal: 'normal', glow: 'glow', weighted: 'weighted' })
  assert.deepEqual([blend.folder, blend.label, blend.shownFor], ['Look', 'Blend', { styles: ['splats'] }])
  // The weighted sum alone needs something of the backend
  assert.deepEqual(blend.choiceNeeds, { weighted: 'weighted' })
  assert.equal(blend.needs, undefined)
  // Blend sits with the splats' own controls, straight after Size
  assert.equal(optionKeys.indexOf('blend'), optionKeys.indexOf('size') + 1)
})

void test('the depth cue starts at none, in the Scene folder, for every style', () => {
  const { depthCue } = viewOptions
  assert.equal(defaultOptions.depthCue, 0)
  assert.deepEqual([depthCue.min, depthCue.max, depthCue.step], [0, 1, 0.01])
  assert.deepEqual([depthCue.folder, depthCue.label, depthCue.shownFor], ['Scene', 'Depth cue', 'every'])
  assert.equal(depthCue.needs, undefined)
  // The Scene's controls come after the cuts
  assert.ok(optionKeys.indexOf('depthCue') > optionKeys.indexOf('caps'))
})

void test('the page opens with no effect on: no bloom, the sorted blend, and the surface\'s depth pass', () => {
  const { bloom, bloomRadius, bloomThreshold, oit } = viewOptions
  assert.deepEqual([defaultOptions.blend, defaultOptions.bloom, defaultOptions.oit], ['normal', 0, false])
  assert.deepEqual([bloom.min, bloom.max, bloom.step], [0, 3, 0.01])
  // Bloom's spread and threshold show only while there's a bloom
  for (const slider of [bloomRadius, bloomThreshold]) {
    assert.deepEqual([slider.min, slider.max, slider.step], [0, 1, 0.01])
    assert.deepEqual(slider.shownWhile, { option: 'bloom', above: 0 })
  }
  for (const entry of [bloom, bloomRadius, bloomThreshold]) {
    assert.deepEqual([entry.folder, entry.shownFor, entry.needs], ['Scene', 'every', undefined])
  }
  // The surface's order-independent transparency acts only on a see-through skin, and needs a capable backend
  assert.deepEqual(
    [oit.kind, oit.folder, oit.shownFor, oit.shownWhile, oit.needs],
    ['switch', 'Scene', { styles: ['surface'] }, { option: 'opacity', below: 1 }, 'oit'],
  )
  assert.deepEqual([bloom.label, bloomRadius.label, bloomThreshold.label, oit.label], ['Bloom', 'Bloom radius', 'Bloom threshold', 'OIT'])
  // They come after the depth cue, the switch last
  assert.deepEqual(optionKeys.slice(optionKeys.indexOf('depthCue')), ['depthCue', 'bloom', 'bloomRadius', 'bloomThreshold', 'oit'])
})

void test('an option the backend can\'t draw goes back to its default, and what it can draw stands as the same object', () => {
  const asked: ViewOptions = { ...defaultOptions, blend: 'weighted', oit: true, opacity: 0.3 }
  assert.equal(drawableOptions(asked, { weighted: true, oit: true, mri: false }), asked)
  assert.deepEqual(drawableOptions(asked, { weighted: false, oit: true, mri: false }), { ...asked, blend: 'normal' })
  assert.deepEqual(drawableOptions(asked, { weighted: true, oit: false, mri: false }), { ...asked, oit: false })
  assert.deepEqual(drawableOptions(asked, { weighted: false, oit: false, mri: false }), { ...asked, blend: 'normal', oit: false })
  // The glow needs nothing, and nor do the defaults
  const glow: ViewOptions = { ...defaultOptions, blend: 'glow' }
  assert.equal(drawableOptions(glow, { weighted: false, oit: false, mri: false }), glow)
  assert.equal(drawableOptions(defaultOptions, { weighted: false, oit: false, mri: false }), defaultOptions)
})

void test('the MRI and the brain are offered only for a body with an MRI, and go back to their defaults without one', () => {
  const { density, trace, inner, mriThreshold } = viewOptions
  assert.deepEqual(density.choices, { CT: 'ct', colour: 'colour', MRI: 'mri' })
  assert.deepEqual(density.choiceNeeds, { mri: 'mri' })
  assert.deepEqual(trace.choices, { skin: 'skin', bone: 'bone', both: 'both', brain: 'brain' })
  assert.deepEqual(trace.choiceNeeds, { brain: 'mri' })
  assert.deepEqual([inner.kind, inner.folder, inner.label, inner.default, inner.needs], ['choice', 'Look', 'Inner', 'bone', 'mri'])
  assert.deepEqual(inner.shownFor, { styles: ['surface'] })
  assert.deepEqual(inner.choices, { bone: 'bone', brain: 'brain' })
  // The threshold sits with the Bone threshold, on the MRI block's scale of 1 to 255
  assert.deepEqual(
    [mriThreshold.kind, mriThreshold.label, mriThreshold.min, mriThreshold.max, mriThreshold.step, mriThreshold.needs],
    ['slider', 'MRI threshold', 1, 255, 1, 'mri'],
  )
  assert.deepEqual(mriThreshold.shownFor, { styles: ['raytrace', 'surface'] })
  assert.equal(optionKeys.indexOf('mriThreshold'), optionKeys.indexOf('boneThreshold') + 1)
  assert.equal(optionKeys.indexOf('inner'), optionKeys.indexOf('backShell') + 1)
  // The defaults read no MRI, so every body draws them
  assert.deepEqual([defaultOptions.density, defaultOptions.trace, defaultOptions.inner], ['ct', 'both', 'bone'])
  const asked: ViewOptions = { ...defaultOptions, density: 'mri', trace: 'brain', inner: 'brain', mriThreshold: 90 }
  const backend = { weighted: true, oit: true }
  assert.equal(drawableOptions(asked, { ...backend, mri: true }), asked)
  // Without one the choices go back and the threshold stays as it was moved, for the next body that has one
  assert.deepEqual(drawableOptions(asked, { ...backend, mri: false }), { ...asked, density: 'ct', trace: 'both', inner: 'bone' })
})
