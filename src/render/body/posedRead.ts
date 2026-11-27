import { Matrix4, RedFormat, Vector3, Vector4 } from 'three'
import { abs, all, bool, clamp, float, floor, If, int, ivec3, length, Loop, max, min, mix, step, texture3D, uniform, uniformArray, vec3, vec4 } from 'three/tsl'
import type { Node, UniformNode } from 'three/webgpu'
import { jointCellBoxes, jointSceneBoxes, noOwnerJoint, type CellBox, type SceneBox } from '../../rig/owners.ts'
import { jointNames } from '../../rig/rig.ts'
import type { RigFile } from '../../rig/rigFile.ts'
import type { CutBox } from '../cuts.ts'
import type { Posed } from '../posed.ts'
import { createJointFrames, jointCount, settleFrames, type Box } from '../posedRays.ts'
import { leastDirection, sceneToCell } from '../rays.ts'
import type { Body } from './body.ts'
import { emptyTexture } from './textures.ts'

// The posed read: how the per-pixel styles read a posed body along each pixel's ray, behind the sampler. A point of the
// scan moves rigidly with the joint that owns its rig cell, so for a point of the posed scene each joint the ray can
// meet offers the point its matrix takes back, kept where it lies in that joint's box and in a cell the joint owns, and
// the body's textures are read there, where the scan holds it. Once a pixel, the ray is taken back into every joint's
// frame and tested against its box, which leaves a mask of the joints it can meet and the stretch of it they span; a
// read outside that stretch is nothing, and one inside it tries the masked joints alone. A cut trims the box each joint
// is tested against, in the scan, so it stays the same section of the anatomy; a shadow's ray, which all of the body
// stands in the way of, takes the whole box. src/render/posedRays.ts is its twin on the CPU, where the tests prove it.
// The joints' frames follow the bones once a frame, and only once they have turned

// The joints a pixel's ray can meet, bit n for joint n, the lowest and the highest of them, so that a read tries only
// the joints between, and the distances along it from which the first can be met to where the last can be
export interface PosedRay {
  mask: Node<'int'>
  lowest: Node<'int'>
  highest: Node<'int'>
  from: Node<'float'>
  to: Node<'float'>
}

// What a read finds at a point: whether a joint's candidate passed, the joint whose candidate is kept, and the point
// of the scan it reads, where that joint takes the point back. Where none passed the joint is the first, so that a
// read of its matrix that a branch has yet to rule out stays within the array
export interface Claim {
  found: Node<'bool'>
  joint: Node<'int'>
  rest: Node<'vec3'>
}

export interface PosedRead {
  // The posed bounds, which no point of the posed body lies outside, as their corners, centre and half extents
  boundsMin: UniformNode<'vec3'>
  boundsMax: UniformNode<'vec3'>
  center: Node<'vec3'>
  half: Node<'vec3'>
  // The mask of a ray from an origin along a direction, between two distances along it, its boxes cut or whole.
  // Called inside the shader function that marches, since it declares the ray's variables there
  ray(origin: Node<'vec3'>, direction: Node<'vec3'>, tEnter: Node<'float'>, tExit: Node<'float'>, cut: boolean): PosedRay
  // What a read finds at a point a distance along the ray, within the cuts or not as its mask was found, where two
  // joints' candidates passing are told apart by the body's coverage at each, the greater winning and the lower joint
  // on a tie
  claim(ray: PosedRay, t: Node<'float'>, point: Node<'vec3'>, coverageAt: (rest: Node<'vec3'>) => Node<'float'>, cut: boolean): Claim
  // A point of the posed scene where a joint takes it back, and a direction turned with it, into the scan; and a
  // direction in the scan turned out to the posed scene with that joint
  restOf(joint: Node<'int'>, point: Node<'vec3'>): Node<'vec3'>
  restDirection(joint: Node<'int'>, direction: Node<'vec3'>): Node<'vec3'>
  posedDirection(joint: Node<'int'>, direction: Node<'vec3'>): Node<'vec3'>
  // Whether a point of the scan lies in the box the cuts leave, and whether it lies in the flesh a joint carries with
  // it as posed: in a cell the joint owns, in one whose own joint moves it to within `together` of where this joint
  // would, or beyond the body's reach. So the reads about a surface a rigid read meets see the flesh that still lies
  // as it did about it, all of it as scanned, and not the flesh the pose has parted from it, whose face it draws
  insideCut(rest: Node<'vec3'>): Node<'bool'>
  sees(joint: Node<'int'>, rest: Node<'vec3'>): Node<'bool'>
  // How far a point of the scan lies from the nearest plane of a cut that's open, and the way out of the body through
  // it, in the scan: up through Axial's, forward through Coronal's and to the right through Sagittal's. A very great
  // distance while no cut is open
  nearestCut(rest: Node<'vec3'>): { distance: Node<'float'>; outward: Node<'vec3'> }
  // The posed bounds as last set, for the steps a ray through them can take
  readonly bounds: Box
  // Reads a body's rig, posed, or nothing while there's no posed body. The rig's texture stays the binding's; the read
  // holds it only while it's bound to it
  bind(body: Body | null): void
  // The box the cuts leave of the body's bounds, in the scan
  setCuts(box: CutBox): void
  // Brings the joints' frames up to date with the bones, where they have turned since; true where they changed, and
  // the bounds with them. Called ahead of each frame, after the bones are posed
  pose(): boolean
  dispose(): void
}

// A distance, in millimetres, farther than any point of a body lies from anything, for a cut that isn't open
const farFromCuts = 1e6

// How near, in millimetres, the flesh of two joints must stay as posed to be read as one: a wall's faces show once its
// sides part by more than this, as the posed surface's do
const together = 0.5

// Each rig file's joints' boxes, found once for the file
const cellBoxesOf = new WeakMap<RigFile, (CellBox | null)[]>()
function cellBoxes(file: RigFile) {
  let boxes = cellBoxesOf.get(file)
  if (!boxes) {
    boxes = jointCellBoxes(file)
    cellBoxesOf.set(file, boxes)
  }
  return boxes
}

export function createPosedRead(): PosedRead {
  const emptyOwners = emptyTexture(RedFormat)
  const owners = texture3D(emptyOwners)
  const frames = createJointFrames()
  const inverses = uniformArray<'mat4'>(frames.inverses, 'mat4')
  // Each joint's skinning matrix, from the scan to the pose, set where the frames are
  const skinning = jointNames.map(() => new Matrix4())
  const forwards = uniformArray<'mat4'>(skinning, 'mat4')
  const lows = jointNames.map(() => new Vector4())
  const highs = jointNames.map(() => new Vector4())
  const boxMin = uniformArray<'vec4'>(lows, 'vec4')
  const boxMax = uniformArray<'vec4'>(highs, 'vec4')
  const present = uniform(0, 'int')
  // From the scene to the rig's cells, and the last cell along each axis, which a fetch is held within
  const toCell = uniform(new Matrix4())
  const lastCell = uniform(new Vector3())
  const cutMin = uniform(new Vector3())
  const cutMax = uniform(new Vector3())
  // 1 along the axis of each cut that's open, Sagittal's x, Axial's y and Coronal's z, else 0
  const openCuts = uniform(new Vector3())
  const boundsMin = uniform(new Vector3())
  const boundsMax = uniform(new Vector3())

  // What the frames are set from: the binding, its joints' boxes in its scene and each joint's skinning matrix, with the
  // binding and the count of its bones' turns they were last set for
  let bound: { body: Body; posed: Posed; boxes: (SceneBox | null)[] } | null = null
  let settled: { posed: Posed; turns: number } | null = null

  const unbind = () => {
    if (!bound) return
    bound.posed.textures.release('owners')
    bound = null
  }

  // The joint a point of the scan's nearest cell is owned by, held within the grid; the owner byte is read as a
  // fraction, as three declares a byte texture a float one
  const ownerAt = (rest: Node<'vec3'>) => {
    const cell = ivec3(clamp(floor(toCell.mul(vec4(rest, 1)).xyz), vec3(0), lastCell))
    return int(owners.load(cell).r.mul(255).add(0.5)).bitAnd(noOwnerJoint)
  }

  // A joint's box as a ray tests it, as the cuts leave it or whole
  const lowOf = (joint: Node<'int'>, cut: boolean) => (cut ? max(boxMin.element(joint).xyz, cutMin) : boxMin.element(joint).xyz)
  const highOf = (joint: Node<'int'>, cut: boolean) => (cut ? min(boxMax.element(joint).xyz, cutMax) : boxMax.element(joint).xyz)

  return {
    boundsMin,
    boundsMax,
    center: boundsMin.add(boundsMax).mul(0.5),
    half: boundsMax.sub(boundsMin).mul(0.5),
    ray(origin, direction, tEnter, tExit, cut) {
      const mask = int(0).toVar()
      const lowest = int(jointCount).toVar()
      const highest = int(-1).toVar()
      const from = tExit.toVar()
      const to = tEnter.toVar()
      Loop(jointCount, ({ i }) => {
        const low = lowOf(i, cut).toVar()
        const high = highOf(i, cut).toVar()
        // A box the cuts leave nothing of is met by no ray
        If(present.shiftRight(i).bitAnd(1).equal(1).and(all(low.lessThanEqual(high))), () => {
          // The ray in the joint's frame, by the slab test of rays.ts, its directions kept away from zero
          const inverse = inverses.element(i)
          const o = inverse.mul(vec4(origin, 1)).xyz
          const d = inverse.mul(vec4(direction, 0)).xyz
          const nudged = step(0, d).mul(2).sub(1).mul(max(abs(d), leastDirection))
          const toLow = low.sub(o).div(nudged)
          const toHigh = high.sub(o).div(nudged)
          const nearer = min(toLow, toHigh)
          const farther = max(toLow, toHigh)
          const enter = max(max(max(nearer.x, nearer.y), nearer.z), tEnter).toVar()
          const exit = min(min(min(farther.x, farther.y), farther.z), tExit).toVar()
          If(exit.greaterThanEqual(enter), () => {
            mask.assign(mask.bitOr(int(1).shiftLeft(i)))
            // The joints are met in order, so the first masked is the lowest and the last the highest
            If(lowest.equal(jointCount), () => {
              lowest.assign(i)
            })
            highest.assign(i)
            from.assign(min(from, enter))
            to.assign(max(to, exit))
          })
        })
      })
      return { mask, lowest, highest, from, to }
    },
    claim(ray, t, point, coverageAt, cut) {
      const found = bool(false).toVar()
      const joint = int(0).toVar()
      const rest = vec3(0).toVar()
      // The coverage where the kept candidate reads, read only once a second candidate passes
      const kept = float(-1).toVar()
      If(t.greaterThanEqual(ray.from).and(t.lessThanEqual(ray.to)), () => {
        Loop({ start: ray.lowest, end: ray.highest, type: 'int', condition: '<=' }, ({ i }) => {
          If(ray.mask.shiftRight(i).bitAnd(1).equal(1), () => {
            const candidate = inverses.element(i).mul(vec4(point, 1)).xyz.toVar()
            const inBox = all(candidate.greaterThanEqual(lowOf(i, cut))).and(all(candidate.lessThanEqual(highOf(i, cut))))
            If(inBox, () => {
              If(ownerAt(candidate).equal(i), () => {
                If(found.not(), () => {
                  found.assign(true)
                  joint.assign(i)
                  rest.assign(candidate)
                }).Else(() => {
                  If(kept.lessThan(0), () => {
                    kept.assign(coverageAt(rest))
                  })
                  const coverage = coverageAt(candidate).toVar()
                  If(coverage.greaterThan(kept), () => {
                    kept.assign(coverage)
                    joint.assign(i)
                    rest.assign(candidate)
                  })
                })
              })
            })
          })
        })
      })
      return { found, joint, rest }
    },
    restOf: (joint, point) => inverses.element(joint).mul(vec4(point, 1)).xyz,
    restDirection: (joint, direction) => inverses.element(joint).mul(vec4(direction, 0)).xyz,
    // The inverse is rigid, so its turn's transpose turns the other way: a row vector times the matrix
    posedDirection: (joint, direction) => vec4(direction, 0).mul(inverses.element(joint)).xyz,
    insideCut: (rest) => all(rest.greaterThanEqual(cutMin)).and(all(rest.lessThanEqual(cutMax))),
    sees(joint, rest) {
      const owner = ownerAt(rest).toVar()
      const seen = owner.equal(joint).or(owner.equal(noOwnerJoint)).toVar()
      If(seen.not(), () => {
        const at = vec4(rest, 1)
        seen.assign(length(forwards.element(owner).mul(at).xyz.sub(forwards.element(joint).mul(at).xyz)).lessThanEqual(together))
      })
      return seen
    },
    nearestCut(rest) {
      // Sagittal keeps x at or above its plane, the box's least x; Axial and Coronal keep y and z at or below theirs
      const toPlane = abs(vec3(rest.x.sub(cutMin.x), cutMax.y.sub(rest.y), cutMax.z.sub(rest.z)))
      const toOpen = mix(vec3(farFromCuts), toPlane, openCuts).toVar()
      const distance = min(min(toOpen.x, toOpen.y), toOpen.z)
      const outward = vec3(0, 0, 1).toVar()
      If(toOpen.x.lessThanEqual(toOpen.y).and(toOpen.x.lessThanEqual(toOpen.z)), () => {
        outward.assign(vec3(-1, 0, 0))
      }).ElseIf(toOpen.y.lessThanEqual(toOpen.z), () => {
        outward.assign(vec3(0, 1, 0))
      })
      return { distance, outward }
    },
    bounds: frames.bounds,
    bind(body) {
      const posed = body?.posed ?? null
      if (posed === (bound?.posed ?? null) && body?.bounds === bound?.body.bounds) return
      // The new texture is taken before the old is let go, so one that both bindings read is never rebuilt
      const texture = posed?.textures.acquire('owners')
      unbind()
      owners.value = texture ?? emptyOwners
      settled = null
      if (!body || !posed) return
      bound = { body, posed, boxes: jointSceneBoxes(posed.file, cellBoxes(posed.file), posed.placement, body.bounds.half) }
      toCell.value.copy(sceneToCell(posed.placement, posed.file))
      lastCell.value.set(posed.file.size[0] - 1, posed.file.size[1] - 1, posed.file.size[2] - 1)
    },
    setCuts(box) {
      cutMin.value.fromArray(box.min)
      cutMax.value.fromArray(box.max)
      // A cut is open where its plane has left the face of the bounds it starts on
      const half = bound?.body.bounds.half
      if (half) openCuts.value.set(box.min[0] > -half[0] ? 1 : 0, box.max[1] < half[1] ? 1 : 0, box.max[2] < half[2] ? 1 : 0)
    },
    pose() {
      if (!bound) return false
      const { posed, body, boxes } = bound
      if (settled?.posed === posed && settled.turns === posed.turns) return false
      // Each joint's skinning matrix, from its bone as posed and its inverse bind matrix, in double, so that the scan's
      // pose gives back the scan's own points
      const { bones, boneInverses } = posed.skeleton.skeleton
      for (let joint = 0; joint < jointCount; joint++) skinning[joint].multiplyMatrices(bones[joint].matrixWorld, boneInverses[joint])
      settleFrames(frames, skinning, boxes, body.bounds.half)
      for (let joint = 0; joint < jointCount; joint++) {
        const { min: low, max: high } = frames.boxes[joint]
        lows[joint].set(low[0], low[1], low[2], 0)
        highs[joint].set(high[0], high[1], high[2], 0)
      }
      present.value = frames.present
      boundsMin.value.fromArray(frames.bounds.min)
      boundsMax.value.fromArray(frames.bounds.max)
      settled = { posed, turns: posed.turns }
      return true
    },
    dispose() {
      unbind()
      emptyOwners.dispose()
    },
  }
}
