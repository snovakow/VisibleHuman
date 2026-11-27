import { Vector3 } from 'three'
import {
  abs,
  bool,
  Break,
  cameraWorldMatrix,
  clamp,
  Discard,
  dot,
  exp,
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
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node, UniformNode } from 'three/webgpu'
import { boneDensity } from '../../../volume/density.ts'
import { bodyCoverage, type Triple } from '../../../volume/format.ts'
import type { PosedRead } from '../../body/posedRead.ts'
import type { BodySampler } from '../../body/sampler.ts'
import type { CutBox } from '../../cuts.ts'
import type { DepthCue } from '../../depthCue.ts'
import type { Trace } from '../../look.ts'
import { bisectionSteps, boneCover, leastLayer, textureBox, type Mapped } from '../../rays.ts'
import { hitDepth, rayQuad } from '../rayQuad.ts'

// The raytrace: each pixel's ray, from the quad, clipped to the box the cuts leave, is stepped through the body's
// textures until it crosses a surface, the skin where the coverage passes the body decision or the bone where the
// density passes the Bone threshold, and the crossing is narrowed by halving the last step. The surface there is lit
// by its slope, in the colour of the tissue just inside it, darkened by the depth cue as it lies farther, and written
// as the pixel's depth, so that what else is drawn composites with it. A ray that starts inside a surface, where a cut
// has opened the body, meets it at once, on the cut face. Below full Opacity the ray carries on past the skin and lays
// the surfaces it meets over one another, front to back, until little light is left, as solid bone leaves none; so the
// skin over the bone over the far skin is ordered pixel by pixel with no sort. It lays Layers of skin at most, and past
// the last goes on for the bone alone, which no count of layers hides. The skin is laid at its surface, faintly where
// the ray only grazes it or it barely stands in its voxels; the bone is laid through its depth, by how much of it the
// ray goes through. Both keep the picture steady as the view turns, where a surface that is either met or missed
// blinks, and for the same reason the Rim lights the skin alone. Shadows send a second march from each lit point
// toward the light, through the whole grid, so that what the cuts take away still throws its shadow onto what they
// leave.
//
// A posed body is traced through the posed read (src/render/body/posedRead.ts): the ray runs through the posed scene
// from where the posed bounds begin, each step reading the scan where the joint that owns its point takes it back, or
// nothing, so every point moves rigidly with one joint. Once a step has crossed a surface, the reads about the crossing
// are made in the scan, along the ray as the joint on the surface's inner side takes it back, and see the flesh that
// still lies about that joint as it did: the halving, the look ahead and the slope, so a surface is found and lit as
// the scan holds it, its slope turned out with the joint, and a face the pose has parted from the flesh beside it is
// found where it parts, stepped by the rig's cells. The cuts act in the scan; a face cut open is met where a step
// crosses into the box the cuts leave, and is shaded as a cut face is, by that face of the box turned out with the
// joint. A shadow's march goes through the read too, its own ray tested against every joint's whole box, so a moved
// limb throws its shadow from where it now is. A body with no pose is traced as it always was, by a material of its own

// The skin lies where the coverage crosses the body decision, where the surface style meshes it too
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
// A crossing of the skin counts by how solidly the skin stands there: how far the coverage gets from the body decision
// on each side of the crossing, the nearer side deciding. A ray that grazes the skin crosses in and straight out again
// without the field ever rising far, as does one through a wisp of tissue or across a thin gap, and a surface drawn
// there at full strength shows as a speck that comes and goes with the pixel and the view: dotted outlines, sparkle
// wherever the Rim lights a sliver, and stair-stepped edges. So a crossing counts in full only where the field stands
// this far from zero on both sides, and for less as it stands less, down to nothing where the ray only touches the
// surface, which smooths every silhouette over about half a voxel. The coverage stands half its scale from the surface
// at most
const skinStanding = 0.25
// How far ahead of a crossing the ray looks for the skin's field to stand, in voxels, at so many reads to a voxel,
// stopping once it stands in full
const skinLook = 4
const looksPerVoxel = 4
// Through empty space the ray takes the step Quality sets, and this share of it wherever a surface it traces could lie
// within a step: the skin where the coverage is neither none nor whole, and the bone wherever there's any density at
// all, since bone a voxel thick is stepped over at a whole step as often as it's found
const bodyStride = 0.5
// A texture's value below which there's nothing there, half a level of its scale, and above which the coverage is whole
const nothing = 0.5 / 255
const whole = 1 - nothing
// A surface's slope is read from the field smoothed over a voxel: each read the mean of the eight reads half a voxel
// away along every axis, which approximates the field between the texels averaged over a texel's cube. Read straight,
// the skin's field, each voxel's share of body, ripples with the lattice wherever a surface crosses it, and the lit
// skin shows the ripple as contour bands over the whole body
const smoothingOffsets = [-0.5, 0.5]

// A shadow's ray is tested against the joints' boxes as far as this, in millimetres, which no body reaches across
const shadowReach = 1e5

// The traces as the shader's integers. The brain is traced as the bone is, alone: its surface is the same field's,
// the texture's fourth channel, which holds the MRI then and is judged against the MRI threshold
export const traceIndex: Record<Trace, number> = { skin: 0, bone: 1, both: 2, brain: 1 }

export interface Raytrace {
  // The quad's colour: what the ray through each pixel met, premultiplied, with how much it covers as its alpha. The
  // trace runs in the depth node and leaves the colour here, see depthNode
  colorNode: Node<'vec4'>
  // The depth of the first surface the ray meets, from the trace itself, which runs here: a node material sets its
  // depth up before its colour, so the trace lives in the depth and the colour node reads what it left
  depthNode: Node<'float'>
  trace: UniformNode<'int'>
  layers: UniformNode<'int'>
  shadows: UniformNode<'bool'>
  opacity: UniformNode<'float'>
  // The density from which a voxel is bone, from 0 to 1 of the scale
  boneThreshold: UniformNode<'float'>
  rim: UniformNode<'float'>
  // The grid the sampler reads, centred on the body's bounds: its spacing sizes the steps, and its box in the scene
  // is what the shadow march runs through
  setGrid(volume: Mapped, center: Triple): void
  // The box the cuts leave, in the scene's millimetres, which clips every ray and bounds the steps one can take
  setCuts(box: CutBox): void
  // The step, as a share of the smallest voxel spacing
  setStep(voxelShare: number): void
  // Where the light is, in degrees from the camera's view: across, from the left to the right, and up
  setLight(azimuthDeg: number, elevationDeg: number): void
  // For a posed trace: brings the read up to date with the bones, and the steps with the posed bounds, ahead of a
  // frame
  pose(): void
}

// The trace of the body a sampler reads, which must read the fields, darkened with depth by the cue, posed by the read
// where one is given
export function raytrace(sampler: BodySampler, cue: DepthCue, posed?: PosedRead): Raytrace {
  // A voxel's size along the scene's x, y and z, in millimetres, for the slope's differences
  const { voxel } = sampler
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
  // The step wherever a traced surface could lie within one
  const fineStep = uniform(1)
  // The most steps a ray through the cut box can take: its diagonal in the finer steps, one more for the step that
  // ends on the far face and one for the first
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
  let box: CutBox = { min: [0, 0, 0], max: [0, 0, 0] }
  let grid: CutBox = { min: [0, 0, 0], max: [0, 0, 0] }

  // The colour the trace leaves for the colour node
  const colour = property('vec4', 'tracedColour')

  // The two fields, each at or above zero inside its surface, from the one texel that holds them both
  const skinField = (p: Node<'vec3'>): Node<'float'> => sampler.fieldsAt(p).x.sub(skinIso)
  const boneField = (p: Node<'vec3'>): Node<'float'> => sampler.fieldsAt(p).y.sub(boneThreshold)
  // Posed, the fields at a point of the scan as a joint holds them: the body's where the flesh lies as it did about the
  // joint, and within the cuts where they're asked for, and nothing elsewhere
  const ownedFields = (joint: Node<'int'>, rest: Node<'vec3'>, cut: boolean): Node<'vec2'> => {
    if (!posed) return sampler.fieldsAt(rest)
    const kept = cut ? posed.sees(joint, rest).and(posed.insideCut(rest)) : posed.sees(joint, rest)
    return select(kept, sampler.fieldsAt(rest), vec2(0))
  }
  // The field of the surface a hit is on, where which surface is the pixel's own, posed as the hit's joint's piece
  // holds it
  const fieldOf = (bone: Node<'bool'>, p: Node<'vec3'>, joint?: Node<'int'>): Node<'float'> => {
    const both = (joint ? ownedFields(joint, p, false) : sampler.fieldsAt(p)).toVar()
    return select(bone, both.y.sub(boneThreshold), both.x.sub(skinIso))
  }
  // 1 where a field's value is at or above zero, inside its surface
  const insideOf = (value: Node<'float'>): Node<'float'> => step(0, value)

  // A posed trace clips its rays to the posed bounds, whose faces a ray that starts inside a surface is cut on, and cues
  // the depth across them
  const entryMin = posed ? posed.boundsMin : cutMin
  const entryMax = posed ? posed.boundsMax : cutMax
  const rayCue = posed ? cue.within(posed.center, posed.half) : cue
  // Where two joints claim a point, the one where the body's coverage is the greater keeps it
  const coverageAt = (rest: Node<'vec3'>) => sampler.fieldsAt(rest).x

  const depthNode = rayQuad(entryMin, entryMax, ({ origin, direction, viewDir, tEnter, tExit }) => {
    const ray = posed?.ray(origin, direction, tEnter, tExit, true)
    const tracesSkin = trace.notEqual(traceIndex.bone).toVar()
    const tracesBone = trace.notEqual(traceIndex.skin).toVar()
    const at = (t: Node<'float'>): Node<'vec3'> => origin.add(direction.mul(t))
    const toCamera = direction.negate().toVar()
    const toLight = normalize(cameraWorldMatrix.mul(vec4(lightView, 0)).xyz).toVar()
    const gathered = vec3(0).toVar()
    const transmittance = float(1).toVar()
    const hits = int(0).toVar()
    // How many layers of skin the hits so far come to, each counted by how solidly it stands
    const laid = float(0).toVar()
    const firstHit = float(0).toVar()
    const done = bool(false).toVar()
    // Whether the Layers are used up, below full Opacity: the ray lays no more skin, and carries on only for the bone,
    // which no count of layers hides
    const spent = bool(false).toVar()

    // Where a field crosses zero between a distance before the crossing and one after it, by halving the span: each
    // halving keeps the half whose ends lie on opposite sides, judged against the near end's side. rays.ts has the
    // same on the CPU, where the tests prove it
    const crossingOf = (fieldAlong: (t: Node<'float'>) => Node<'float'>, before: Node<'float'>, after: Node<'float'>, insideBefore: Node<'float'>) => {
      const low = before.toVar()
      const high = after.toVar()
      Loop(bisectionSteps, () => {
        const mid = low.add(high).mul(0.5).toVar()
        If(insideOf(fieldAlong(mid)).equal(insideBefore), () => {
          low.assign(mid)
        }).Else(() => {
          high.assign(mid)
        })
      })
      return low.add(high).mul(0.5)
    }

    // A field smoothed over a voxel's cube about a point
    const smoothFieldOf = (bone: Node<'bool'>, p: Node<'vec3'>, joint?: Node<'int'>): Node<'float'> => {
      const sum = float(0).toVar()
      for (const ox of smoothingOffsets) {
        for (const oy of smoothingOffsets) {
          for (const oz of smoothingOffsets) {
            sum.addAssign(fieldOf(bone, p.add(voxel.mul(vec3(ox, oy, oz))), joint))
          }
        }
      }
      return sum.div(smoothingOffsets.length ** 3)
    }

    // The way out of a surface at a point on it: against the smoothed field's slope, from central differences a
    // voxel apart. Where the reads agree there's no slope, and the division is guarded, since normalizing a zero
    // vector gives a NaN that some GPUs carry into the pixel
    const outwardOf = (bone: Node<'bool'>, p: Node<'vec3'>, joint?: Node<'int'>): Node<'vec3'> => {
      const gradient = (joint ? loopedGradient(bone, p, joint) : unrolledGradient(bone, p)).toVar()
      return gradient.negate().div(max(length(gradient), 1e-6))
    }
    const unrolledGradient = (bone: Node<'bool'>, p: Node<'vec3'>): Node<'vec3'> => {
      const dx = vec3(voxel.x, 0, 0)
      const dy = vec3(0, voxel.y, 0)
      const dz = vec3(0, 0, voxel.z)
      return vec3(
        smoothFieldOf(bone, p.add(dx)).sub(smoothFieldOf(bone, p.sub(dx))),
        smoothFieldOf(bone, p.add(dy)).sub(smoothFieldOf(bone, p.sub(dy))),
        smoothFieldOf(bone, p.add(dz)).sub(smoothFieldOf(bone, p.sub(dz))),
      )
    }
    // Posed, the same differences as a loop over the axes and the cube's corners, which sums each smoothed read in the
    // same order and so gives the same slope, since each of the 48 reads asks whether the flesh lies as it did about
    // the joint, and written out 48 times over at each place the trace reads a slope that made the shader too large to
    // compile in good time
    const loopedGradient = (bone: Node<'bool'>, p: Node<'vec3'>, joint: Node<'int'>): Node<'vec3'> => {
      const gradient = vec3(0).toVar()
      const [low, high] = smoothingOffsets
      Loop(3, ({ i: axis }) => {
        const along = vec3(select(axis.equal(0), float(1), float(0)), select(axis.equal(1), float(1), float(0)), select(axis.equal(2), float(1), float(0))).toVar()
        const ahead = p.add(voxel.mul(along)).toVar()
        const behind = p.sub(voxel.mul(along)).toVar()
        const sumAhead = float(0).toVar()
        const sumBehind = float(0).toVar()
        // The corners in the order the unrolled reads take them, x the slowest and z the fastest
        Loop(smoothingOffsets.length ** 3, ({ i: corner }) => {
          const offsetOf = (bit: number) => select(corner.shiftRight(bit).bitAnd(1).equal(1), float(high), float(low))
          const offset = voxel.mul(vec3(offsetOf(2), offsetOf(1), offsetOf(0))).toVar()
          sumAhead.addAssign(fieldOf(bone, ahead.add(offset), joint))
          sumBehind.addAssign(fieldOf(bone, behind.add(offset), joint))
        })
        gradient.addAssign(along.mul(sumAhead.div(smoothingOffsets.length ** 3).sub(sumBehind.div(smoothingOffsets.length ** 3))))
      })
      return gradient
    }

    // The way out of a box at a point on one of its faces: the face the point lies on, found as the nearest. A point
    // nearer the camera than any face is on the near plane, inside the body, and faces the camera
    const faceNormalAt = (p: Node<'vec3'>, boxLow: Node<'vec3'>, boxHigh: Node<'vec3'>): Node<'vec3'> => {
      const toLow = abs(p.sub(boxLow)).toVar()
      const toHigh = abs(boxHigh.sub(p)).toVar()
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
      if (posed) {
        // Posed, the march runs through the read along a ray of its own, as far as the last joint it can meet
        const shadowRay = posed.ray(start, toLight, float(0), float(shadowReach), false)
        const s = float(0).toVar()
        Loop(maxShadowSteps, () => {
          If(s.greaterThan(shadowRay.to), () => {
            Break()
          })
          const claim = posed.claim(shadowRay, s, start.add(toLight.mul(s)).toVar(), coverageAt, false)
          If(claim.found.and(fieldOf(bone, claim.rest).greaterThanEqual(0)), () => {
            lit.assign(shadowShade)
            Break()
          })
          s.addAssign(shadowStep)
        })
        return lit
      }
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

    // What the bone the ray is in shows: its colour as lit where the ray entered it
    const boneShade = vec3(0).toVar()

    // What's left of the Layers for a hit on the skin or a cut face to count by, below full Opacity, as rays.ts has it
    // on the CPU: all of it while a whole layer is left, and the share that's left of the last
    const layersLeft = () => select(opacity.lessThan(1), clamp(float(layers).sub(laid), 0, 1), float(1))

    // A hit at a distance along the ray, on the bone or the skin, on a cut face or a traced surface: shaded, and then
    // the skin and any cut face laid over what's gathered, the skin at Opacity by how solidly it stands there and a
    // face cut through bone whole, and the ray ended at full cover or once little light is left, or at the last layer
    // where the bone isn't traced. Traced bone is only shaded here, for the steps inside it to lay
    // Posed, a hit is read about where its joint, the one on the surface's inner side, takes it back to in the scan
    const hit = (tHit: Node<'float'>, bone: Node<'bool'>, cutFace: Node<'bool'>, standing: Node<'float'>, joint?: Node<'int'>) => {
      const p = at(tHit).toVar()
      const outward = vec3(0).toVar()
      let scanned: Node<'vec3'> = p
      let onFace = cutFace
      if (posed && joint) {
        // Posed, the hit is read where its joint takes it back to in the scan; and a hit within the faces' tolerance
        // of the plane of an open cut there is on a cut face, which the halving found where the step crossed into the
        // box the cuts leave, and takes that plane's way out, turned out with the joint
        const rest = posed.restOf(joint, p).toVar()
        const nearest = posed.nearestCut(rest)
        const onCut = cutFace.or(nearest.distance.lessThanEqual(faceTolerance)).toVar()
        If(cutFace, () => {
          outward.assign(faceNormalAt(p, entryMin, entryMax))
        })
          .ElseIf(onCut, () => {
            outward.assign(posed.posedDirection(joint, nearest.outward))
          })
          .Else(() => {
            outward.assign(posed.posedDirection(joint, outwardOf(bone, rest, joint)))
          })
        scanned = rest
        onFace = onCut
      } else {
        If(cutFace, () => {
          outward.assign(faceNormalAt(p, entryMin, entryMax))
        }).Else(() => {
          outward.assign(outwardOf(bone, p))
        })
      }
      // Turned to face the camera where the ray is leaving the surface, so that the far side of the skin reads as the
      // inside of a shell
      const normal = select(dot(outward, direction).greaterThan(0), outward.negate(), outward).toVar()
      // The way out of the surface where its colour is read
      const away = posed && joint ? posed.restDirection(joint, outward) : outward
      const base = vec3(0).toVar()
      for (let read = 0; read < colourReads; read++) {
        const depth = voxelDepth.mul((read + 0.5) / colourReads)
        base.addAssign(sampler.colourOf(sampler.texelAt(scanned.sub(away.mul(depth)))))
      }
      base.divAssign(colourReads)
      const facing = max(dot(normal, toCamera), 0).toVar()
      const sky = mix(float(groundLight), float(skyLight), normal.y.mul(0.5).add(0.5))
      const direct = facing.mul(headlight).toVar()
      If(shadows.and(facing.greaterThan(0)), () => {
        // The tissue a face is cut through can't shadow it, so a cut face, like bone, is shadowed by bone alone
        direct.mulAssign(litAt(p.add(normal.mul(stepLength)), onFace.or(bone)))
      })
      // A traced surface mirrors the headlight into the camera where it faces it, and the skin takes the Rim's light
      // where it turns away from it. The bone takes none: a ray meets the 4 mm level's thin bone at a graze all along
      // its outline, where the Rim's light, strongest there, comes and goes with just where the ray's steps fall, so
      // the outline sparkles as the view turns. A cut face takes neither: it's matte, so that the section shows the
      // photograph's own colours, and flat, so that seen from the side the Rim would light the whole of it, as it does
      // no edge
      const glint = select(onFace, float(0), pow(facing, shininess).mul(highlight))
      const edge = select(onFace.or(bone), float(0), pow(facing.oneMinus(), rimPower).mul(rim)).toVar()
      // The depth cue darkens the whole of what the hit shows, its highlight and its rim with it, as fog would
      const shaded = base.mul(sky.add(direct)).add(glint).add(edge).mul(rayCue.at(tHit.mul(viewDir.z.negate()))).toVar()
      If(hits.equal(0), () => {
        firstHit.assign(tHit)
      })
      hits.addAssign(1)
      If(bone.and(onFace.not()), () => {
        boneShade.assign(shaded)
      }).Else(() => {
        const strength = standing.mul(layersLeft()).toVar()
        const alpha = select(bone, float(1), clamp(max(opacity, edge), 0, 1)).mul(strength).toVar()
        gathered.addAssign(shaded.mul(alpha.mul(transmittance)))
        transmittance.mulAssign(alpha.oneMinus())
        // The layers are the skin's, counted below full Opacity, where each lets the next show through; at full
        // Opacity a ray goes on only past what doesn't stand in full, until it meets something that does
        laid.addAssign(select(bone, float(0), strength))
        spent.assign(opacity.lessThan(1).and(float(layers).sub(laid).lessThan(leastLayer)))
        done.assign(alpha.greaterThanEqual(1).or(transmittance.lessThan(minTransmittance)).or(spent.and(tracesBone.not())))
      })
    }

    // Which surfaces the point at a distance is inside, of those traced
    const skinInside = float(0).toVar()
    const boneInside = float(0).toVar()
    // Each field's value at the last sample, and how far the skin's has stood from zero, either way, on the ray's side
    // of the skin since the ray last crossed it. A ray starts with it standing in full, as nothing lies outside the cut
    // box
    const skinValue = float(0).toVar()
    const boneValue = float(0).toVar()
    const skinStood = float(skinStanding).toVar()
    // Posed, the joint whose candidate the last sample and the next were read by
    const joints = posed ? { last: int(0).toVar(), next: int(0).toVar() } : null
    const sampleAt = (t: Node<'float'>, skinTo: Node<'float'>, boneTo: Node<'float'>, skinValueTo: Node<'float'>, boneValueTo: Node<'float'>) => {
      // One read gives both fields, which is what a step costs; posed, the read of the scan where the step's point came
      // from, or nothing
      let both: Node<'vec2'>
      if (posed && ray && joints) {
        const claim = posed.claim(ray, t, at(t).toVar(), coverageAt, true)
        both = vec2(0).toVar()
        If(claim.found, () => {
          both.assign(sampler.fieldsAt(claim.rest))
        })
        joints.next.assign(claim.joint)
      } else both = sampler.fieldsAt(at(t)).toVar()
      If(tracesSkin, () => {
        skinValueTo.assign(both.x.sub(skinIso))
        skinTo.assign(insideOf(skinValueTo))
      })
      If(tracesBone, () => {
        boneValueTo.assign(both.y.sub(boneThreshold))
        boneTo.assign(insideOf(boneValueTo))
      })
    }

    // How solidly the skin stands at a crossing, from 0 to 1: how far its field has stood on the side the ray comes
    // from and how far it comes to stand ahead, read along the ray, the lesser deciding; rising is 1 where the field
    // rises along the ray, into the body, and −1 where it falls, out of it
    const standingAt = (tCross: Node<'float'>, rising: Node<'float'>, skinAlong: (t: Node<'float'>) => Node<'float'>): Node<'float'> => {
      const ahead = float(0).toVar()
      Loop(skinLook * looksPerVoxel, ({ i }) => {
        const reach = voxelDepth.mul(float(i).add(1).div(looksPerVoxel))
        ahead.assign(max(ahead, skinAlong(tCross.add(reach)).mul(rising)))
        If(ahead.greaterThanEqual(skinStanding), () => {
          Break()
        })
      })
      return smoothstep(0, skinStanding, min(skinStood, ahead))
    }

    // The skin's or the bone's field along the ray, and, posed, as the joint on a surface's inner side takes the ray
    // back into the scan, its own piece's: whole where the reads look ahead of a crossing, as the skin's look ahead
    // reads past the cuts, and as the cuts leave it where the crossing is narrowed down, so that a crossing into the
    // box the cuts leave is found on its face
    const along = (bone: boolean, joint: Node<'int'> | undefined, cut: boolean) => (t: Node<'float'>) => {
      if (!posed || !joint) return (bone ? boneField : skinField)(at(t))
      const both = ownedFields(joint, posed.restOf(joint, at(t)).toVar(), cut).toVar()
      return bone ? both.y.sub(boneThreshold) : both.x.sub(skinIso)
    }

    // Where the ray enters the cut box inside a surface, the box's face is the hit: a cut face, bone before skin
    sampleAt(tEnter, skinInside, boneInside, skinValue, boneValue)
    const entryBone = boneInside.equal(1).toVar()
    If(entryBone.or(skinInside.equal(1)), () => {
      hit(tEnter, entryBone, bool(true), float(1), joints?.next)
    })
    joints?.last.assign(joints.next)

    // Then step by step, each step ending at the exit at the latest, a crossing of either surface since the last
    // sample is narrowed down and hit, the nearer first where both are crossed. The skin is crossed either way, into
    // the body or out of it, until its Layers are laid; the bone only into it, where it's lit for the steps inside it
    // to lay
    const t = tEnter.toVar()
    // A posed ray reads nothing past the last of its joints, once a step has taken it there
    const end = ray ? min(tExit, ray.to).toVar() : tExit
    Loop(maxSteps, () => {
      If(done.or(t.greaterThanEqual(end)), () => {
        Break()
      })
      // The finer step wherever a surface traced could lie within one, by the fields as last sampled
      const nearSkin = tracesSkin.and(skinValue.add(skinIso).greaterThan(nothing)).and(skinValue.add(skinIso).lessThan(whole))
      const nearBone = tracesBone.and(boneValue.add(boneThreshold).greaterThan(nothing))
      const stride = select(nearSkin.or(nearBone), fineStep, stepLength).toVar()
      const tNext = min(t.add(stride), tExit).toVar()
      const skinNext = skinInside.toVar()
      const boneNext = boneInside.toVar()
      sampleAt(tNext, skinNext, boneNext, skinValue, boneValue)
      const crossedSkin = tracesSkin.and(spent.not()).and(skinNext.notEqual(skinInside)).toVar()
      const crossedBone = tracesBone.and(boneInside.equal(0)).and(boneNext.equal(1)).toVar()
      // Posed, a surface is read in the frame of the joint on its inner side: the skin's, which a ray may cross either
      // way, at whichever end of the step is inside it, and the bone's at the step's end, since it's crossed only into
      const skinJoint = joints ? select(skinInside.equal(1), joints.last, joints.next).toVar() : undefined
      const boneJoint = joints?.next
      If(crossedSkin.or(crossedBone), () => {
        // A surface not crossed is placed beyond the step, so the other is the nearer
        const beyond = tNext.add(stride).toVar()
        const tSkin = beyond.toVar()
        const tBone = beyond.toVar()
        If(crossedSkin, () => {
          tSkin.assign(crossingOf(along(false, skinJoint, true), t, tNext, skinInside))
        })
        If(crossedBone, () => {
          tBone.assign(crossingOf(along(true, boneJoint, true), t, tNext, boneInside))
        })
        // Both are hit in turn while the ray goes on, since the bone can lie within a step of the skin and the next
        // step starts past them both. Each, once hit, is placed beyond the step too, so that it's hit once
        Loop(2, () => {
          If(done.or(min(tSkin, tBone).greaterThanEqual(beyond)), () => {
            Break()
          })
          const bone = tBone.lessThanEqual(tSkin).toVar()
          // The skin's field rises along the ray where it enters the body and falls where it leaves
          const standing = float(1).toVar()
          If(bone.not(), () => {
            standing.assign(standingAt(tSkin, skinInside.mul(-2).add(1), along(false, skinJoint, false)))
          })
          hit(select(bone, tBone, tSkin), bone, bool(false), standing, boneJoint && skinJoint ? select(bone, boneJoint, skinJoint) : undefined)
          If(bone, () => {
            tBone.assign(beyond)
          }).Else(() => {
            tSkin.assign(beyond)
          })
        })
      })
      // Inside the bone, the step just taken is laid in the colour the bone was lit in where the ray entered it, by how
      // far the density stands over the threshold at the step's end and by the step's length in voxels, as rays.ts has
      // it on the CPU. Most of the 4 mm bone is a voxel thick or less and barely over the threshold, and counted once,
      // at its surface, such bone is there or not by where a ray's steps happen to fall, so it blinks as the view
      // turns; laid by how much of it the ray goes through, it shows the same from one view to the next
      If(tracesBone.and(boneNext.equal(1)).and(done.not()), () => {
        const depth = boneValue.mul(tNext.sub(t)).div(voxelDepth).mul(boneCover)
        const cover = exp(depth.negate()).oneMinus().toVar()
        gathered.addAssign(boneShade.mul(cover.mul(transmittance)))
        transmittance.mulAssign(cover.oneMinus())
        done.assign(transmittance.lessThan(minTransmittance))
      })
      // What the skin's field has stood on the side the ray is now on: past a crossing, only this sample's worth
      skinStood.assign(select(crossedSkin, abs(skinValue), max(skinStood, abs(skinValue))))
      t.assign(tNext)
      skinInside.assign(skinNext)
      boneInside.assign(boneNext)
      joints?.last.assign(joints.next)
    })

    If(hits.equal(0), () => {
      Discard()
    })
    colour.assign(vec4(gathered, transmittance.oneMinus()))
    return hitDepth(firstHit, viewDir)
  })

  // The steps follow the voxel spacing, the step's share, the cut box and the grid's box as they stand; posed, the
  // posed bounds take the place of both, since a ray and a shadow may cross all of them
  const fit = () => {
    const least = Math.min(...spacing)
    stepLength.value = least * voxelShare
    fineStep.value = stepLength.value * bodyStride
    const across = (each: { min: Triple; max: Triple }) => Math.hypot(each.max[0] - each.min[0], each.max[1] - each.min[1], each.max[2] - each.min[2])
    const diagonal = across(posed ? posed.bounds : box)
    maxSteps.value = Math.ceil(diagonal / fineStep.value) + 2
    shadowStep.value = least * shadowStepVoxels
    const gridDiagonal = across(posed ? posed.bounds : grid)
    maxShadowSteps.value = Math.ceil(gridDiagonal / shadowStep.value) + 1
    voxelDepth.value = least
    faceTolerance.value = least * faceShare
  }

  return {
    colorNode: colour,
    depthNode,
    trace,
    layers,
    shadows,
    opacity,
    boneThreshold,
    rim,
    setGrid(volume, center) {
      spacing = volume.spacing
      grid = textureBox(volume, center)
      gridMin.value.fromArray(grid.min)
      gridMax.value.fromArray(grid.max)
      fit()
    },
    setCuts(next) {
      box = next
      if (posed) posed.setCuts(next)
      else {
        cutMin.value.fromArray(next.min)
        cutMax.value.fromArray(next.max)
      }
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
    pose() {
      if (posed?.pose()) fit()
    },
  }
}
