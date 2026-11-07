#!/usr/bin/env node
// Read-only survey for the /commit skill. Prints what the review needs before anything is staged:
// the branch's state, the baseline, the commits and files under review, message checks, secrets,
// links, prose to read and doc references. It only reads git and the working tree and changes
// nothing. Node 18 or later, no dependencies.
//
//     node scan.mjs
//     node scan.mjs --since <commit>    the last commit to keep: the review starts after it
//
// The settings block is the part to adapt for a project; everything below it is generic.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

// --- Settings: adapt these for the project, and keep them in step with SKILL.md ------------------

// A version commit's whole message; group 1 is the version.
const VERSION_MESSAGE = /^Version (\d+\.\d+\.\d+)$/;
// The file that stores the version, or null for a project that keeps no version commits: the
// baseline is then the newest pushed commit. JSON is read as JSON; any other file is searched for
// `version = "x.y.z"`, `"version": "x.y.z"` or `SOME_VERSION = 'x.y.z'`.
const VERSION_FILE = 'package.json';
// Every file a version commit may touch, the version file included. One that touches anything
// else is not a version commit.
const VERSION_FILES = ['package.json', 'package-lock.json'];
// The changelog, or null for none. 'auto' finds CHANGELOG.md at the root or under docs/. With
// one, a version commit also touches it, and its newest section at that commit is headed with
// the number.
const CHANGELOG = 'auto';
// Count only version commits by this git user.name; null counts any author.
const VERSION_AUTHOR = 'snovakow';
// Branches the skill should not commit on.
const PROTECTED_BRANCHES = ['main', 'master'];
// Paths the skill never stages: another skill's files, generated data, local settings. A folder
// covers everything under it.
const LEAVE_ALONE = [];
// Words that must not appear in anything that becomes public, matched without regard to case in
// every added line and message: private hosts, customers, people, outside sites.
const NEVER_MENTION = [];
// Prose the skill keeps true, as git pathspecs. Their backticked paths are checked against the
// tree, and files that came or went since the baseline are listed beside them.
// A plan under docs/, when there is one, is the user's: the skill commits it but never edits it.
const DOCS = ['README.md'];
// Files that usually should not be tracked, checked against the files added since the baseline.
const JUNK = [
  /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/, /(^|\/)\.env(\.[\w-]+)?$/,
  /\.(log|tmp|bak|orig|rej|swp)$/, /(^|\/)node_modules\//,
  /(^|\/)(dist|build|out|coverage|\.cache)\//, /(^|\/)__pycache__\//, /\.pyc$/,
  // TypeScript's build state, Vite's temporary config bundle, local and personal settings, keys.
  /\.tsbuildinfo$/, /\.timestamp-\d+-[0-9a-f]+\.m?js$/, /\.local$/, /(^|\/)\.claude\/settings\.local\.json$/,
  /\.(pem|key|p12|pfx)$/,
  // Source images downloaded while testing; the data script reads them from the NLM's server.
  /(^|\/)a_vm\d+\.png$/i, /\.(raw|rgb|fre)(\.(Z|gz))?$/i,
];
const LARGE_FILE = 1_000_000; // bytes; an added file above this is worth a look
const SUBJECT_MAX = 72;       // characters
const STYLE_SAMPLE = 8;       // subjects shown from at and below the baseline
const LONG_RANGE = 40;        // commits; more than this with no baseline is worth saying
const LIST_MAX = 40;          // lines per list before "and N more"
const DIFFS_MAX = 300;        // newest range commits whose diffs are scanned

// --- Patterns ------------------------------------------------------------------------------------

const VERSION_LOOKALIKE = /^v?\d+\.\d+\.\d+\b|\b(?:version|release|bump)\b.*\bv?\d+\.\d+(?:\.\d+)?\b/i;
const VAGUE_SUBJECT = /^(?:wip|fix(?:es|ed)?|update[sd]?|changes?|misc|tweaks?|clean ?up|stuff|tests?|more|minor|refactor|typo|oops|temp|save|work|changes made)[.!]?$/i;
const FILE_SUBJECT = /^(?:update|edit|change|fix|modify|tweak|add|remove|delete|create)[sd]?\s+[\w./-]+\.\w{1,5}$/i;
const TRAILER = /^(?:co-authored-by|signed-off-by|reviewed-by|helped-by|acked-by):/i;

const SCHEME_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>)\]]+/gi;
const WWW_HOST = /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const BARE_DOMAIN = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|co|us|uk|ca|ai|app|dev|gg|tv|info|me|news|online|site|xyz|edu|gov)(?![a-z0-9-]|\.[a-z0-9])/gi;
const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;
const XMLNS = /\bxmlns(?::[\w-]+)?\s*=\s*"[^"]*"/g;
// A markdown link matters only when it leaves the repo; a relative path names no site. Not
// global, so .test() stays stateless.
const LINK_TARGET_HOST = new RegExp(`${SCHEME_URL.source}|${WWW_HOST.source}|${BARE_DOMAIN.source}|^//`, 'i');
const PROSE_FILE = /\.(md|markdown|txt|rst|html?)$/i;
const HASH_COMMENT_FILE = /\.(php|sh|zsh|bash|py|rb|pl|ya?ml|toml|ini|conf|cfg)$|(^|\/)\.(gitignore|gitattributes|npmrc|env)$|(^|\/)(Makefile|Dockerfile)$/i;

// Credentials and copied browser-session data. Values never reach the output.
const SECRET_PATTERNS = [
  [/(?:^|['"\s])(?:set-)?cookie\s*:/i, 'cookie header'],
  [/\bCURLOPT_COOKIE(?:FILE|JAR)?\b/i, 'cookie sent with a request'],
  [/(?:^|['"\s])authorization\s*:/i, 'authorization header'],
  [/\bBearer\s+[\w.~+/-]{12,}/, 'bearer token'],
  [/(?:^|['"\s])x-api-key\s*:/i, 'api key header'],
  [/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|auth[_-]?token|password|passwd)\b\s*[=:]\s*['"`][^'"`\s]{8,}['"`]/i, 'key, token or password value'],
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'secret key'],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:[^\s/@'"]+@/i, 'credentials in a URL'],
  [/(?:^|['"\s])(?:traceparent|tracestate|x-correlation-id|x-datadog-[a-z-]+)\s*:/i, 'session or trace id header'],
];
// The skill's own files spell out the patterns and the words above, so they would always match.
const SELF_FILE = /(^|\/)skills\/commit\//;
// The values are the payload, so they never reach the output: quoted strings of eight characters
// or more, and bare tokens of twenty or more, are replaced.
const maskValues = (text) => text
  .replace(/(['"`])((?:(?!\1).){8,})\1/g, (_, quote) => `${quote}…${quote}`)
  .replace(/(?<![\w.~+/=-])[\w.~+/=-]{20,}(?![\w.~+/=-])/g, '…');
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = NEVER_MENTION.map((word) => [new RegExp(escapeRegExp(word), 'i'), word]);

// --- Helpers -------------------------------------------------------------------------------------

const git = (...args) => execFileSync('git', args, {
  encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'],
}).replace(/\n$/, '');
const tryGit = (...args) => {
  try { return git(...args); } catch { return null; }
};
const lines = (text) => (text ? text.split('\n').filter(Boolean) : []);
const short = (sha) => sha.slice(0, 7);
const clip = (text, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const carries = (n) => `${count(n, 'added line')} ${n === 1 ? 'carries' : 'carry'}`;
const capped = (items, max = LIST_MAX) => (items.length > max ? [...items.slice(0, max), `… and ${items.length - max} more`] : items);
const readText = (path) => {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
};
const fileSize = (path) => {
  try { const stat = statSync(path); return stat.isFile() ? stat.size : null; } catch { return null; }
};
const versionIn = (text) => {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.version === 'string') return parsed.version;
  } catch { /* not JSON: fall through to the text search */ }
  return /version\s*['"]?\s*[:=]\s*['"]?v?(\d+\.\d+\.\d+)/i.exec(text)?.[1] ?? null;
};
const versionAt = (rev) => (VERSION_FILE && rev ? versionIn(tryGit('show', `${rev}:${VERSION_FILE}`)) : null);
const bump = (version) => version.replace(/\d+$/, (n) => String(Number(n) + 1));
const underLeaveAlone = (path) => LEAVE_ALONE.some((entry) => {
  const prefix = entry.replace(/\/+$/, '');
  return path === prefix || path.startsWith(`${prefix}/`);
});
const statusPath = (line) => line.slice(3).split(' -> ').pop().replace(/^"(.*)"$/, '$1');

let top;
try {
  top = git('rev-parse', '--show-toplevel');
} catch {
  console.error('scan: not inside a git repository');
  process.exit(2);
}
process.chdir(top);
// --since names the baseline for this run: the last commit to keep, chosen by the user when asked
// about the commits above the pushed tip. It must be a commit on this branch.
const sinceArg = (() => { const at = process.argv.indexOf('--since'); return at === -1 ? null : (process.argv[at + 1] ?? ''); })();
const since = sinceArg === null ? null : tryGit('rev-parse', '-q', '--verify', `${sinceArg}^{commit}`);
if (sinceArg !== null && (!since || tryGit('merge-base', '--is-ancestor', since, 'HEAD') === null)) {
  console.error(`scan: --since ${sinceArg || '(empty)'} does not name a commit on this branch`);
  process.exit(2);
}
const EMPTY_TREE = tryGit('hash-object', '-t', 'tree', '/dev/null') ?? '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const changelog = CHANGELOG === 'auto'
  ? ['CHANGELOG.md', 'docs/CHANGELOG.md', 'CHANGELOG', 'docs/CHANGELOG'].find((path) => existsSync(path)) ?? null
  : CHANGELOG;
// The version in the newest `## ` heading that carries one; an Unreleased heading is passed over.
const changelogVersion = (text) => {
  for (const [, heading] of (text ?? '').matchAll(/^##\s+(.+)$/gm)) {
    const match = /\bv?(\d+\.\d+\.\d+)\b/.exec(heading);
    if (match) return match[1];
  }
  return null;
};

// --- State ---------------------------------------------------------------------------------------

const hasHead = Boolean(tryGit('rev-parse', '-q', '--verify', 'HEAD'));
const branch = tryGit('symbolic-ref', '--short', '-q', 'HEAD');
const upstream = hasHead ? tryGit('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}') : null;
const [behind, ahead] = upstream
  ? git('rev-list', '--left-right', '--count', '@{u}...HEAD').split(/\s+/).map(Number)
  : [0, 0];
const operations = [
  ['rebase-merge', 'rebase'], ['rebase-apply', 'rebase'], ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert'], ['BISECT_LOG', 'bisect'],
].filter(([name]) => existsSync(git('rev-parse', '--git-path', name))).map(([, label]) => label);
const userName = tryGit('config', 'user.name');
const remotes = lines(tryGit('remote') ?? '');

// Pushed means reachable from any remote-tracking branch; only commits outside that set can be
// rewritten. With no remote, nothing is pushed.
const unpushed = new Set(hasHead ? lines(git('rev-list', 'HEAD', '--not', '--remotes')) : []);
const firstParent = hasHead ? lines(git('rev-list', '--first-parent', 'HEAD')) : [];
const pushedTip = firstParent.find((sha) => !unpushed.has(sha)) ?? null;

// --- Baseline: the newest well-formed version commit, else the newest pushed commit --------------

const versionFiles = new Set([VERSION_FILE, ...VERSION_FILES, changelog].filter(Boolean));
const candidates = hasHead && VERSION_FILE
  ? git('log', '--full-history', '--format=%H%x1f%an%x1f%B%x1e', 'HEAD', '--', VERSION_FILE)
    .split('\x1e').map((record) => record.trim()).filter(Boolean)
    .map((record) => {
      const [sha, author, message = ''] = record.split('\x1f');
      return { sha, author, message: message.trim() };
    })
  : [];
// Why a commit is not a well-formed version commit, or null when it is. Every test reads the
// commit itself: its whole message, the files it touches, and the version file as it stands there.
const versionDefect = ({ sha, author, message }) => {
  const match = VERSION_MESSAGE.exec(message);
  if (!match) return 'its message is not exactly the version message';
  if (VERSION_AUTHOR && author !== VERSION_AUTHOR) return `its author is ${author}, not ${VERSION_AUTHOR}`;
  const files = lines(git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha));
  if (!files.includes(VERSION_FILE)) return `it does not touch ${VERSION_FILE}`;
  const outside = files.filter((file) => !versionFiles.has(file));
  if (outside.length) return `it touches ${outside.slice(0, 3).join(', ')}${outside.length > 3 ? ' and more' : ''}`;
  if (changelog && !files.includes(changelog)) return `it does not touch ${changelog}`;
  if (changelog && changelogVersion(tryGit('show', `${sha}:${changelog}`)) !== match[1]) return `${changelog} at that commit is not headed with ${match[1]}`;
  if (versionAt(sha) !== match[1]) return `${VERSION_FILE} at that commit does not read ${match[1]}`;
  return null;
};
const official = candidates.find((candidate) => versionDefect(candidate) === null) ?? null;
const officialVersion = official ? VERSION_MESSAGE.exec(official.message)[1] : null;
const baseline = since ?? official?.sha ?? pushedTip;
const rewriteBase = baseline && !unpushed.has(baseline) ? pushedTip : baseline;
const diffBase = baseline ?? EMPTY_TREE;

const headVersion = hasHead ? versionAt('HEAD') : null;
const worktreeVersion = VERSION_FILE ? versionIn(readText(VERSION_FILE)) : null;
const nextVersion = officialVersion ? bump(officialVersion) : worktreeVersion ? bump(worktreeVersion) : null;
const changelogNow = changelog ? changelogVersion(readText(changelog)) : null;

// --- Range: commits after the baseline, plus the working tree ------------------------------------

const rangeShas = hasHead
  ? lines(git('rev-list', '--reverse', '--topo-order', ...(baseline ? [`${baseline}..HEAD`] : ['HEAD'])))
  : [];
const commits = rangeShas.map((sha) => {
  const [parents, author, date, ...rest] = git('log', '-1', '--format=%P%x1f%an%x1f%ad%x1f%B', '--date=short', sha).split('\x1f');
  const message = rest.join('\x1f').trim();
  const [subject = '', second = ''] = message.split('\n');
  const parent = parents ? parents.split(' ')[0] : null;
  const bumps = Boolean(VERSION_FILE) && versionAt(sha) !== (parent ? versionAt(parent) : null);
  const problems = [];
  if (subject.length > SUBJECT_MAX) problems.push(`subject is ${subject.length} characters`);
  if (/\.$/.test(subject)) problems.push('subject ends with a period');
  if (VAGUE_SUBJECT.test(subject)) problems.push('vague subject');
  if (FILE_SUBJECT.test(subject)) problems.push('subject names a file rather than a change');
  if (second.trim()) problems.push('no blank line after the subject');
  if (!VERSION_FILE) {
    if (VERSION_LOOKALIKE.test(subject)) problems.push('subject reads like a version commit; this project keeps none');
  } else if (VERSION_MESSAGE.test(message)) {
    problems.push(`has a version commit's message, but ${versionDefect({ sha, author, message }) ?? 'it sits above the baseline'}; reviewed as an ordinary commit`);
  } else if (VERSION_MESSAGE.test(subject)) {
    problems.push("has a version commit's subject with a body or trailer under it; not a version commit");
  } else if (bumps) {
    problems.push(`changes the version in ${VERSION_FILE}; not a version commit`);
  } else if (VERSION_LOOKALIKE.test(subject)) {
    problems.push('subject reads like a version commit; it is not one');
  }
  return { sha, merge: parents.split(' ').length > 1, author, date, message, pushed: !unpushed.has(sha), problems };
});

const status = lines(git('status', '--short', '--untracked-files=all'));
const untracked = lines(git('ls-files', '--others', '--exclude-standard'));
const leftAloneLines = status.filter((line) => underLeaveAlone(statusPath(line)));
const stagedLeftAlone = leftAloneLines.filter((line) => line[0] !== ' ' && line[0] !== '?').map(statusPath);

// --- Added lines: where secrets, links and names would be -----------------------------------------

// Added lines from a unified diff, with their line numbers in the new file.
const addedLines = (diff) => {
  const result = [];
  let file = null;
  let lineNo = 0;
  let inHeader = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) { inHeader = true; file = null; continue; }
    if (inHeader) {
      if (line.startsWith('+++ ')) { file = line === '+++ /dev/null' ? null : line.slice(6); inHeader = false; }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (line.startsWith('+')) { if (file) result.push({ file, line: lineNo, text: line.slice(1) }); lineNo++; }
    else if (line.startsWith(' ')) lineNo++;
  }
  return result;
};
const DIFF_FLAGS = ['--unified=0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
const commitAdded = (sha) => addedLines(git('show', '--format=', '--diff-merges=first-parent', ...DIFF_FLAGS, sha));
const worktreeAdded = () => addedLines(git('diff', 'HEAD', ...DIFF_FLAGS));
const untrackedAdded = (path) => {
  try {
    const size = fileSize(path);
    if (size === null || size > 2_000_000) return [];
    const buffer = readFileSync(path);
    if (buffer.subarray(0, 8000).includes(0)) return [];
    return buffer.toString('utf8').split('\n').map((text, index) => ({ file: path, line: index + 1, text }));
  } catch {
    return [];
  }
};

// The comment or document text of a line: where names would be prose rather than code.
const proseOf = (file, text) => {
  const trimmed = text.trim();
  if (!trimmed || /\.svg$/i.test(file)) return null;
  if (PROSE_FILE.test(file)) return trimmed;
  if (/^(\/\*|\*)/.test(trimmed)) return trimmed;
  if (HASH_COMMENT_FILE.test(file) && trimmed.startsWith('#')) return trimmed;
  // Comment markers count only at the start or after whitespace, so URLs, paths and strings don't.
  const pieces = [
    /(?:^|\s)\/\/(.*)$/.exec(text)?.[1],
    /(?:^|[\s{(;])\/\*(.*?)(?:\*\/|$)/.exec(text)?.[1],
    /(?:^|[\s>])<!--(.*?)(?:-->|$)/.exec(text)?.[1],
  ].filter((piece) => piece?.trim());
  return pieces.length ? pieces.join(' … ').trim() : null;
};
const externalLinks = (text) => [...text.matchAll(MARKDOWN_LINK)]
  .filter(([, target]) => LINK_TARGET_HOST.test(target))
  .map(([match]) => match);

const linkHits = [];
const proseLines = [];
const proseFiles = new Map();
const secretHits = [];
const mentionHits = [];
const scanText = (where, file, line, text, proseOnly) => {
  const code = text.replace(XMLNS, '');
  const location = file ? `${file}:${line}` : `line ${line}`;
  const self = SELF_FILE.test(file ?? '');
  if (!proseOnly && !self) {
    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(code)) secretHits.push(`${where} ${location}  ${label}  | ${clip(maskValues(code.trim()), 100)}`);
    }
  }
  if (!self) {
    for (const [pattern, word] of mentions) {
      if (pattern.test(code)) mentionHits.push(`${where} ${location}  ${word}  | ${clip(code.trim(), 100)}`);
    }
  }
  const prose = proseOnly ? code : proseOf(file, code);
  const urls = code.match(SCHEME_URL) ?? [];
  const found = new Set([
    ...urls,
    ...[...(code.match(WWW_HOST) ?? []), ...(prose?.match(BARE_DOMAIN) ?? [])].filter((host) => !urls.some((url) => url.includes(host))),
    ...(prose ? externalLinks(prose).filter((link) => !urls.some((url) => link.includes(url))) : []),
  ]);
  for (const match of found) linkHits.push(`${where} ${location}  ${match}  | ${clip(code.trim())}`);
  if (prose && !proseOnly) {
    if (PROSE_FILE.test(file)) {
      const key = `${where} ${file}`;
      proseFiles.set(key, [...(proseFiles.get(key) ?? []), `${where} ${location}  ${clip(prose)}`]);
    } else {
      proseLines.push(`${where} ${location}  ${clip(prose)}`);
    }
  }
};

const scanned = commits.slice(-DIFFS_MAX);
for (const commit of scanned) {
  const label = `${short(commit.sha)}${commit.pushed ? ' (pushed)' : ''}`;
  commit.message.split('\n').forEach((text, index) => {
    if (!TRAILER.test(text.trim())) scanText(`msg ${label}`, null, index + 1, text, true);
  });
  for (const { file, line, text } of commitAdded(commit.sha)) scanText(label, file, line, text, false);
}
if (hasHead) {
  for (const { file, line, text } of worktreeAdded()) scanText('worktree', file, line, text, false);
}
for (const path of untracked) {
  for (const { file, line, text } of untrackedAdded(path)) scanText('untracked', file, line, text, false);
}
// A prose file with a few added lines is listed line by line; a longer one is named once, to
// read in full.
const proseSummary = [];
for (const [key, added] of proseFiles) {
  if (added.length <= 5) proseSummary.push(...added);
  else proseSummary.push(`${key}  ${count(added.length, 'line')} of prose added; read the file in full`);
}
proseLines.unshift(...proseSummary);

// --- Files added since the baseline: junk and size -----------------------------------------------

const addedPaths = new Set(untracked);
if (hasHead) {
  for (const line of lines(git('diff', '--name-status', '--no-renames', diffBase))) {
    const [kind, path] = line.split('\t');
    if (kind[0] === 'A') addedPaths.add(path);
  }
}
const junk = [...addedPaths].filter((path) => JUNK.some((pattern) => pattern.test(path))).sort();
const large = [...addedPaths].map((path) => [path, fileSize(path)])
  .filter(([, size]) => size !== null && size > LARGE_FILE)
  .sort()
  .map(([path, size]) => `${path} (${(size / 1_000_000).toFixed(1)} MB)`);

// --- Docs: the prose the skill maintains ---------------------------------------------------------

const docFiles = [...new Set(DOCS.length ? lines(tryGit('ls-files', '--cached', '--others', '--exclude-standard', '--', ...DOCS) ?? '') : [])]
  .filter((file) => PROSE_FILE.test(file) && existsSync(file));
// A backticked span that reads as a repo path and names nothing on disk.
const SPAN = /`([^`\n]+)`/g;
const PATHLIKE = /^\.?[\w@+-][\w.@+-]*(?:\/[\w.@+-]+)+\/?$|^\.?[\w@+-][\w.@+-]*\/$/;
const dangling = [];
const seenRef = new Set();
for (const file of docFiles) {
  let fenced = false;
  (readText(file) ?? '').split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    for (const [, span] of line.matchAll(SPAN)) {
      const base = span.replace(/:\d+(?:-\d+)?$/, '');
      if (!PATHLIKE.test(base) || /[*<>{}$]/.test(base)) continue;
      const key = `${file}\t${base}`;
      if (seenRef.has(key) || existsSync(base.replace(/\/$/, ''))) continue;
      seenRef.add(key);
      dangling.push(`${file}:${index + 1}  ${span}`);
    }
  });
}
// Files that came or went since the baseline: the usual reason a page is out of date. Edits inside
// existing files are left out; they would fill the list every batch.
const structural = hasHead
  ? lines(git('diff', '--name-status', '--find-renames', diffBase)).flatMap((line) => {
    const [kind, ...paths] = line.split('\t');
    return kind[0] === 'M' ? [] : [`${kind[0]} ${paths.join(' -> ')}`];
  })
  : [];
for (const path of untracked) structural.push(`A ${path}`);

// --- Checks the project offers -------------------------------------------------------------------

const scripts = (() => {
  try { return Object.keys(JSON.parse(readText('package.json') ?? 'null')?.scripts ?? {}); } catch { return []; }
})();
const checks = ['lint', 'typecheck', 'check', 'test', 'build'].filter((name) => scripts.includes(name)).map((name) => `npm run ${name}`);
const styleSample = baseline ? lines(git('log', `-${STYLE_SAMPLE}`, '--format=%h %s', baseline)) : [];

// --- Output --------------------------------------------------------------------------------------

const versioning = !VERSION_FILE
  ? 'off: the newest pushed commit is the baseline, and pushing closes a run'
  : !existsSync(VERSION_FILE)
    ? `off: ${VERSION_FILE} does not exist; set VERSION_FILE here and the version shape in SKILL.md`
    : official
      ? `on: last version commit ${officialVersion}, HEAD ${headVersion ?? '(none)'}, working tree ${worktreeVersion ?? '(none)'}, next ${nextVersion}`
      : `no version commit yet: ${VERSION_FILE} reads ${worktreeVersion ?? '(no version found)'}; pass a version as the argument to start one${nextVersion ? `, ${nextVersion} would be next` : ''}`;

const attention = [
  ...operations.map((operation) => `${operation} in progress`),
  ...(hasHead && !branch ? ['HEAD is detached'] : []),
  ...(behind ? [`branch is ${count(behind, 'commit')} behind ${upstream}`] : []),
  ...(branch && PROTECTED_BRANCHES.includes(branch) ? [`on ${branch}, a protected branch`] : []),
  ...(VERSION_AUTHOR && userName !== VERSION_AUTHOR ? [`git user.name is ${userName ?? 'unset'}, not ${VERSION_AUTHOR}; a version commit would not count`] : []),
  ...(official && (headVersion !== officialVersion || worktreeVersion !== officialVersion)
    ? [`version changed outside /commit: HEAD ${headVersion}, working tree ${worktreeVersion}, last version commit ${officialVersion}`] : []),
  ...(official && changelog && changelogNow !== officialVersion
    ? [`${changelog} has a section above the last version commit's: newest ${changelogNow ?? '(none)'}, last version commit ${officialVersion}`] : []),
  ...(secretHits.length ? [`${carries(secretHits.length)} credentials or session data; see Secrets and session data`] : []),
  ...(mentionHits.length ? [`${carries(mentionHits.length)} a name that must not appear; see Names that must not appear`] : []),
  ...junk.map((path) => `looks like it should not be tracked: ${path}`),
  ...large.map((item) => `large file added: ${item}`),
  ...stagedLeftAlone.map((path) => `staged, but in Leave alone: ${path}`),
  ...(!since && !official && commits.length
    ? [`${count(commits.length, 'commit')} above the newest pushed commit with no version commit standing; ask before reading them whether to review them all, keep them all, or name the last one to keep`] : []),
  ...(!baseline && commits.length > LONG_RANGE
    ? [`${count(commits.length, 'commit')} with no baseline: nothing is pushed and there is no version commit, so the range is the whole history`] : []),
];

const out = [];
const say = (text = '') => out.push(text);
const section = (title) => out.push('', `## ${title}`);
const list = (items, empty = '(none)') => {
  for (const item of (items.length ? capped(items) : [empty])) say(`- ${item}`);
};

say('# Commit survey');
section('Attention');
list(attention);

section('State');
say(`Branch: ${branch ?? (hasHead ? '(detached)' : '(unborn)')}${upstream ? `, upstream ${upstream} (ahead ${ahead}, behind ${behind})` : ', no upstream'}`);
say(`Remotes: ${remotes.length ? remotes.join(', ') : 'none, so nothing counts as pushed'}`);
say(`Git user: ${userName ?? '(unset)'}`);
if (!hasHead) say('No commits yet: the whole working tree is the first batch');
say(`Baseline: ${since
  ? `${short(since)} ${git('log', '-1', '--format=%s', since)} (the last commit kept, named with --since)`
  : official
  ? `${short(official.sha)} ${official.message} (${unpushed.has(official.sha) ? 'unpushed' : 'pushed'} version commit)`
  : pushedTip
    ? `${short(pushedTip)} ${git('log', '-1', '--format=%s', pushedTip)} (newest pushed commit; ${VERSION_FILE ? 'no version commit yet' : 'pushing closes a run'})`
    : `(root: nothing is pushed${VERSION_FILE ? ' and there is no version commit' : ''})`}`);
say(`Rewrite base: ${rewriteBase ? short(rewriteBase) : '(root)'}; only commits after it may be rewritten`);
say(`Versioning: ${versioning}`);
say(`Changelog: ${changelog ? `${changelog}, newest section ${changelogNow ?? '(none)'}` : 'none'}`);
say(`Checks available: ${checks.length ? checks.join(', ') : 'none found in package.json'}`);

section(`Range commits (${commits.length}, oldest first)`);
if (commits.length > 100) say(`(the oldest ${commits.length - 100} are not shown)`);
for (const commit of commits.slice(-100)) {
  say(`### ${short(commit.sha)} ${commit.pushed ? 'pushed' : 'unpushed'}${commit.merge ? ', merge' : ''} | ${commit.author} | ${commit.date}`);
  for (const text of commit.message.split('\n')) say(`    ${text}`);
  for (const problem of commit.problems) say(`    ! ${problem}`);
}
if (!commits.length) say('(none)');

section('Message style (newest subjects at and below the baseline)');
for (const line of styleSample.length ? styleSample : ['(none)']) say(line);

section('Working tree');
for (const line of status.length ? capped(status, 200) : ['(clean)']) say(line);
if (LEAVE_ALONE.length) {
  section(`Left alone (${LEAVE_ALONE.join(', ')})`);
  for (const line of leftAloneLines.length ? leftAloneLines : ['(nothing changed there)']) say(line);
}

section('Secrets and session data');
list(secretHits);
if (NEVER_MENTION.length) {
  section('Names that must not appear');
  list(mentionHits);
}
section('Links and domains');
list(linkHits);
section('Prose to read (comments and docs added in the range)');
list(proseLines);
if (commits.length > scanned.length) say(`(diffs of the oldest ${commits.length - scanned.length} commits were not scanned)`);

section('Docs (maintained prose)');
say(`Files: ${docFiles.length ? docFiles.join(', ') : '(none)'}`);
say(`Paths named that do not exist: ${dangling.length ? '' : 'none'}`);
for (const line of capped(dangling)) say(`    ${line}`);
say(`Added, deleted or renamed since the baseline: ${structural.length ? '' : 'none'}`);
for (const line of capped(structural)) say(`    ${line}`);

console.log(out.join('\n'));
