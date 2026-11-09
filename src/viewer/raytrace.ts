import { Data3DTexture, LinearFilter, Matrix4, NoColorSpace, RedFormat, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector3 } from 'three'
import {
  abs,
  bool,
  Break,
  cameraWorldMatrix,
  clamp,
  colorSpaceToWorking,
  Discard,
  dot,
  float,
  If,
  int,
  length,
  Loop,
  max,
  min,
  mix,
  normalize,
  pow,
  property,
  select,
  step,
  texture3D,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node, UniformNode } from 'three/webgpu'
import type { Trace } from '../options.ts'
import { boneDensity } from '../volume/density.ts'
import { bodyCoverage, type Triple } from '../volume/format.ts'
import { hitDepth, rayQuad } from './rayQuad.ts'
import { bisectionSteps, sceneToTexture, textureBox, type Mapped } from './rays.ts'

// The raytrace: each pixel's ray, from the quad, clipped to the box the cuts leave, is stepped through the body's
// textures until it crosses a surface, the skin where the coverage passes the body decision or the bone where the
// density passes the Bone threshold, and the crossing is narrowed by halving the last step. The surface there is lit
// by its slope, in the colour of the tissue just inside it, and written as the pixel's depth, so that what else is
// drawn composites with it. A ray that starts inside a surface, where a cut has opened the body, meets it at once, on
// the cut face. Below full Opacity the ray carries on past the skin and lays the surfaces it meets over one another,
// front to back, until it meets bone, has laid Layers of them, or has little light left; so the skin over the bone
// over the far skin is ordered pixel by pixel with no sort. Shadows send a second march from each lit point toward
// the light, through the whole grid, so that what the cuts take away still throws its shadow onto what they leave

// The skin lies where the coverage crosses the body decision, where the surface style, still to come, will mesh it
const skinIso = bodyCoverage / 255
// The light: a hemisphere's share of a surface's colour, from the sky's at one facing up to the ground's at one facing
// down; the headlight's share at one facing the camera; and a highlight's strength and sharpness, where the surface
// mirrors the headlight into the camera
const skyLight = 0.4
const groundLight = 0.12
const headlight = 0.6
const highlight = 0.3
const shininess = 32
// What the light leaves of the headlight's share where the body stands between the surface and the light
const shadowShade = 0.35
// The shadow march's step, in voxels: coarser than the trace, since it asks only whether anything lies in the way
const shadowStepVoxels = 2
// How sharply Rim's light is confined to a surface's edge
const rimPower = 3
// The ray stops once this little of the light would still get through
const minTransmittance = 0.01
// A surface's colour is the mean of this many reads spread evenly through the first voxel in from the surface. The
// colour changes with depth through the skin, and a surface crosses the lattice at every depth, so one read at a set
// depth would print the lattice onto the skin as bands of colour; the mean over a whole voxel's depth is the same
// whatever the depth the surface lies at
const colourReads = 4
// A hit within this share of a voxel of a face of the cut box lies on that face; one nearer the camera than any face
// is on the near plane, with the camera inside the body
const faceShare = 0.1
// A surface's slope is read from the field smoothed over a voxel: each read the mean of the eight reads half a voxel
// away along every axis, which approximates the field between the texels averaged over a texel's cube. Read straight,
// the skin's field, each voxel's share of body, ripples with the lattice wherever a surface crosses it, and the lit
// skin shows the ripple as contour bands over the whole body
const smoothingOffsets = [-0.5, 0.5]

// The traces as the shader's integers
const traceIndex: Record<Trace, number> = { skin: 0, bone: 1, both: 2 }

export interface Raytrace {
  // The quad's colour: what the ray through each pixel met, premultiplied, with how much it covers as its alpha. The
  // trace runs in the depth node and leaves the colour here, see depthNode
  colorNode: Node<'vec4'>
  // The depth of the first surface the ray meets, from the trace itself, which runs here: a node material sets its
  // depth up before its colour, so the trace lives in the depth and the colour node reads what it left
  depthNode: Node<'float'>
  // The box the cuts leave, in the scene's millimetres, which clips every ray
  cutMin: UniformNode<'vec3'>
  cutMax: UniformNode<'vec3'>
  trace: UniformNode<'int'>
  layers: UniformNode<'int'>
  shadows: UniformNode<'bool'>
  opacity: UniformNode<'float'>
  // The density from which a voxel is bone, from 0 to 1 of the scale
  boneThreshold: UniformNode<'float'>
  rim: UniformNode<'float'>
  // Reads a volume's colour and coverage textures, mapped from the scene by the volume's axes and centred on the
  // body's bounds. The textures stay their owner's, who releases them; the trace only reads them
  show(colour: Data3DTexture, coverage: Data3DTexture, volume: Mapped, center: Triple): void
  // The box the cuts leave, in the scene's millimetres, which clips every ray and bounds the steps one can take
  setCuts(min: Triple, max: Triple): void
  // The step, as a share of the smallest voxel spacing
  setStep(voxelShare: number): void
  // Where the light is, in degrees from the camera's view: across, from the left to the right, and up
  setLight(azimuthDeg: number, elevationDeg: number): void
  // Lets go of what the trace owns: the one-voxel textures it reads until a volume is shown
  dispose(): void
}

// A texture of one voxel of nothing, read until a volume is shown, so that the material compiles against a 3D texture
function emptyTexture(format: typeof RGBAFormat | typeof RedFormat, channels: number) {
  const texture = new Data3DTexture(new Uint8Array(channels), 1, 1, 1)
  texture.format = format
  texture.type = UnsignedByteType
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  return texture
}

export function raytrace(): Raytrace {
  const emptyColour = emptyTexture(RGBAFormat, 4)
  const emptyCoverage = emptyTexture(RedFormat, 1)
  const body = texture3D(emptyColour)
  const skin = texture3D(emptyCoverage)
  // From a point in the scene to the texture's coordinates, by the volume's axes
  const toTexture = uniform(new Matrix4())
  // A voxel's size along the scene's x, y and z, in millimetres, for the slope's differences
  const voxel = uniform(new Vector3(1, 1, 1))
  const cutMin = uniform(new Vector3())
  const cutMax = uniform(new Vector3())
  // The whole grid's box in the scene, which the shadow march runs through
  const gridMin = uniform(new Vector3())
  const gridMax = uniform(new Vector3())
  const trace = uniform(traceIndex.both, 'int')
  const layers = uniform(2, 'int')
  const shadows = uniform(false)
  const opacity = uniform(1)
  const boneThreshold = uniform(boneDensity / 255)
  const rim = uniform(0)
  // Toward the light, in view space
  const lightView = uniform(new Vector3(0, 0, 1))
  const stepLength = uniform(1)
  // The most steps a ray through the cut box can take: its diagonal in steps, one more for the step that ends on the
  // far face and one for the first
  const maxSteps = uniform(1, 'int')
  const shadowStep = uniform(1)
  const maxShadowSteps = uniform(1, 'int')
  // In millimetres: the depth of a voxel, through which a surface's colour is read, and how near a face of the cut
  // box a hit must lie to be on it
  const voxelDepth = uniform(1)
  const faceTolerance = uniform(1)

  // What the steps are sized from: the spacing shown, the step's share of it, the cut box and the grid's box
  let spacing: Triple = [1, 1, 1]
  let voxelShare = 1
  let box: { min: Triple; max: Triple } = { min: [0, 0, 0], max: [0, 0, 0] }
  let grid: { min: Triple; max: Triple } = { min: [0, 0, 0], max: [0, 0, 0] }

  // The colour the trace leaves for the colour node
  const colour = property('vec4', 'tracedColour')

  const uvwOf = (p: Node<'vec3'>): Node<'vec3'> => toTexture.mul(vec4(p, 1)).xyz
  // The two fields, each at or above zero inside its surface. The textures have one level, which is named so that the
  // reads need no screen derivatives, which WGSL allows only where every pixel takes the same path, and a ray that
  // has stopped doesn't
  const skinField = (p: Node<'vec3'>): Node<'float'> => skin.sample(uvwOf(p)).level(float(0)).r.sub(skinIso)
  const boneField = (p: Node<'vec3'>): Node<'float'> => body.sample(uvwOf(p)).level(float(0)).a.sub(boneThreshold)
  // The field of the surface a hit is on, where which surface is the pixel's own
  const fieldOf = (bone: Node<'bool'>, p: Node<'vec3'>): Node<'float'> => {
    const value = float(0).toVar()
    If(bone, () => {
      value.assign(boneField(p))
    }).Else(() => {
      value.assign(skinField(p))
    })
    return value
  }
  // 1 where a field's value is at or above zero, inside its surface
  const insideOf = (value: Node<'float'>): Node<'float'> => step(0, value)

  const depthNode = rayQuad(cutMin, cutMax, ({ origin, direction, viewDir, tEnter, tExit }) => {
    const tracesSkin = trace.notEqual(traceIndex.bone).toVar()
    const tracesBone = trace.notEqual(traceIndex.skin).toVar()
    const at = (t: Node<'float'>): Node<'vec3'> => origin.add(direction.mul(t))
    const toCamera = direction.negate().toVar()
    const toLight = normalize(cameraWorldMatrix.mul(vec4(lightView, 0)).xyz).toVar()
    const gathered = vec3(0).toVar()
    const transmittance = float(1).toVar()
    const hits = int(0).toVar()
    const firstHit = float(0).toVar()
    const done = bool(false).toVar()

    // Where a field crosses zero between a distance before the crossing and one after it, by halving the span: each
    // halving keeps the half whose ends lie on opposite sides, judged against the near end's side. rays.ts has the
    // same on the CPU, where the tests prove it
    const crossingOf = (field: (p: Node<'vec3'>) => Node<'float'>, before: Node<'float'>, after: Node<'float'>, insideBefore: Node<'float'>) => {
      const low = before.toVar()
      const high = after.toVar()
      Loop(bisectionSteps, () => {
        const mid = low.add(high).mul(0.5).toVar()
        If(insideOf(field(at(mid))).equal(insideBefore), () => {
          low.assign(mid)
        }).Else(() => {
          high.assign(mid)
        })
      })
      return low.add(high).mul(0.5)
    }

    // A field smoothed over a voxel's cube about a point
    const smoothFieldOf = (bone: Node<'bool'>, p: Node<'vec3'>): Node<'float'> => {
      const sum = float(0).toVar()
      for (const ox of smoothingOffsets) {
        for (const oy of smoothingOffsets) {
          for (const oz of smoothingOffsets) {
            sum.addAssign(fieldOf(bone, p.add(voxel.mul(vec3(ox, oy, oz)))))
          }
        }
      }
      return sum.div(smoothingOffsets.length ** 3)
    }

    // The way out of a surface at a point on it: against the smoothed field's slope, from central differences a
    // voxel apart. Where the reads agree there's no slope, and the division is guarded, since normalizing a zero
    // vector gives a NaN that some GPUs carry into the pixel
    const outwardOf = (bone: Node<'bool'>, p: Node<'vec3'>): Node<'vec3'> => {
      const dx = vec3(voxel.x, 0, 0)
      const dy = vec3(0, voxel.y, 0)
      const dz = vec3(0, 0, voxel.z)
      const gradient = vec3(
        smoothFieldOf(bone, p.add(dx)).sub(smoothFieldOf(bone, p.sub(dx))),
        smoothFieldOf(bone, p.add(dy)).sub(smoothFieldOf(bone, p.sub(dy))),
        smoothFieldOf(bone, p.add(dz)).sub(smoothFieldOf(bone, p.sub(dz))),
      ).toVar()
      return gradient.negate().div(max(length(gradient), 1e-6))
    }

    // The way out of the cut box at a point on one of its faces: the face the point lies on, found as the nearest. A
    // point nearer the camera than any face is on the near plane, inside the body, and faces the camera
    const faceNormalAt = (p: Node<'vec3'>): Node<'vec3'> => {
      const toLow = abs(p.sub(cutMin)).toVar()
      const toHigh = abs(cutMax.sub(p)).toVar()
      const nearest = min(toLow, toHigh).toVar()
      const sideOf = (low: Node<'float'>, high: Node<'float'>) => select(low.lessThan(high), float(-1), float(1))
      const normal = vec3(0).toVar()
      If(nearest.x.lessThanEqual(nearest.y).and(nearest.x.lessThanEqual(nearest.z)), () => {
        normal.assign(vec3(sideOf(toLow.x, toHigh.x), 0, 0))
      })
        .ElseIf(nearest.y.lessThanEqual(nearest.z), () => {
          normal.assign(vec3(0, sideOf(toLow.y, toHigh.y), 0))
        })
        .Else(() => {
          normal.assign(vec3(0, 0, sideOf(toLow.z, toHigh.z)))
        })
      If(min(min(nearest.x, nearest.y), nearest.z).greaterThan(faceTolerance), () => {
        normal.assign(toCamera)
      })
      return normal
    }

    // What the light leaves at a point, by a march from it toward the light at the shadow's step through the whole
    // grid, until it leaves the grid or the field stands in the way
    const litAt = (start: Node<'vec3'>, bone: Node<'bool'>): Node<'float'> => {
      const lit = float(1).toVar()
      const p = start.toVar()
      Loop(maxShadowSteps, () => {
        const outside = p.x
          .lessThan(gridMin.x)
          .or(p.y.lessThan(gridMin.y))
          .or(p.z.lessThan(gridMin.z))
          .or(p.x.greaterThan(gridMax.x))
          .or(p.y.greaterThan(gridMax.y))
          .or(p.z.greaterThan(gridMax.z))
        If(outside, () => {
          Break()
        })
        If(fieldOf(bone, p).greaterThanEqual(0), () => {
          lit.assign(shadowShade)
          Break()
        })
        p.addAssign(toLight.mul(shadowStep))
      })
      return lit
    }

    // A hit at a distance along the ray, on the bone or the skin, on a cut face or a traced surface: shaded and laid
    // over what's gathered, bone whole and skin at Opacity, and the ray ended at bone, at full cover, at the last
    // layer or once little light is left
    const hit = (tHit: Node<'float'>, bone: Node<'bool'>, cutFace: Node<'bool'>) => {
      const p = at(tHit).toVar()
      const outward = vec3(0).toVar()
      If(cutFace, () => {
        outward.assign(faceNormalAt(p))
      }).Else(() => {
        outward.assign(outwardOf(bone, p))
      })
      // Turned to face the camera where the ray is leaving the surface, so that the far side of the skin reads as the
      // inside of a shell
      const normal = select(dot(outward, direction).greaterThan(0), outward.negate(), outward).toVar()
      const base = vec3(0).toVar()
      for (let read = 0; read < colourReads; read++) {
        const depth = voxelDepth.mul((read + 0.5) / colourReads)
        const texel = body.sample(uvwOf(p.sub(outward.mul(depth)))).level(float(0))
        base.addAssign(colorSpaceToWorking(vec4(texel.rgb, 1), SRGBColorSpace).rgb)
      }
      base.divAssign(colourReads)
      const facing = max(dot(normal, toCamera), 0).toVar()
      const sky = mix(float(groundLight), float(skyLight), normal.y.mul(0.5).add(0.5))
      const direct = facing.mul(headlight).toVar()
      If(shadows.and(facing.greaterThan(0)), () => {
        // The tissue a face is cut through can't shadow it, so a cut face, like bone, is shadowed by bone alone
        direct.mulAssign(litAt(p.add(normal.mul(stepLength)), cutFace.or(bone)))
      })
      // A traced surface mirrors the headlight into the camera where it faces it; a cut face is matte, so that the
      // section shows the photograph's own colours
      const glint = select(cutFace, float(0), pow(facing, shininess).mul(highlight))
      const edge = pow(facing.oneMinus(), rimPower).mul(rim).toVar()
      const shaded = base.mul(sky.add(direct)).add(glint).add(edge)
      const alpha = select(bone, float(1), clamp(max(opacity, edge), 0, 1)).toVar()
      gathered.addAssign(shaded.mul(alpha.mul(transmittance)))
      transmittance.mulAssign(alpha.oneMinus())
      If(hits.equal(0), () => {
        firstHit.assign(tHit)
      })
      hits.addAssign(1)
      done.assign(bone.or(alpha.greaterThanEqual(1)).or(transmittance.lessThan(minTransmittance)).or(hits.greaterThanEqual(layers)))
    }

    // Which surfaces the point at a distance is inside, of those traced
    const skinInside = float(0).toVar()
    const boneInside = float(0).toVar()
    const sampleAt = (p: Node<'vec3'>, skinTo: Node<'float'>, boneTo: Node<'float'>) => {
      If(tracesSkin, () => {
        skinTo.assign(insideOf(skinField(p)))
      })
      If(tracesBone, () => {
        boneTo.assign(insideOf(boneField(p)))
      })
    }

    // Where the ray enters the cut box inside a surface, the box's face is the hit: a cut face, bone before skin
    sampleAt(at(tEnter), skinInside, boneInside)
    const entryBone = boneInside.equal(1).toVar()
    If(entryBone.or(skinInside.equal(1)), () => {
      hit(tEnter, entryBone, bool(true))
    })

    // Then step by step, each step ending at the exit at the latest, a crossing of either surface since the last
    // sample is narrowed down and hit, the nearer first where both are crossed. The skin is crossed either way, into
    // the body or out of it; the bone only into it, since a ray stops there
    const t = tEnter.toVar()
    Loop(maxSteps, () => {
      If(done.or(t.greaterThanEqual(tExit)), () => {
        Break()
      })
      const tNext = min(t.add(stepLength), tExit).toVar()
      const skinNext = skinInside.toVar()
      const boneNext = boneInside.toVar()
      sampleAt(at(tNext), skinNext, boneNext)
      const crossedSkin = tracesSkin.and(skinNext.notEqual(skinInside)).toVar()
      const crossedBone = tracesBone.and(boneInside.equal(0)).and(boneNext.equal(1)).toVar()
      If(crossedSkin.or(crossedBone), () => {
        // A surface not crossed is placed beyond the step, so the other is the nearer
        const beyond = tNext.add(stepLength).toVar()
        const tSkin = beyond.toVar()
        const tBone = beyond.toVar()
        If(crossedSkin, () => {
          tSkin.assign(crossingOf(skinField, t, tNext, skinInside))
        })
        If(crossedBone, () => {
          tBone.assign(crossingOf(boneField, t, tNext, boneInside))
        })
        // Both are hit in turn while the ray goes on, since the bone can lie within a step of the skin and the next
        // step starts past them both. The skin, once hit, is placed beyond the step too; a bone hit ends the ray
        Loop(2, () => {
          If(done.or(min(tSkin, tBone).greaterThanEqual(beyond)), () => {
            Break()
          })
          const bone = tBone.lessThanEqual(tSkin).toVar()
          hit(select(bone, tBone, tSkin), bone, bool(false))
          tSkin.assign(beyond)
        })
      })
      t.assign(tNext)
      skinInside.assign(skinNext)
      boneInside.assign(boneNext)
    })

    If(hits.equal(0), () => {
      Discard()
    })
    colour.assign(vec4(gathered, transmittance.oneMinus()))
    return hitDepth(firstHit, viewDir)
  })

  // The steps follow the voxel spacing, the step's share, the cut box and the grid's box as they stand
  const fit = () => {
    const least = Math.min(...spacing)
    stepLength.value = least * voxelShare
    const diagonal = Math.hypot(...box.max.map((high, axis) => high - box.min[axis]))
    maxSteps.value = Math.ceil(diagonal / stepLength.value) + 2
    shadowStep.value = least * shadowStepVoxels
    const gridDiagonal = Math.hypot(...grid.max.map((high, axis) => high - grid.min[axis]))
    maxShadowSteps.value = Math.ceil(gridDiagonal / shadowStep.value) + 1
    voxelDepth.value = least
    faceTolerance.value = least * faceShare
  }

  return {
    colorNode: colour,
    depthNode,
    cutMin,
    cutMax,
    trace,
    layers,
    shadows,
    opacity,
    boneThreshold,
    rim,
    show(colourTexture, coverageTexture, volume, center) {
      body.value = colourTexture
      skin.value = coverageTexture
      toTexture.value.copy(sceneToTexture(volume, center))
      spacing = volume.spacing
      const { x, y, z } = volume.axes
      voxel.value.set(volume.spacing[x.source], volume.spacing[y.source], volume.spacing[z.source])
      grid = textureBox(volume, center)
      gridMin.value.fromArray(grid.min)
      gridMax.value.fromArray(grid.max)
      fit()
    },
    setCuts(low, high) {
      box = { min: low, max: high }
      cutMin.value.fromArray(low)
      cutMax.value.fromArray(high)
      fit()
    },
    setStep(share) {
      voxelShare = share
      fit()
    },
    setLight(azimuthDeg, elevationDeg) {
      // In view space x runs to the right, y up and z toward the camera, so the light at azimuth 0 and elevation 0
      // is behind the camera, and a negative azimuth puts it to the left
      const azimuth = (azimuthDeg * Math.PI) / 180
      const elevation = (elevationDeg * Math.PI) / 180
      lightView.value.set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth))
    },
    dispose() {
      emptyColour.dispose()
      emptyCoverage.dispose()
    },
  }
}

export { traceIndex }
