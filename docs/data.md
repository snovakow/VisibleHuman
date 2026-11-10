# The Visible Human data

This page describes everything the U.S. National Library of Medicine publishes of the Visible Human Project: what each set of images is, how it's laid out and numbered, what's odd about it, what VisibleHuman does with it, and what else could be done with it. It's written for someone deciding what to build from the data, with this project's local copy as the evidence. The counts and sizes of the sets this project keeps were checked against that copy and against the NLM's own listings on 2026-11-08; the sets it doesn't keep were read from the listings on 2026-11-10.

- [Where the data lives, and its terms](#where-the-data-lives-and-its-terms)
- [The project and its bodies](#the-project-and-its-bodies)
- [The local copy](#the-local-copy)
- [Every set at a glance](#every-set-at-a-glance)
- [The male](#the-male)
  - [Colour cross-sections](#male-colour-cross-sections-male-colour)
  - [Frozen CT](#male-frozen-ct-male-ct)
  - [MRI](#male-mri-male-mri)
  - [70 mm film](#male-70-mm-film-male-70mm)
- [The female](#the-female)
  - [Colour cross-sections](#female-colour-cross-sections-female-colour)
  - [CT](#female-ct-female-ct)
  - [MRI](#female-mri-female-mri)
  - [70 mm film](#female-70-mm-film-female-70mm-2k-and-female-70mm-4k)
- [The head](#the-head)
  - [Colour cross-sections](#head-colour-cross-sections-head-cryo)
  - [Small JPEGs](#head-small-jpegs-head-cryo-jpeg)
  - [CT](#head-ct-head-cat-and-head-cat-dicom)
  - [MRI](#head-mri-head-mri-and-head-mri-dicom)
- [Sets this project doesn't keep](#sets-this-project-doesnt-keep)
  - [The male's fresh CT](#the-males-fresh-ct)
  - [The male's scout CT and X-rays](#the-males-scout-ct-and-x-rays)
  - [The original compressed files](#the-original-compressed-files)
  - [The head's other JPEGs](#the-heads-other-jpegs)
  - [The sample data](#the-sample-data)
- [What VisibleHuman builds from it](#what-visiblehuman-builds-from-it)
- [What the data could support](#what-the-data-could-support)

## Where the data lives, and its terms

The NLM's [Visible Human Project page](https://www.nlm.nih.gov/research/visible/visible_human.html) describes the project, and its [data page](https://datadiscovery.nlm.nih.gov/Images/Visible-Human-Project/ux2j-9i9a/about_data) points to four folders on one file server:

- [`Male-Images`](https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Male-Images/index.html)
- [`Female-Images`](https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Female-Images/index.html)
- [`Additional-Head-Images`](https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Additional-Head-Images/index.html)
- [`Sample-Data`](https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Sample-Data/index.html)

all under `https://data.lhncbc.nlm.nih.gov/public/Visible-Human/`. Three things about that server shape whatever reads it:

- **A folder is listed by its `index.html`.** The folder's own address answers "not found"; `<folder>/index.html` is a table of names, sizes in bytes and dates, with `-` for the size of a subfolder. The fetch script reads those tables to learn what a set holds and how big each file should be.
- **A web page can't read it.** The server sends no header that would let a page on another site fetch its files, so a browser app has to be given its own copy of whatever it draws. That's why this project builds a small file for each body rather than reading the images.
- **It serves byte ranges and sends no rate limit.** An interrupted download can pick up where it stopped. The scripts here read it with at most four connections at once.

Since 2019 the data needs no licence: anyone may download it. Before that, a user signed an agreement with the NLM that stated the intended use, and about 4,000 licences were granted in 66 countries. What remains are the NLM's general [terms and conditions](https://www.nlm.nih.gov/databases/download/terms_and_conditions.html): credit the source with the words "Courtesy of the U.S. National Library of Medicine", don't suggest the NLM endorses what you make, and, if you redistribute the data or something made from it, say plainly that it may not be the NLM's most current data. The page carries that credit, and the [README](../README.md#license-and-credits) the rest.

## The project and its bodies

The Visible Human Project grew out of the NLM's long-range plan of 1986, and was run there by Michael J. Ackerman. The bodies were scanned, frozen, sectioned and photographed under contract at the University of Colorado, at what became Victor M. Spitzer's Center for Human Simulation. The male set was finished in November 1994 and the female in November 1995.

Each body was scanned by MRI, axial through the head and neck and coronal through the rest, and by CT along its whole length in axial slices. It was then set in gelatin and water and frozen, the male scanned by CT once more as frozen, and the frozen block was ground away from the crown down: a millimetre at a pass for the male, a third of a millimetre for the female. After every pass the newly bared face of the block was photographed, by a digital camera at 2048 × 1216 pixels and on 70 mm film beside it. So "cut" and "slice", the project's own words and this page's, are loose: nothing was sliced off and kept. The photographs are what remains. The film was scanned later, the male's in August 2000, at 4096 × 2700 pixels; those scans are the 70 mm sets below.

The male was a man of 39, executed in Texas in 1993, who had agreed to give his body to science; the University of Vienna questioned that consent in a 1995 letter to the Lancet. The female was a woman of 59, anonymous, whose husband asked that she take part. The NLM "thanks the man and the woman who each willed their body to science" and names neither, and neither does this page.

The bodies are as they were, not as a textbook draws them, and the departures matter to anything built on the data:

- **The male.** His forearms are darkened by the formalin that preserved them, and there's broken-down tissue where he was injected. His arms weren't laid in the standard anatomical position, so their sections run at an angle to the body's. Freezing swelled his brain a little, and the small bones of the middle ear were lost in the preparation. He has one testicle and no appendix, and his right sartorius was damaged where the femoral vein was drained.
- **The female.** She is missing fourteen small parts, the cartilage of the nose among them. Her reproductive organs aren't typical of the anatomy, and she had cardiovascular disease and diverticulitis.
- **Both, in the photographs.** Nerves look much like fat, the small vessels have collapsed, and tendons smear across the face of the block. This limits what colour alone can tell: a density read from the photographs can't separate those tissues, which is one reason VisibleHuman takes its density from the CT.

The head is a separate specimen from another laboratory: the head of a man of 72, prepared by Peter Ratiu at Brigham and Women's Hospital and Harvard Medical School under a later NLM contract, and described in a 2003 paper titled "Visible Human 2.0 – The Next Generation". It was preserved in formalin, its blood vessels were filled with araldite-F, a resin, and its CT and MRI were taken before it was frozen. It was then sectioned at 0.147 mm, about seven passes to the millimetre.

The NLM's page and this copy count the data differently. The NLM gives the male as 1,871 cross-sections and about 15 GB, and the female as 5,189 images and about 40 GB; those are sizes of the raw frames, 7.5 MB each. The male's set as published runs from 1001 to 2878, which is 1,878 files with twelve black ones among them, and as compressed PNGs it's 5.7 GB. The female's has 5,186 colour files in 16.5 GB, and her film set is numbered 1001 to 6189, which is where 5,189 comes from.

There's more Visible Human data than the NLM publishes. A third donor, Susan Potter, gave her body to the Colorado group in 2000 and was sectioned after her death in 2015; National Geographic told her story in 2018. Her data isn't among the NLM's four folders. The NLM has also long stated the aim of higher-resolution sets of parts of the body, of which the head is one.

A good deal of software has been built on the two bodies, which is some guide to what the data can carry: VOXEL-MAN's segmented atlas of 1998 and its free 3D Navigator; Touch of Life's VH Dissector; the NLM's own Insight Toolkit, written to find the boundaries of organs in data like this; Alexander Tsiaras's *Body Voyage*; a Virtual Radiography simulator that makes X-rays from the CT; Primal Pictures' anatomy software; Anatomage's dissection table, which shows the male; and the Project 12:31 light paintings. The data has corrected the textbooks too: researchers at Columbia University found from it that they had the shape of a muscle of the pelvis wrong, and the places of the bladder and the prostate.

## The local copy

The scripts read a local copy of the NLM's files, never the server, apart from the fetch script that makes the copy. It lives in `~/Data/VisibleHuman`, or in the folder named by the `VHP_DATA` environment variable or by `--data` on any script, and it's never part of this repository.

The layout is one folder for each set, named by the set's id in the tables below, holding the files under the NLM's own names. The NLM files a slice under the region of the body it shows, and a slice in two regions is listed twice; the copy keeps it once. The head's MRI comes as four series whose file names are the same, so each series has a subfolder: `head-mri/PD`, `head-mri/T1`, `head-mri/T2` and `head-mri/T2_512`, and the same under `head-mri-dicom`.

`npm run fetch` makes and maintains the copy; the [README](../README.md#source-data) has its options. It reads each folder's listing, skips files already present at the listed size, and resumes a partial download. It gives up on a request only when no bytes have arrived for a minute, however slow the download, and fetches again a file that's larger than its listing says. When it's done it writes `manifest.json` at the root of the copy: for each set, the files present and expected, their bytes, the names missing, and when it was checked. `--verify` re-checks every size against the listings without downloading, and `--verify --md5` also compares each file with the checksum the server gives for it. [`scripts/lib/sets.ts`](../scripts/lib/sets.ts) is the one table of the sets, with the NLM folders each comes from and the number of files it should hold.

The copy this page was checked against was first filled by a shell script kept in the data root itself, before the fetch script existed, and then verified by the fetch script: every name and size against the listings, every image opened, every `.gz` file decompressed whole.

## Every set at a glance

Sizes are the sum of the files' bytes, in decimal units, so they match the listings rather than the disk's blocks. "Core" sets are fetched by default; "film" sets only with `--set all`.

| Set | What it is | Files | Bytes | Size | Kept |
| --- | --- | ---: | ---: | ---: | --- |
| `male-colour` | Male colour cross-sections, PNG | 1,878 | 5,697,384,876 | 5.70 GB | core |
| `male-ct` | Male frozen CT, PNG and header texts | 3,754 | 496,458,796 | 496 MB | core |
| `male-mri` | Male MRI, PNG and header texts | 2,058 | 80,587,857 | 81 MB | core |
| `female-colour` | Female colour cross-sections, PNG | 5,186 | 16,452,622,136 | 16.45 GB | core |
| `female-ct` | Female CT, PNG and header texts | 3,468 | 442,483,084 | 442 MB | core |
| `female-mri` | Female MRI, PNG and header texts | 1,971 | 74,486,963 | 74 MB | core |
| `head-cryo` | Head colour cross-sections, gzipped TIFF | 1,477 | 4,279,154,546 | 4.28 GB | core |
| `head-cryo-jpeg` | The same as quarter-size JPEGs | 1,477 | 25,906,995 | 26 MB | core |
| `head-cat` | Head CT, gzipped 8-bit TIFF | 463 | 54,460,889 | 54 MB | core |
| `head-cat-dicom` | Head CT, gzipped DICOM | 463 | 114,802,343 | 115 MB | core |
| `head-mri/PD` | Head MRI, proton density, gzipped 8-bit TIFF | 76 | 2,703,210 | 2.7 MB | core |
| `head-mri/T1` | Head MRI, T1 | 76 | 2,709,432 | 2.7 MB | core |
| `head-mri/T2` | Head MRI, T2 | 76 | 2,890,227 | 2.9 MB | core |
| `head-mri/T2_512` | Head MRI, T2 at 512 × 512 | 229 | 28,389,081 | 28 MB | core |
| `head-mri-dicom/PD` | Head MRI, proton density, gzipped DICOM | 76 | 4,779,560 | 4.8 MB | core |
| `head-mri-dicom/T1` | Head MRI, T1 | 76 | 4,692,967 | 4.7 MB | core |
| `head-mri-dicom/T2` | Head MRI, T2 | 76 | 4,557,056 | 4.6 MB | core |
| `head-mri-dicom/T2_512` | Head MRI, T2 at 512 × 512 | 229 | 53,168,112 | 53 MB | core |
| `male-70mm` | Male film scans, gzipped raw RGB | 1,878 | 40,243,656,079 | 40.2 GB | film |
| `female-70mm-2k` | Female film scans, PNG | 5,190 | 24,864,974,310 | 24.9 GB | film |
| `female-70mm-4k` | Female film scans, TIFF | 5,190 | 195,231,524,000 | 195.2 GB | film |
| **All 21** | | **35,367** | **288,162,392,519** | **288.2 GB** | |

The eighteen core sets are 23,109 files and 27.8 GB; the three film sets are 12,258 files and 260.3 GB. All 21 were complete when checked on 2026-11-08.

Not kept, and described [further down](#sets-this-project-doesnt-keep):

| Set | NLM folder | Files | Size |
| --- | --- | ---: | ---: |
| Male fresh CT, PNG and headers | `Male-Images/PNG_format/radiological/normalCT`, `normalCTHeaders` | 521 + 521 | 117 MB |
| Male scout CT, PNG | `Male-Images/PNG_format/radiological/scoutCT` | 4 | 1.5 MB |
| Male X-rays, PNG, 8 and 14 bit | `Male-Images/PNG_format/radiological/xray8`, `xray14` | 15 + 15 | 40 MB |
| Male colour, original raw files | `Male-Images/Fullcolor` | 1,878 | 7.9 GB |
| Female colour, original raw files | `Female-Images/Fullcolor` | 5,186 | 22.8 GB |
| Male CT, MRI, scouts and X-rays, original files | `Male-Images/radiological` | about 6,900 | 0.8 GB |
| Female CT and MRI, original files | `Female-Images/radiological` | about 5,400 | 0.6 GB |
| Head JPEGs: full and half size, and the coronal and sagittal reformats | `Additional-Head-Images/cryo/jpeg` | 10,039 | 0.87 GB |
| Sample data | `Sample-Data` | 6 | 0.6 MB |

## The male

A whole body, 1,878 mm from the crown of the head to the soles of the feet, numbered a millimetre at a time from 1001 at the crown to 2878. The same numbers run through the photographs, the film and the frozen CT, so a number names one plane of the body in all three.

### Male colour cross-sections (`male-colour`)

**What it is.** The digital camera's photograph of the block's face after each pass: the body's true colour in cross-section, one slice a millimetre. This is the set VisibleHuman draws the male from.

**Where and how it's named.** `Male-Images/PNG_format/<region>/a_vmNNNN.png`, in six region folders that overlap: head 1001–1377, thorax 1280–1688, abdomen 1455–1997, pelvis 1732–2028, thighs 1732–2411, legs 2265–2878. A slice in two regions is the same file in both.

**Geometry.** 1,878 files, 1001 to 2878. Each is 2048 × 1216 pixels, 8-bit RGB (checked on `a_vm1500.png`), at 0.33 mm a pixel, so the frame covers about 676 × 401 mm. The camera and the block were fixed, so the slices are aligned with one another as photographed. The top of the image is the body's back, and the image's left is the body's right. Around the body the frame shows the blue gel of the block, a grey scale card, a ruler and number tags.

**Size.** 5.70 GB; a slice averages 3.0 MB.

**Quirks.**

- **Four frozen blocks.** The body was cut into four blocks before sectioning: 1001–1505, 1506–2016, 2017–2423 and 2436–2878. The colour of the photographs steps where one block meets the next: the body's mean brightness changes by 5 to 11 % across each join, against about 1 % between neighbouring 4 mm layers inside a block. The grey card beside the body doesn't explain the steps: across two of the joins the card reads brighter where the body reads darker. The card's white patch is clipped at the scan's white point, so it can't serve as a reference; the next patch but one is the first that no channel clips.
- **Black slices.** 2424 to 2435, between the thighs' block and the legs', are black frames, 7,404 bytes each.
- **Frost.** The first and last slices of a block lie under frost, which is pale and blue-green and hides the tissue. 1505 and 2017–2020 show so little body that they read as nearly empty; 1506 and 2016 show a body tinted blue; 2021–2024 are a little dim. 1505 is also discoloured.
- **A colour card at the legs.** Slices 2436 to 2443 carry a card of white and coloured patches beside the legs, brighter than the grey card.
- **The arms.** They lie at an angle across the frame, as the section on the bodies says, and the forearms are dark.

**Limits.** The pixel is a third of a millimetre but the slices are a millimetre apart, so the finest cubic voxel the set gives is 1 mm; finer than that across the slice, the voxels are three times as tall as wide. The colour tells bone from soft tissue poorly: in the photographs bone is cream, not white, and close in colour to pale fat.

**Used here for** the male's colour, the outline of his body, and his density wherever the CT doesn't reach.

### Male frozen CT (`male-ct`)

**What it is.** The CT taken of the frozen blocks before they were sectioned, one slice a millimetre, numbered like the photographs. It shows what the X-rays met: bone bright, air black, and the soft tissues in between.

**Where and how it's named.** `Male-Images/PNG_format/radiological/frozenCT/cvmNNNNf.png` for the images, and `frozenCTHeaders/cvmNNNNf.txt` for a text dump of each image's scanner header.

**Geometry.** 1,877 images and 1,877 headers, 1006 to 2882: the first five photographs have no CT, and the CT runs four slices past the last. Each image is 512 × 512, one channel, 16 bits (checked on `cvm1125f.png` and `cvm1945f.png`). The value is the scanner's number plus 1024, so 0 stands for −1024 Hounsfield units, air; soft tissue is near 1024 and dense bone runs past 2000. The front of the body is at the top of the image, the reverse of the photographs.

The field of view changes along the body, and with it the size of a pixel: 270 mm (0.527 mm a pixel) for 231 slices of the head and neck, 400 mm (0.781 mm) for 24 at the shoulders, and 480 mm (0.9375 mm) for the other 1,622. The header gives it for each slice, with the centre of the image, the table's position and the slice's thickness, 1 mm. Counting the changes of block, the slices fall into eight runs of one geometry, and each run has to be placed on the photographs on its own.

**Size.** 496 MB.

**Quirks.**

- The headers are text with a few stray control bytes among it, so they're read as Latin-1 with the control characters removed.
- The reconstruction is a circle 480 mm across at its widest, and the arms pass outside it: about 3 % of the body's volume, at the outer edges of the arms, has no CT.
- The scanner's table shows under the body, and the rim of the reconstruction circle reads as bone where the arms touch it.
- The headers date the scan to 29 August 1993, at the University Hospital in Denver.

**Limits.** At a millimetre a slice and up to 0.94 mm a pixel it's coarser across the slice than the photographs. It separates bone, air and soft tissue well and the soft tissues from one another hardly at all.

**Used here for** the male's density: `npm run register -- --body male` fits each run of the CT onto the photographs, and the volume script resamples it into the body's grid. About 97 % of the male's voxels take their density from it.

### Male MRI (`male-mri`)

**What it is.** The MRI taken of the body before it was frozen: axial slices through the head and neck, and coronal slices, front to back, through the rest of the body in overlapping sections, each position imaged three ways.

**Where and how it's named.** `Male-Images/PNG_format/radiological/mri/mvmNNNN<s>.png` and `mriHeaders/mvmNNNN<s>.txt`, where `<s>` is `1`, `p` or `t` for the three images of a position, or `l` for a locating image.

**Geometry.** 1,029 images and 1,029 headers. Each image is 256 × 256, one channel, 16 bits (checked on the three images of 1005).

- **1005 to 1165, every fifth number:** 33 axial slices of the head, 4 mm thick with 1 mm between them, 260 mm across (1.016 mm a pixel).
- **3392 to 7625:** five groups of coronal slices, every fourth or fifth number, covering the body from the neck down in sections, 4 mm thick; the one read here is 300 mm across (1.17 mm a pixel).
- **2001 to 2012, 3001 to 3010 and the like at the start of each thousand:** sagittal images, most of them views for planning the scan, 56 in all.

**Size.** 81 MB.

**Quirks.** The three suffixes don't mean what they suggest. By the headers read here, at 1005 and 3400, the `p` image is the proton-density echo (echo time 17 ms), the `1` image is the T2-weighted echo of the same scan (102 ms), and the `t` image is the T1-weighted one (repetition time 0.5 s). The headers date the scan to 5 August 1993, on a 1.5 tesla magnet.

**Limits.** It's sparse: a slice every 5 mm in the head, and coronal sections elsewhere that don't share the photographs' planes. The body wasn't yet frozen, so it doesn't lie as it does in the photographs.

**Used here for** nothing. It's kept and recorded in the manifest.

### Male 70 mm film (`male-70mm`)

**What it is.** The film photograph of each face, scanned in 2000: the same 1,878 planes as the camera's set at more than twice the detail.

**Where and how it's named.** `Male-Images/70mm/fullbody/NNNN.rgb.gz`.

**Geometry.** 1,878 files, 1001 to 2878. Each unpacks to 33,177,600 bytes: 4096 × 2700 pixels of 8-bit RGB, interleaved, with no header at all (checked on `1500.rgb.gz`). The NLM's note beside them gives the pixel as 0.144 mm.

**Size.** 40.2 GB compressed.

**Quirks.** The same note calls the set "unaligned image data": each frame was scanned on its own, so the body shifts and turns a little from one frame to the next, where the camera's pictures line up. 2426 to 2432 are empty files of 29 bytes.

**Limits.** Without alignment the frames can't be stacked into a volume as they are, and with no header a reader has to know the size.

**Used here for** nothing: it's an archive, fetched only with `--set all`.

## The female

A whole body, 1,730 mm long, numbered from 1001 at the crown to 2730. She was sectioned three times as finely as the male, so each number has three photographs, lettered `a`, `b` and `c` from the top down.

### Female colour cross-sections (`female-colour`)

**What it is.** The camera's photograph of every face of the block, three to the millimetre: the finest aligned set of a whole body in the project, with voxels that are cubes a third of a millimetre on a side.

**Where and how it's named.** `Female-Images/PNG_format/<region>/avfNNNN<a|b|c>.png`, in six overlapping regions: head 1001–1285, thorax 1262–1488, abdomen 1432–1909, pelvis 1703–1953, thighs 1703–2300, legs 2200–2730.

**Geometry.** 5,186 files. Each is 2048 × 1216, 8-bit RGB (checked on `avf1500b.png`), 0.33 mm a pixel, laid out as the male's: the body's back at the top, its right at the image's left. The three photographs of a number are a third of a millimetre apart: her CT steps a millimetre a number, so a number spans a millimetre.

**Size.** 16.45 GB; a photograph averages 3.2 MB.

**Quirks.**

- **Four frozen blocks:** 1001–1492, 1497–1977, 1978–2328 and 2330–2730. Each new block starts a new run of numbers on the tags in the frame.
- **Black frames between the blocks:** 1492b to 1497b (16 files), 1977c, 1978a and 1978b, and 2329c and 2330a, each 7,404 bytes.
- **Names the set doesn't have:** 2328c, 2329a, 2329b and 2730c. That's why 1,730 numbers make 5,186 files and not 5,190.
- **Two empty files:** `avf2100a.png` and `avf2100b.png` have no bytes on the NLM's server itself, in the middle of a block. They can't be decoded, so 2100 has only its `c` photograph.
- **Frost, deeper than the male's.** About 4 mm either side of each run of black frames, a dozen photographs, lies under frost. Before a face the body's pixels thin out and turn blue over 1489a–1492a and 1976a–1977b; after it they recover over 1497c–1499b, 1978c–1980c and 2330b–2332a. Read as tissue, the frost drew cyan lines across the body.
- **A step in colour between blocks,** as on the male: about 13 % in the skin's brightness across 1492/1497.

**Limits.** At full resolution the set is far beyond a browser: the body alone is over 2 billion voxels. The colour has the male's blindness to bone.

**Used here for** the female's colour, outline and, where her CT doesn't reach, density.

### Female CT (`female-ct`)

**What it is.** A CT of the whole body, one slice a millimetre, numbered like the photographs. Unlike the male's it was taken before the body was frozen, lying in air, so her posture and soft tissue differ a little from the photographs'.

**Where and how it's named.** `Female-Images/PNG_format/radiological/normalCT/cvfNNNNf.png`, with headers at `normalCTHeaders/c_vfNNNN.txt`. The two are named differently.

**Geometry.** 1,734 images and 1,734 headers, 1001 to 2734, complete. 512 × 512, one channel, 16 bits, the scanner's number plus 1024 as the male's (checked on `cvf1500f.png`). The front of the body is at the top. Fields of view: 250 mm (0.488 mm a pixel) for 209 slices of the head, 370 mm (0.723 mm) for 639, 440 mm (0.859 mm) for 22 at the shoulders, and 480 mm (0.9375 mm) for 864.

**Size.** 442 MB.

**Quirks.** It's two scans: the headers call them exams 370 and 371, taken some five hours apart on 22 September 1993, the first head first and the second feet first. One CT slice serves a number's three photographs.

**Limits.** Because the body moved between the CT and the freezing, the CT's bone lands on the photographs' bone within a few millimetres at best, and its soft tissue less well. Near the crown the CT's outline runs up to 10 mm outside the scalp on one side.

**Used here for** the female's density, fitted in eleven runs. One run, the shoulders at 1228–1249, is placed by hand, and marked so in the file so that a refit keeps it: its fit put the arms on bone but left the spine 12 mm off. About 98 % of her voxels take their density from the CT.

### Female MRI (`female-mri`)

**What it is.** As the male's: axial through the head, coronal through the rest, three images a position.

**Where and how it's named.** `Female-Images/PNG_format/radiological/mri/mvfNNNN<s>.png` and `mriHeaders/mvfNNNN<s>.txt`, with the male's suffixes.

**Geometry.** 986 images and 985 headers; 256 × 256, 16 bits (checked on the three images of 1014). The axial head slices are 1014 to 1174, every fifth number, 33 of them, 4 mm thick, 220 mm across; the coronal groups run from 3383 to 7584, and there are 62 locating images.

**Size.** 74 MB.

**Quirks.** One image, `mvf74722.png`, has no header and a suffix of its own. The `1` suffix has 293 images where `p` and `t` have 315. The headers date the scan to 21 September 1993.

**Limits.** The male's: sparse, and of the body before it was frozen.

**Used here for** nothing. It's kept and recorded.

### Female 70 mm film (`female-70mm-2k` and `female-70mm-4k`)

**What it is.** The film photographs of her sections, scanned, at two sizes.

**Where and how it's named.** `Female-Images/70mm/2K_PNG-Images/NNNN.png` and `Female-Images/70mm/4K_Tiff-Images/NNNN.tif`. The frames are numbered on their own, 1001 to 6189, one for each photograph in order rather than by slice number and letter, with one extra frame named `1713b` in each set.

**Geometry.** 5,190 files in each set. The 2K frames are 2048 × 1530, 8-bit RGB PNGs (checked on `3000.png`); the 4K frames are 4096 × 3061, 8-bit RGB TIFFs, uncompressed, 37.6 MB each (checked on `3000.tif`).

**Size.** 24.9 GB and 195.2 GB.

**Quirks.** 25 frames are black, 9,227 bytes each in the 2K set: 2474–2490, 3931–3933 and 4984–4988. They fall where the camera's set has its black frames and its missing names, 1492a–1497b, 1977c–1978b and 2328c–2330a, counting three frames to a number from 1001, so frame 1001 + 3 × (number − 1001) is a number's `a` photograph and the next two its `b` and `c`. The film has one black frame more than the camera at the first run, 1492a.

**Limits.** The NLM says of the male's film that it's unaligned, and nothing suggests the female's differs.

**Used here for** nothing: an archive, fetched only with `--set all`.

## The head

A head on its own, 217 mm from the crown to the throat, numbered from 0001 at the crown to 1477.

### Head colour cross-sections (`head-cryo`)

**What it is.** The photograph of each face of the block, 0.147 mm apart: the finest set here, with cubic voxels about a seventh of a millimetre on a side.

**Where and how it's named.** `Additional-Head-Images/cryo/tiff/NNNN.tiff.gz`.

**Geometry.** 1,477 gzipped TIFFs. Each is 1056 × 1528, 8-bit RGB (checked on `0700.tiff.gz`), 0.147 mm a pixel, so the frame is about 155 × 225 mm. The face is at the top of the image, the reverse of the bodies', and the subject's right is at the image's right. The photographs alone don't settle left from right; the CT does, whose scanner records it: the frontal sinuses, the larger on the subject's left, lie on the photographs only this way round.

**Size.** 4.28 GB; a slice unpacks to 4.9 MB.

**Quirks.**

- **Ice, not gel.** The head is set in ice: white frost over the crown and grey ice below. A rule that looks for blue gel finds nothing, and the ice can't be told from tissue by brightness, since the frost's cast grows with its brightness. The fixed tissue is pale too.
- **Replaced slices.** The NLM's note says 0172, 0173 and 0174 were lost and replaced by averages of 0171 and 0175, and 1395 by the average of its neighbours.
- **One taller slice.** 0293 is 1056 × 1529: it has an extra row, a copy of its first.
- **Frost.** Slices 500 to 508 lie under a film of frost.
- **The frame is narrower than the head.** The subject's right side passes out of the frame over slices 233 to 1288 and the left over 353 to 1216, and the tip of the nose and the back of the head touch its top and bottom.
- **A shadow.** The last 32 pixels of each row lie in the shadow of the block's holder, dark and a little red, which reads as tissue.
- **Closed sutures.** The joins between the bones of the skull have fused in this subject, as the CT shows, so no rendering can show them.

**Limits.** At full resolution the head is about 1.4 billion voxels. The fixing has bleached the tissue, so its colours are paler than the bodies'.

**Used here for** the head's colour and outline.

### Head small JPEGs (`head-cryo-jpeg`)

**What it is.** Every slice again as a JPEG a quarter the size, which the NLM offers "for illustration purposes only".

**Where and how it's named.** `Additional-Head-Images/cryo/jpeg/quarterSize/axial/NNNN.04.jpg`.

**Geometry.** 1,477 files, 264 × 382 pixels (checked on `0700.04.jpg`).

**Size.** 26 MB.

**Used here for** a contact sheet: `npm run volume -- --body head --contact-sheet` draws a few of them side by side, which is how the head's orientation and its ice were first read.

### Head CT (`head-cat` and `head-cat-dicom`)

**What it is.** A CT of the head taken before it was frozen, twice over: as 8-bit TIFF pictures, and as the scanner's DICOM files with their full values and geometry.

**Where and how it's named.** `Additional-Head-Images/MR_CT_tiffs/CAT-tiff/N.tif.gz`, numbered 1 to 463 without padding, and `Additional-Head-Images/MR_CT_DICOM/CAT/J.NNN.gz`, 001 to 463.

**Geometry.** 463 files in each. 512 × 512, at 0.489 mm a pixel, so 250 mm across. The TIFFs are one channel of 8 bits, already windowed for viewing (checked on `200.tif.gz`). The DICOM files hold 12-bit values in 16 (checked on `J.200.gz`), with the scanner's frame: the head lay face up, head first, with the image's axes along the patient's. The slices lie half a millimetre apart, on a lattice of 466 positions of which three near the crown have no file.

**Size.** 54 MB and 115 MB.

**Quirks.**

- **The values are half of Hounsfield units.** The files state a rescale of 1 and −1200, and by it air beside the head reads −490, fat about −45, the skull's bone about 950 and the teeth's enamel 1,065 to 1,365, where air is −1000 and fat about −100. Doubled, they agree with the usual scale.
- **Thickness.** The NLM's note gives the slices as 0.5 mm thick with no gap; the DICOM header states a thickness of 1.5 mm at a spacing of 0.5 mm.
- The DICOM files date the scan to 5 April 2002.

**Limits.** The TIFFs have lost the values, so only the DICOM set gives a density.

**Used here for** the head's density, from the DICOM set: `npm run register -- --body head` fits it onto the head's grid with one turn and shift. The TIFF set is kept and unused.

### Head MRI (`head-mri` and `head-mri-dicom`)

**What it is.** Four MRI series of the head before it was frozen, each as TIFF pictures and as DICOM files: proton density (`PD`), T1, T2, and a finer T2 (`T2_512`).

**Where and how it's named.** `Additional-Head-Images/MR_CT_tiffs/MRI-tiff/<series>-tiff/N.tif.gz` and `Additional-Head-Images/MR_CT_DICOM/MRI/<series>/I.NNN.gz`.

**Geometry.** `PD`, `T1` and `T2` are 76 slices each, 256 × 256 at 0.9375 mm a pixel, 3 mm apart. `T2_512` is 229 slices, 512 × 512 at 0.469 mm, 1 mm apart; its header states a thickness of 2 mm, so its slices overlap. The TIFFs are 8-bit (checked on slice 20 of each); the DICOM files hold 12-bit values. All four share one frame, tilted a few degrees from the scanner's axes, and it isn't the CT's frame: the two scanners give different identifiers, so the MRI has to be fitted to the CT rather than placed by its header.

**Size.** 37 MB of TIFFs and 67 MB of DICOM.

**Quirks.** The DICOM files date the scans to 4 April 2002, the day before the CT.

**Limits.** The three coarser series are 3 mm apart, far coarser than the photographs.

**Used here for** the head's MRI channel, from the `T2_512` DICOM series alone, placed on the CT by the mutual information of their values. It tells the brain from the skull, which the CT's density can't. `PD`, `T1`, `T2` and all the TIFFs are kept and unused.

## Sets this project doesn't keep

### The male's fresh CT

`Male-Images/PNG_format/radiological/normalCT/cvmNNNNf.png` with headers in `normalCTHeaders`: 521 images and 521 headers, 109 MB and 9 MB. A CT of the male before he was frozen, lying in air, from 1012 to 2893 at uneven steps: a millimetre through the head, 3 or 5 mm below it, and nothing at all between 2263 and 2688, most of the legs. Its field of view is 345 mm at the head (0.674 mm a pixel) and 460 mm at the chest, and its headers date it to 5 August 1993, the day of the MRI. It isn't kept because the frozen CT is complete at a millimetre and is of the body as it was photographed. It would be the set to compare with the frozen one, to see what freezing moved.

### The male's scout CT and X-rays

`Male-Images/PNG_format/radiological/scoutCT` holds four scout images, the long low-resolution views a CT takes to plan a scan, 1.5 MB. `xray8` and `xray14` each hold the same 15 digitised radiographs of the male, at 8 and at 14 bits, 10 MB and 30 MB. None is kept: they're single projections, not slices. They'd serve as a check on an X-ray simulated from the CT. The female has neither.

### The original compressed files

Each PNG set above was converted by the NLM from older files that are still there:

- `Male-Images/Fullcolor` and `Female-Images/Fullcolor`: the colour cross-sections as raw frames packed with the Unix `compress` tool (`a_vmNNNN.raw.Z`, `avfNNNN<a|b|c>.raw.Z`), by region and again whole under `fullbody`: 1,878 files and 7.9 GB for the male, 5,186 files and 22.8 GB for the female.
- `Male-Images/radiological` and `Female-Images/radiological`: the CT and MRI in the scanner's own format (`c_vmNNNN.fro.Z` for the frozen CT, `.fre.Z` for the fresh, `m_vmNNNN.pd.Z`, `.t1.Z` and `.t2.Z` for the MRI), with their headers as text.

They aren't kept because the PNG copies hold the same pixels, 16 bits deep where the scanner's were, and Node has no reader for `compress`. The MRI's original names say which image is which weighting, which the PNG names' suffixes don't.

### The head's other JPEGs

Beside the quarter-size axial JPEGs that are kept, `Additional-Head-Images/cryo/jpeg` has the axial slices at full and half size, and the head cut the other two ways, coronal (1,528 images) and sagittal (about 830), reformatted from the stack at each of the three sizes: 10,039 files and 0.87 GB in all. The half-size ones are gzipped. They're for looking at, and the TIFFs hold everything in them.

### The sample data

`Sample-Data` holds six small zip files of the male's MRI, one for each region of the body, 0.6 MB together. They're a taste of the format and hold nothing the full set lacks.

## What VisibleHuman builds from it

The page can't hold any of this, so [`npm run volume`](../README.md#the-volume-file) averages each body into a grid of blocks and writes one small file for it, with each block's colour, how much of it is body, and its density from the CT; the head's also carries its MRI. The files as committed:

| Body | Block | Grid | Blocks of body | File | Built from | Time to build |
| --- | --- | --- | ---: | ---: | --- | --- |
| Male | 3.96 × 3.96 × 4 mm | 144 × 83 × 472 | 1,601,866 | 5.67 MB | 1,878 photographs, 1,873 CT slices | about 6 minutes |
| Female | 3.96 × 3.96 × 4 mm | 136 × 75 × 435 | 1,281,284 | 4.56 MB | 5,186 photographs, 1,730 CT slices | about 15 minutes |
| Head | 1.176 mm cubes | 130 × 193 × 187 | 2,778,775 | 10.77 MB | 1,477 photographs, the CT and the T2 MRI | about 5 minutes |

The times are on a 2014 Intel Mac. Finer levels can be built and aren't committed: 2 mm for the male and the female, each about eight times the blocks, and 1 mm and 0.6 mm for the head.

What the build does with the quirks above:

- **The body is told from its surroundings by colour.** For the two bodies, a pixel is body unless it's blue like the gel, dark like the frame, or grey like the card and tags; then the largest connected piece is kept. For the head, a pixel is tissue if it isn't dark and its colour channels differ by enough, as a share of the brightest, to rule out ice; tissue too pale for that rule, where the head encloses it, is filled back in.
- **Black, empty and absent slices are skipped,** and so are slices that show much less body than those around them, which is how frost at a block's face first shows.
- **Frosted slices are skipped too.** Within 8 mm of a block's face, a slice whose body is more than a tenth bluer than the slices further in is read as missing. A layer that keeps fewer than half its slices is filled from the layers either side, its colour blended between them.
- **The steps between blocks are left as photographed.** The script measures each one against the grey card and reports it, and `--match` will even them out on request.
- **The CT is placed on the photographs by a fit,** saved in [`data/`](../data): one run of slices at a time for the bodies, each a shift, a small turn and a flip at the scale the header gives; the head's whole CT at once, by a turn and a shift in three dimensions.
- **Density is on one scale for all three:** Hounsfield units plus 1000, over 16, so air is 0, soft tissue about 63 and bone from about 110 up.

## What the data could support

None of this is built here; it's what the sets would bear.

- **The film at full detail.** The male's 70 mm scans have 0.144 mm pixels against the camera's 0.33 mm, and the female's 4K scans twice the camera's pixels each way. They're unaligned, but every frame shows the same block, card and tags as the camera's picture of that face, which is aligned. Registering each film frame to its camera picture would give a body at more than twice the detail across each slice.
- **Regions at full resolution.** A whole body at 1 mm is some hundred million voxels of body, too much for a browser as one texture; a region isn't. The female's cubic 0.33 mm voxels would give a hand, a knee or the heart at a detail no whole-body file can, and the head's 0.147 mm the eye or the inner ear. That wants a file of bricks, loaded as the view needs them.
- **The scans as themselves.** The CTs are drawn here only as a density at the photographs' grid. Each could be a volume in its own right, at its own half-millimetre pixels, and its own slice could be shown on a cut face beside the photograph's, which would also show the registration by eye. The head's CT at 1 mm is small enough to try first.
- **Fresh against frozen.** The male has a CT from before freezing and one after. Fitting one to the other would measure how freezing and the gel moved the body, and the female's fresh CT against her photographs asks the same question.
- **The body MRIs.** The coronal series of both bodies are untouched. They'd need placing on the photographs across a change of posture, with no shared planes, but they show soft tissue the CT can't.
- **The head's other MRI series.** PD, T1 and T2 share the T2_512's frame, so the fit already made places them. Together the three weightings separate grey matter, white matter and fluid better than any one does.
- **Segmentation.** The NLM's data has no labels: nothing says which voxel is liver. The colour, the CT's density and, for the head, the MRI are three independent readings of each voxel, which is a start for telling tissues apart, bearing in mind what the photographs can't distinguish.
- **Simulated X-rays, checked.** The male's digitised radiographs and scout images are real projections of the same body the CT describes, so an X-ray computed from the CT can be compared with one.
- **The colour between blocks.** The grey card can't settle the steps in colour between the frozen blocks, and the body's own colour mixes anatomy with exposure. A calibration that used the unclipped patches of the card, and the colour card at the legs, across all slices might.
