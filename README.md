# VisibleHuman

**TypeScript + React + three.js + React Three Fiber + Vite + WebGPU**

VisibleHuman is a browser app, now being set up, for rendering the [Visible Human Project](https://www.nlm.nih.gov/research/visible/visible_human.html)'s male body as Gaussian splats. The project photographed a body in cross-sections a millimetre apart, from the top of the head to the soles of the feet. Stacked back up, those photographs make a volume in true colour, and each small block of it becomes a soft blob of that colour at its place in the body. The body can then be turned in 3D and cut open along any of the three anatomical planes. The splats are drawn by three.js's own WebGPU-based Gaussian splat rendering.

## Status

The viewer runs, with a stand-in for the body: a box-shaped cloud of coloured splats, about the body's size, which can be turned and zoomed. It renders with WebGPU where the browser and the GPU can run it, and with WebGL 2 otherwise; adding `?webgl` to the address forces WebGL 2. A script now builds the body's volume from the photographs, but there's no body on screen yet. The [setup plan](docs/setup-plan.md) lays out the steps still to come, from the first body on screen to the first deploy.

## Running it locally

You'll need [Node.js](https://nodejs.org) 22.12 or later, which Vite 8 and drei's camera controls need. Then, in a clone of this repository:

```sh
npm install
npm run dev
```

and open the address it prints.

## Stack

| | |
| --- | --- |
| [TypeScript](https://www.typescriptlang.org) | Strict types across the whole app |
| [React](https://react.dev) | Components and state for the viewer and its panels |
| [three.js](https://threejs.org) | Rendering, including its built-in Gaussian splats |
| [React Three Fiber](https://r3f.docs.pmnd.rs) | The three.js scene, written as React components |
| [Vite](https://vite.dev) | The dev server and the production build |
| [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) | The GPU API three.js renders with, falling back to WebGL 2 in browsers without it or on GPUs where it fails |
| [Node.js](https://nodejs.org) | The script that builds the body's volume from the source images |

Around them are drei's helpers, a leva control panel, zustand for app state, and Oxlint for linting.

## Workflow

- **Planned in phases.** The project is set up by following a [written plan](docs/setup-plan.md). Each phase is one focused thread, and the phases that change code end with lint, the tests and a type-checked production build passing.
- **Reviewed before it's committed.** Every batch of work goes through `/commit`, a [Claude Code skill](.claude/skills/commit/SKILL.md) that serves as the final code review. It's adapted from a shared [baseline](https://github.com/snovakow/Claude-Skills/tree/main/skills/commit), and it runs in a fresh thread, so the review starts without the author's assumptions. It reads every changed line for bugs, React Three Fiber and three.js pitfalls, type and lint escapes, new dependencies, leftovers and anything that shouldn't be public. Then it runs the checks, splits the work into focused commits with descriptive messages, and keeps this README accurate.
- **Tested where it's pure.** The parts with no GPU or React in them, such as the volume file's reader and writer and the rule that tells the body from its surroundings, have tests that build their own inputs, and each review runs them with the other checks.
- **Versioned checkpoints.** Versions start at 0.0.0 and count up: each reviewed batch ends with a version commit, which marks where the next review starts.
- **Current dependencies.** Packages and tools track their latest releases, and each review reports anything that has fallen behind.
- **Branches and deploys.** Work lands on `development` and reaches `main` by merge. The live site will be a static build of `main`.

## Credits

- The images come from the [Visible Human Project®](https://www.nlm.nih.gov/research/visible/visible_human.html), courtesy of the U.S. National Library of Medicine. The NLM "thanks the man and the woman who each willed their body to science, thereby enabling this project." VisibleHuman draws a reduced copy of the images, which may not reflect the NLM's most current data. The NLM doesn't endorse this project.
- [three.js](https://threejs.org), whose Gaussian splat rendering draws them.
