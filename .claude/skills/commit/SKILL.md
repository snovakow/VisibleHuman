---
name: commit
description: Review everything since the last reviewed point, fix what can still be fixed, commit the working tree as itemised commits with real messages, keep the README and docs true, and end with a version commit where the project keeps them. Nothing is pushed. Run by hand only.
argument-hint: "[x.y.z] [notes on what changed]"
disable-model-invocation: true
model: opus
effort: max
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Bash(git fetch *)
  - Bash(git add *)
  - Bash(git restore --staged *)
  - Bash(git commit *)
  - Bash(git rebase *)
  - Bash(GIT_EDITOR=true git rebase *)
  - Bash(GIT_SEQUENCE_EDITOR=true GIT_EDITOR=true git rebase *)
  - Bash(git stash push *)
  - Bash(git stash pop *)
  - Bash(npm run *)
  - Bash(npm outdated *)
  - Bash(npm version * --no-git-tag-version)
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/scan.mjs *)
metadata:
  baseline: 2026-10-21
---

# Commit a reviewed batch

Arguments: $ARGUMENTS

The arguments are an optional version, written like `1.2.3`, and the user's notes on what changed. Use the notes in the messages.

The user commits ad hoc while working and runs this skill when a batch is ready to go. Review everything since the baseline, fix what can still be fixed, commit all of it as a short series of well-described commits, and finish with a version commit where the project keeps them. The user reviews and pushes; this skill never pushes.

Treat the repository as public. Whatever is committed, in code, comments, docs or messages, can be read by anyone, and the history keeps it after any later clean-up.

## Project settings

The one block to adapt for a project. The steps below read it, and `scripts/scan.mjs` holds the same settings at its top; keep the two in step.

- **Protected branches:** `main`, `master`. Work does not land on these. On one, stop and ask. Work lands on `development`, and the user merges it into `main`.
- **Version commits:** `auto`: on when the scan reports a last version commit, or the arguments name a version; otherwise off, and the report says how to start. The project had no version before, so it started at `0.0.0`, as the Vite template sets it, and `/commit 0.0.1` made the first version commit; from then on every run ends with one.
- **Version shape:** the version lives in `package.json`. `npm version <x.y.z> --no-git-tag-version` sets it and updates `package-lock.json`. The commit touches only those two files, and the changelog where there is one, and its whole message is `Version X.Y.Z`. Only a version commit by snovakow counts.
- **Changelog:** `auto`. When a `CHANGELOG.md` exists at the root or under `docs/`, the version commit also carries a new section for its number; the scan names the file. There is none yet.
- **Checks:** the `lint`, `typecheck`, `check`, `test` and `build` scripts that `package.json` defines, whichever exist, run for what changed. The scan lists them. Then `npm outdated`, which reports rather than fails (Rules of this repository).
- **Leave alone:** none.
- **Maintained docs:** `README.md`, written for the public. A plan under `docs/`, when there is one, is the user's (Rules of this repository).
- **Never mention:** none.

## Rules of this repository

VisibleHuman is a React Three Fiber app in TypeScript, built with Vite, that draws the Visible Human Project's cross-sections as Gaussian splats with three.js's `WebGPURenderer`, from a volume file that a Node script builds out of the source images. These rules add to the steps below.

- **Review the code as well as the commits.** Step 2 reads every change in full; read it as a code reviewer too, and treat each of these as a finding to fix or ask about:
  - logic or arithmetic errors, wrong units, axes or coordinate spaces, an off-by-one in a grid or slice index, unhandled `null` or `undefined`, async work that can finish after its component unmounts, and listeners or timers that are never removed
  - a volume reader that trusts the file's header without checking it against the file's length, or a load that a slower, older request can overwrite
  - in the data script: a download that isn't retried or that leaves a partial file where a whole one is expected, a slice skipped or counted twice where the source's regions overlap, and memory that grows with the number of slices
  - React and R3F misuse: hooks outside the rules of hooks, effects that break under StrictMode's double mount, allocation or React state updates inside `useFrame`, splat geometries, `GaussianSplat` objects, data textures or other GPU resources made by hand and never disposed of, and cached results changed in place
  - anything `WebGPURenderer` can't run. It runs node materials only, so no GLSL `ShaderMaterial`, `RawShaderMaterial` or `onBeforeCompile`, no WebGL render target, and no drei helper built on them; custom shading belongs in TSL.
  - a new `any`, `@ts-ignore`, `@ts-expect-error` or lint suppression without a comment saying why, and any loosening of the Oxlint config, a tsconfig option or a package script that the batch doesn't need
  - a new dependency that isn't needed, maintained, licensed for a public repository and worth its size
- **A change to this skill** goes at the top of the report.
- **The volume file is generated.** The file under `public/volume/` comes from the data script, and the scan flags it as large; that's expected, so confirm with the user that it was built by the script as committed, rather than reviewing its bytes. A batch that changes the script, or the settings it reads, and not the file says in the report that the file needs rebuilding; a batch that changes the file and not the script says how it was built.
- **Dependencies stay current.** After the checks, run `npm outdated` (skip it offline) and list in the report what has fallen behind, apart from the deliberate holds: `@types/node` follows the Node in use, and React stays within React Three Fiber's peer range. A run never installs, upgrades or removes a package.
- **A plan is the user's.** When `docs/` holds a plan for the work under way, commit it as the user left it and never edit it, even where it names paths on the user's machine for its deploy steps; say in the report when a change makes it inaccurate. The batch that deletes it also drops the README's link to it.
- **The live site** is a static build of `main`. When a batch changes anything the build reads (`src/`, `public/`, `index.html`, the Vite config, `package.json` or `package-lock.json`), the report says that the site needs a rebuild and a deploy once it's merged.

## Rules that hold throughout

- Run in a fresh thread, as the first thing in it. A thread that made the changes under review remembers making them and cannot review them from the repository alone, and one that has already run this would run it again over the same work. So if anything precedes this command in the thread, an earlier message, work done here or a summary carried over from a longer context, stop before anything is read or run, and say to start a new thread with `/commit` as its first message.
- Never push. Never create, switch or delete a branch, and never clone or copy the repository to rehearse a step: the checks on each step and the undo point are the safety net. Never run anything that discards the user's work: no `git reset --hard`, no `git checkout -- <file>` over their edits, no `git clean`, no `git stash drop`.
- Never rewrite a pushed commit, or anything at or below the baseline. A problem there is reported, not fixed; a fix to pushed work is a new commit.
- Note `git rev-parse HEAD` before changing anything and give it in the report as the undo point.
- The file is the unit. Splitting hunks needs interactive staging, which is not available here, so two unrelated changes in one file go in one commit whose message covers both, or ask whether to hold one back.
- Stage explicit paths, never `-A` or `.`. Before each commit, check `git diff --cached --stat` against its subject, and unstage what does not belong with `git restore --staged <path>` rather than widen the message.
- Never delete the user's files or edit `.gitignore` without asking. An untracked file that does not belong in the repository is reported, not committed.
- Keep message files outside the repository, in the thread's scratchpad directory, so they can never be committed.
- If a hook rejects a commit, fix the cause and commit again rather than bypass it.

## How the pieces fit

- **Baseline.** The review covers everything after it: the range commits, the working tree, staged or not, and untracked files. With version commits, the baseline is the newest well-formed one, since a run ends at its report and everything below has been reviewed. That checkpoint lives in the history: it travels with every clone, a forgotten push costs nothing, and a commit made by hand after a release is still reviewed at the next one, though never rewritten once pushed. Without, it is the newest pushed commit, or the root when nothing is pushed, or the commit the user names when step 1 asks about what sits above the pushed tip: pushing is what closes a run, and until a run's commits are pushed the next run asks about them, which is also what brings a commit made outside a run under review.
- **Well-formed version commit.** All of these hold, each read from the commit itself: its whole message is exactly the version message, with no body and no trailer; it touches only the version files, and the version file among them; the version file at that commit reads the number in the message; and, with a changelog, it touches that too and the changelog's newest section at that commit is headed with the number. Anything else is an ordinary commit however much it looks like one: a subject that mentions a version, a bump made by hand, the right message with a trailer under it. The scan marks these lookalikes, and they are reviewed like any range commit.
- **Rewritable.** A commit may be rewritten only if it is after the baseline and not reachable from any remote branch. The scan prints the rewrite base. Pushed commits in the range are still reviewed, and their problems reported.
- **Order.** Plan the batch before staging anything. Fixes to existing commits first, then the new commits, then the prose commits for the maintained docs if needed, then the version commit, last.

## 1. Survey

With the thread fresh, run `git fetch --quiet` so pushed state is current; if it fails, say so and go on. Then run the scan, which is read-only:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/scan.mjs
```

Its **Attention** section lists what needs the user. Stop and ask about each before anything else:

- a rebase, merge, cherry-pick or revert in progress, or a detached HEAD
- the branch behind its upstream, or a protected branch
- the version changed outside this skill: HEAD or the working tree no longer holds the last version commit's number. Ask whether to undo the change or to pass the intended version as the argument.
- a changelog section above the last version commit's number, written by hand or by a run that never finished. Ask whether to rewrite it as this run's section or to keep its text as the start of one.
- credentials or session data in added lines (step 3)
- a file that looks like it should not be tracked, or a large one
- commits above the newest pushed commit where no version commit stands. They may be work a thread committed that nobody reviewed, or a run's own commits not yet pushed, and nothing in the repository says which. Ask before reading any of them, listing them oldest first by hash and subject, with these choices: review them all; commit the working tree only, treating all of them as reviewed; or stop, so the user can push first and run again. Say in the question that to keep some and review the rest, the user chooses Other and types the hash of the last commit to keep: that commit and everything below it stay as they are, and the review starts with the commit after it. A hash that names exactly one listed commit becomes this run's baseline, as the newest of them does for the working tree only: run the scan again with `--since <hash>`, and read nothing at or below it. Anything else, ask again rather than guess.

If nothing is new since the baseline, with no range commits, a clean tree and nothing untracked, say so and stop.

Settle whether this run ends with a version commit, from the Version commits setting and the scan's Versioning line. Then open the first message with the baseline, by hash and subject, and the version the run will write, if any, so that a baseline found lower than expected, or a number the user did not expect, is seen before anything acts on it.

## 2. Review the range

Read every range commit with `git show`, the working-tree diff with `git diff HEAD`, and every untracked file, in full. Look for:

- a commit whose diff does not match its message, or that holds more than one concern
- comments and docs whose claims the code does not bear out; fix any that overstate or misattribute what the code does
- references a reader of the public repository cannot follow: private hosts, local paths, customers, test data by name, "the spec". Write the structural fact the sentence needed instead, in the project's own terms.
- leftovers that look accidental: debug output, commented-out code, notes written for this thread
- files that should not be tracked: build output, data dumps, logs, local settings
- anything on the Never-mention list. The scan greps for the words; a name written another way needs reading, so go through **Prose to read** and every message yourself.

Run the checks that match what changed, and ask before committing if one fails in a touched file. They run against the tree as it will be committed, before the version commit, so a failure never needs a commit after it.

## 3. Credentials and private data

The scan's **Secrets and session data** section flags added lines that carry a credential or a copied browser session: cookie and authorization headers, bearer tokens, API keys, private keys, trace ids. Anything it lists is an Attention item: stop and ask before committing. Values never reach the scan's output; open the file to investigate.

A request usually works without a copied header. Check with a throwaway script in the scratchpad that runs it with and without the line, rather than guess, and remove what is not needed. When one genuinely is needed, say so in the report instead of committing it quietly. The check reads only lines added after the baseline, so it says nothing about what is already in the code.

## 4. Messages

Match the history; the scan prints the newest subjects at and below the baseline. Unless the history does otherwise:

- Subject: imperative, sentence case, at most 72 characters, no trailing period, no prefix such as `feat:`. Say what changed and, where it fits, why; never which file changed. Two related changes can share one: "Write the ledger with LF, and say so in the runbook".
- Body, when the diff does not explain itself: a blank line, then why, wrapped at 72 columns, then what was verified.
- Keep it public-safe: a message outlives any later clean-up of the files it describes.

Rewrite a rewritable commit's message only when it names something private, has a file-name or vague subject ("Update App.tsx", "wip", "fix"), or does not match its diff. Leave good messages alone. Keep each commit's author, and the trailers a reworded commit already has.

New commits other than the version commit end with the attribution trailer this thread's instructions ask for, if any. The version commit never carries one.

No other commit's subject may read like a version commit's, since the baseline depends on that shape being unique: reword a rewritable one to say what it changed.

## 5. README and docs

For each commit, ask whether its change makes a maintained doc untrue or incomplete: a feature, a setting, a step, a file that moved, a design choice. Update what it outdates. Most commits need nothing, and pure fixes, refactors and styling never do.

- An edit that only keeps a doc true to one commit's change goes in that commit. A broader rewrite is its own prose commit, after the code and before the version commit.
- Keep the doc's voice. Describe the idea rather than the code: a page that restates identifiers, values or counts from the source goes wrong silently on the next rename, and nothing checks it. Keep why a rule exists, what breaks without it, and what was measured, with the date.
- Never invent results. A claim only the user can confirm goes in the report.
- The scan's **Docs** section lists the maintained files, backticked paths that no longer exist, and files added, deleted or renamed since the baseline, which are the usual reasons a doc is out of date.

## 6. Plan the commits

Decide the whole batch before staging anything. Take the scan's **Working tree** list, assign every path to a group, and give each group its subject. That plan is what step 7 executes, in order.

- One concern per commit: a change someone would describe in one sentence. Unrelated work in the same batch gets its own commit, however small.
- Order so every commit stands on its own: a helper before its caller, code before the docs describing it, so no commit mid-batch leaves the build broken.
- If the batch is one concern, say so and make one commit. Do not split a coherent change to look tidy.
- Files under Leave alone belong to no group. Unstage any that are staged and name them in the report.
- Reword-only and fix-only work on existing commits is not a group; it belongs to step 7.2.

## 7. Apply

1. Note `git rev-parse HEAD`.
2. Fix the rewritable commits first, before new commits bury the tip.
   - **The tip:** stage the fixed files, then `git commit --amend -F <message file>`. For a message-only change, `git commit --amend --only -F <message file>`, which leaves the index alone.
   - **An older commit, content fix:** edit, stage only the fix, and `git commit --fixup=<sha>`.
   - **An older commit, message fix:** write `amend! <the target's exact subject>`, a blank line and the whole new message to a file, then `git commit --allow-empty --only -F <file>`. That body becomes the message entire, so nothing goes after it.
   - **Then fold them in.** Note the tip's hash, then `GIT_EDITOR=true git rebase --autosquash --autostash <rewrite base>`. Afterwards check that no subject in `git log --format=%s <rewrite base>..HEAD` still begins `fixup!` or `amend!`, and that `git diff <that tip> HEAD` is empty: the fold changed no tree. An older git ignores `--autosquash` outside an interactive rebase and reports success anyway; if the fixups are still there, run `GIT_SEQUENCE_EDITOR=true GIT_EDITOR=true git rebase -i --autosquash --autostash <rewrite base>`, which honours it and needs no editor.
   - If the rebase stops on a conflict, `git rebase --abort` and ask. A merge commit anywhere but the tip: report it and ask rather than flatten it.
   - If a fix touches a file that also has uncommitted edits, `git stash push --include-untracked` first and `git stash pop` after.
3. Make the fixes to working-tree work that step 2 found, with any doc edit that belongs with them.
4. Commit the groups in the planned order: stage explicit paths, check the staged stat against the subject, and commit with `git commit -F <message file>`. Commit untracked files that belong to the project and ask about the rest.
5. Make the prose commits, if step 5 calls for them.
6. Make the version commit, when this run ends with one:
   - **Number:** the last version commit's with its last number incremented (`0.0.9` becomes `0.0.10`). With no version commit yet, the version file's current number incremented. A version in the arguments is used exactly; if it is not higher than the current one, compared number by number, ask. Any other words in the arguments are notes for the messages.
   - **Changelog**, where there is one: add a section headed with the number at the top, in the file's existing format, describing the whole release in a reader's terms: what changed and what it means for them, not a list of commits. Date it the way the file dates its sections. It goes in the version commit, never on its own.
   - **Set it** with the project's command, and commit only the version files and the changelog, with the version message and nothing else: no body, no trailer, author as configured. It is the last commit.
   - **Then test it** as the next run will, against the well-formed tests above. If it fails, mend it until the last commit passes, and say what was wrong.

## 8. Verify and report

Run the scan again, with the same `--since` if one was used. `git status` lists only the files deliberately left out; the new version commit, if any, shows as the baseline; no range subject begins `fixup!` or `amend!`. Reread the final messages.

Then report, briefly:

- first, what the review flagged: problems in pushed commits that could not be fixed, anything committed over a failed check on the user's say-so, a credential kept and why
- each commit in order: short hash, subject and files; a rewritten commit as old to new hash with what changed
- the version change and changelog section, if any, and any doc claim only the user can confirm
- files left uncommitted, each with the reason
- the checks that ran, with their results
- the undo point: nothing was pushed, and `git reset --soft <starting hash>` returns the branch to where it stood with every change the run made left staged. Without version commits, say too that pushing is what closes the run: until then, the next run asks about these commits before reviewing them again.

## 9. After the report

The run ends with the report. Anything the user asks for next, in this thread or another, is development work, not part of the run, and how it is kept depends on how the run ended:

- **With a version commit.** Make and commit that work as usual, with the thread's attribution trailer, and stop there. These are ordinary commits, not the skill's: they carry no version bump, so the next run finds them above its baseline and reviews them. Do not bump the version or make a version commit, even when the follow-up comes straight after one.
- **Without one.** Make the change and commit none of it: leave it in the working tree, where the next run reviews it with the rest. Nothing in the history marks where a run without a version commit ended, so a commit made now could not be told from the run's own, and the next run could not know it was never reviewed.

The next batch gets its own `/commit`, which the user starts in a fresh thread so the review begins from a clean context. If follow-up work leaves a batch ready to go, say so instead.
