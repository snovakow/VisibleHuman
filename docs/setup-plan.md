# Setup plan: VisibleHuman

This plan sets VisibleHuman up from an empty repository as a Vite + React + TypeScript app built on React Three Fiber (R3F). It renders the Visible Human Project's male body as Gaussian splats, with three.js's built-in splat rendering on its WebGPU renderer. You run the terminal steps yourself. Each phase that changes code has a prompt to paste into a fresh Claude Code thread in this repository, and every phase ends with `/commit`.

The prompts send the agent back to this file, so it is the single source of truth: if you disagree with a default under **Decisions**, edit it here before running the phase that uses it.

It follows the plan that set up [PDBSplat](https://github.com/snovakow/PDBSplat), with every fix that run found already folded in, so the renderer's fallback is built in one go rather than in follow-ups. What's new is the data. The Visible Human images can't be fetched by a browser, and there are 6 GB of them, so a Node script reads them once and writes a small volume file that the app loads (Phase 4).

Latest versions on 2026-11-07, when this was last checked: three.js r187 (`three@0.187.0`), `@react-three/fiber` 9.8.2, `@react-three/drei` 10.7.9, create-vite 9.3.4 with Vite 8.3.6, React 19.3.1, TypeScript 7.0.2, Oxlint 1.92, pngjs 7.0.0, Node.js 24.22.2 and npm 12.2.2. PDBSplat runs the same stack today, set up by these same steps, with only Vite and Oxlint a patch behind. So it wasn't rebuilt in a scratch copy. The one new piece was checked on a real slice: pngjs decoding a source image in a TypeScript script run by Node 24.

## 1. Where it ends up

```
VisibleHuman/
├── .claude/skills/commit/      the /commit skill, a copy of the Claude-Skills baseline (section 5)
├── docs/setup-plan.md          this plan, deleted in Phase 7
├── scripts/build-volume.ts     the data script: the NLM's slices in, the volume file out (D7 to D9)
├── public/volume/male-4mm.bin  the volume file, built by the script and committed (D8)
├── src/
│   ├── main.tsx                React root, in StrictMode
│   ├── App.tsx                 the <Canvas>, the DOM overlays and the credit line (D12)
│   ├── index.css               full-window layout
│   ├── store.ts                zustand: the volume, its loading state, the view options
│   ├── volume/                 format.ts (the file's layout, shared with the script), segment.ts, loadVolume.ts, levels.ts
│   └── viewer/                 Viewer, renderer.ts (the WebGPU renderer guard), BodySplats, cellTable.ts
├── test/                       node:test files for the pure modules (D17)
├── index.html                  title, analytics, #root
├── vite.config.ts              base: '' for relative asset paths
├── .oxlintrc.json              lint rules (D1)
├── tsconfig.json, tsconfig.app.json, tsconfig.node.json, tsconfig.test.json
├── package.json, package-lock.json   with one npm override, so every package shares the same three (D16)
├── VisibleHuman.code-workspace
└── README.md                   for the public
```

Scripts: `dev`, `build` (`tsc -b && vite build`), `preview`, `lint`, `lint:fix`, `typecheck`, `test` (`node --test`), `volume` (`node scripts/build-volume.ts`).

## 2. Decisions

These are the defaults the prompts follow. Change a row before running the phase it affects.

| # | Topic | Default | Alternative |
| --- | --- | --- | --- |
| D1 | Linter (chosen in Phase 1, configured in Phase 2) | **Oxlint**, create-vite's default: its React and TypeScript rules plus type-aware rules, with warnings failing `npm run lint`. Its React rules include React Compiler-style checks, such as `react(immutability)`, which flag mutating what a hook returned; Appendix C's patterns satisfy them, so they stay on | **ESLint** (pick it at the prompt or pass `--eslint`), with `@react-three/eslint-plugin`'s two allocation-in-loop rules |
| D2 | React Compiler | Off (the plain "TypeScript" variant) | `react-compiler-ts`: little to gain in a frame-loop app, and slower builds |
| D3 | Control panel | **leva**, as PDBSplat has. It shows numbers to two decimals at most; every value in this panel fits | lil-gui, created in an effect and destroyed on unmount |
| D4 | State | **zustand**: the volume, its loading state and the view options, shared by the panel and the scene | React context |
| D5 | Splats | three's built-in **`GaussianSplat`** (r187's addons), built from the volume's cells with its geometry helpers (Appendix A). No Spark | |
| D6 | Analytics | The gtag snippet your other Vite projects use, with measurement ID G-DV1KLMY93N, on every host | Load it only on snovakow.com |
| D7 | Source images | **The Visible Human Male's colour cross-sections**, as the PNG copies on the NLM's server: slices 1001 to 2878, 1,878 of them, 1 mm apart, each 2048 × 1216 pixels of 0.33 mm (Appendix A). The server sends no CORS header and the set is 6.2 GB, so the browser never reads it. A Node script reads it once, and the app loads what the script writes | The female, whose slices are 0.33 mm apart (5,189 of them, about 40 GB); or the male's CT, 512 × 512 at 1 mm, in GE's format with its own headers |
| D8 | The volume file | **One binary file, `public/volume/male-4mm.bin`**, on a 4 mm grid cropped to the body's bounds: a short header, a bitmask of which cells are body, then three colour bytes for each body cell (Appendix A). About 1.4 million body cells and about 5 MB. It's committed, so a clone runs, builds and deploys without the script | Gitignored, and built by the script before each deploy (about 10 to 25 minutes) |
| D9 | Telling body from background | Each slice shows the body set in blue gel, inside a black frame, with white fiducial dots, a grey-scale card and a yellow tag bearing a number, whose colour is close to fat's. A pixel is body unless it's blue (blue above red by a margin), dark or grey. A cell is body when most of its pixels are, and its colour is the mean of its body pixels. Last, only the largest 3D-connected piece of body is kept, which drops the card, the tag and the dots, since none of them touch the body. Every slice is read, so each 4 mm cell averages four slices; the thresholds are named constants, tuned on the script's preview images | Read every fourth slice: a quarter of the download, but the cells alias rather than average along the body |
| D10 | Cells as splats | One round splat per cell at its centre, in millimetres, centred on the body's bounds: the head up (+y), the front towards +z and the body's left on +x, so that the camera starts facing the body. Its size comes from the grid spacing times the panel's Size, its colour is the cells', as photographed, and its alpha comes from the panel's Opacity. **Detail** offers three levels: 4 mm (every cell, about 1.4 million splats), 8 mm (each 2 × 2 × 2 block that holds body, averaged; about 180,000) and 16 mm (about 23,000). It starts on 8 mm | Start on 16 mm, if this Mac's WebGL 2 fallback can't hold about 20 fps at 8 mm (Phase 5's check) |
| D11 | Cutting | Three cuts, one along each anatomical plane: **Axial** cuts down from the head, **Coronal** cuts back from the front, and **Sagittal** cuts across from the body's right. Each is a slider from 0 (nothing cut) to 1, and a cut sets the alpha of the splats on its far side to zero through the cell table, so no splat is rebuilt (Appendix C, item 12) | A single plane that faces the camera, as PDBSplat's Clip does |
| D12 | Credit | The NLM's terms ask for "Courtesy of the U.S. National Library of Medicine" in a clear and conspicuous manner, and that nothing implies its endorsement. So a small line stays at the bottom left of the page: "Images courtesy of the U.S. National Library of Medicine", linking to the Visible Human Project's page. The README carries the same, plus the note that the reduced copy may not reflect the NLM's most current data | |
| D13 | Build output | `dist/` with `base: ''`, the volume file inside it. Deploy by copying `dist/` into a new `~/Sites/localhost/live/visiblehuman/`, served at snovakow.com/visiblehuman | Another path name |
| D14 | Version | There's no earlier version to continue, so versions start at `0.0.0`, the Vite template's. Only `/commit` changes them, each time with a version commit that becomes the next run's baseline (section 5). Phase 1's `/commit 0.0.1` makes the first; every run after it bumps the last number; Phase 7's `/commit 0.1.0` marks the first release, the one merged into `main` and deployed. Phase 0's run has no `package.json` to version, so it ends without one, and pushing closes it | Keep bumping the last number at the release too |
| D15 | Renderer | three's **`WebGPURenderer`**, created by an async `gl` factory on the Canvas that awaits `renderer.init()`. `GaussianSplat` needs it: plain `WebGLRenderer` can't draw these splats. Where a browser lacks WebGPU, the renderer falls back to its WebGL 2 backend, and the splats still draw, sorted on the CPU instead of the GPU. Some GPUs offer WebGPU but can't compile the sort's compute shaders: this Mac's 2014 Intel Iris fails on `CountingSortReset` with a `GPUInternalError`, and the failure takes Chrome's GPU process down with it. So GPUs known to fail (Intel's `gen-7`, this Mac's) start on the fallback without trying WebGPU, and on any other GPU a `GPUInternalError` or a lost device under WebGPU switches to the fallback by remounting the Canvas with `forceWebGL`, retrying the fallback's start while the GPU process recovers (Appendix C, item 1) | |
| D16 | Versions | **Latest of everything** at install time, and again whenever `/commit` reports something behind (`npm outdated`). One npm override, `"three": "$three"`, makes drei's `stats-gl` share the app's three instead of bundling its own. Deliberate holds: Node.js 24 LTS, because Node 26, the newer LTS, won't start on this Mac's macOS 12.7 (it needs 13.5); `@types/node` 24 to match it; and React within R3F's peer range (19.0 to 19.3, which is also the latest today). pngjs decodes the source images in the script, and is a dev dependency, since the app never ships it | Keep the template's pins |
| D17 | Tests | **Node's own test runner**, as PDBSplat ended up with, for the pure modules: the volume file's reader and writer, the body rule, and the coarser levels. Each test builds its own small inputs; none downloads anything. They start in Phase 4, with the first pure module, and need Node 22.18 or later, which runs TypeScript without a flag | None |
| D18 | This plan | Deleted in Phase 7, before the first merge to `main`; git history keeps it | Keep it under `docs/` |

## 3. How to run a phase

1. Read the phase, and do its **You** steps: git steps in GitHub Desktop, and the rest in a terminal at the repository root.
2. Open a fresh Claude Code thread in this repository and paste the phase's **Prompt**. The agent reads this file, does that phase only, runs the checks, and summarises without committing.
3. Do the phase's **Check** yourself and ask for fixes in the same thread.
4. Open another fresh thread and run `/commit` with a note naming the phase, such as `/commit Phase 3 of docs/setup-plan.md`. It has to be the thread's first message: the skill stops otherwise, because a thread that wrote the code can't review it from the repository alone. The note lets it read the phase for intent. It fixes what it can in commits that aren't pushed yet, such as a vague message, and asks before committing over a failing check or anything else it can't settle.
5. Start the next phase in a new thread.

If a phase goes badly, GitHub Desktop's Changes tab shows what it touched. **Branch → Discard All Changes…** puts the changed files back and moves the new ones to the Trash. Check the list first: it also discards anything else that isn't committed. Then run the prompt again.

## 4. Phases

### Before Phase 0: bring the tools up to date

**You**

Node and npm are installed for the whole Mac, so earlier setups already did most of this. On 2026-11-07 this Mac had Node.js 24.22.2, the latest 24.x, and npm 12.2.1, one patch behind 12.2.2. Run the check at the end of step 2, and repeat the steps only if it shows something older.

1. **Node.js 24.22.2**, the latest of Node 24 LTS. Install it with the macOS installer (the x64 `.pkg`) from nodejs.org, into `/usr/local/bin`. Node 26 is the newer LTS, but it fails to start on this Mac's macOS 12.7.6 (`dyld: Symbol not found` in `libc++`); its builds need macOS 13.5 or later. Node 24 stays supported until April 2028, and upgrading macOS is what would unlock Node 26.
2. **npm 12**, which needs Node 24.15 or later, so it comes after Node. The installer's global folder belongs to root, hence `sudo`:

   ```sh
   sudo npm install -g npm@latest
   node -v && npm -v
   ```

   Expect v24.22.2 or a later 24.x, and 12.2.2 or later.

   `sudo npm` can leave root-owned files in your npm cache, and then later installs fail with `EACCES` under `~/.npm/_cacache`. Hand the cache back to yourself:

   ```sh
   sudo chown -R "$(id -un)":staff ~/.npm
   ```

3. **git**, optionally. Apple's 2.37.1 is the newest its command-line tools offer on macOS 12, and the `/commit` skill works with it.
4. **Disk space** for Phase 4: the script downloads 6.2 GB but keeps none of it unless you ask it to (`--cache`, which needs that much free).

### Phase 0: make the first commit, start the development branch, commit this plan and the skill, and push

**You**

1. The repository on GitHub is empty, with no `main` yet, so make its first commit by hand, as GitHub's "Initial commit" was for PDBSplat. In GitHub Desktop's Changes tab, tick only `VisibleHuman.code-workspace`, give it the summary `Initial commit`, and click **Commit to main**. Then click **Publish branch**.
2. Work lands on `development` and reaches `main` by merge. Create it: choose **Current Branch → New Branch**, name it `development`, and base it on `main`. When Desktop asks what to do with your uncommitted changes, bring them to `development`.
3. In a fresh Claude Code thread here, run `/commit Plan and tooling for setting up VisibleHuman`. Expect separate commits for the `/commit` skill, the public README and this plan. There's no version commit yet, because there's no `package.json` until Phase 1 (D14).
4. Push `development`, which puts it on GitHub: click **Publish branch**.

   Until the first version commit, a run's baseline is the newest pushed commit, so pushing is what closes this run. Without the push, Phase 1's run would ask about these commits before reading them; answering that it should keep them all, as already reviewed, does the same.

### Phase 1: scaffold Vite in place and install the stack

**You**

1. Scaffold into this folder:

   ```sh
   npm create vite@latest . -- --template react-ts
   ```

   Answer its prompts like this:
   - *Current directory is not empty*: **Ignore files and continue**. Not "Remove existing files", which deletes everything except `.git`, including `.claude/` and `docs/`. Since those are committed, **Discard All Changes** in GitHub Desktop would bring them back, but don't.
   - *Package name*: **visiblehuman**, the default it offers, since npm names can't have capitals.
   - *Which linter to use?*: **Oxlint** (D1).
   - *Install with npm and start now?*: **No**.

   It writes the template's files into the folder, overwriting `README.md`. Bring back the public README: in GitHub Desktop's Changes tab, right-click `README.md` and choose **Discard Changes…**.

2. Install everything at its latest version (D16): the template's own packages, which create-vite pins a little behind, the 3D stack, and pngjs for the script. Then add the override that makes every package share the app's three, and install once more to apply it:

   ```sh
   npm install
   npm install react@latest react-dom@latest three@latest @react-three/fiber@latest @react-three/drei@latest leva@latest zustand@latest
   npm install --save-dev vite@latest @vitejs/plugin-react@latest typescript@latest oxlint@latest @types/react@latest @types/react-dom@latest @types/three@latest @types/node@24 pngjs@latest @types/pngjs@latest
   npm pkg set 'overrides.three=$three'
   npm install
   ```

   Leave out `leva` or `zustand` if you changed D3 or D4. npm 12 runs no install scripts that haven't been approved, so it warns that `fsevents`' was skipped. That's harmless: it's an optional macOS file watcher, and the dev server, lint and build work without it.

3. Check that there is one three.js, with types from the same release, and that nothing is behind:

   ```sh
   npm ls three @types/three
   npm outdated
   ```

   Expect `three@0.187.x` (or newer) everywhere, deduped under fiber, drei, three-stdlib and stats-gl, and `@types/three` at the same minor version. `npm outdated` should list only `@types/node`, held at 24 to match Node (D16). If npm reports a React peer conflict, it's because R3F 9 accepts React 19.0 to 19.3, so a newer React has come out: run `npm install react@~19.3 react-dom@~19.3`, and hold it there until R3F catches up.

4. Check the untouched template: run `npm run dev` and open the URL it prints (stop it with Ctrl+C), then `npm run lint` and `npm run build`.
5. In a fresh thread, run `/commit 0.0.1 Phase 1 of docs/setup-plan.md`. Expect the scaffold with its dependencies, then `Version 0.0.1`, the first version commit (D14). From here on, every run ends with one.

### Phase 2: app shell and tooling

**Prompt**

```text
Read docs/setup-plan.md: sections 1 and 2, Phase 2, and Appendix C. Carry out Phase 2 only: turn the fresh create-vite scaffold into VisibleHuman's app shell and tooling. If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck and npm run build passing, then summarise what changed and anything you couldn't do.
```

**The work**

1. Remove the template's demo: `src/App.css`, `src/assets/`, `public/icons.svg`, and `public/favicon.svg` with its `<link>`. `src/App.tsx` renders a full-window `<Canvas>` with nothing in it yet.
2. `index.html`: `lang="en"`, the title "VisibleHuman", a one-line meta description ("The Visible Human Project's male body, rendered in the browser as Gaussian splats."), and Google's standard gtag snippet (D6): the async `gtag.js` script and the `dataLayer` setup, at the top of `<head>` as your other sites have it. Keep `#root` and the module script.
3. `src/index.css`: only what the app needs. `html`, `body` and `#root` fill the window, with no margin, no scrollbars and a black background, which splats read best against.
4. `vite.config.ts`: `base: ''` (D13), with a one-line comment saying why. The WebGPU build of three makes one chunk of about 2 MB, so raise `build.chunkSizeWarningLimit` to 2500 to cover it rather than splitting chunks.
5. `package.json`: add `"typecheck": "tsc -b"` and `"lint:fix": "oxlint --fix"` to the template's scripts. Leave the version alone; only `/commit` changes it (D14).
6. `.oxlintrc.json` (D1): keep the template's plugins and rules, and:
   - ignore `.claude/**`, whose `/commit` scan script stays word for word the Claude-Skills baseline (section 5) and fails type-aware `require-array-sort-compare` on two sorts
   - make the `correctness` category errors, and add `suspicious` as warnings
   - turn off `react/react-in-jsx-scope`, which `suspicious` brings in and React's automatic JSX runtime makes obsolete; with warnings failing, it would fail every `.tsx` file
   - make warnings fail the run (`options.denyWarnings`)
   - turn on type-aware rules: `npm install --save-dev oxlint-tsgolint@latest`, then `options.typeAware`. This works with TypeScript 7 in PDBSplat; if it fails anyway, stop and say why.
   - leave the React Compiler-style rules, such as `react(immutability)`, on, and write code that satisfies them (Appendix C, item 9)
7. `.gitignore`: add `.cache`, where Phase 4's script keeps its previews and any downloads.
8. `README.md`: add "Running it locally" (Node.js 22.12 or later, which Vite 8 and drei's camera-controls need, `npm install`, `npm run dev`) after "Status", and change "Status" to say the app shell runs but shows no body yet. Keep its public voice.

**Check** `npm run dev` shows an empty black page with no console errors, and the elements panel shows a `<canvas>` filling the window, two `<div>`s down (`#root > div > div > canvas`), where R3F nests it. Expect one console warning, `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` It's R3F's: R3F 9 still makes a `THREE.Clock`, which three deprecated in r183. It needs nothing, and it goes once a stable R3F 10 replaces the clock.

### Phase 3: the viewer and a first splat cloud

**Prompt**

```text
Read docs/setup-plan.md: section 2 (especially D15), Phase 3 and Appendices A and C. Carry out Phase 3 only: set up the WebGPU canvas with its WebGL 2 fallback, the camera and controls, and a test cloud of procedural splats that proves three's GaussianSplat pipeline before any body data. If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck and npm run build passing, then summarise, including what I should look at in the browser.
```

**The work**

- `App.tsx`: the `<Canvas>`, with static props (Appendix C, items 1 to 4):
  - `gl`: an async factory that creates three's `WebGPURenderer` with antialiasing, forcing its WebGL 2 fallback when the page URL has `?webgl`, and awaits its `init()` (D15); then logs once with `console.info` whether it got WebGPU or the fallback
  - the fallback, all three layers of item 1: GPUs known to fail start on the fallback without trying WebGPU, logging why with `console.info`; a `GPUInternalError` or a lost device under WebGPU switches to the fallback, with one `console.warn` saying why; and the fallback's start is retried if it fails
  - camera: fov 50, near 1, far 20000, since the body is measured in millimetres and is about 1,900 of them tall
  - `flat`, so the splats' colours show as given, with no tone mapping
- `src/viewer/renderer.ts`: `asWebGPU()`, the guard that hands components the `WebGPURenderer` that R3F types as a `WebGLRenderer` (item 2).
- `src/viewer/Viewer.tsx`: drei's `<OrbitControls makeDefault />` and `<Stats />`.
- `TestCloud`, temporary: a few thousand splats placed procedurally, such as in a solid box with varied sizes and colours, built with `createGaussianSplatGeometry` and `writeCovariance` and drawn by a `GaussianSplat` (D5; Appendix A; items 5 and 6). Phase 5 replaces it with the body.

**Check** The console says whether WebGPU or its WebGL 2 fallback is rendering, and `?webgl` forces the fallback. The cloud draws as soft blobs that blend in the right order as you orbit, with either backend. On this Mac, whose GPU can't compile the sort's shaders, the page without `?webgl` says its GPU is known to fail WebGPU and renders with the fallback straight away, with no shader errors and no freeze, just as `?webgl` does. Besides Phase 2's `THREE.Clock` warning, expect two harmless messages: `PCFSoftShadowMap has been removed. Using PCFShadowMap instead.`, because R3F asks every renderer for a shadow type that `WebGPURenderer` replaces, and in `npm run dev`, a 404 for `/favicon.ico`, which Phase 2 removed (on snovakow.com the browser gets the site's own).

### Phase 4: the volume

**Prompt**

```text
Read docs/setup-plan.md: section 2 (especially D7 to D9 and D17), Phase 4 and Appendices A and C. Carry out Phase 4 only: write the data script that turns the NLM's slices into the volume file, the file's reader and writer, and their tests. Run the script on a short range of slices only, writing into .cache; I'll run the full build myself. If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing, then summarise, including the command for the full build and what to look at in its previews.
```

**The work**

- `src/volume/format.ts`: the volume file's layout (Appendix A), with a writer and a reader shared by the script and the app. The reader checks the magic, the version, and that the header's sizes and body count agree with the file's length and the mask, and throws a clear error otherwise. It also exports the file's axes and how they map to the scene's (D10; Appendix A).
- `src/volume/segment.ts`: the pure rules of D9. One says whether a pixel is body; one keeps the largest 6-connected piece of a cell mask, with an explicit queue rather than recursion, since the body runs to millions of cells. Their thresholds are named constants with a comment on each.
- `scripts/build-volume.ts`, run by `npm run volume`, on Node 24's own TypeScript (Appendix C, item 13):
  - It takes slices 1001 to 2878, each from the first region that lists it (Appendix A), downloads four at a time, retries a failed download a few times, and checks each PNG is 2048 × 1216 RGB before using it. `--from` and `--to` narrow the range, `--out` writes the file somewhere other than `public/volume/male-4mm.bin`, and `--cache` keeps the downloads in `.cache/slices/` and reads them from there next time.
  - It adds each slice's pixels into the cells of its 4 mm layer: 12 × 12 pixels across (3.96 mm), 4 slices along (4 mm). The header records those true spacings rather than rounding them. Memory holds one layer's sums and the finished grid, never the slices.
  - Once every slice is in, it keeps the largest piece of body, crops the grid to its bounds, and writes the file through a temporary name, renamed into place once whole.
  - It writes previews to `.cache/preview/`, as PNGs through pngjs, drawn through `format.ts`'s axes so they show the body as the app will: the front view, the nearest body cell along each line of sight from the front; the mid-coronal plane, as seen from the front; and the mid-sagittal plane, as seen from the body's right, so its front faces right. `--previews` redraws them from the existing file without downloading anything. It logs the slices read, the grid's size, the body cells, the file's size and the time taken.
- `tsconfig.node.json` takes in `scripts` beside `vite.config.ts`. A `tsconfig.test.json` like the app's, with `"types": ["node"]` and `include: ["test"]`, is added to `tsconfig.json`'s references. `package.json` gets `"test": "node --test"` and `"volume": "node scripts/build-volume.ts"`.
- Tests in `test/` (D17; Appendix C, item 14): the file round-trips through the writer and the reader, and the reader refuses a wrong magic, a short file and a body count that disagrees with the mask. The body rule passes body colours and refuses gel blue, black and grey. The piece-keeping keeps the larger of two pieces and joins pieces that touch only across a slice.

**You**

1. Run the full build. It takes about 10 to 25 minutes, transfers 6.2 GB and keeps none of it:

   ```sh
   npm run volume
   ```

   Expect a log ending with about 1.4 million body cells in a grid about 140 × 75 × 470, and `public/volume/male-4mm.bin` at about 5 MB. A count far off that means D9's rule is taking in the gel or losing tissue, which the previews show.
2. Open the previews in `.cache/preview/`. The front view shows the whole body, head up, arms at its sides, facing you, with nothing else in the frame: no card, tag or dots. The sagittal plane shows the brain, the spine and the organs in their places, with the profile facing to the right, the body's front, all the way from head to feet. The coronal plane shows both lungs, the heart towards the body's left (your right), and the liver on the body's right. If the profile jumps sideways between slices, the slices aren't aligned with one another: stop and raise it in the Phase 4 thread, since D9 assumes they are. If the body comes out mirrored, the orientation in Appendix A is wrong: ask the Phase 4 thread to correct `format.ts`'s axes, then redraw the previews with `npm run volume -- --previews`. The file keeps the source's axes, so it needn't be rebuilt.
3. In a fresh thread, run `/commit Phase 4 of docs/setup-plan.md`. It asks about the volume file, which is larger than its 1 MB threshold. That's expected: answer that the script built it as committed (D8).

### Phase 5: the body as splats, and the panel

**Prompt**

```text
Read docs/setup-plan.md: section 2 (especially D8, D10, D11 and D12), Phase 5 and Appendices A and C. Carry out Phase 5 only: load the volume file, draw its cells as Gaussian splats at three levels of detail, frame the camera on them, add the cuts, the panel and the credit line. If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing, then summarise, including what I should look at in the browser.
```

**The work**

- `src/volume/loadVolume.ts`: fetch `volume/male-4mm.bin`, relative to the page so the build works from any folder (D13), read it with `format.ts`, and keep the result while the page is open. A failed fetch or a refused file reads as such in the page (item 8).
- `src/volume/levels.ts`: the 8 mm and 16 mm levels, from 2 × 2 × 2 and 4 × 4 × 4 blocks of 4 mm cells. A block that holds body becomes one cell, at the centre of its body cells, coloured by their mean. Pure, and tested in `test/`.
- `src/store.ts` (zustand, D4): the volume's status (loading, ready or failed), the error and the levels, with the view options.
- `BodySplats`, replacing `TestCloud`: one round splat per cell of the level shown (D10), centred on the body's bounds, with each splat's colour bytes carrying its cell's index into the cell table (item 12). Each level's splat is built the first time it's shown, and freed when the component unmounts (item 6).
- `src/viewer/cellTable.ts`: the cell table, one RGBA texel per cell, which the splats' colour node reads: the cell's colour, with Opacity and the cuts as its alpha. A change to either rewrites the table in place and uploads it, with no rebuild (D11; item 12).
- Framing: when the body loads, fit it in view from the front, head up, and put the orbit target on its centre (item 7).
- The panel, in leva (D3): Detail (16 mm, 8 mm or 4 mm, starting on 8 mm); Size (0.5 to 2, default 1); Opacity (0 to 1, default 1); Axial, Coronal and Sagittal (0 to 1, default 0); and, read-only, the splats shown and the renderer. While the body loads, the page says so, and a failed load shows its message.
- The credit line (D12): a small DOM overlay at the bottom left, "Images courtesy of the U.S. National Library of Medicine", linking to https://www.nlm.nih.gov/research/visible/visible_human.html, readable against black, and clear of the panel and Stats.

**Check** The page opens on the body from the front at 8 mm: about 180,000 splats, head up, facing you, coloured as the slices are, with the credit line at the bottom left. Note the frame rate under this Mac's WebGL 2 fallback; if it's well under 20 fps while orbiting, change D10 to start on 16 mm and ask for it in the same thread. 16 mm draws a coarse body at once; 4 mm takes longer to build, then shows the most detail, at the lowest frame rate. Axial at about 0.27 cuts through the chest, and the cut face shows what slice 1500 shows (Appendix A): the lungs, the heart and both upper arms. Coronal and Sagittal open the body from the front and from its right in the same way. Size and Opacity act at once, the splats keep blending correctly as you orbit, and moving a cut doesn't stall the page. Switching Detail back and forth ten times leaves the frame rate where it was.

### Phase 6: review and README

**Prompt**

```text
Read docs/setup-plan.md in full. Carry out Phase 6 only: review the app and the data script against the decisions and Appendices A and C, fix what doesn't match, remove leftovers, and bring README.md up to date for the public. Don't rebuild the volume file. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing; then serve the build with npm run preview and confirm that the page and every asset it references, the volume file among them, load with HTTP 200 (curl is fine). Summarise what you fixed and anything still open, and give me a checklist to walk through in the browser.
```

**The work**

- Check the code against D5 and D7 to D12 and Appendix C, and fix what doesn't match. A fix to the script that would change the volume file is reported, not run.
- Remove leftovers: template files or text (the Vite and React logos, "Vite + React", `App.css`), `TestCloud` if any of it is left, dependencies nothing imports (compare `npm ls --depth=0` with the imports), `any` or lint suppressions without a stated reason, and `console.log`.
- README.md, for a public reader. Keep the stack line, the Stack table, the Workflow section and the credits, and bring the rest up to date: what VisibleHuman shows, the live demo at snovakow.com/visiblehuman, as a present fact, since Phase 7 merges and deploys straight after this phase, the controls and the panel, running and building it (`npm run build` makes a static site in `dist/` that works from any folder), how the volume file is made and rebuilt (`npm run volume`, what it downloads and how long it takes), and its status. No internal values; keep the existing voice. Keep the link to this plan for now; Phase 7 removes it.

**You** Walk the agent's checklist in `npm run dev` and again in `npm run preview`. Then, in a fresh thread, run `/commit Phase 6 of docs/setup-plan.md`.

### Phase 7: merge and first deploy

**You**

1. Delete this plan. Read the rest of this phase first; afterwards it is only in git history.

   ```sh
   rm docs/setup-plan.md
   rmdir docs
   ```

   Then, in a fresh thread, run `/commit 0.1.0 Remove the setup plan now that setup is done`. The scan lists the plan among the deleted files, and the run drops the README's link to it in the same batch. Its last commit is `Version 0.1.0`, the first release (D14). Ask it to also bring the `/commit` skill's Version commits setting up to date: it still says the template's `package.json` is to come and that `/commit 0.0.1` makes the first version commit.
2. Merge and push, in GitHub Desktop:
   1. With `development` checked out, choose **Branch → Merge into Current Branch…** and pick `main`. It should say `development` is already up to date with it, meaning `main` has no commits that `development` lacks; close the dialog. If it finds commits instead, merge them, run `/commit` if the merge needs fixes, and start this step again.
   2. Switch **Current Branch** to `main`, choose **Branch → Merge into Current Branch…**, and merge `development`. Since `main` has nothing of its own, this fast-forwards, with no merge commit.
   3. Click **Push origin**, then switch back to `development` and click **Push origin** there too, so GitHub's `development` matches `main`.

3. Build and deploy:

   ```sh
   npm ci
   npm run build
   mkdir -p ~/Sites/localhost/live/visiblehuman
   cp -R dist/ ~/Sites/localhost/live/visiblehuman/
   ```

   Then publish `live/` to snovakow.com the way you do for the other sites.
4. Open https://snovakow.com/visiblehuman/ and check that the body loads, that the Network panel shows `volume/male-4mm.bin` with HTTP 200 and gtag, that there are no 404s, and that the credit line shows.
5. Once it's up, add the live demo to the README and run `/commit` in a fresh thread; its version commit is `0.1.1`. Link VisibleHuman from your homepage, and from PDBSplat's README if you want, so visitors find it.

## 5. The /commit skill

`.claude/skills/commit/` holds `/commit`, the final review before work enters the repository's history. It's a project copy of the generic skill in [Claude-Skills](https://github.com/snovakow/Claude-Skills/tree/main/skills/commit). Its steps, and its scan below the scan's settings, are the baseline's word for word, and its frontmatter adds only a grant for `npm outdated`. What's VisibleHuman's own is the two settings blocks, one at the top of `SKILL.md` and its twin at the top of `scripts/scan.mjs`, and a short "Rules of this repository" section. `metadata.baseline` in the frontmatter dates the baseline it came from, and "Keeping a copy current" in the baseline's README has the diffs that compare a copy with it and the way to bring one up to date.

It runs only when you type it, on Opus at max effort, and only as the first message of a fresh thread. `/commit [x.y.z] [notes]`:

- **Surveys** with `git fetch` and a read-only scan, and stops to ask about:
  - a merge, rebase or similar in progress, or a detached HEAD
  - being on `main`, or behind the upstream
  - a version changed by hand
  - credentials or session data in added lines
  - a file that looks like it shouldn't be tracked, or a large one. Among these are `node_modules`, `dist`, `.cache`, `.env` files, personal Claude settings, keys, and source slices downloaded while testing. The volume file is large too, and expected (D8).
  - before the first version commit, commits above the newest pushed commit, which it asks about before reading any
- **Reviews** every commit since the baseline, the working-tree diff and every untracked file, in full. It checks messages against diffs, comments against code, references a public reader can't follow, and leftovers. VisibleHuman's rules add a code review: correctness, axes and grid indices, a volume reader that trusts its header, a data script that loses or doubles a slice, React and R3F lifecycle, splats and other GPU resources freed when rebuilt, what `WebGPURenderer` can't run, type and lint escapes, and new dependencies. They also tie the volume file to the script: a change to one without the other is reported.
- **Runs the checks**, `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`, and asks before committing over a failure. Then it runs `npm outdated` and lists what has fallen behind, apart from D16's holds. It never installs or upgrades anything, and never runs the data script.
- **Fixes what it can** in unpushed commits after the baseline, such as a vague or file-name subject. It amends the tip, or folds `fixup!` and `amend!` commits in with one autosquash rebase and checks that the fold changed no files. Pushed commits are reported, never rewritten.
- **Commits** the batch, planned first: one concern per commit, the file as the unit, explicit paths, and an order in which each commit stands on its own. Subjects are imperative and at most 72 characters. Bodies say why and what was verified, and end with the thread's co-author trailer.
- **Keeps README.md true** for the public. This plan is yours: it commits the plan but never edits it, and says when a change makes it inaccurate.
- **Ends with a version commit** once they've started (D14). Its message is `Version X.Y.Z` alone, by snovakow, with no trailer, and it touches only `package.json` and `package-lock.json`. It's the next run's baseline, and since it's in the history it holds in every clone. Before the first one, a run ends without a version commit, and pushing is what closes it.
- **Reports** what it flagged, each commit, what it left out and why, the checks and their results, and whether the live site needs a rebuild after the merge. It also gives the undo point, `git reset --soft <start>`. It never pushes, never changes branches, and never discards your work.

After the report, more work in the same thread is ordinary development. Once a run has ended with a version commit, that work can be committed as usual, and the next run reviews it. Before then it stays uncommitted, because nothing would tell it apart from the run's own commits.

## Appendix A: reference

Facts the phases rely on, checked on 2026-11-07.

**three r187's Gaussian splats**

- `import { GaussianSplat } from 'three/addons/objects/GaussianSplat.js'`, with its helpers in `three/addons/utils/GaussianSplatUtils.js`. `@types/three` 0.187 types both.
- `GaussianSplat` works only with `WebGPURenderer`. Its WebGL 2 fallback is supported, and plain `WebGLRenderer` isn't. It needs `three/webgpu` and `three/tsl` to resolve, which the npm package's exports do.
- `new GaussianSplat(geometry, { autoSort: true })` is a `Mesh`. With `autoSort`, it sorts its splats back to front before rendering whenever the view direction has changed: on the GPU with a compute pass under WebGPU, and on the CPU under the WebGL 2 fallback. It also implements `raycast`.
- `createGaussianSplatGeometry(centers, covariances, colors)` builds the geometry from packed arrays: centres, three floats per splat (`position`); covariances, the six unique entries of each 3 × 3 matrix (xx, xy, xz, yy, yz, zz; `covariance`); and colours, four bytes per splat, RGBA, read as normalised (`color`). It computes the bounding box and sphere. Optional spherical-harmonics bands add view-dependent colour, which the cells don't need.
- `writeCovariance(target, offset, sx, sy, sz, qx, qy, qz, qw)` writes a splat's covariance from its scale and rotation (Σ = R·S·Sᵀ·Rᵀ). A round splat has equal scales and the identity rotation. `writeColorBytes` and the other helpers are in the same file; read their source for the ranges they expect.
- A splat's colour bytes are copied into its storage when it's built and have no update path. The splat's material is a node material whose `colorNode` can be replaced, which is how PDBSplat's atom table recolours without a rebuild (Appendix C, item 12).

**The Visible Human Male's colour slices**

- The NLM's overview: https://www.nlm.nih.gov/research/visible/visible_human.html. Since 2019 no license is needed. The images are used under the NLM's terms (https://www.nlm.nih.gov/databases/download/terms_and_conditions.html), which ask for the credit in D12, no implied endorsement, and a note that redistributed data may not be current.
- The PNG copies are at `https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Male-Images/PNG_format/<region>/a_vm<NNNN>.png`. A folder lists its files at `<folder>/index.html`; the folder's own URL is a 404. The server is S3 behind CloudFront and sends no `Access-Control-Allow-Origin`, so a page on another site can't read the images.
- The regions, and the slices each holds: `head` 1001 to 1377, `thorax` 1280 to 1688, `abdomen` 1455 to 1997, `pelvis` 1732 to 2028, `thighs` 1732 to 2411, `legs` 2265 to 2878. Together they cover 1001 to 2878 without a gap. Where regions overlap, the slice is the same file (the same length and ETag in each), so take each number once.
- Each slice is a PNG of 2048 × 1216 pixels, 8-bit RGB, non-interlaced, of 2.6 to 3.6 MB; 6.2 GB in all. The NLM gives the pixels as 0.33 mm square and the slices as 1 mm apart, numbered from the top of the head (1001) to the soles of the feet (2878). One slice took about 0.5 s to download and 0.26 s to decode with pngjs.
- What else a slice holds: blue gel around the body, a black frame and its shadow, small white fiducial dots, a grey-scale card along the bottom edge, and a yellow tag bearing a four-digit number (4500 on slice 1500), near the bottom right. The body's place in the frame varies along its length: the lower legs (slice 2600) sit near the top of the frame.
- The body's cross-section, measured on four slices with the rule in D9: about 280 cm² at 1100 (the head), 1,040 at 1500 (the chest and both upper arms), 830 at 1950 (the hips), and 110 at 2600 (the lower legs). That puts the body near 90 litres, so about 1.4 million cells at 4 mm, 180,000 at 8 mm and 23,000 at 16 mm.
- Orientation, read from slice 1500 and to be confirmed on Phase 4's previews: the image's rows run from the body's back at the top, where the spinal cord, the vertebral body and the back muscles are, to its front at the bottom, where the sternum and the costal cartilages are; its columns run from the body's right at the left to its left at the right, with the liver at the image's left and the heart towards its right. So a cell at column i, row j and slice k sits in the scene at x = i, y = −k and z = j, times the spacing, before centring.
- Gaps, found by the first full build: slices 2424 to 2435 are blank, all-black 7 KB PNGs of the right size, the only files under 1 MB, between the thighs' block and the legs'. Left in, they empty three layers below the knees, and the largest piece of body drops the legs. And the first slices of the thighs' block, 2017 to 2020, where the tag's numbering restarts and the frame moves up, sit under a frosty cyan cast that reads as gel, so they hold 7 to 79% of their neighbours' body pixels and leave a dark line across the thighs; 2021 is clear of it. The script reads both kinds as missing (`segment.ts`): they add nothing to their cells, a layer of missing slices only is filled from its nearest read layers, and the log lists them.

**The volume file**

- Little-endian, in this order:
  - a header: the magic `VHV1` (four ASCII bytes); a format version (u16, 1); the grid's size in cells, nx, ny and nz (u16 each); the spacing in millimetres along each (f32 each: 3.96, 3.96 and 4); the crop's offset in the full grid, in cells (u16 each); the first and last slice numbers read (u16 each); and the number of body cells (u32)
  - the mask: one bit per cell, ⌈nx·ny·nz / 8⌉ bytes. Cell (i, j, k) has index i + nx·(j + ny·k), and is body when bit (index & 7) of byte (index >> 3) is set.
  - the colours: three bytes, R, G and B, for each body cell, in index order
- The axes are the source's: i across the image, j down it, k down the slices from the head. `format.ts` maps them to the scene's (D10).

## Appendix B: ideas after the setup

From the data:

- The female: three times the detail along the body, from 5,189 slices of the same size, at 40 GB.
- The CT and MRI scans of both bodies, taken before they were frozen and cut, drawn beside the photographs or blended with them.
- Sharper cuts: where a cut opens the body, the full-resolution slice drawn as a textured plane on the cut face, from a set of reduced slices hosted with the site.
- Splats only for the cells that can be seen, those on the body's surface or a cut's face, which would let a finer grid draw at the same cost.
- A ray-marched volume, as PDBSplat's field style draws its density, as a second style beside the splats.

## Appendix C: notes on R3F, WebGPU and three r187 for this project

These are PDBSplat's notes, checked there against `@react-three/fiber` 9.8.2, `@react-three/drei` 10.7.9 and three 0.187.0, and proven by its app, which is checked out beside this repository at `../PDBSplat` (github.com/snovakow/PDBSplat). Items 12 to 14 are new to this project, and item 12 points at PDBSplat's code.

1. **Creating the WebGPU renderer.** R3F 9 accepts an async `gl` factory. Narrow the `canvas` it passes, which R3F types more widely than the DOM does, with `if (!(canvas instanceof HTMLCanvasElement)) throw new Error(…)`; TypeScript 7 rejects it unnarrowed. Then construct `new WebGPURenderer({ canvas, antialias: true, forceWebGL })` and `await renderer.init()` before returning it, after which `render()` works each frame (`renderAsync` is deprecated). `'isWebGPUBackend' in renderer.backend` says whether WebGPU or the WebGL 2 fallback is rendering. `@types/three` 0.187 types `backend` as the base `Backend`, which lacks the flag, so `renderer.backend.isWebGPUBackend` doesn't type-check.

   **Falling back when WebGPU fails.** A GPU can offer WebGPU and still fail to compile three's shaders. On this Mac's Intel Iris (Haswell, Metal's oldest GPU family, frozen at macOS 12), Apple's Metal compiler hits an internal error on `CountingSortReset`, the sort's first shader, which only `atomicStore`s zeros; the sort's other shaders use the same atomics. three reports it through `renderer.onError` as a `GPUInternalError`. The failure then takes Chrome's GPU process down: in PDBSplat's runs on this Mac, the page sometimes froze for about 30 seconds before the device was lost, and once the remounted Canvas's WebGL 2 context came back `null`, because the GPU process was restarting, so the fallback's `init()` threw and the page stayed black. Hence three layers:
   - **Known-bad GPUs skip WebGPU.** Before creating the renderer, unless the fallback is already forced, ask `navigator.gpu?.requestAdapter()` for its `info`. An Intel adapter (`vendor` `'intel'`) whose `architecture` is `'gen-7'`, Haswell, starts on the fallback, with one `console.info` saying why; keep the list in one named constant. TypeScript 7's DOM library types `navigator.gpu` and `GPUAdapterInfo`, so nothing needs installing. This Mac then never compiles the failing shaders.
   - **Other GPUs that fail switch at runtime.** Keep a `forceWebGL` flag in `App`'s state, starting from `?webgl`, and give the Canvas a `key` from it. In the factory, under WebGPU, set `renderer.onError` to switch on a `GPUInternalError` and `renderer.onDeviceLost` to switch on any loss, each still logging as three's defaults do; setting the flag remounts the Canvas with the fallback. Validation errors don't switch, since they're bugs to fix rather than hide. The fallback sorts on the CPU, so the failing shaders never compile, and setting the flag again does nothing, so it can't loop. The zustand store lives outside the Canvas, so a loaded volume survives the switch. Check that the old renderer is disposed when its Canvas unmounts.
   - **The fallback's start is retried.** If `init()` of a forced fallback throws, dispose of that renderer and try a new one on the same canvas, a second apart, a few times, before letting the error through. A canvas whose `getContext('webgl2')` returned `null` holds no context, so a later attempt can succeed once the GPU process is back.
2. **R3F types the renderer as a WebGLRenderer.** `useThree((s) => s.gl)` is typed `WebGLRenderer` even though it holds a `WebGPURenderer`. Go through `asWebGPU()` in `src/viewer/renderer.ts`: an `instanceof WebGPURenderer` guard that takes an `object` and narrows it, so no cast is needed.
3. **The Canvas defaults.** With a factory there are no `gl` props, so R3F would set ACES tone mapping once the renderer exists; pass `flat` to keep it off, so the splats' colours show as photographed. R3F caps the pixel ratio at 2 by default, which suits a dense cloud of splats.
4. **Keep the Canvas props static.** R3F re-applies `shadows`, `flat` and `linear` only when those props change (by shallow comparison). Anything changed at runtime is set on the renderer from inside the Canvas. The one exception is item 1's fallback, which changes the Canvas's `key`, so React mounts a new Canvas rather than updating this one.
5. **Only node materials run under WebGPU.** GLSL `ShaderMaterial`, `RawShaderMaterial` and `onBeforeCompile` don't run; custom shading is TSL (`three/tsl`) or node materials. `GaussianSplat` is built on TSL, so it fits. drei helpers built on GLSL or on WebGL render targets don't work; `OrbitControls` and `Stats` don't depend on the renderer.
6. **The splats' lifecycle.** Build each level's geometry and its `GaussianSplat` in the effect that owns them, as item 9 says, and in that effect's cleanup, remove the splat from the scene and dispose of the source geometry, the splat's own geometry, its material and the cell table's texture. `GaussianSplat` has no `dispose()` of its own in r187: disposing those frees the drawing data and the splat's quad, but the storage buffers holding the centres, covariances and colours, and the sort's buffers, are freed only when the splat is garbage-collected. So keep no reference to a freed splat, in a ref or anywhere else, or a leak grows with every rebuild; a level kept for reuse is kept on purpose, in one place. Never build them during render. Under the WebGL 2 fallback, sorting is CPU work that grows with the splat count, so watch the frame rate at 4 mm.
7. **Millimetres and framing.** The cells' centres are in millimetres, from the grid's corner. Subtract the bounds' centre when filling the centres, then fit the camera to the body from the front: back off by the body's half-height over `tan(fov / 2)`, with a margin, and keep near and far comfortably around it.
8. **Loading.** The volume file ships with the site, so a fetch relative to the page reaches it from any folder. Give the load an `AbortController` that the effect's cleanup aborts, so StrictMode's double mount doesn't read the file twice into the store. Keep the levels once built; switching Detail back needn't rebuild the data, only the splat.
9. **Satisfying the React Compiler-style lint rules.** Oxlint's `react(immutability)` flags mutating anything a hook returned, `useMemo` and `useThree` results included, even inside an effect. These patterns pass, as PDBSplat's code shows:
   - Create imperative three objects (the splat geometry, the `GaussianSplat`, the cell table) inside the effect that owns them, keep them in a ref for later effects, and dispose of them in that effect's cleanup.
   - Read the renderer, scene, camera and controls through `const get = useThree((s) => s.get)`, calling `get()` inside effects and handlers.
   - Mutate per-frame state through refs inside `useFrame`.
10. **Nothing allocates per frame.** Inside `useFrame`, reuse vectors and other objects through refs or module scope.
11. **Versions.** Everything installs at its latest (D16). `npm ls three` should show one three: fiber, drei and three-stdlib take it as a peer, and the `$three` override folds in the copy drei's `stats-gl` would otherwise bring. `@types/three` comes from the same release. TypeScript 7 builds the template's tsconfig unchanged, and Oxlint's type-aware rules run on it. React has to stay within R3F 9's peer range (19.0 to 19.3), and `@types/node` follows the Node in use (24). After that, `npm outdated` should list only `@types/node`.
12. **The cell table.** A splat's colour bytes can't change after it's built, so they carry the cell's index, written as three bytes, low first, exact to 2²⁴ cells. A `DataTexture` of one RGBA texel per cell holds what can change. The splat's `material.colorNode` decodes the index from three's `vSplatColor` varying and reads the texel with `textureLoad`. Opacity and the cuts rewrite the texels' alpha in place on the CPU, set `needsUpdate`, and rebuild nothing. A cut tests each cell's centre against its plane, in a loop over a typed array, which stays in the low milliseconds even at 4 mm. Take the texture's width as a fixed power of two within WebGPU's default limit (8192 texels), with as many rows as the cells need. PDBSplat's `src/viewer/atomTable.ts` and its use in `ProteinSplats.tsx` are the pattern, working under both backends.
13. **The data script.** Node 24 runs TypeScript by stripping its types, so the script uses only erasable syntax (no enums, namespaces or parameter properties, which `erasableSyntaxOnly` enforces), imports with `.ts` extensions, and runs because `package.json` has `"type": "module"`. `import { PNG } from 'pngjs'` works from ESM, and `PNG.sync.read(buffer)` gives `width`, `height` and `data` as four bytes per pixel, alpha included, even for an RGB file. Use Node's own `fetch`, with a small pool of four downloads, and a pause before each retry. Write the volume file through a temporary name, renamed into place once whole, so a failed run never leaves half a file where the app expects one.
14. **Tests.** Tests live in `test/<module>.test.ts` and run on `node --test`, type-checked by `tsconfig.test.json`. Keep them as PDBSplat's are: no helper modules under `test/`, since Node runs every `.ts` there as a test file; every call written `void test(…)`, since type-aware `no-floating-promises` flags a bare one; and no casts, since `no-unsafe-type-assertion` fails the lint. A test reaches an odd value by building it, not by asserting its type.
