# Plan: VisibleHuman, phase 2 — three bodies, four render styles

## Context

VisibleHuman 0.1.0 is live: the Visible Human Male's colour cryosections, averaged into 4 mm cells and drawn as Gaussian splats with three.js r187 on WebGPU (WebGL 2 fallback), with Detail/Size/Opacity and three anatomical cuts. The setup plan's Appendix B deferred: the female body, the CT and MRI scans, sharper cut faces, surface-only splats and a ray-marched volume. The "Setup-plan walkthrough results" audit found the release sound and left six small items open (Size slider rebuilds at 4 mm; slice 1002 false-positive short; no fetch timeout; README says 6.2 GB not 5.7; no LICENSE; no gzip on the volume).

This phase brings in the three NLM datasets (Male, Female, the Ratiu Head), keeps the originals outside the repository, and adds three render styles beside the splats: a 3D-texture ray march (Volume), surfaces ray-traced from one full-screen quad (Raytrace) and a traditional mesh (Surface), with CT (and for the head, CAT + MRI) supplying density and surface boundaries, and low-opacity / x-ray-like effects. It is written in the setup plan's form, one phase per thread, each reviewed by `/commit`; during the work it lives at `docs/phase2-plan.md`.

### Decisions taken with the user (2026-11-08)

- **Data root**: `~/Data/VisibleHuman/`, overridable by `VHP_DATA` or `--data`.
- **Download**: everything the NLM offers in PNG/TIFF form: the core set (≈22 GB) *and* the three 70 mm film sets (male 40 GB, female 2K PNG 25 GB, female 4K TIFF 195 GB). ≈288 GB on disk with the male slices already cached; 615 GB is free. The film sets are unaligned frame to frame and are archived, not used by this phase.
- **Assets**: small files committed (≤ ~10 MB each, gzip, decoded in the browser); finer opt-in levels gitignored, built before a deploy, copied to the live folder with `dist/`.
- **Order**: data tooling, then the Volume, Raytrace and Surface styles on the male with its CT, then the female, then the head.
- **Raytrace style** (asked for after approval, 2026-11-08): a render that needs only a quad. A fourth style traces the volume's surfaces from one full-screen quad (D21), and the Volume march shares that quad in place of a proxy box (D10).

## Research findings (checked 2026-11-07/08)

### The NLM data

The data-discovery page (`datadiscovery.nlm.nih.gov/.../ux2j-9i9a`) is only a pointer: its API record lists four access points on the LHNCBC mirror, `https://data.lhncbc.nlm.nih.gov/public/Visible-Human/{Male-Images,Female-Images,Additional-Head-Images,Sample-Data}/`. The mirror is S3 behind CloudFront: **no CORS header** (a page can't read it), folder listings at `<folder>/index.html` (the folder URL itself is a 404), `Accept-Ranges: bytes`, ETags, no rate limit seen. No license since 2019; the NLM asks for the "Courtesy of the U.S. National Library of Medicine" credit (already in the app).

**Male** (`Male-Images/`)

| Set | Path / naming | What it is | Size |
| --- | --- | --- | --- |
| Colour CCD cryosections | `PNG_format/<region>/a_vmNNNN.png`, regions head 1001–1377, thorax 1280–1688, abdomen 1455–1997, pelvis 1732–2028, thighs 1732–2411, legs 2265–2878 (overlaps are identical files) | 1,878 slices 1001–2878, 2048×1216 RGB8, 0.33×0.33 mm pixels, 1 mm apart, aligned (fixed camera). Blanks 2424–2435 (7 KB files); frosty block starts 1506–1507, 2017–2020; 1505 discoloured | 5.70 GB. **Already cached** in `.cache/slices/` (1,878 files) |
| 70 mm film scans | `70mm/fullbody/NNNN.rgb.gz` | 1,878 frames 1001–2878, 4096×2700 interleaved RGB raw (no header), 0.144 mm pixels per the folder README (the web page says 0.17). README: "TOTAL BODY (**unaligned** image data)". 2426–2432 are empty 29-byte files | 40.24 GB gz (33 MB raw each) |
| Frozen CT | `PNG_format/radiological/frozenCT/cvmNNNNf.png` + `frozenCTHeaders/cvmNNNNf.txt`; originals `radiological/frozenCT/c_vmNNNN.fro.Z` (GE 16-bit, 3416-byte header) | 1,877 slices **1006–2882, 1 mm, numbered like the cryosections**. 512×512, 8-bit in the PNG (air 0–15, soft tissue ≈60–66, bone 100–255: poor soft-tissue contrast, good bone/air/skin). **DFOV varies per segment**: 270 mm at 1125 (0.527 mm/px), ≈480 mm at the hips. The header text gives DFOV, pixel size, centre R/A/S, corner coordinates, table position. The frozen gel block is visible in some segments (hips), not in the head. CT anterior is at the top of the image; the cryosections have the posterior at the top (verified on the sagittal preview), so a vertical flip is expected | 0.47 GB PNG (0.51 GB .Z) |
| Normal (fresh) CT | `PNG_format/radiological/normalCT/cvmNNNNf.png` + headers | 521 slices 1012–2893 at irregular 1/3/5 mm steps, DFOV 345 at 1125; body in air | 0.11 GB |
| MRI | `PNG_format/radiological/mri/mvmNNNN{1,p,t}.png` (t1, pd, t2) + headers | Axial head 1005–1165 every 5 numbers (33 slices; 256×256, DFOV 260 → 1.016 mm/px, 4 mm thick + 1 mm gap). Numbers ≥ 3001 are the longitudinal body series and localizers | 0.06 GB |
| Scout CT, X-rays | `radiological/scoutCT`, `xray8`, `xray14` (.Z only) | 4 scouts; 15 digitised radiographs at 8 and 14 bit | 0.06 GB |

**Female** (`Female-Images/`)

| Set | Path / naming | What it is | Size |
| --- | --- | --- | --- |
| Colour CCD cryosections | `PNG_format/<region>/avfNNNN[abc].png`, regions head 1001–1285, thorax 1262–1488, abdomen 1432–1909, pelvis 1703–1953, thighs 1703–2300, legs 2200–2730 | **5,186 slices**: numbers 1001–2730 × a/b/c (absent: 2328c, 2329a, 2329b, 2730c), 2048×1216 RGB8, **0.33 mm cubic voxels**, aligned. Blank 7 KB files: 1492b–1497b (16), 1977c, 1978a, 1978b, 2100a, 2100b, 2329c, 2330a. Overlapping regions hold identical files | 16.45 GB (mean 3.17 MB) |
| 70 mm film scans | `70mm/2K_PNG-Images/NNNN.png` (1001–6189 + `1713b`), `70mm/4K_Tiff-Images/NNNN.tif` | 5,189 frames; presumably unaligned like the male's; 25 blank 2K files (2474–2490, 3931–3933, 4984–4988) | 24.9 GB (2K PNG), **195 GB** (4K TIFF, 37.6 MB each) |
| Normal CT | `PNG_format/radiological/normalCT/cvfNNNNf.png` + `normalCTHeaders/c_vfNNNN.txt` | 1,734 slices **1001–2734 at 1 mm, complete**, 512×512, "AXIAL 1X1 NCE", taken fresh (before freezing); DFOV 250 at 1001 (0.488 mm/px) | 0.41 GB |
| MRI | `PNG_format/radiological/mri/mvfNNNN{1,p,t}.png` | Axial head 1014–1174 every 5 (33 slices); body series ≥ 3001 | 0.06 GB |

**Head** (`Additional-Head-Images/`, Ratiu / Brigham and Women's Hospital, a 72-year-old male; formalin-fixed, vessels filled with araldite-F; MRI and CAT taken *before* freezing)

| Set | Path / naming | What it is | Size |
| --- | --- | --- | --- |
| Colour cryosections | `cryo/tiff/NNNN.tiff.gz` (0001–1477) | 1,477 slices, 1056×1528 RGB, **0.147 mm isotropic** (217 mm span, 155×225 mm field). 0172–0174 and 1395 are averages of their neighbours | 4.28 GB gz |
| JPEG copies | `cryo/jpeg/{fullSize,halfSize,quarterSize}/{axial,coronal,sagittal}/NNNN.0{1,2,4}.jpg` | Illustration copies; coronal/sagittal are reformats | 0.21 GB full, 0.03 GB quarter |
| CAT | `MR_CT_tiffs/CAT-tiff/N.tif.gz` (1–463); DICOM `MR_CT_DICOM/CAT/J.NNN.gz` | 463 slices, 0.489 mm pixels, 0.5 mm thick, no gap (512×512 → 250 mm) | 0.05 GB TIFF, 0.11 GB DICOM |
| MRI | `MR_CT_tiffs/MRI-tiff/{PD,T1,T2}-tiff/` (76 each, 0.9375 mm px, 3 mm), `T2_512-tiff/` (229, 0.469 mm px, 1 mm); DICOM under `MR_CT_DICOM/MRI/` | | 0.03 GB TIFF, 0.05 GB DICOM (T2_512) |

**Sample data** (`Sample-Data/`): zips of 5 frozen + 5 fresh male CT PNGs (512×512 8-bit grey), 3 head MRI PNGs (256×256 8-bit), 6 male and 5 female colour slices, and a .docx index. Downloaded and decoded during research to confirm the formats above.

### Which sets are ideal

- **Male**: the CCD colour set (aligned, already cached). The 70 mm scans have 2.3× the linear resolution but are *unaligned* and 40 GB; nothing the browser can hold goes below ≈1 mm for a whole body, so they add nothing to the 3D work. Frozen CT for density and bone: complete at 1 mm, numbered like the cryosections. MRI only covers the head at 5 mm.
- **Female**: the CCD colour set is the finest aligned whole-body data in the project (0.33 mm cubic). Fresh CT is complete at 1 mm. The 70 mm sets are archived.
- **Head**: cryo TIFFs (0.147 mm, the finest of all), CAT (0.5 mm) for bone/density, T2_512 MRI (1 mm) for soft tissue. JPEG quarter-size copies are a quick orientation proof set.
- Skip the `.Z` (Unix compress) originals: PNG copies exist for every set used, and Node has no LZW `.Z` decoder built in.

### Existing code (0.1.0, `development` = `main`)

- `scripts/build-volume.ts` (466 lines): downloads `PNG_format/<region>/a_vm<N>.png` four at a time (no timeout), segment rule in `src/volume/segment.ts` (blue/dark/grey tests, `bodyShare` 0.5, blank/short slices, gap fill, largest piece), 12×12 px × 4 slices → 3.96×3.96×4 mm cells, writes `public/volume/male-4mm.bin` (format VHV1 in `src/volume/format.ts`: 38-byte header, body bitmask, RGB per body cell; 5.48 MB, 1,601,613 cells, grid 142×81×470), previews in `.cache/preview/`. Options `--from --to --out --cache --previews`.
- `src/volume/levels.ts` builds 16/8/4 mm levels; `src/viewer/BodySplats.tsx` + `cellTable.ts`: one splat per cell, index-in-colour → RGBA `DataTexture` table for opacity and cuts (no rebuild); `renderer.ts`: WebGPU with blocklist (Intel gen-7) and WebGL 2 fallback; `store.ts` zustand; leva panel in `App.tsx`. 29 node:test tests. `/commit` skill reviews and versions each batch; a plan under `docs/` is the user's to edit.
- Scene axes (`format.ts` `sceneAxes`): x = +i (body's right → left), y = −k (head up), z = +j (rows run back → front, so the image's top is posterior).
- Machine: macOS 12.7, Node 24.22.2, 615 GB free, Intel Iris (WebGL 2 fallback only). Deploy = copy `dist/` to `~/Sites/localhost/live/visiblehuman/`.

### PDBSplat techniques that transfer (`../PDBSplat/src/`)

1. `viewer/field.ts` + `viewer/ProteinField.tsx`: front-to-back ray march of a `Data3DTexture` through a back-face proxy box (slab entry, near-plane crossing, hash jitter, Beer–Lambert, early exit at T < 0.01, premultiplied One/OneMinusSrcAlpha, `.level(0)` sampling for WGSL uniformity, textures swapped via `node.value`). Needs a transfer function instead of the atom lookup. Already runs on this Mac's WebGL 2 fallback.
2. `surface/gaussianSurface.ts` + `surface.worker.ts` + `surfaceWorker.ts` + `viewer/ProteinSurface.tsx`: marching cubes (three's Bourke tables) with a 4-plane ring buffer, shared edge vertices, gradient normals, probe-then-budget (10 M triangles), latest-wins worker queue with transfer; depth pre-pass for a translucent nearest layer, "back shell" passes, hemisphere + headlight.
3. `viewer/weighted.ts` + `viewer/Effects.tsx`: weighted-blended OIT via `pass().setMRT`, `RenderPipeline`, `bloom()`, `ssao()`.
4. `viewer/levels.ts` (`mergeGaussians`, `levelToDraw`), `viewer/atomTable.ts` (the table trick), `options.ts` + `Panel.tsx` (declarative options with `shownFor`/`shownWhile`), `viewer/renderer.ts`, `viewer/shading.ts` (depth cue via `renderGroup` uniforms, `scene.fogNode`), `viewer/Clip.tsx` (near-plane clip).

### three r187 facts (installed `three@0.187.0`, latest release r187 of 2026-10-30)

- `GaussianSplat` (`three/addons/objects/GaussianSplat.js`, `{autoSort}`), `createGaussianSplatGeometry`, `writeCovariance`; storage buffers (52 bytes per splat), GPU counting sort, CPU sort on WebGL 2, no `dispose()`.
- `Data3DTexture` + TSL `texture3D` / `texture3DLoad` / `texture3DLevel`; `Storage3DTexture` + `textureStore` for compute; `RaymarchingBox(steps, cb)` in `three/addons/tsl/utils/Raymarching.js` (unit box, `Loop` with a float step); examples `webgpu_volume_cloud`, `webgpu_compute_texture_3d`.
- `oitPass(scene, camera)` in `three/addons/tsl/display/OITPassNode.js`: McGuire–Bavoil weighted-blended OIT; only `NormalBlending` transparent materials qualify; MSAA only on WebGPU. Also `BloomNode`, `SSAONode`, `GTAONode`, `OutlineNode`.
- Clipping on the node renderer: `material.clippingPlanes` or a `ClippingGroup` (exported from `three/webgpu`, see `webgpu_clipping`); there is **no `localClippingEnabled`** flag, the renderer handles planes itself. `MarchingCubes.js` holds the tables.
- WebGPU default limits: `maxTextureDimension3D` 2048, `maxStorageBufferBindingSize` 128 MB, `maxBufferSize` 256 MB. Browsers have `DecompressionStream('gzip')`, so compressed files can be served from any static host.
- `@types/three` 0.187 types all of the above. Decoders on npm: `sharp` 0.35.5 (PNG/TIFF/JPEG/raw; prebuilt `@img/sharp-darwin-x64` for Node ≥ 20.9, no install script), `dicom-parser` 1.8.21, `utif2` 4.1.0, `jpeg-js` 0.4.4.

### Measurements

- Frozen CT 1125 (head): 8-bit values air 0–15, tissue ≈60–66, bone ≥100; head ≈183 mm wide at 0.527 mm/px; no gel block. Frozen CT 1945 (hips): body inside a rounded rectangular block (the gel), DFOV ≈480 mm. Fresh CT 1125: head in air at 0.674 mm/px.
- Cryosection body areas from the cached slices: 301 cm² at 1125, 1,099 at 1449, 916 at 1945.
- MRI header: `Slice Thickness 4`, `Spacing Between scans 1`, DFOV 260, 256×256 → 1.016 mm/px, 34 slices in the head group.
- Gzip of the committed 4 mm male (142×81×470 grid, 1,601,613 body voxels, 29.6 % of the box): sparse file as committed **4.34 MB**; dense RGBA interleaved 4.97 MB; dense planar RGB 4.51 MB; dense planar G, R−G, B−G 3.90 MB; the same delta-coded along i **3.73 MB**; a dense coverage byte block 0.08 MB. A dense cropped grid is *cheaper* than today's sparse file, and empty space is free.

## 1. Where it ends up

```
VisibleHuman/
├── .claude/skills/commit/        unchanged, except its settings mention data/ and the opt-in level files (Phase 10)
├── docs/phase2-plan.md           this plan, deleted before the merge (D20)
├── LICENSE                       MIT, for the code; the images stay under the NLM's terms (D18)
├── data/                         small committed JSON the scripts read and write
│   ├── male/registration.json    CT → cryosection, one 2D similarity per segment (D7, Appendix B)
│   ├── female/registration.json
│   └── head/registration.json    CAT → cryosection rigid transform, and the MRI's frame (D8, Appendix B)
├── scripts/
│   ├── fetch-data.ts             npm run fetch: the NLM's sets into the data root, resumable (D1–D3)
│   ├── build-volume.ts           npm run volume: a body's slices (+ CT/MRI) into a v2 volume file (D4–D6)
│   ├── register.ts               npm run register: the CT→cryo fit for male/female, the 3D fit for the head (D7, D8)
│   └── lib/                      sets.ts, data.ts, listing.ts, bodies.ts, decode.ts, dicom.ts, images.ts, previews.ts
├── public/volume/
│   ├── bodies.json               the bodies, their levels and files (D5, D14, Appendix B)
│   ├── male-4mm.bin              v2 (D4), committed; replaces the v1 file of the same name
│   ├── female-4mm.bin            committed
│   ├── head-1.2mm.bin            committed
│   └── male-2mm.bin, female-2mm.bin, head-1mm.bin, head-0.6mm.bin    opt-in, gitignored, built before a deploy (D5)
├── src/
│   ├── App.tsx                   the Canvas, overlays and credit; the panel moves out
│   ├── Panel.tsx                 the leva panel, built from options.ts (D9)
│   ├── options.ts                the view options table: folders, labels, defaults, which styles show each (D9)
│   ├── store.ts                  body, level, status, volume, bounds, splat levels, options
│   ├── volume/                   format.ts (v2), codec.ts, loadVolume.ts, density.ts, segment.ts, levels.ts,
│   │                             ctHeader.ts, similarity.ts, rigid.ts
│   ├── surface/                  marchingCubes.ts, surface.worker.ts, surfaceWorker.ts (D11)
│   └── viewer/                   Viewer.tsx, renderer.ts, styles.ts, cuts.ts, rays.ts, rayQuad.ts, volumeTexture.ts,
│                                 shading.ts, BodySplats.tsx, cellTable.ts, volumeMarch.ts, BodyVolume.tsx,
│                                 raytrace.ts, BodyRaytrace.tsx, BodySurface.tsx, CutCaps.tsx, weighted.ts,
│                                 Effects.tsx, Framing.tsx
├── test/                         format, codec, density, segment, levels, listing, ctHeader, similarity, rigid,
│                                 marchingCubes, cuts, rays  (node:test, D16)
└── README.md

~/Data/VisibleHuman/              the originals, outside the repository (D1): one folder per set, plus manifest.json
```

Scripts in `package.json`: the existing ones, plus `fetch` (`node scripts/fetch-data.ts`) and `register` (`node scripts/register.ts`); `volume` stays (`node scripts/build-volume.ts`).

## 2. Decisions

| # | Topic | Default | Alternative |
| --- | --- | --- | --- |
| D1 | Where the originals live | **`~/Data/VisibleHuman/<set>/`**, overridable by the `VHP_DATA` environment variable or `--data PATH` on every script. One flat folder per set (`male-colour`, `male-ct`, `male-mri`, `male-70mm`, `female-colour`, `female-ct`, `female-mri`, `female-70mm-2k`, `female-70mm-4k`, `head-cryo`, `head-cryo-jpeg`, `head-cat`, `head-cat-dicom`, `head-mri`, `head-mri-dicom`), files under their NLM names; the NLM's region folders aren't mirrored, since a slice listed in two regions is the same file. `manifest.json` at the root records what's present (Appendix B). The 1,878 slices already in `.cache/slices/` are **moved** there with one `mv` (Phase 1), not downloaded again; `.cache/` keeps only previews afterwards | Mirror the NLM's folder tree verbatim under the root |
| D2 | What's downloaded | Two runs. **Core, ≈22.3 GB**, needed by Phases 3–9: male frozen CT + headers (0.47 GB), male MRI + headers (0.06), female colour (16.45), female CT + headers (0.41), female MRI (0.06), head cryo TIFFs (4.28), head CAT TIFFs (0.05) and CAT DICOM (0.11, for its geometry), head MRI TIFFs (0.03) and MRI DICOM, head quarter-size axial JPEGs (0.03, the orientation proof set). **Film, ≈260 GB**, archived and unused by this phase (the frames are unaligned): `male-70mm` (40.2), `female-70mm-2k` (24.9), `female-70mm-4k` (195.2). Both resumable; the film run can take a day or more and can run while Phases 2–7 proceed. Not downloaded: the `.Z` originals, the male normal CT, scouts and x-rays (in `sets.ts` as optional sets) | Add `male-normal-ct` (0.11 GB) if the fresh/frozen comparison ever matters |
| D3 | Decoders in the scripts | **sharp 0.35** (dev dependency; prebuilt `@img/sharp-darwin-x64`, Node ≥ 20.9, no install script): PNG, TIFF (8- and 16-bit), JPEG and raw output in one native library, about 10× faster than pngjs on a 2048×1216 slice, which matters for the female's 5,186 slices (≈15 min instead of ≈2 h). **dicom-parser 1.8** (pure JS) reads the head's DICOM headers and pixels. `node:zlib` handles `.gz`. pngjs and `@types/pngjs` go; the previews are written with sharp too. Phase 1 proves sharp on this Mac before anything depends on it | pngjs + utif2 + jpeg-js, pure JS: no native risk, but slow; decode in `worker_threads` to claw back 3–4× |
| D4 | The volume file, version 2 | **One dense grid per body and spacing, cropped to the body's bounds**, in planar byte blocks: colour as G, R−G, B−G (mod 256), then density, coverage and, for the head, MRI; every block delta-coded along i; the whole file gzipped and read in the browser through `DecompressionStream('gzip')` (Appendix A has the byte layout). Measured on the male's 4 mm colour: 3.73 MB this way against 4.34 MB for today's sparse file, so empty space costs nothing after gzip and the dense grid is the cheaper one. Colour is dilated one voxel outward past the body (coverage stays 0 there), so trilinear sampling at the skin never mixes tissue with black. Density is 0 outside the body and 1–255 inside (D6). The three styles all read this one file: splats from coverage + colour, the volume from an RGBA `Data3DTexture` built in the browser (R, G, B, density), the surface from coverage and density on the CPU with colour from that texture. Version 1 is retired; the app reads v2 only | A bricked atlas (8³ bricks + page table) as a v3 for regional 1 mm data (Appendix E says why not now) |
| D5 | Levels: what ships, what's opt-in | Committed and loaded by default: **male 4 mm (≈5 MB)**, **female 4 mm (≈4.5 MB)**, **head 1.2 mm (8 px blocks, ≈10 MB)**. Opt-in, gitignored, built before a deploy and listed in `bodies.json` with `optional: true`: male 2 mm (≈39 MB file, 173 MB GPU texture), female 2 mm (≈32 MB, 139 MB), head 1 mm (7 px, ≈14 MB, 28 MB) and head 0.6 mm (4 px, ≈78 MB, 149 MB). A level the server lacks shows "not built" in the panel and the body stays on its default. All within the 2048³ texture limit; the 128 MB storage-binding limit doesn't apply to textures. The splat Detail list derives from whatever grid is loaded: blocks of 1, 2, 4 and 8 voxels, labelled in mm, omitting any with over **2 million** cells (52 bytes per splat against the 128 MB binding), starting on the finest with at most 400,000 (male: 8 mm, 215,000, as today) | Commit the head at 1 mm (≈14 MB) if the extra 4 MB is acceptable; or quantise colour to 6 bits (−30 % file size, measured) |
| D6 | Density | One 8-bit scale for every body: **density = clamp((HU + 1000) / 16, 0, 255)**, which is what the NLM's 8-bit CT PNGs already are (air 0–15, soft tissue ≈62, bone ≥100); the head's DICOM HU values go through the same formula. Inside the body: the registered CT's value where it covers the voxel, else `densityFromColor(r, g, b)` in `src/volume/density.ts` (pale and unsaturated → high, red → middle, yellow → low, on the same scale), the same formula also written in TSL for the Volume style's "Density: colour" choice. Outside the body: 0, so density > 0 is the body test on the GPU. Bone threshold default 110 (slider 70–200). The body MRIs (33 axial head slices at 5 mm) aren't used in the grids: too sparse; they're downloaded and recorded in the manifest | — |
| D7 | CT → cryosection registration (male, female) | **Automatic, per segment**: a 2D similarity (scale from the header's pixel size, so only translation, a small rotation and a flip are fitted) per run of slices that shares one CT geometry (DFOV and centre, grouped from the headers) within one cryo block (blocks split at 1505/1506, 2016/2017 and 2423/2436 for the male). Fitted on ≈8 sample slices per segment jointly, by maximising the overlap of the CT bone mask (≥100) with the cryosection's bright-bone pixels (luminance ≥150 and channel spread ≤60, inside the body), both at 1 mm; where the segment has no gel block, the body outlines (CT ≥40 against coverage) are added. Coarse-to-fine search: flips {none, vertical, horizontal, both} × translation ±80 mm at 4 mm steps, then ±4 mm at 1 mm, then rotation ±3° at 0.25°. Result in `data/<body>/registration.json` (Appendix B), overlays in `.cache/preview/register/`, a score per sample slice in the log. Expect **1–2 mm** on the male (frozen CT of the same block) and **2–5 mm on bone, worse on soft tissue, for the female**, whose CT was taken fresh; a per-slice translation refinement smoothed along z is the fallback if a segment drifts | Type the transforms by hand into the JSON from the overlays |
| D8 | Head registration (CAT, MRI → cryosection) | **6-DOF rigid, automatic first**: the head masks of the CAT (HU ≥ −300) and the cryo grid (coverage) give centroids and principal axes (24 sign/order candidates), then a search over ±15° per axis at 2.5° and ±20 mm at 2 mm, refined to 0.5° and 0.5 mm, scoring bone agreement (CAT HU ≥ 300 against pale cryo voxels) on 2 mm grids. MRI: if the CAT's and T2's DICOM `FrameOfReferenceUID` match, the MRI sits in the CAT's frame by its `ImagePositionPatient`/`ImageOrientationPatient`; otherwise MRI → CAT by mutual information on 2 mm grids. Written to `data/head/registration.json`; the manual fallback is editing that file's `rotationDeg`/`translationMm` and rebuilding (≈3 min at 1.2 mm), with before/after overlays from `npm run register -- --body head --preview`. Honest expectation: **2–3 mm and ≈2°** on the skull, the fixation and freezing having changed soft tissue; a wrong basin shows as a score under ≈0.4 and an overlay that is plainly off, which the manual edit fixes | Ship the CAT as its own small grid and adjust the transform live with sliders; more code and a second texture, so later |
| D9 | Styles and options | Four **components**, one mounted at a time by `styles.ts`'s switch as PDBSplat's `Viewer` does: `BodySplats`, `BodyVolume`, `BodyRaytrace`, `BodySurface`. Options in **`src/options.ts`**, a table of folders, labels, defaults, ranges and `shownFor`/`shownWhile`, with **`src/Panel.tsx`** built from it (PDBSplat's `options.ts` and `Panel.tsx`, ported nearly verbatim). Folders: **Body** (Body, Level), **Look** (Style; Detail, Size, Blend for splats; Mode, Density, Window low/high, Quality, Shading for the volume; Trace, Layers, Shadows, Light for the raytrace; Skin, Bone, Back shell for the surface; Bone threshold and Rim for the raytrace and the surface; Opacity for all), **Cuts** (Axial, Coronal, Sagittal; Caps for the surface), **Scene** (Depth cue, Bloom, Bloom radius, Bloom threshold, OIT), **Info** (renderer, grid, shown, status) | Keep the hand-written leva block |
| D10 | The Volume style | **The ray quad** (`rayQuad.ts`, D21, Appendix D item 14), shared with the Raytrace style: one full-screen quad whose fragment builds the camera ray, clips it to the cut box with the slab test and starts it at the near plane, so the camera may be inside the body and no proxy geometry is scaled, culled or turned inside out; `depthWrite: false`, premultiplied `One`/`OneMinusSrcAlpha`, a miss discards. A front-to-back march in TSL (`volumeMarch.ts`, from PDBSplat's `field.ts`): per-pixel hash jitter, `Loop` with `Break` at exit or at T < 0.01, `texture3D(...).sample(uvw).level(0)` so WGSL needs no derivatives and GLSL takes `textureLod`. **Modes**: *over* (α = 1 − exp(−σ·Δs), σ = extinction × Opacity × smoothstep(Window low, high, density), colour decoded from sRGB), *x-ray* (Beer–Lambert transmittance of density above 40, shown as a negative: tint × (1 − T) over black), *MIP* (max density, tinted), *glow* (emission only, additive, meant for Bloom). The three cuts clamp the ray's entry and exit to a sub-box (uniforms `cutMin`, `cutMax`), so a cut face is exact and nothing but two uniforms changes. Quality sets the step: 1 voxel on the WebGL 2 fallback, ½ voxel on WebGPU; `maxSteps` = the sub-box diagonal in steps + 1. Shading (central-difference gradient, six extra fetches, only where a step contributes) is a switch, off by default | PDBSplat's back-face proxy box as the ray source (no full-screen discards, but inside/outside cases and resized geometry); or accumulating in a half-float target with bloom-only HDR |
| D11 | The Surface style | Marching cubes in a **worker** (`marchingCubes.ts`: `gaussianSurface.ts`'s `march()` rewritten for a sampled byte field with a 4-plane ring buffer, shared edge vertices and gradient normals; `surfaceWorker.ts` ported verbatim): the **skin** from coverage at 128, the **bone** from density at the Bone threshold (110), both from the loaded grid. No vertex colours: the fragment samples the RGBA 3D texture half a voxel inward along the normal, so the mesh shows true tissue colour. Cuts by **`material.clippingPlanes`** (three world-space planes, inactive ones parked outside the bounds so the plane count never changes) plus **caps**: for each active cut a quad in the cut plane, sized to the remaining box, whose `MeshBasicNodeMaterial` samples the texture and discards where density is 0, opaque where density ≥ Bone and at the skin's Opacity elsewhere: the "sharper cut faces" idea, at the grid's resolution. Translucent skin over opaque bone by PDBSplat's **depth pre-pass** (nearest layer only) with its back shell as a switch; r187's `oitPass` behind a Scene switch, checked on both backends in Phase 7. **Rim**: a Fresnel term, pow(1 − |N·V|, 3), added as light and, under 1 Opacity, as alpha, which gives the hologram/x-ray shell. Hemisphere light + headlight as PDBSplat | Vertex colours sampled on the CPU in the worker (one more pass, loses sharpness at low Detail) |
| D12 | The Splats style | Kept as is, plus **Blend** normal / glow (`AdditiveBlending`, unsorted) / weighted (premultiplied, summed by the ported `weighted.ts` through `Effects.tsx`), as `ProteinSplats.tsx` does it; **Size** moves to leva's `onEditEnd`, so a drag rebuilds once; levels built from v2's coverage and colour by `levels.ts` with the block rule of D5 | — |
| D13 | Effects: in scope now | Cheap and in: opacity/extinction (all styles), Beer–Lambert x-ray, MIP, additive glow + `bloom()`, weighted blend (splats), depth cue (fog node for meshes, in-shader for splats and the rays), back shell (surface), per-pixel layered translucency and cast shadows (raytrace), Fresnel rim (raytrace, surface), cut faces (traced for free in the raytrace, capped quads for the surface). Later (listed, not built): `OutlineNode` silhouettes, SSAO/GTAO on the opaque surface, depth of field, gradient ambient occlusion along the traced normal, empty-space skipping from a coarse min/max density mip, brick streaming | — |
| D14 | Bodies | A **Body** chooser (Male / Female / Head) and a **Level** chooser from `public/volume/bodies.json` (Appendix B). The store holds one body at a time: choosing another aborts the current load, loads that body's default level, rebuilds levels and bounds and reframes. Each file carries its own scene axes in its header (D4), so `format.ts`'s fixed `sceneAxes` becomes `volume.axes`; the male's mapping is the default, the female's is checked on her previews, and the head's is decided by a **check step** (Phase 9) on contact sheets of its slices before the build, as the setup plan checked the male's. `?body=female` in the URL opens on a body | A single merged scene with all three bodies side by side |
| D15 | Memory in the scripts | As today: slices are summed into the layer being built and let go; the grid is held as byte arrays of the full slice field (coverage, R, G, B, density: 5 bytes per cell; 27 MB for the male at 4 mm, 325 MB at 2 mm, 23 MB for the head at 1.2 mm, 186 MB at 0.6 mm), then cropped. Decoding is sharp's (libvips, threaded); the sums are plain loops (≈10 ms per slice). One spacing per run; coarser splat levels are derived in the app, never built twice. The female's 12 sub-slices per 4 mm layer (6 per 2 mm) are read 4 at a time like the male's | — |
| D16 | Tests | node:test on the pure modules, as before: v2 round trip and refusals, delta coding, density formula, the amended short-slice rule, levels from v2, listing parsing, CT header parsing, the 2D similarity and 3D rigid maths (apply, invert, compose, PCA on a synthetic ellipsoid), marching cubes on a sphere field (closed: V − E + F = 2, normals outward), the cuts' box and planes | — |
| D17 | Versions and dependencies | Latest of everything, as D16 of the setup plan; new dev dependencies `sharp`, `dicom-parser` (and `@types/dicom-parser` if it still ships separately); `pngjs` and `@types/pngjs` removed in Phase 2. Phases end at 0.1.1 … 0.1.9; Phase 10 releases **0.2.0**. The committed binaries are rebuilt only where a phase says (≈19 MB of history in all) | — |
| D18 | LICENSE | **MIT** for the code, with the README's existing note that the images are the NLM's and used under its terms | — |
| D19 | README | Brought up to date in Phase 10 for the public: three bodies, four styles, the data scripts (with the corrected 5.7 GB), the data root, what's committed and what's built before a deploy | — |
| D20 | This plan | Lives at `docs/phase2-plan.md` during the work and is deleted in Phase 10 before the merge, as the setup plan was | Keep it under `docs/` |
| D21 | The Raytrace style | **Surfaces traced straight from the volume by the same single quad** (`rayQuad.ts`), with no mesh: per pixel the ray is clipped to the cut box and stepped a voxel at a time (half a voxel on WebGPU) through the chosen field until it crosses the isosurface; the crossing is refined by five bisection steps, the normal is the field's central-difference gradient there, and the point is shaded by the headlight and a hemisphere (Lambert plus a Blinn–Phong highlight) in the RGBA texture's colour sampled half a voxel inward, decoded from sRGB. **Fields**: the skin from a second R8 `Data3DTexture` of the coverage block at iso 0.5 (the same surface the mesh takes), the bone from the density channel at the Bone threshold, the brain (head) from the MRI block; **Trace** chooses skin, bone or both. **Cut faces for free**: a ray whose entry into the cut box is already inside the surface hits at the entry, and that hit is drawn flat in the texture's colour and lit by the cut plane's normal (bone opaque, tissue at Opacity), so this style has no cap geometry. **Layers**: under 1 Opacity the ray carries on after a skin hit, composites front to back and stops at bone, at T < 0.01 or after Layers hits (1–4), which orders skin over bone over far skin exactly per pixel with no sort, pre-pass or OIT. **Shadows** (switch, off): from a hit, a second march toward the Light direction (two sliders, upper left of the camera by default) at 2-voxel steps darkens the diffuse term where the field blocks it. Rim and Depth cue as the surface's. The fragment writes `depthNode` from the first hit, so anything drawn with it composites correctly, and a miss discards before any work. Expected cost: skin-only about the Volume march at Quality 1 (the skin is near the box), bone-only up to ≈100 steps per pixel through soft tissue; this Mac's fallback at dpr 1 should hold ≥ 15 fps skin-only and ≥ 10 bone-only | Trace the skin only and leave bone to the mesh; or a screen-space bounding quad in place of the full-screen one, which saves the discarded pixels but needs projected bounds every frame |

## 3. How to run a phase

The same five steps as the setup plan: do the phase's **You** steps; paste its **Prompt** into a fresh Claude Code thread; walk its **Check**, asking for fixes in that thread; then, in another fresh thread, `/commit Phase N of docs/phase2-plan.md` as the first message; and start the next phase in a new thread. GitHub Desktop's **Discard All Changes…** is the undo.

Two things are new. The scripts now read from the data root (D1), so a phase that needs data says which `npm run fetch` must have finished first. And the volume files are generated: a thread rebuilds a **default** level only when the phase says so (the history keeps every replaced copy), and experiments go to `--out .cache/…`.

## 4. Phases

### Phase 1: the data root, the fetch script, and the downloads

**You**

1. Make the data root and move the cached male slices into it (same volume, so the move is instant):

   ```sh
   mkdir -p ~/Data/VisibleHuman/male-colour
   mv .cache/slices/* ~/Data/VisibleHuman/male-colour/ && rmdir .cache/slices
   ls ~/Data/VisibleHuman/male-colour | wc -l
   ```

   Expect 1878.

**Prompt**

```text
Read docs/phase2-plan.md: sections 1 and 2 (especially D1 to D3), Phase 1, section 5 and Appendices B and C. Carry out Phase 1 only: the fetch script with its set table and listing parser, the data root, the LICENSE and the README corrections, and prove sharp and dicom-parser on this Mac. Run the fetch only for the small sets and a dry run of the rest; I'll start the large downloads myself. If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing, then summarise, including the exact commands for the large downloads and what the manifest should show when they finish.
```

**The work**

- `npm install --save-dev sharp@latest dicom-parser@latest` (D3, D17). Prove them: a 20-line check in the thread (not committed) decodes `~/Data/VisibleHuman/male-colour/a_vm1500.png` with `sharp(path).raw().toBuffer({ resolveWithObject: true })` and reports width 2048, height 1216, channels 3, and the time (expect ≈30–60 ms). If sharp's binary won't load on macOS 12, stop and say so: D3's alternative applies.
- `scripts/lib/sets.ts`: the set table (Appendix C): id, the NLM folder URL(s), how its files are named (an enumerated pattern with ranges and suffixes, or "every file the listing shows"), the expected count, and whether it's in the core download. The male's regions and the female's a/b/c suffixes live here as data.
- `scripts/lib/listing.ts` (pure, tested): `parseListing(html)` → `{ name, bytes | null }[]` from a folder's `index.html` (anchors, then a size cell and a date cell; the research parsed these pages as name/size/date text triples). Capture one real listing in the thread to write the test from, inline in `test/listing.test.ts`.
- `scripts/lib/data.ts`: the data root (`--data`, `VHP_DATA`, default `~/Data/VisibleHuman`), set folders, and `manifest.json` read/write (Appendix B).
- `scripts/fetch-data.ts`, `npm run fetch -- [--set a,b,…] [--data PATH] [--dry-run] [--verify [--md5]] [--parallel 4]`: for each chosen set, read the folder listing(s), work out the wanted files, skip those already present with the listed size, download the rest four at a time with `AbortSignal.timeout(60_000)` per request, four attempts with a growing pause, through a `.part` file renamed when whole and size-checked, resuming a `.part` with a `Range` header when the server answers 206. `--verify` re-checks sizes without downloading; `--verify --md5` also compares each file's MD5 with the server's ETag where the ETag is a plain MD5 (no `-` suffix). It logs progress per set with an ETA and ends by writing `manifest.json`: per set, files present, bytes, the missing names (as runs) and `complete`. `--dry-run` prints counts and bytes per set and fetches nothing but listings. With no `--set`, the core sets of D2. This closes the "no fetch timeout" audit item, since `build-volume.ts` stops downloading in Phase 2.
- A DICOM check in the thread: fetch one head CAT DICOM (`--set head-cat-dicom` is 0.11 GB, fine to run), gunzip it, parse with dicom-parser, and report Rows, Columns, PixelSpacing, SliceThickness, ImagePositionPatient, ImageOrientationPatient, RescaleIntercept/Slope, BitsAllocated and FrameOfReferenceUID; do the same for one T2_512 MRI DICOM. Put the values in the summary; Phase 9 relies on them.
- Run `npm run fetch -- --set male-ct,male-mri,head-cryo-jpeg,head-cat,head-cat-dicom,head-mri,head-mri-dicom` (≈0.8 GB) and `npm run fetch -- --dry-run` for the core, then `--dry-run --set male-70mm,female-70mm-2k,female-70mm-4k` for the film sets.
- `LICENSE` (MIT, D18). README: "6.2 GB" → "5.7 GB" where it describes the male download, and a short "Source data" paragraph on the data root and `npm run fetch` (the full rewrite is Phase 10's).

**Check** `~/Data/VisibleHuman/manifest.json` shows `male-colour` complete at 1,878 files (verified, nothing downloaded), `male-ct` 1,877 PNGs + 1,877 headers, `male-mri` as the listing has it, the small head sets complete, and the dry run's totals for `female-colour` (5,186 files, ≈16.45 GB), `female-ct` (1,734 + headers), `head-cryo` (1,477), and the film sets (1,878 / 5,190 / 5,190 files; ≈40 / 25 / 195 GB). Then start the big ones yourself and leave them running; rerunning the same command resumes:

```sh
npm run fetch -- --set head-cryo,female-ct,female-mri,female-colour      # core, ≈21 GB, hours
npm run fetch -- --set male-70mm,female-70mm-2k,female-70mm-4k          # film, ≈260 GB, a day or more
```

Then `/commit Phase 1 of docs/phase2-plan.md`.

### Phase 2: the volume file v2, the script per body, the loader

Needs `male-colour` (already there). Nothing else.

**Prompt**

```text
Read docs/phase2-plan.md: sections 1 and 2 (especially D4 to D6, D12, D14 and D15), Phase 2 and Appendices A, B and D. Carry out Phase 2 only: the v2 volume format with its codec and tests, build-volume.ts generalised per body and reading the data root, the browser loader with gzip, the store's body and level, and the splats reading v2, with the male rebuilt at 4 mm. Run the script on a short slice range into .cache first, then the full male build (it reads local files, about 5 minutes). If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing, then summarise, including the file's size, the grid and body counts, and what to look at in the previews and the browser.
```

**The work**

- `src/volume/format.ts`: the v2 `Volume` (`body`, `size`, `spacing`, `origin`, `firstSlice`, `lastSlice`, `axes`, and the blocks `red`, `green`, `blue`, `density`, `coverage`, `mri | null`), `writeVolume`/`readVolume` for the layout in Appendix A (header checks: magic, version, header length, sizes against the byte length, channel bits), `isBodyVoxel = coverage ≥ 128`, `rgbaBytes(volume)` (the interleaved texture bytes), and the axes helpers taking the volume's own `axes` (`sceneCell(volume, i, j, k)`, `sceneSpacing`, `scenePosition`). The male's axes are the current constants.
- `src/volume/codec.ts` (pure, tested): `deltaEncode(block, nx)`/`deltaDecode`, `decorrelate(r, g, b)` → (G, R−G, B−G) and back. Encoding and decoding each run in one pass per block.
- `src/volume/density.ts` (pure, tested): `densityFromColor(r, g, b)` on D6's scale: from luminance and saturation, giving bone-white ≈120–180, muscle ≈60–70, fat ≈45–55, never below 1; and the thresholds `boneDensity = 110`, `xrayFloor = 40`, shared with the shaders.
- `src/volume/segment.ts`: the **slice 1002 fix**: `missingReason` returns `'short'` only when both `before` and `after` hold `dipWindow` non-blank counts (tests updated: a slice with one neighbour above is never short). Keep the rest.
- `scripts/lib/bodies.ts`: per-body constants: slice numbers and naming (`a_vmNNNN.png`; the female's `avfNNNN[abc].png` and the head's `NNNN.tiff.gz` entries are added in Phases 8 and 9 but the shape is designed now), pixel size, slice spacing, the levels as pixel-block sizes per nominal spacing (male: 4 mm = 12 px × 4 slices, 2 mm = 6 × 2, 1 mm = 3 × 1), the scene axes, the cryo blocks, and the known blank slices.
- `scripts/lib/decode.ts`: sharp wrappers: `readRgb(path | buffer)` → `{ width, height, data }` with the size check, `readGray16`, `gunzipFile`, `writePng(path, rgba, width, height)`.
- `scripts/lib/previews.ts`: `drawPreviews` moved out of `build-volume.ts`, through `volume.axes`, written with sharp; plus a fourth preview, `density.png`, the mid-coronal plane of the density channel in grey.
- `scripts/build-volume.ts`, `npm run volume -- --body male --spacing 4 [--out PATH] [--from A --to B] [--previews] [--data PATH]`: reads slices from the data root only (a missing file is an error that names the fetch command), sums as today, keeps per cell the coverage byte, dilates colour one voxel outward after the crop, fills density with `densityFromColor` (the CT comes in Phase 3), writes the file through `writeVolume` + `zlib.gzipSync(level 9)` + a temporary name, updates the level's entry in `public/volume/bodies.json` (bytes, size, spacing, origin), and logs what it did. The default output is `public/volume/<body>-<spacing>mm.bin`.
- `public/volume/bodies.json` (Appendix B) with the male's two levels, 2 mm marked `optional: true`.
- `src/volume/loadVolume.ts`: fetch the level's file; if the first two bytes are `1f 8b`, pipe `response.body` through `new DecompressionStream('gzip')` and read the result, else take the bytes as they are (a host that strips the gzip itself is then harmless); `readVolume`; abort as before; log the decode time.
- `src/volume/levels.ts`: `bodyIndices` from coverage; colours gathered from the planar blocks; `buildBody(volume)` makes the D5 block levels (`{ block: 1|2|4|8, spacing, count, centers, colors }`), omitting blocks over 2 M cells, and names the default (finest ≤ 400,000).
- `src/store.ts`: `bodies` (from `bodies.json`, fetched once), `body`, `level`, `status`, `error`, `volume`, `bounds`, `levels`, `options`; `load(body, level, signal)` aborts and replaces a load in progress; `setOptions` as today. `ViewOptions.detail` becomes the block number.
- `App.tsx`: Detail lists the loaded levels' labels; **Size uses `onEditEnd`** (the audit item); a Level chooser from the manifest (the Body chooser waits for Phase 8, there being one body). `BodySplats.tsx` and `cellTable.ts` adjust to the new `Level` type and take nothing else.
- Remove `pngjs` and `@types/pngjs`. `.gitignore`: add `public/volume/*-2mm.bin`, `public/volume/head-1mm.bin`, `public/volume/head-0.6mm.bin`.
- Run `npm run volume -- --body male --spacing 4 --from 1400 --to 1600 --out .cache/test.bin` first, then the full `npm run volume -- --body male --spacing 4`.

**Check** The full build reads 1,878 local slices in ≈3–6 min and logs: grid 142 × 81 × 470 (or 471 if the kept slice 1002 adds a layer), ≈1.60 million body voxels, `public/volume/male-4mm.bin` **≈4.5–5.5 MB** (colour 3.7 + density-from-colour ≈0.8 + coverage ≈0.1 + dilation ≈0.3). `.cache/preview/front.png`, `coronal.png` and `sagittal.png` match the previous previews; `density.png` shows a plausible grey body with pale bone. In the browser the page opens on the body as before; the console logs the decode time (expect < 300 ms) and the levels (4 mm ≈1.60 M, 8 mm ≈215,000, 16 mm ≈30,000); dragging Size rebuilds once on release; Opacity and the cuts behave as before. `git status` shows `male-4mm.bin` changed and nothing under `public/volume/` untracked but `bodies.json`. Then `/commit Phase 2 of docs/phase2-plan.md` (it asks about the volume file; answer that the script built it as committed).

### Phase 3: CT registration and density for the male

Needs `male-colour` and `male-ct`.

**Prompt**

```text
Read docs/phase2-plan.md: sections 1 and 2 (especially D6 and D7), Phase 3, section 5 and Appendices B and C. Carry out Phase 3 only: the CT header parser, the 2D registration maths and their tests, the register script with its overlays, and the CT density resampled into the male's grid, then rebuild male-4mm.bin. Fit the registration on the male and show me the overlays before rebuilding the file. If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing, then summarise with the per-segment scores and what to look at.
```

**The work**

- `src/volume/ctHeader.ts` (pure, tested on two real header texts pasted into the test): `parseCtHeader(text)` → `{ dfovMm, pixelMm, size, centerRAS, tablePosition, sliceThickness }`, tolerant of spacing and case (the fields are `Display Field of view - X (mm)`, `Image pixel size - X/Y`, `Image matrix size - X/Y`, `Center R/A/S coord of plane image`, `Table start location`, `Slice Thickness (mm)`); a missing DFOV is an error naming the file.
- `src/volume/similarity.ts` (pure, tested): a 2D similarity with a flip, `{ scale, rotationDeg, tx, ty, flip }`, `apply`, `invert`, `compose`, and the CT-pixel ↔ cryo-pixel conventions of Appendix B.
- `scripts/lib/images.ts`: box downsampling to 1 mm; the masks of D7 (CT bone ≥100, CT body ≥40, cryo bright-bone, cryo body via `isBodyPixel`); the overlap score (Dice on the bone masks, plus the outline Dice where the segment has no gel, detected as CT body area ≫ cryo body area); the coarse-to-fine search.
- `scripts/register.ts`, `npm run register -- --body male [--samples 8] [--preview] [--data PATH]`: groups the CT headers into geometry runs, intersects with the cryo blocks (`bodies.ts`), fits each segment on its sample slices jointly (the same transform scored on all), writes `data/male/registration.json`, and draws `.cache/preview/register/male-<slice>.png`: the cryosection at 1 mm with the CT bone mask outlined in magenta before the fit and cyan after. `--preview` redraws from the JSON without fitting. The log prints a table: segment, slices, DFOV, flip, scale, rotation, tx, ty, score.
- `build-volume.ts`: each 4 mm layer also reads its CT slices (same numbers), maps each cell centre through the segment's inverse transform to CT pixels, bilinearly samples, averages over the layer's slices, and writes `max(1, value)` where the body is; cells no CT covers (1001–1005, and any CT slice missing) keep `densityFromColor`; `--no-ct` skips it. The log counts cells from CT and from colour.
- Rebuild `male-4mm.bin`; `bodies.json` gains `density: "ct"` for the level.

**Check** The registration log shows ≈5–7 segments, the expected vertical flip on every one, scales near 1.6 (head) to 2.8 (hips), scores ≥ 0.6 on bone. In the overlays the cyan skull, vertebrae, pelvis and femora sit on the pale bone of the photograph within about 2 mm (one or two 1 mm pixels); the magenta "before" shows how far they moved. `density.png` now shows a CT-grey body: dark lungs, grey organs, white bone; the file grows by ≈0.5–1 MB. The app shows no change yet. Then `/commit Phase 3 of docs/phase2-plan.md`.

### Phase 4: the options table, the panel, the style switch, and the Volume style

**Prompt**

```text
Read docs/phase2-plan.md: sections 1 and 2 (especially D9, D10 and D13), Phase 4, section 5 and Appendix D. Carry out Phase 4 only: the declarative options table and the panel built from it, the style switch, the shared cuts module, the ray quad with its camera rays, the RGBA 3D texture, and the Volume style with its four modes, on the male. Check the quad's rays and the first 3D texture sample on both backends before building the march on them. If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing, then summarise, including what I should look at in the browser on WebGPU and with ?webgl.
```

**The work**

- `src/options.ts` and `src/Panel.tsx`, ported from PDBSplat and reduced to D9's folders and controls; `src/viewer/styles.ts` with `Style = 'splats' | 'volume' | 'surface'` and the switch in `Viewer.tsx`. `store.ts` takes its `ViewOptions` and `defaultOptions` from the table. `App.tsx` keeps the Canvas, `LoadStatus` and the credit.
- `src/viewer/cuts.ts` (pure, tested): from the bounds and the three cut fractions, the remaining box (`min`, `max` in scene mm) and the three world-space planes (normal, constant) with the semantics in Appendix D, inactive planes parked beyond the bounds.
- `src/viewer/volumeTexture.ts`: `volumeTexture(volume)` builds a `Data3DTexture` from `rgbaBytes(volume)` (RGBA8, `LinearFilter` both ways, no mipmaps, `NoColorSpace`, `needsUpdate`), memoised in a `WeakMap`, with `disposeVolumeTexture(volume)` called from `Viewer` when the volume changes or the Canvas unmounts. The grid's box in scene space (origin, extent) comes with it.
- `src/viewer/volumeMarch.ts`: the TSL march of D10 (skeleton in Appendix D, item 4), written as a `rayQuad` fragment, with uniforms for origin, extent, voxel size, `cutMin`/`cutMax`, mode (an `int` uniform switched with `select`/`If`, one shader), opacity, window, extinction, step length, max steps, tint, shading flag, density source; `show(texture, box)` swaps the texture by `node.value`.
- `src/viewer/rays.ts` (pure, tested): the camera ray for a clip-space corner (from the inverse projection and the camera's world matrix) and the slab test against a box, in plain TypeScript; the TSL in `rayQuad.ts` mirrors it line for line, and later CPU picking reuses it.
- `src/viewer/rayQuad.ts`: the shared full-screen quad (Appendix D, item 14): a `PlaneGeometry(2, 2)` mesh with `frustumCulled = false` whose material's `vertexNode` puts the corners in clip space directly; a varying carries the corner's NDC; the fragment rebuilds the world ray from `cameraProjectionMatrixInverse` and `cameraWorldMatrix`, clips it to `cutMin`/`cutMax` with the slab test, starts it at the near plane and `Discard()`s a miss. It exports `rayQuad(fragment)`, taking a TSL function of `{ origin, direction, viewDir, tEnter, tExit }`, used by the Volume style now and by the Raytrace style in Phase 5.
- `src/viewer/BodyVolume.tsx`: the quad and its `NodeMaterial` (created in the effect that owns them), the march as the quad's fragment, the cuts as uniforms only, blending per mode (`One`/`OneMinusSrcAlpha`, additive for glow), `depthWrite: false`, the options copied into uniforms in effects, and a pixel-ratio cap of 1 on the fallback through R3F's `setDpr` while this style is mounted.
- A `test/cuts.test.ts`; `densityFromColor` in TSL beside the TS one, with a note that the two must match.
- First check, in the thread: the quad's rays drawn as the cut box's entry distance (a grey ramp over the body's bounds that stays put as the camera orbits and zooms through it), then a 16³ test texture with a known pattern sampled along them, on WebGPU and with `?webgl`, before the real march.

**Check** The Style chooser shows splats / volume / raytrace / surface (the last two empty until Phases 5 and 6). Zooming the camera inside the body keeps rendering, since the quad has no inside or outside. **Volume, over**: the male as a translucent coloured body; Opacity 1 looks like a solid; Window low raised to ≈0.35 fades soft tissue and leaves the skeleton in cryo colours; the cuts slice it with exact flat faces. **X-ray**: a bright skeleton on black, ribs and pelvis distinct, lungs dark, Opacity scaling the density; **MIP** a familiar radiograph-like maximum; **glow** a soft emissive body. Both backends draw the same picture; `?webgl` on this Mac holds ≥ 15 fps at dpr 1 in over and x-ray with Quality at 1 voxel, and the frame counter recovers when the style switches back to splats. No console errors on either backend, in particular no WGSL uniformity error (the `.level(0)` sampling) and no GLSL loop compile error. Then `/commit Phase 4 of docs/phase2-plan.md`.

### Phase 5: the Raytrace style

**Prompt**

```text
Read docs/phase2-plan.md: sections 1 and 2 (especially D9, D13 and D21), Phase 5, section 5 and Appendix D. Carry out Phase 5 only: the Raytrace style on the shared ray quad: the coverage texture, the isosurface tracer with its bisection and gradient shading, the traced cut faces, the layered translucency, the Shadows switch and the depth write, on the male, checked on both backends. If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing, then summarise, including frame rates per Trace choice and what to look at in the browser on WebGPU and with ?webgl.
```

**The work**

- `src/viewer/volumeTexture.ts`: `coverageTexture(volume)`, an R8 `Data3DTexture` of the coverage block (`RedFormat`, `LinearFilter`, `unpackAlignment = 1`), memoised and disposed beside the RGBA one; and, for a volume with an `mri` block, `mriTexture(volume)` the same way (used from Phase 9).
- `src/viewer/raytrace.ts`: the TSL tracer of D21 as a `rayQuad` fragment (Appendix D, item 15): the field chosen by the Trace uniform (coverage at iso 0.5 for the skin, density at the Bone threshold for the bone, both = whichever crosses first, each hit tagged with which); the entry test that turns a hit at `tEnter` into a cut face; voxel stepping at the Quality step; five bisection steps; the gradient normal; the shading (headlight + hemisphere, a Blinn–Phong highlight, the RGBA texture's colour half a voxel inward, Rim, Depth cue); the Layers loop under 1 Opacity with front-to-back compositing; the Shadows march toward the Light direction; `depthNode` from the first hit through `viewZToPerspectiveDepth`; `Discard()` on a miss.
- `src/viewer/BodyRaytrace.tsx`: the quad and its material in their effect; `transparent = false` and `depthWrite = true` at Opacity 1 (it is an opaque surface then), `transparent = true` with the first hit's depth below it; the uniforms copied in effects; the same dpr cap on the fallback as the Volume style.
- `options.ts`: Trace (skin / bone / both, default both), Layers (1–4, default 2), Shadows (off), Light (azimuth and elevation relative to the camera, two sliders, default upper left); Bone threshold and Rim shared with the surface; `styles.ts` gains `raytrace`; `Viewer.tsx` mounts it.
- `src/viewer/rays.ts` gains the pure twin of the bisection step, tested; the tracer itself is TSL and is checked in the browser.

**Check** **Raytrace, Trace both, Opacity 1**: the male as a lit, closed skin in true colour, the same silhouette as the Volume style at Window low 0 and smooth where the mesh of Phase 6 will be faceted; **bone** alone shows the skeleton, ribs and pelvis crisp; Opacity 0.3 shows the skeleton through a single skin layer that stays correctly ordered as the camera orbits, with no flicker, and Layers 3 adds the far skin as a back shell. Axial at 0.27 opens the chest and the cut face shows the section in cryo colour with the bone bright, flush with the traced surfaces; the three cuts combine; zooming the camera inside the body still renders. Shadows on: the ribs throw shadows onto the cut face, and moving Light swings them. The depth write is checked in the thread with a temporary test mesh (a sphere half inside the body is hidden where the traced surface is nearer), on both backends. Frame rate on this Mac at dpr 1: ≥ 15 fps skin, ≥ 10 bone. No console errors on either backend. Then `/commit Phase 5 of docs/phase2-plan.md`.

### Phase 6: the Surface style

**Prompt**

```text
Read docs/phase2-plan.md: sections 1 and 2 (especially D11), Phase 6, section 5 and Appendix D. Carry out Phase 6 only: marching cubes in a worker on the loaded grid, the skin and bone meshes coloured from the 3D texture, the cuts with their caps, translucency by the depth pre-pass, and the rim, on the male. If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing, then summarise, including triangle counts and what to look at in the browser on both backends.
```

**The work**

- `src/surface/marchingCubes.ts` (pure, tested): `meshIsosurface({ field: Uint8Array, size, spacing, origin, isolevel, axes })` → `{ positions, normals, indices }` with their own buffers; the structure of `gaussianSurface.ts`'s `march()` (four-plane ring, shared edge caches, central-difference normals, Bourke tables from `three/addons/objects/MarchingCubes.js`), without owners, sharpening or the probe (the budget is the grid's). Positions come out in scene mm through the volume's axes. Test: a sphere field of radius 10 on a 32³ grid is closed (V − E + F = 2), its vertices lie within 0.6 voxels of the sphere, normals point outward.
- `src/surface/surface.worker.ts` and `surfaceWorker.ts`: PDBSplat's queue verbatim (latest wins, grace, transfer), the request carrying the field, size, spacing, origin, axes and isolevel. The skin request sends the coverage block, the bone request the density block (each ≈5 MB at 4 mm, copied once per request).
- `src/viewer/BodySurface.tsx`: two meshes, skin (`MeshStandardNodeMaterial`, roughness 0.6) and bone (same, roughness 0.4), each with `colorNode` = the volume texture sampled at `positionWorld − normalWorld × half a voxel`, decoded from sRGB; Skin and Bone switches; Bone threshold re-meshes bone only; Opacity < 1 makes the skin transparent with the depth pre-pass twin (`colorWrite: false`, `renderOrder` ahead), bone staying opaque; Back shell as PDBSplat's two extra passes; Rim as D11; `clippingPlanes` from `cuts.ts` on all four materials; hemisphere + headlight; the triangle counts to the store for the panel.
- `src/viewer/CutCaps.tsx`: one quad per active cut (D11), `MeshBasicNodeMaterial`, `DoubleSide`, `polygonOffset`, drawn after the opaque meshes and before the transparent ones; its colorNode samples the texture at `positionWorld`, discards density 0, and takes alpha 1 where density ≥ Bone else the skin's Opacity.
- `Viewer.tsx` mounts `BodySurface` + `CutCaps` for the surface style.

**Check** At 4 mm the skin meshes in under 2 s in the worker (log it) to ≈200–400 thousand triangles, the bone to ≈200–500 thousand; the body is a closed shell in true colour, the skeleton inside cream-white. Opacity 0.3 shows the skeleton through a single, non-flickering skin layer; Back shell adds the far side; Rim 0.5 at low Opacity gives the hologram look. Axial at 0.27 opens the chest and the **cap** shows the cut section in cryo colour, flush with the mesh edges, lungs dark, bone white; the three cuts combine. Both backends: the clipping works, no z-fighting at the caps, frame rate on this Mac ≥ 20 fps. Then `/commit Phase 6 of docs/phase2-plan.md`.

### Phase 7: blends and effects

**Prompt**

```text
Read docs/phase2-plan.md: sections 1 and 2 (especially D12 and D13), Phase 7, section 5 and Appendix D. Carry out Phase 7 only: the splats' Blend with the weighted blend and bloom through a render pipeline, the depth cue for every style, and the OIT switch for the surface, each checked on WebGPU and on the WebGL 2 fallback. If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing, then summarise what works on each backend.
```

**The work**

- `src/viewer/shading.ts`: the depth cue uniforms (`optionUniforms`, `cueNear`/`cueFar` from the bounds' radius), the scene `fogNode` for the meshes (PDBSplat's `ShadingUniforms` folded into `Viewer`), the cue term applied in `cellColor` and in the march per step.
- `src/viewer/weighted.ts` verbatim; `src/viewer/Effects.tsx` ported: `RenderPipeline`, the weighted blend's two targets and composite, `bloom()` with its sliders, mounted only while Blend is weighted, Bloom > 0 or OIT is on. No SSAO (D13).
- `BodySplats.tsx`: Blend glow = `AdditiveBlending` and `autoSort: false` (plus the one `updateSort` on the fallback, as PDBSplat notes), weighted = `premultipliedAlpha` + the pipeline; normal as today.
- `BodySurface.tsx`: an **OIT** switch (Scene folder, shown for the surface) that routes rendering through `oitPass(scene, camera)` in the pipeline and disables the depth pre-pass while on.
- `BodyVolume.tsx`: glow mode with Bloom reads as intended; the x-ray tint through the pipeline unchanged.

**Check** Splats: glow brightens where splats pile up and turns with no sort pops; weighted reads like an x-ray of the body without order artefacts; both with `?webgl` (if the fallback can't make the half-float MRT targets, say so: the weighted choice is then hidden on the fallback, by a capability flag in the store). Bloom 1 on glow or on the volume's glow mode haloes the body; Depth cue 0.6 darkens the far side in every style. OIT on the surface at Opacity 0.3 shows skin over bone without the pre-pass, on WebGPU with MSAA and on WebGL without; if `oitPass` fails on the fallback, the switch is hidden there and noted. Then `/commit Phase 7 of docs/phase2-plan.md`.

### Phase 8: the female

Needs `female-colour` and `female-ct` complete (check `manifest.json`).

**Prompt**

```text
Read docs/phase2-plan.md: sections 1 and 2 (especially D5, D7, D14 and D15), Phase 8, section 5 and Appendices B and C. Carry out Phase 8 only: the female's constants in bodies.ts, her slices through build-volume.ts, her CT registration, her 4 mm file, the Body chooser and the URL parameter, with the previews and overlays checked before the full builds. If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing, then summarise with counts, sizes and what to look at.
```

**The work**

- `bodies.ts`: the female: slices 1001–2730 × a/b/c in that order (`avf1001a.png`, `avf1001b.png`, `avf1001c.png`, …), 0.33 mm pixels, 0.33 mm sub-slice spacing, levels 4 mm = 12 px × 12 sub-slices, 2 mm = 6 × 6; the absent names (2328c, 2329a, 2329b, 2730c) read as missing rather than as errors; the blank 7 KB files (1492b–1497b, 1977c, 1978a, 1978b, 2100a, 2100b, 2329c, 2330a) fall to the blank rule; regions as data for the fetch only. Axes: the male's, to be confirmed on the previews.
- `build-volume.ts`: a layer may have sub-slices; `--from`/`--to` take `1500` or `1500b`; CT slices map one per number (the a/b/c share one CT slice).
- `register.ts --body female`: the fresh CT 1001–2734 at 1 mm in air, so the outline term is on everywhere; segments by header geometry only (plus any cryo block boundary the blank runs reveal). Expect flips as the male's. Check on a sample slice that the 8-bit CT scale matches D6 (air ≈0, soft tissue ≈60, bone ≥100); if it doesn't, a per-body linear map goes in `bodies.ts`.
- Build `female-4mm.bin`; `bodies.json` gains the female with 4 mm default and 2 mm optional.
- `Panel.tsx`: the **Body** chooser; `store.load` on change; `Framing` reframes; `?body=female` read at start and written with `history.replaceState` on change.

**Check** The previews first, from a `--from 1300 --to 1700` test build into `.cache`: the front view faces you, head up, the sagittal profile faces right; if she's mirrored or upside down, the female's axes change in `bodies.ts`, not the format. The full build reads 5,186 files in ≈10–20 min with sharp and logs the blanks as the list above, a grid ≈130 × 75 × 435 (her field is the male's; her height ≈1,730 numbers), ≈1.2–1.4 million body voxels, a file ≈4–5 MB. Registration scores ≥ 0.5 on bone with overlays within ≈3 mm on the spine and pelvis (soft tissue may sit a few mm off, as D7 says). In the app, Body → Female loads her in ≈1 s, every style works, the cuts show her anatomy, `?body=female` opens on her. Then `/commit Phase 8 of docs/phase2-plan.md`.

### Phase 9: the head

Needs `head-cryo`, `head-cat-dicom`, `head-mri-dicom`, `head-cryo-jpeg`.

**Prompt**

```text
Read docs/phase2-plan.md: sections 1 and 2 (especially D6, D8 and D14), Phase 9, section 5 and Appendices B and C. Carry out Phase 9 in two steps: first the orientation check (contact sheets from the head's slices) and stop so I can decide its axes and background rule; then, on my word in the same thread, the head's constants, its TIFF and DICOM decoding, the 3D registration with its overlays, the MRI channel, and the 1.2 mm file. If the plan turns out to be wrong or impossible somewhere, stop and tell me instead of improvising. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing, then summarise with the registration's score and transform and what to look at.
```

**The work**

- **Step 1, the check**: `npm run volume -- --body head --contact-sheet` writes `.cache/preview/head-sheet.png`: quarter-size JPEGs of axial slices 0001, 0300, 0600, 0740, 0900, 1200, 1477 (or the TIFFs decoded and downsampled) with their numbers, plus a histogram summary of the background colour at the corners and a note of the image size. You read it: which way is the face, which side is the subject's right, where the neck is (so k's sign), and what the embedding looks like (blue gel as the bodies, or something else). The thread then writes the head's `axes` and an `isBodyPixel` variant if the background differs (a `segmentRule` per body in `bodies.ts`, with a test).
- **Step 2**: `bodies.ts` head: slices 0001–1477 as `NNNN.tiff.gz`, 0.147 mm isotropic, 1056 × 1528, levels 1.2 mm = 8 px × 8 slices, 1 mm = 7 × 7, 0.6 mm = 4 × 4; the four interpolated slices (0172–0174, 1395) are ordinary data. `decode.ts`: gunzip + sharp TIFF. `scripts/lib/dicom.ts`: CAT and T2_512 series to `{ size, spacing, origin, orientation, frameUID, voxels: Int16Array (HU) | Uint16Array }`, sorted by position.
- `src/volume/rigid.ts` (pure, tested): a 6-DOF rigid transform `{ rotationDeg: [x, y, z], translationMm }` about a stated centre; apply, invert, compose, from PCA (centroid + axes of a mask); tested on a synthetic ellipsoid recovered after a known rotation.
- `register.ts --body head`: D8's fit against the head's built colour grid (so Step 2 builds the 1.2 mm grid without density first, registers, then rebuilds with density and MRI); overlays `.cache/preview/register/head-{axial,coronal,sagittal}.png`: the cryo mid-planes with the CAT bone outline before and after; the MRI placed by frame or by its own fit; `data/head/registration.json`.
- `build-volume.ts`: density from the CAT through D6's formula and the rigid transform (trilinear), MRI into the `mri` block (percentile-normalised 1–255 inside the body); `bodies.json` gains the head with 1.2 mm default and 1 mm, 0.6 mm optional.
- App: the **Density** choice gains "MRI" for a volume with an `mri` block (`mriTexture`, an R8 `Data3DTexture` with `unpackAlignment = 1`); the surface's Bone switch and the raytrace's Trace gain a **Brain** option on the MRI block at an MRI threshold slider.

**Check** The contact sheet makes the orientation unambiguous before anything is built. The 1.2 mm build reads 1,477 TIFFs in ≈3–5 min, grid ≈132 × 191 × 185, ≈2.8 million body voxels, file ≈9–11 MB. Registration score ≥ 0.5; in the overlays the CAT's skull outline sits on the cryo skull within ≈3 mm on all three planes, the orbits and the mandible lining up; if it's plainly off, edit `rotationDeg`/`translationMm` in the JSON, `--preview`, and rebuild. In the app the head frames to fit, the x-ray mode shows the skull, the surface's bone is the skull with sutures at 1.2 mm, Density: MRI shows the brain, Trace: brain traces its surface, and the cuts expose it. Then `/commit Phase 9 of docs/phase2-plan.md`.

### Phase 10: review, README, the opt-in levels, release

**Prompt**

```text
Read docs/phase2-plan.md in full. Carry out Phase 10 only: review the app and the scripts against the decisions and Appendix D, fix what doesn't match, remove leftovers, bring README.md up to date for the public, update the /commit skill's settings for data/ and the opt-in level files, and serve a production build to confirm every asset loads. Don't rebuild any committed volume file. Don't commit. Finish with npm run lint, npm run typecheck, npm test and npm run build passing, then summarise with a checklist for the browser and the deploy steps.
```

**The work**

- Review against D4–D14, D21 and Appendix D: every GPU object disposed on volume change and Canvas remount; no per-frame allocation; uniforms set in effects; the worker terminated on unmount; the loader's abort on body switch; no `any` or suppressions without reasons; dependencies all imported (`npm ls --depth=0`).
- README (D19): three bodies, four styles, the controls by folder, the data root and `npm run fetch` (5.7 GB male, 22 GB core, the film sets as an archive), `npm run volume` per body and spacing, `npm run register`, what's committed (the three default files and `bodies.json`) and what's built before a deploy, the LICENSE line, the credits (add Brigham and Women's / the Ratiu head as the NLM's page credits it).
- `.claude/skills/commit/SKILL.md` settings: the volume files are generated (now three plus opt-in gitignored ones), `data/*/registration.json` is generated by `npm run register` and small, `~/Data` is never in the repository.
- `npm run build`, `npm run preview`, and confirm HTTP 200 for the page, `volume/bodies.json` and the three default files.

**You**

1. Build the opt-in levels (≈20–40 min in all) and check their sizes against Appendix E:

   ```sh
   npm run volume -- --body male --spacing 2
   npm run volume -- --body female --spacing 2
   npm run volume -- --body head --spacing 1
   ```

   Try the male 2 mm in the app on this Mac: expect the volume style to slow or fail (173 MB texture on the Iris) and the panel to say the texture size; that's the opt-in warning working. Skip the head 0.6 mm unless a stronger GPU will show it.
2. Walk the agent's checklist in `npm run dev` and `npm run preview`.
3. Delete the plan, then `/commit 0.2.0 Phase 10 of docs/phase2-plan.md, removing the plan`. Merge `development` into `main`, push both, `npm ci && npm run build`, copy `dist/` to `~/Sites/localhost/live/visiblehuman/` and publish. Check the live page's Network panel: the three default files and `bodies.json` at 200, and an opt-in level only when chosen.

## 5. Risks and unknowns, each with the check that settles it early

| Risk | Where it bites | Early check and fallback |
| --- | --- | --- |
| sharp's native binary on macOS 12.7 / Node 24 x64 | Every script | Phase 1 decodes a real slice first thing. Fallback D3: pngjs + utif2 + jpeg-js in `worker_threads` |
| The mirror's `index.html` format | fetch verification | Phase 1 captures one listing before writing the parser; fallback: enumerate names from the known ranges and HEAD each for its size |
| 280 GB over days; a stalled connection | Phases 1, 8–9 | Resumable with timeouts and `.part` files; re-running resumes; the manifest says what's missing; the core run goes first and the film run never blocks a phase |
| CT header field names differ from the assumption | Phase 3 | Parse two real headers into the test before the script; fallback: DFOV per segment typed into `bodies.ts` from the research values |
| Frozen CT gel block: gel reads like soft tissue | Male hips segments | Skin never comes from CT (coverage only); registration scores bone, adding outlines only where CT body area ≈ cryo body area |
| The female's CT is of the fresh body: posture and soft tissue differ | Female density | Bone-only expectations in D7; a per-slice translation refinement smoothed along z if a segment's overlay drifts; the app's Density: colour as the escape |
| The head's orientation, background and embedding are unknown | Phase 9 | The contact-sheet step stops before any build; `axes` and `segmentRule` per body |
| The head's 3D fit lands in a wrong basin | Phase 9 | 24 PCA candidates, a score threshold, three-plane overlays, manual JSON fallback with `--preview` |
| `Data3DTexture` size on WebGL 2 (this Mac) | Volume style | 4 mm (21.6 MB) in Phase 4 on the Mac; 2 mm (173 MB) tried in Phase 10 and expected to fail or crawl: opt-in with a texture-size read-out |
| `texture3D` sampling inside a `Loop` on the GLSL backend | Phase 4 | A 16³ pattern sampled on both backends before the march; PDBSplat's field style already runs on this Mac's fallback with the same constructs |
| WGSL uniformity (derivatives in divergent loops) | Phase 4 | `.level(0)` everywhere a texture is sampled inside the loop; no `dFdx` in the march |
| Fragment depth written from the quad (`depthNode`) | Phase 5 | Checked with a test mesh on both backends; writing depth turns off early-z for that pass, so a miss discards before any work; fallback: no depth write, the raytrace style drawn last |
| Bone-only tracing through soft tissue is slow on the fallback | Phase 5 | The Quality step of 1 voxel and dpr 1 on the fallback, Trace defaulting to both (the skin stops most rays early); fallback: an empty-space skip from a coarse min/max mip of the density, listed under later in D13 |
| `oitPass` on the WebGL backend | Phase 7 | Checked both ways; the switch hides on a failing backend; the depth pre-pass is the default anyway |
| Half-float MRT for the weighted blend on WebGL 2 | Phase 7 | Checked; the blend choice hides on the fallback if the targets can't be made |
| Worker bundling with Vite | Phase 6 | PDBSplat's `new Worker(new URL('./surface.worker.ts', import.meta.url), { type: 'module' })` is proven |
| An R8 3D texture with an odd width on WebGL 2 | Head MRI | `unpackAlignment = 1` on the MRI texture (the RGBA texture needs nothing) |
| Repository growth from rebuilt binaries | Phases 2, 3, 8, 9 | Each default file is rebuilt only where the phase says; experiments go to `.cache`; ≈19 MB of binaries in all |
| `DecompressionStream` missing | Old browsers | A clear load error naming the browser; every current browser has it |
| Marching cubes memory at 2 mm (12.8 M body voxels) | Phase 10 opt-in | The worker's typed arrays double as they fill; skin ≈1 M triangles, bone ≈1.5 M at 2 mm, well under 10 M; the worker reports time |

## Appendix A: the volume file, version 2

A `.bin` file is the gzip of (header ‖ blocks); the loader also accepts the ungzipped bytes, telling them apart by the gzip magic `1f 8b`. Little-endian. Voxel (i, j, k) has index i + nx·(j + ny·k); i runs across the slice image, j down it, k along the slices from the first.

```
offset  bytes  field
 0       4     magic "VHV2"
 4       2     u16 version = 2
 6       2     u16 headerBytes = 64
 8       6     u16 × 3 size: nx, ny, nz
14      12     f32 × 3 spacing: mm between voxel centres along i, j, k (male 4 mm: 3.96, 3.96, 4)
26      12     f32 × 3 origin: the centre of voxel (0, 0, 0) in the source frame, mm: i and j from the
               slice image's top-left pixel centre, k from slice firstSlice's plane
38       2     u16 firstSlice: the first slice number the grid covers (after the crop)
40       2     u16 lastSlice
42       3     u8 × 3 axes, for scene x, y, z: bits 0–1 the source axis (0 = i, 1 = j, 2 = k), bit 7 set when
               the scene axis runs against it (male: x = i, y = −k, z = j → 0x00, 0x82, 0x01)
45       1     u8 channels: bit 0 colour (three blocks), bit 1 density, bit 2 coverage, bit 3 mri
46       1     u8 coding: 1 = every block delta-coded along i
47       1     u8 reserved, 0
48      16     body id, ASCII, zero-padded: "male", "female", "head"
64       …     the blocks, each nx·ny·nz bytes in index order, in this order for the channels present:
               G, (R − G) mod 256, (B − G) mod 256, density, coverage, mri
```

Delta coding: within a block, the byte at index n stores value[n] − value[n − 1] mod 256, except where n mod nx = 0, which stores value[n] itself; decoding is a running sum restarted at each row.

Channel meanings: **colour** is the photographs' sRGB, the mean of the cell's body pixels; outside the body (coverage < 128) it's the mean of the body neighbours within one voxel (26-neighbourhood), else 0. **density** is 0 where coverage < 128 and otherwise max(1, d), d on D6's scale from the registered CT where it covers the voxel, else `densityFromColor`. **coverage** is round(255 × body pixels / pixels). **mri** is 0 outside the body or where the MRI doesn't reach, else 1–255.

Reader checks: magic, version, header length, byte length = 64 + blocks × nx·ny·nz, channel bit 0 and bit 2 set (every file has colour and coverage), spacing > 0, axes using each source axis once.

The app's RGBA texture is R, G, B, density per voxel; the body test on the GPU is density > 0; the splat and mesh body test on the CPU is coverage ≥ 128.

## Appendix B: the JSON files

**`public/volume/bodies.json`** (committed; `build-volume.ts` updates a level's entry when it writes the file):

```json
{
  "bodies": [
    {
      "id": "male", "label": "Male", "credit": "Visible Human Male, courtesy of the U.S. National Library of Medicine",
      "levels": [
        { "id": "4mm", "label": "4 mm", "file": "volume/male-4mm.bin", "spacing": [3.96, 3.96, 4],
          "size": [142, 81, 470], "bytes": 5100000, "textureBytes": 21623760, "density": "ct", "default": true },
        { "id": "2mm", "label": "2 mm", "file": "volume/male-2mm.bin", "spacing": [1.98, 1.98, 2],
          "size": [284, 162, 940], "bytes": 39000000, "textureBytes": 172990080, "density": "ct", "optional": true }
      ]
    }
  ]
}
```

**`~/Data/VisibleHuman/manifest.json`** (written by `fetch-data.ts`):

```json
{ "root": "/Users/snovakow/Data/VisibleHuman", "checked": "2026-11-09T10:12:00Z",
  "sets": { "male-colour": { "files": 1878, "expected": 1878, "bytes": 5697231000, "missing": [], "complete": true } } }
```

**`data/<body>/registration.json`** for the male and female. The convention: a CT pixel centre (u, v), in pixels from the CT image's top-left, maps to a cryo pixel centre (x, y), in pixels from the slice image's top-left, by
x, y = scale · R(rotationDeg) · F · (u − cu, v − cv) + (tx, ty), with (cu, cv) the CT image centre (256, 256), F the flip (`none`, `vertical` negates v, `horizontal` negates u, `both`), and scale = ctPixelMm / 0.33. The build uses the inverse.

```json
{ "body": "male", "source": "frozenCT", "fitted": "2026-11-12", "cryoPixelMm": 0.33,
  "segments": [
    { "slices": [1006, 1505], "ctPixelMm": 0.5273, "dfovMm": 270, "flip": "vertical",
      "scale": 1.5980, "rotationDeg": 0.25, "tx": 1021.5, "ty": 608.0,
      "score": 0.78, "samples": [1006, 1080, 1160, 1240, 1320, 1400, 1480, 1505] } ] }
```

**`data/head/registration.json`**: cryo mm = R(rotationDeg, xyz order) · (cat mm − catCentre) + cryoCentre + translationMm, with the centres the two grids' bounding-box centres in their own frames (recorded in the file).

```json
{ "body": "head", "fitted": "2026-11-20",
  "cat": { "size": [512, 512, 463], "spacing": [0.489, 0.489, 0.5], "frameUID": "…", "centreMm": [125, 125, 115.5] },
  "mri": { "series": "T2_512", "size": [512, 512, 229], "spacing": [0.469, 0.469, 1], "sameFrameAsCat": true },
  "catToCryo": { "rotationDeg": [2.0, -1.5, 0.5], "translationMm": [1.2, -3.4, 0.8], "cryoCentreMm": [77.6, 112.3, 108.6] },
  "score": 0.71, "method": "pca+search", "manual": false }
```

## Appendix C: the sets and the bodies' quirks, for the scripts

The set table (`scripts/lib/sets.ts`), base `https://data.lhncbc.nlm.nih.gov/public/Visible-Human/`:

| id | folder(s) under the base | files | core |
| --- | --- | --- | --- |
| `male-colour` | `Male-Images/PNG_format/{head,thorax,abdomen,pelvis,thighs,legs}/a_vmNNNN.png`, first region listing the number | 1,878 (1001–2878) | yes (already present) |
| `male-ct` | `Male-Images/PNG_format/radiological/frozenCT/cvmNNNNf.png`, headers `…/frozenCTHeaders/cvmNNNNf.txt` | 1,877 + 1,877 (1006–2882) | yes |
| `male-mri` | `Male-Images/PNG_format/radiological/mri/` and `mriHeaders/`, every file listed | 1,029 + 1,029 | yes |
| `male-normal-ct` | `…/radiological/normalCT/` + `normalCTHeaders/` | 521 + 521 | no |
| `male-70mm` | `Male-Images/70mm/fullbody/NNNN.rgb.gz` | 1,878 (1001–2878; 2426–2432 empty) | no (film run) |
| `female-colour` | `Female-Images/PNG_format/{head,thorax,abdomen,pelvis,thighs,legs}/avfNNNN[abc].png` | 5,186 (1001–2730 × a/b/c, less 2328c, 2329a, 2329b, 2730c) | yes |
| `female-ct` | `Female-Images/PNG_format/radiological/normalCT/cvfNNNNf.png`, headers `…/normalCTHeaders/c_vfNNNN.txt` | 1,734 + 1,734 (1001–2734) | yes |
| `female-mri` | `Female-Images/PNG_format/radiological/mri/` + `mriHeaders/` | 986 + 985 | yes |
| `female-70mm-2k` | `Female-Images/70mm/2K_PNG-Images/` every file listed | 5,190 | no (film run) |
| `female-70mm-4k` | `Female-Images/70mm/4K_Tiff-Images/` every file listed | 5,190 | no (film run) |
| `head-cryo` | `Additional-Head-Images/cryo/tiff/NNNN.tiff.gz` | 1,477 (0001–1477) | yes |
| `head-cryo-jpeg` | `Additional-Head-Images/cryo/jpeg/quarterSize/axial/` | 1,477 | yes (proof set) |
| `head-cat` | `Additional-Head-Images/MR_CT_tiffs/CAT-tiff/N.tif.gz` | 463 | yes |
| `head-cat-dicom` | `Additional-Head-Images/MR_CT_DICOM/CAT/` | 463 | yes |
| `head-mri` | `Additional-Head-Images/MR_CT_tiffs/MRI-tiff/{PD,T1,T2,T2_512}-tiff/` | 76 × 3 + 229 | yes |
| `head-mri-dicom` | `Additional-Head-Images/MR_CT_DICOM/MRI/{PD,T1,T2,T2_512}/` | as listed (T2_512: 229) | yes |

Per body (`scripts/lib/bodies.ts`): the male as the research findings say (blanks 2424–2435; frosty 1506–1507, 2017–2020; cryo blocks 1001–1505, 1506–2016, 2017–2423, 2436–2878; levels 12 px × 4, 6 × 2, 3 × 1). The female: 0.33 mm cubic, 12 px × 12 sub-slices for 4 mm, 6 × 6 for 2 mm; the a/b/c order within a number; absent names and blank files as Phase 8 lists; her cryo blocks found from the blank runs in Phase 8. The head: 0.147 mm isotropic, 1056 × 1528, 8 px × 8 (1.18 mm), 7 × 7 (1.03 mm), 4 × 4 (0.59 mm); slices 0172–0174 and 1395 are neighbours' averages and need no special handling; the CAT 512 × 512 × 463 at 0.489 × 0.489 × 0.5 mm; T2_512 512 × 512 × 229 at 0.469 × 0.469 × 1 mm. The male and female CT PNGs are already on D6's scale; the head's DICOM HU go through (HU + 1000) / 16.

## Appendix D: TSL, WebGPU and WebGL 2 notes for this project

Beyond the setup plan's Appendix C (in git history: `git show a2bdc29:docs/setup-plan.md`), which still holds:

1. **3D textures.** `new Data3DTexture(bytes, nx, ny, nz)` with `format = RGBAFormat`, `type = UnsignedByteType`, `minFilter = magFilter = LinearFilter`, `generateMipmaps = false`, `colorSpace = NoColorSpace`, `needsUpdate = true`. Decode colour in the shader after sampling: `colorSpaceToWorking(vec4(texel.rgb, 1), SRGBColorSpace).rgb`, never the alpha. WebGL 2 stores it with `texStorage3D`, which is immutable: a new grid is a new texture swapped in by `textureNode.value = texture`, the old one disposed (PDBSplat's `field.ts`). A `RedFormat` 3D texture whose width isn't a multiple of 4 needs `unpackAlignment = 1` on WebGL 2.
2. **Sampling in a loop.** `texture3D(tex).sample(uvw).level(float(0))`: the explicit level keeps WGSL's uniformity analysis happy (no implicit derivatives inside a loop a ray may leave early) and becomes `textureLod(sampler3D, uvw, 0.0)` on GLSL. `uvw = (p − origin) / extent + half a voxel / size` for voxel-centred data.
3. **Loops.** `Loop(maxSteps, () => { If(cond, () => { Break() }) … })` with `maxSteps` a `uniform(1, 'int')` compiles to a `for` with `break` on both backends; GLSL ES 3.0 allows dynamic bounds. Keep the body free of `dFdx`/`dFdy`.
4. **The march skeleton** (`volumeMarch.ts`), per fragment of the proxy's back faces: `toFragment = positionWorld − cameraPosition`, `direction`, the slab entry against `cutMin`/`cutMax` (the three cuts already applied on the CPU to the box), the near-plane crossing, `t = max(entry, nearCrossing) + step × hash(screenCoordinate)`, then the loop: `p = cameraPosition + direction × t`; `texel` sampled as in 2; `d = texel.a × 255`; per mode: over: `σ = extinction × opacity × smoothstep(low, high, d)`, `α = 1 − exp(−σ × step)`, `rgb += colour × α × T`, `T ×= 1 − α`; x-ray: `T ×= exp(−μ(d) × step × opacity)` with `μ = k × max(0, d − 40) / 215`; MIP: `m = max(m, d)`; glow: `rgb += colour × d / 255 × step × gain`. Outputs: over → `vec4(rgb, 1 − T)`; x-ray → `vec4(tint × (1 − T), 1 − T)`; MIP → `vec4(tint × m, m)`; glow → `vec4(rgb, 0)` with additive blending. Early exit at `t > exit` or `T < 0.01`.
5. **Blending.** Over, x-ray and MIP: `CustomBlending`, `blendSrc = OneFactor`, `blendDst = OneMinusSrcAlphaFactor`, `transparent = true`, `depthWrite = false`, `side = BackSide`. Glow: `AdditiveBlending`. Splats' glow the same; weighted sets `premultipliedAlpha = true` and goes through the MRT pass.
6. **Clipping.** `material.clippingPlanes = [Plane, Plane, Plane]` in world space (or a `ClippingGroup` from `three/webgpu` holding them); the node renderer transforms them per frame itself and has no `localClippingEnabled` flag (verified in r187's `Renderer.js`), by hardware clip distances where `WEBGL_clip_cull_distance` exists and by fragment discard otherwise. A fragment is clipped where `dot(plane.normal, p) + plane.constant < 0`. Axial cut at height y0 keeps y ≤ y0: normal (0, −1, 0), constant y0; coronal at z0 keeps z ≤ z0: normal (0, 0, −1), constant z0; sagittal at x0 keeps x ≥ x0: normal (1, 0, 0), constant −x0. Changing the number of planes recompiles the material, so keep all three and park an inactive plane past the bounds.
7. **Caps.** A `PlaneGeometry` rotated into the cut plane, `DoubleSide`, `polygonOffset: true, polygonOffsetFactor: -1`, `renderOrder` between the opaque and transparent meshes; its `colorNode` samples the texture at `positionWorld` and `Discard()`s where density is 0.
8. **Fresnel rim.** `facing = abs(dot(normalView, normalize(positionView).negate()))`, `rim = pow(1 − facing, 3) × rimAmount`; add `rim × rimColour` to the colour, and under 1 Opacity use `max(opacity, rim)` as alpha through `opacityNode`.
9. **Surface materials.** `MeshStandardNodeMaterial` with `colorNode` set; `transparent` toggled with `needsUpdate = true`; the depth pre-pass twin is `MeshBasicNodeMaterial({ colorWrite: false, transparent: true })` at an earlier `renderOrder` (PDBSplat's `ProteinSurface.tsx`).
10. **Pipelines.** `RenderPipeline` from `three/webgpu` (r187; `PostProcessing` extends it) rendered from a `useFrame` at priority 1 in place of R3F's render; `pass(scene, camera, { samples: 0 })` for MRT; `oitPass(scene, camera)` takes only `transparent` + `NormalBlending` materials (the splats' material qualifies, so OIT is offered in the surface style only); MSAA only on WebGPU.
11. **Depth cue.** `scene.fogNode = fog(vec3(0), rangeFogFactor(cueNear, cueFar).mul(depthCue))` for the meshes; the splats and the march apply the same smoothstep themselves (PDBSplat's `shading.ts`).
12. **Lint patterns.** Create every three object inside the effect that owns it, keep it in a ref, dispose in the cleanup; copy options into uniforms in effects, not per frame; `useThree((s) => s.get)`; no state updates in `useFrame`.
13. **Node 24 scripts.** Erasable syntax only; `import sharp from 'sharp'`; JSON read with `JSON.parse(await readFile(…))`; streams to disk through `pipeline(Readable.fromWeb(response.body), createWriteStream(part))`; `AbortSignal.timeout`.
14. **The ray quad.** A `Mesh(new PlaneGeometry(2, 2), material)` with `frustumCulled = false` and `material.vertexNode = vec4(positionGeometry.xy, 0, 1)`, so its two triangles cover the viewport whatever the camera does; `const ndc = varying(positionGeometry.xy)`. In the fragment: `const far = cameraProjectionMatrixInverse.mul(vec4(ndc, 1, 1))`, `viewDir = normalize(far.xyz.div(far.w))` (view space, z negative), `direction = normalize(cameraWorldMatrix.mul(vec4(viewDir, 0)).xyz)`, `origin = cameraPosition`; the slab test against `cutMin`/`cutMax`, with the direction's components kept at least 1e-6 from zero, gives `tEnter`/`tExit`; `tEnter = max(tEnter, cameraNear.div(viewDir.z.negate()))` starts at the near plane; `tExit < tEnter` discards. Depth of a hit at distance t: `viewZ = t × viewDir.z`, `depthNode = viewZToPerspectiveDepth(viewZ, cameraNear, cameraFar)`. Writing depth turns off early-z for that pass on both backends, so a miss discards before any sampling. An orthographic camera would need the origin per pixel; the app has none. `QuadMesh` from `three/webgpu` is the same idea for post-processing, but it brings its own camera, so the scene's `Mesh` form is used here.
15. **Isosurface tracing.** `f(p)` is `texture3D(field).sample(uvw(p)).level(0).r` minus the iso. If `f ≥ 0` at `tEnter`, the hit is the cut face: distance `tEnter`, normal the cut plane's. Otherwise step `t += step` while `f(p) < 0` and `t < tExit` in a `Loop` with `Break`; on the first `f ≥ 0`, bisect five times between the last two samples; normal = `normalize(gradient).negate()`, the gradient by central differences one voxel apart (six samples); colour = the RGBA texture at `p − normal × half a voxel`, decoded from sRGB; shade = a hemisphere ambient + `max(0, n·l)` for the headlight at the camera + `pow(max(0, n·h), 32) × 0.3`; Rim as item 8; Depth cue as item 11. Layers: `colour += shade × α × T; T ×= 1 − α` per hit, α = Opacity for skin and 1 for bone, carrying on from `t + step` and stopping at `T < 0.01`, at bone or after Layers hits. Shadows: from `p + normal × step`, march toward the Light direction at 2-voxel steps until the cut box's exit or `f ≥ 0`, and multiply the diffuse term by 0.35 on a hit. Every sample uses `.level(0)` (item 2) and the loop bodies hold no derivatives (item 3).

## Appendix E: sizes

Measured on the committed 4 mm male (142 × 81 × 470, 1,601,613 body voxels, 29.6 % of the box): gzip of today's sparse file 4.34 MB; of a dense interleaved RGBA grid 4.97 MB; of dense planar RGB 4.51 MB; of dense planar G, R−G, B−G 3.90 MB; the same delta-coded along i **3.73 MB**; of a dense coverage byte block 0.08 MB. From these: colour ≈2.33 bytes per body voxel after compression; density (smooth CT) ≈0.5; coverage and dilation ≈0.2 together.

| Body, level | grid (cropped) | voxels | body voxels | GPU texture (RGBA) | file (gzip) |
| --- | --- | --- | --- | --- | --- |
| Male 4 mm | 142 × 81 × 470 | 5.4 M | 1.6 M | 21.6 MB | ≈5 MB |
| Male 2 mm | 284 × 162 × 940 | 43.2 M | 12.8 M | 173 MB | ≈39 MB |
| Male 2 mm bricked 8³ (a later v3) | ≈34,000 of 84,400 bricks | 17.3 M | 12.8 M | 69 MB + 0.3 MB page table | ≈39 MB |
| Male 1 mm whole | 568 × 324 × 1880 | 346 M | 102 M | 1.38 GB | out of reach; regional bricks only |
| Female 4 mm | ≈131 × 76 × 437 | 4.3 M | ≈1.3 M | 17.4 MB | ≈4.5 MB |
| Female 2 mm | ≈262 × 152 × 874 | 34.8 M | ≈10.4 M | 139 MB | ≈32 MB |
| Head 1.2 mm (8 px) | 132 × 191 × 185 | 4.7 M | ≈2.8 M | 18.7 MB | ≈10 MB (+1.4 with MRI) |
| Head 1 mm (7 px) | 151 × 218 × 211 | 6.9 M | ≈4.2 M | 27.8 MB | ≈14 MB |
| Head 0.6 mm (4 px) | 264 × 382 × 369 | 37.2 M | ≈22 M | 149 MB | ≈78 MB |
| Head 0.44 mm (3 px) | 352 × 509 × 492 | 88 M | ≈53 M | 353 MB | dense impossible; regional only |

Why dense now and bricks later: after gzip the empty space costs nothing, so bricking saves download size not at all; it saves GPU memory (69 against 173 MB at 2 mm) at the price of a page-table indirection in the fragment loop, border-aware trilinear filtering, and a second code path for the mesh and splat builders, none of which the WebGL 2 fallback on this Mac would run faster. The v2 header's channel and coding bytes leave room for a v3 whose blocks are brick atlases with a page table, for regional 1 mm (male) and 0.5 mm (head) data.

## Verification, end to end

- Every phase ends with `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` passing, and its **Check** walked in `npm run dev` on WebGPU-capable browser and with `?webgl` (this Mac).
- Data: `manifest.json` reports every core set complete; `npm run fetch -- --verify` re-checks sizes without downloading.
- Volumes: each build logs grid, body voxels, file size against Appendix E; the previews (`front`, `coronal`, `sagittal`, `density`) and the registration overlays are read by eye before any default file is committed.
- App: the three bodies load from `bodies.json`; each style renders on both backends; the cuts agree across styles (a splat cut, a volume cut, a traced cut face and a surface cap at the same slider value show the same anatomy); opt-in levels load only when chosen and say so when absent.
- Release: `npm run preview` serves every asset at 200; after the merge, the live page's Network panel shows the three default files and `bodies.json`, and the Lighthouse-style check that nothing over 10 MB loads by default.
