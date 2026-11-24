import type { Detail } from '../volume/levels.ts'
import type { Cuts } from './cuts.ts'

// The look: everything a picture of a body is made from, apart from the body itself and the camera. It is all the
// stage is given to draw by, so the scene knows nothing of the panel, its presets or the page's address: whatever
// sets the picture first makes a look of it. Each style has its own part, which it alone reads, and the styles share
// the cuts and what's laid over the whole frame. Every part is always there, whichever style is drawn, so that a change
// of style needs nothing more than its name

// The ways a body can be drawn. The splats draw one Gaussian per cell of a level, the volume marches a ray through the
// body's 3D texture from a full-screen quad, the raytrace follows the same ray to the skin and bone surfaces, and the
// surface meshes them by marching cubes
export type Style = 'splats' | 'volume' | 'raytrace' | 'surface'

// How the splats lay over one another: in front of what's behind, or added to it so dense parts glow, or summed by how
// near and how opaque each is, so that the order they're drawn in never matters
export type Blend = 'normal' | 'glow' | 'weighted'

// How the volume's march shows what it passes through: laid over what's behind, step by step, from the front; as an
// x-ray, the light that gets through the body's density; as the most density met along the ray; or as light the body
// gives off, added to what's behind
export type VolumeMode = 'over' | 'xray' | 'mip' | 'glow'

// Where the march reads a voxel's density: the file's density channel, the CT's where the scan covers the voxel and
// a reading of its colour where it doesn't; that reading of the colour everywhere, which shows what the CT adds; or,
// for a body with one, its MRI, which tells the soft tissues apart where the CT tells bone from the rest
export type DensitySource = 'ct' | 'colour' | 'mri'

// A ray's step as a share of a voxel: a step chosen for the backend, a whole voxel on the WebGL 2 fallback and half a
// voxel on WebGPU, or one named, each halving doubling the cost of a frame
export type Quality = 'auto' | 'voxel' | 'half' | 'quarter'

// Which surfaces the raytrace follows each ray to: the skin, the bone, or both, whichever a ray meets first; or, for
// a body with an MRI, the surface where the MRI passes its threshold, which with the body cut open is the brain's
export type Trace = 'skin' | 'bone' | 'both' | 'brain'

// What the surface's inner mesh is of: the bone, from the density at the Bone threshold, or, for a body with an MRI,
// the surface where the MRI passes its threshold
export type Inner = 'bone' | 'brain'

// Where the surface's colour comes from: the body's texture just inside the surface, at the loaded grid's resolution
// whatever the Detail, or the colour of the blocks either side of each vertex on its mesh's grid, the Detail's for the
// skin and the shell and the loaded grid's for the bone, mixed as the vertex lies between them. On the skin that's
// much the splats' own colour at that Detail: a block's colour takes in the band dilated around the body as well as
// its body voxels, and a splat's its body voxels alone
export type SurfaceColour = 'texture' | 'cells'

export interface SplatLook {
  // The level drawn, by the block of voxels each splat stands for
  detail: Detail
  // Each splat's size, as a share of its level's spacing
  size: number
  blend: Blend
  opacity: number
}

export interface VolumeLook {
  mode: VolumeMode
  density: DensitySource
  // The window over the density, each end a share of the scale's top: clear below the low end, as dense as the mode
  // allows above the high end
  windowLow: number
  windowHigh: number
  quality: Quality
  // Lights each step by the density's slope there
  shading: boolean
  // Draws the density's share of the window in grey, in place of the photographs' colour
  grey: boolean
  opacity: number
}

export interface RaytraceLook {
  trace: Trace
  // How many layers of skin a ray lays over one another below full Opacity; the bone shows through them all
  layers: number
  shadows: boolean
  // Where the light the shadows fall from is, in degrees from the camera's view: across and up
  lightAzimuth: number
  lightElevation: number
  // The density, and the MRI's value, on the file's scale of 0 to 255, from which a voxel is bone, or brain
  boneThreshold: number
  mriThreshold: number
  // How much the skin's edges light up where it turns away from the eye; the bone and the brain take none
  rim: number
  // How opaque the skin is; the bone and the brain are drawn by their own depth, whatever it is
  opacity: number
  quality: Quality
}

export interface SurfaceLook {
  // The skin's mesh and the mesh inside it, each on or off
  skin: boolean
  bone: boolean
  // The far side of the skin drawn under its near side, below full Opacity
  backShell: boolean
  inner: Inner
  colour: SurfaceColour
  // How far under the skin the shell inside it lies, in millimetres, with none at 0
  depth: number
  // The blocks the skin and the shell are meshed on, as the splats' levels are
  detail: Detail
  boneThreshold: number
  mriThreshold: number
  rim: number
  // How opaque the skin and the tissue's part of a cap's section are; the inner mesh and the shell stay solid
  opacity: number
  // The section through the body shown on each open cut
  caps: boolean
  // The see-through layers summed without an order, in place of the depth pass that shows only the nearest
  oit: boolean
}

// A glow spread around the bright parts of the frame: its strength, with none at 0, how far it spreads, from 0 to 1,
// and the brightness, from 0 to 1, below which nothing glows
export interface Bloom {
  strength: number
  radius: number
  threshold: number
}

export interface Look {
  style: Style
  cuts: Cuts
  // How far the far side of the body darkens, from none at 0 to black at 1
  depthCue: number
  bloom: Bloom
  splats: SplatLook
  volume: VolumeLook
  raytrace: RaytraceLook
  surface: SurfaceLook
}
