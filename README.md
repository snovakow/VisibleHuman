# VisibleHuman

**TypeScript + React + three.js + React Three Fiber + Vite + WebGPU**

VisibleHuman renders the [Visible Human Project](https://www.nlm.nih.gov/research/visible/visible_human.html)'s male and female bodies in the browser as Gaussian splats. The project photographed each body in cross-sections a millimetre apart, the female's three times as finely, from the top of the head to the soles of the feet. Stacked back up, those photographs make a volume in true colour, and each small block of it becomes a soft blob of that colour at its place in the body. The body can then be turned in 3D and cut open along any of the three anatomical planes. The splats are drawn by three.js's own WebGPU-based Gaussian splat rendering.

**Live demo: [snovakow.com/visiblehuman](https://snovakow.com/visiblehuman/)**

## Using it

The page opens on the whole body, seen from the front. Drag to turn it, scroll or pinch to zoom, and right-drag or drag with two fingers to move it.

The panel at the top right groups its controls in folders:

- **Body** chooses the body, the male or the female, and **Level** the file it's drawn from: 4 mm, which it opens on, or 2 mm, twice as fine along each axis and a larger download. Where the site doesn't have a level's file, the panel marks it not built and the body stays as it was. Adding `?body=female` to the address opens the page on the female, and the address follows the body chosen, so a link opens on the body it was copied from.
- **Style** chooses how the body is drawn: splats, volume, raytrace or surface. The volume follows a ray from the eye through each pixel and samples the body in small steps along it; the raytrace follows the same ray until it reaches the skin or the bone, and lights the surface it finds there; the surface builds the skin and the bone as meshes, in a background thread, and lights them as solid objects. Adding `?style=` and a style's name to the address, as in `?style=volume`, opens the page on that style.
- **Detail** sets the size of the blocks the body is drawn in: at the 4 mm level, 32 mm (about 4,500 splats), 16 mm (about 30,000), 8 mm (about 215,000, where it starts) or 4 mm (about 1.6 million, which has the most detail and runs slowest). The surface builds its skin from the same blocks, so the skin is as coarse or as fine as the splats at each Detail, while its bone keeps the loaded file's own grid.
- **Size** shrinks or grows every splat, from half to twice its starting size.
- **Blend** chooses how the splats lie over one another. *normal* draws them back to front, each over what's behind it; *glow* adds each one's light to what's behind, so the body brightens where splats pile up, which a low Opacity keeps from burning out; *weighted* mixes them by how near and how opaque each is, with no order at all, so at a low Opacity the body reads like an X-ray in its own colours. Size and Blend show only while the splats are drawn, and Detail while the splats or the surface are.
- **Mode** chooses how the volume shows what each ray passes through: *over* lays the tissue's own colours one over another from the front, so at full Opacity the skin reads as a surface; *x-ray* shows how much of an X-ray the body would stop, with the bone brightest; *MIP* shows the densest tissue along each ray, which picks out the skeleton; and *glow* adds up the tissue's colours as if the body gave off light.
- **Density** chooses where the volume reads each block's density: *CT* takes it from the frozen CT where the scan covers the block and from the block's colour where it doesn't, as the volume file stores it, and *colour* takes it from the colour everywhere, which shows what the CT adds.
- **Window low** and **Window high** pick the range of density the volume shows: tissue below the low end is clear, and tissue above the high end is as dense as the mode allows. With the CT's density, raising the low end to about a third leaves only the bone. The x-ray reads a range of its own, so the window is hidden there.
- **Quality** sets the step the volume and the raytrace sample at, as a share of a voxel: *auto* takes a whole voxel on WebGL 2 and half a voxel on WebGPU, and each halving of the step doubles the work of a frame.
- **Shading**, in the over mode, lights the tissue by how its density changes, so surfaces show their shape. It costs frame rate, so it starts off. Mode, Density, the window and Shading show only while the volume is drawn, and Quality while the volume or the raytrace is.
- **Trace** chooses which surfaces the raytrace follows each ray to: the *skin*, the *bone*, or *both*, whichever comes first.
- **Layers**, below full Opacity, sets how many surfaces a ray lays over one another before it stops: the skin alone at 1, then the bone or the far side of the skin behind it, and so on. A ray stops at bone whatever the count.
- **Shadows** casts the body's shadows onto its surfaces, from a light above and to the left of the eye, and shows **Light azimuth** and **Light elevation** to move the light around the eye, in degrees. The whole body casts the shadows, so what a cut takes away still throws its shadow, the bone's, onto the section it leaves. It costs frame rate, so it starts off.
- **Skin** and **Bone** switch the surface's skin and bone meshes on and off.
- **Back shell**, below full Opacity, draws the far side of the skin under the near side, so the body reads as a hollow glass shell rather than a single film.
- **Colour** chooses where the surface's colour comes from. *texture*, which it starts on, reads the tissue just under each point of a mesh, at the loaded file's own grid whatever the Detail, so the skin shows the photographs' skin tone and the bone its cream; *cells* colours each vertex of a mesh from the blocks either side of it on the grid the mesh was built from, so the skin is coloured much as the splats are at that Detail.
- **Depth** draws the closed surface that lies that many millimetres under the skin all over the body, opaque, so that through a see-through skin, or with the skin switched off, it shows the tissue at that depth. At 0 there's none. The surface builds it again at each new depth.
- **Bone threshold** sets the density from which the raytrace and the surface count tissue as bone, on the scale the file stores it in, where the default is bone's. Lowering it toward 90 shows the ribs whole at the 4 mm level, where a block holds as much soft tissue as bone; raising it keeps only the densest bone. The surface builds its bone mesh again at each new value.
- **Rim** lights a surface's edges where they turn away from the eye, which draws the skin as a glass shell at a low Opacity. Trace, Layers, Shadows and the light show only while the raytrace is drawn, Skin, Bone, Back shell, Colour and Depth while the surface is, and Bone threshold and Rim while the raytrace or the surface is.
- **Opacity** fades the whole body, so you can see into it. In the raytrace and the surface it makes the skin see-through, with the bone solid behind it.
- **Axial**, **Coronal** and **Sagittal** cut the body open. Axial cuts down from the head, coronal back from the front, and sagittal across from the body's right. At 0 nothing is cut, and at 1 the whole body is cut away. The raytrace draws each cut face as the photographs show it, with the bone's section flush with the tissue's; the surface does the same with **Caps**, a switch that shows the section on each cut, the bone's part solid and the tissue's at the skin's Opacity.
- **Depth cue** darkens the body with distance, from nothing at its near side to the slider's share at its far side, so near and far read apart, most of all in a body you can see through. It works in every style.
- **Bloom** spreads a glow around the bright parts of the picture, and shows **Bloom radius**, how far it spreads, and **Bloom threshold**, the brightness below which nothing glows. It suits the splats' glow and the volume's.
- **OIT**, for the surface below full Opacity, shows every layer of the see-through skin over the bone, mixed by how near each is, where the skin otherwise shows its nearest layer alone. It needs nothing drawn in order, which is what its name, order-independent transparency, says. The panel leaves it out where the browser can't draw it, and the weighted Blend likewise.
- **Renderer**, **Grid**, **Splats shown**, **Triangles** and **Status** tell you whether WebGPU or WebGL 2 is drawing, how many voxels the loaded file holds along each axis, how many splats are being drawn, how many triangles each of the surface's meshes holds, and whether the body is still loading, is ready, or failed and why.

The counter at the top left shows the frame rate.

VisibleHuman renders with WebGPU where the browser and the GPU can run it, and with WebGL 2 otherwise, including on GPUs known to fail at three.js's WebGPU splat sorting. Adding `?webgl` to the address forces WebGL 2, and `?webgpu` tries WebGPU on those GPUs all the same, to test a shader there. WebGL 2 sorts the splats on the CPU, so expect the finest Detail to turn slowly there.

## Status

The first version is complete and live. The body loads, draws at four levels of detail and cuts open along all three planes, under WebGPU or WebGL 2. The female body can now be chosen too, with her density from the CT taken of her before she was frozen. Ideas for later include the MRI scans taken of both bodies, and full-resolution photographs shown on the cut faces.

## Running it locally

You'll need [Node.js](https://nodejs.org) 22.12 or later, which Vite 8 and drei's camera controls need. For the tests and the scripts, you'll need 22.18 or later, which runs TypeScript without a flag. Then, in a clone of this repository:

```sh
npm install
npm run dev
```

and open the address it prints.

`npm run build` makes a static site in `dist/`, with the volume file included, which works from any folder on any web server. `npm run preview` serves it locally. `npm run lint`, `npm run typecheck` and `npm test` run the checks.

## The volume file

The NLM's photographs can't be read by a page on another site, because its server doesn't allow it, and at 5.7 GB they'd be far too much to load anyway. So a Node script reads them once and writes a file of about 5.7 MB, [`public/volume/male-4mm.bin`](public/volume/male-4mm.bin), which the page loads. It holds every block of the box around the body: its colour, how much of it is body, and a density, gzipped so the empty space around the body costs next to nothing. The page finds it through [`public/volume/bodies.json`](public/volume/bodies.json), which lists each body and the levels of detail it can be built at. The 4 mm file is committed, so a clone runs, builds and deploys without the script.

The script reads all 1,878 colour cross-sections of the male body. It tells the body apart from the blue gel it was set in and from the frame, scale card and labels around it, then averages what's left into 4 mm blocks, each keeping the colour of the tissue in it. The few slices that are blank or hazy in the NLM's set are skipped, and their blocks are filled from their neighbours'.

Each block's density comes from the male's frozen CT, which was scanned before the sectioning and is numbered like the photographs. The CT is framed and scaled its own way, so `npm run register -- --body male` works out where each run of its slices sits on the photographs, by fitting the CT's bone onto the pale bone in them, and saves the fit in [`data/male/registration.json`](data/male/registration.json), with overlays to check it by in `.cache/preview/register/`. The fit is committed, so a rebuild needs only the CT's images, which `npm run fetch` gets with the rest. Where the CT doesn't reach, as at the crown of the head and the outer edges of the arms, the density is estimated from the colour instead. To rebuild the file:

```sh
npm run volume -- --body male --spacing 4
```

It reads the slices from the local copy of the NLM's images that `npm run fetch` makes, described below, so that copy comes first. The male takes a few minutes. It also draws previews of the result in `.cache/preview/`. The other options go after the `--` too:

- `--spacing` picks how fine the blocks are, in millimetres: 4 for the file the page opens on, 2 for a finer one, several times the size. The finer file isn't committed: it's built before a deploy, and a host without it offers it as not built. A file written into `public/volume/` is entered in `bodies.json` as it's written.
- `--previews` redraws the previews from the existing file, without reading any slice.
- `--no-ct` estimates every block's density from its colour and reads no CT, for a local copy without the CT's images.
- `--match card` or `--match body` evens out the colour where one frozen block of the body meets the next, by the grey scale card photographed beside every slice or by the body's own colour either side of the join. Without it each block keeps its colour as photographed. The script measures and reports both steps either way: on the male the card doesn't explain them, since across two of the joins it reads brighter where the body reads darker.
- `--from` and `--to` read only a range of slices, numbered from 1001 at the head down, to 2878 for the male and 2730 for the female, whose three photographs to a number are lettered a, b and c, so that a bound may name one of them, as in `--from 1500b`; `--out` writes the file somewhere else; `--data` names the folder of the local copy, as it does for `npm run fetch`.

## Source data

The next stage builds each body from a local copy of the NLM's images, rather than from its server. `npm run fetch` makes that copy in `~/Data/VisibleHuman`, one folder for each set, or in the folder named by `VHP_DATA` or by `--data`. It skips what's already there and picks up interrupted downloads where they stopped, so running it again finishes the job. When it's done, it writes a `manifest.json` that says what each set holds. By default it fetches the core sets, about 28 GB: the colour cross-sections, CT and MRI of the male and the female, and the separately scanned head. `--set all` adds the 70 mm film scans, about 260 GB more, which nothing here reads. `--dry-run` says what a fetch would do, and `--verify` checks the copy against the NLM's listings without downloading anything. Its options go after `--` too, as in `npm run fetch -- --verify`.

## Stack

| | |
| --- | --- |
| [TypeScript](https://www.typescriptlang.org) | Strict types across the whole app |
| [React](https://react.dev) | Components and state for the viewer and its panels |
| [three.js](https://threejs.org) | Rendering, including its built-in Gaussian splats |
| [React Three Fiber](https://r3f.docs.pmnd.rs) | The three.js scene, written as React components |
| [Vite](https://vite.dev) | The dev server and the production build |
| [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) | The GPU API three.js renders with, falling back to WebGL 2 in browsers without it or on GPUs where it fails |
| [Node.js](https://nodejs.org) | The scripts that fetch the source images and build the body's volume from them |

Around them are drei's helpers, a leva control panel, zustand for app state, and Oxlint for linting.

## Workflow

- **Planned in phases.** The project was set up by following a written plan, and its next stage has [one of its own](docs/phase2-plan.md). Each phase is one focused thread, and the phases that change code end with lint, the tests and a type-checked production build passing.
- **Reviewed before it's committed.** Every batch of work goes through `/commit`, a [Claude Code skill](.claude/skills/commit/SKILL.md) that serves as the final code review. It's adapted from a shared [baseline](https://github.com/snovakow/Claude-Skills/tree/main/skills/commit), and it runs in a fresh thread, so the review starts without the author's assumptions. It reads every changed line for bugs, React Three Fiber and three.js pitfalls, type and lint escapes, new dependencies, leftovers and anything that shouldn't be public. Then it runs the checks, splits the work into focused commits with descriptive messages, and keeps this README accurate.
- **Tested where it's pure.** The parts with no GPU or React in them, such as the volume file's reader and writer and the rule that tells the body from its surroundings, have tests that build their own inputs, and each review runs them with the other checks.
- **Versioned checkpoints.** Versions start at 0.0.0 and count up: each reviewed batch ends with a version commit, which marks where the next review starts.
- **Current dependencies.** Packages and tools track their latest releases, and each review reports anything that has fallen behind.
- **Branches and deploys.** Work lands on `development` and reaches `main` by merge. The live site is a static build of `main`.

## Credits

- The images come from the [Visible Human Project®](https://www.nlm.nih.gov/research/visible/visible_human.html), courtesy of the U.S. National Library of Medicine. The NLM "thanks the man and the woman who each willed their body to science, thereby enabling this project." VisibleHuman draws a reduced copy of the images, which may not reflect the NLM's most current data. The NLM doesn't endorse this project.
- [three.js](https://threejs.org), whose Gaussian splat rendering draws them.
