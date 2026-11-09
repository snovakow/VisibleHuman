# VisibleHuman

**TypeScript + React + three.js + React Three Fiber + Vite + WebGPU**

VisibleHuman renders the [Visible Human Project](https://www.nlm.nih.gov/research/visible/visible_human.html)'s male body in the browser as Gaussian splats. The project photographed a body in cross-sections a millimetre apart, from the top of the head to the soles of the feet. Stacked back up, those photographs make a volume in true colour, and each small block of it becomes a soft blob of that colour at its place in the body. The body can then be turned in 3D and cut open along any of the three anatomical planes. The splats are drawn by three.js's own WebGPU-based Gaussian splat rendering.

**Live demo: [snovakow.com/visiblehuman](https://snovakow.com/visiblehuman/)**

## Using it

The page opens on the whole body, seen from the front. Drag to turn it, scroll or pinch to zoom, and right-drag or drag with two fingers to move it.

The panel at the top right:

- **Level** chooses the file the body is drawn from: 4 mm, which it opens on, or 2 mm, twice as fine along each axis and a larger download. Where the site doesn't have a level's file, the panel marks it not built and the body stays as it was.
- **Detail** sets the size of the blocks the body is drawn in: at the 4 mm level, 32 mm (about 4,500 splats), 16 mm (about 30,000), 8 mm (about 215,000, where it starts) or 4 mm (about 1.6 million, which has the most detail and runs slowest).
- **Size** shrinks or grows every splat, from half to twice its starting size.
- **Opacity** fades the whole body, so you can see into it.
- **Axial**, **Coronal** and **Sagittal** cut the body open. Axial cuts down from the head, coronal back from the front, and sagittal across from the body's right. At 0 nothing is cut, and at 1 the whole body is cut away.
- **Splats shown** and **Renderer** tell you how many splats are being drawn, and whether WebGPU or WebGL 2 is drawing them.

The counter at the top left shows the frame rate.

VisibleHuman renders with WebGPU where the browser and the GPU can run it, and with WebGL 2 otherwise, including on GPUs known to fail at three.js's WebGPU splat sorting. Adding `?webgl` to the address forces WebGL 2. WebGL 2 sorts the splats on the CPU, so expect the finest Detail to turn slowly there.

## Status

The first version is complete and live. The body loads, draws at four levels of detail and cuts open along all three planes, under WebGPU or WebGL 2. Ideas for later include the female body, which was cut three times as finely; the CT and MRI scans taken of both bodies; and full-resolution photographs shown on the cut faces.

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
- `--from` and `--to` read only a range of slices, numbered 1001 to 2878 from the head down; `--out` writes the file somewhere else; `--data` names the folder of the local copy, as it does for `npm run fetch`.

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
