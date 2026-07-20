# Agent Notes

`@cunarist/deno-lit-analyzer` type checks Lit `html` and `css` templates in a
Deno project. It ships one surface: a CLI at `src/mod.ts`, the `.` export.

It is a thin wrapper around the npm package `lit-analyzer`. The wrapping exists
for one reason: that CLI reads compiler options from a hardcoded
`tsconfig.json`, and a Deno project has none. We read `deno.json` instead.

## Verification

Run all four before considering a change done:

```shell
deno fmt
deno lint
deno check src/*.ts tests/*.ts
deno test -A
```

Before a release, also run `deno publish --dry-run` to confirm the package still
builds and that `publish.exclude` keeps `tests` out.

## Every failure mode in this library is a silent pass

This is the single most important thing to know. `lit-analyzer` does not report
that it could not resolve something. It reports nothing, prints a clean summary,
and exits 0. Every mistake made while building this package looked like success:

| Mistake                         | What it printed                   |
| ------------------------------- | --------------------------------- |
| No `moduleResolution` set       | `Found 0 problems in 296 files`   |
| Path with a doubled slash       | `0 errors in 296 files`           |
| A directory argument on Windows | `Couldn't find any files`, exit 0 |

So a passing check proves nothing on its own. **Every test that asserts a clean
result must be paired with one that asserts a specific problem is found.** That
is why `tests/fixture` has both `good` and `bad`, and why the `bad` assertion
pins the exact rule id. If the pair is ever split, a broken analyzer will look
green forever.

The same rule applies when reviewing a change: if it touched compiler options,
path handling, or file collection, run `deno task bad` and confirm it still
fails.

## Compiler options

`REQUIRED_OPTIONS` in `src/config.ts` overrides whatever `deno.json` declares.
`moduleResolution` is the load-bearing entry. Without it TypeScript falls back
to classic resolution, never opens `node_modules`, and every custom element
becomes an unknown tag with no type to check against. Do not make it
configurable.

`deno.ns` and its siblings are stripped from `lib` because TypeScript rejects
the whole array when one entry is unknown to it, taking `dom` down with it. Do
not "simplify" that filter away.

## Paths are always forward slashes

TypeScript normalizes `SourceFile.fileName` to forward slashes, and diagnostics
are matched against the collected paths by string equality. A path built with
the platform separator, or one carrying a doubled slash from a trailing-slash
join, matches nothing and every diagnostic is dropped without a word.

`collectFiles` owns this normalization. Anything that builds a path outside it
has to normalize too.

## What gets walked

`collectFiles` skips `node_modules` and `.git` whatever the config says, which
is what `deno lint` and `deno fmt` do, then applies the top level `exclude` list
from `deno.json`. An entry without a glob in it matches as a prefix, because
excluding a directory has to exclude what is under it.

`dist` is not skipped by default, and neither is it by `deno lint`. A project
that builds into the tree it checks should say so in `exclude`.

The upstream CLI has none of this. Its default is the glob
`src/**/*.{js,jsx,ts,tsx}`, which reaches the same files from the same place by
a different route.

## Rule severities

`DEFAULT_RULES` in `src/analyze.ts` layers on top of whichever preset `strict`
selected. Six rules are `off` because they report an unknown tag for every
element a project registers indirectly: 156 reports against 3 genuine errors on
a real codebase. Those six are already off in the non-strict preset, so the
entry that does the work either way is `no-unintended-mixed-binding`, promoted
to `error` because neither preset raises it above a warning.

These are defaults, not policy. `readOptions` in `src/options.ts` layers the
project's `rules` field over them, so any of the seven can be set to something
else.

The barrel-module explanation this file used to give was wrong. A local barrel
(`export * from "./tag.ts"`) resolves fine, because the analyzer collects
`@customElement` declarations from every source file in the program rather than
following imports. The 156 reports most likely came from third-party elements
whose declarations live only in `node_modules`. That has not been confirmed.

## Exit code

`isFailure` in `src/mod.ts` mirrors `isSuccessful` in the upstream CLI: any
error fails the run, and warnings only fail it once `maxWarnings` is set to
something other than -1 and the count goes past it. A warning on its own exits
0. Do not "fix" that.

## Options

Which rules run, and at what severity, is declared in the `litAnalyzer` field of
`deno.json` and never passed as a flag. Two people running the tool on the same
checkout have to agree on what a problem is. Everything else is a flag.

| Setting                                     | Where                |
| ------------------------------------------- | -------------------- |
| `strict`, `rules`                           | `deno.json` only     |
| `format`, `quiet`, `maxWarnings`, `noColor` | flag only            |
| the paths to check                          | positional arguments |

Nothing is readable from both. A setting with two sources needs a precedence
rule, and the rule is invisible in whichever file the reader is looking at.

`FIELDS` and `FLAGS` in `src/options.ts` are the two lists, and each side
rejects the other's names with a message naming the right spelling.

`rejectUnknownFlags` in `src/options.ts` fails on the upstream flags that moved
or were dropped, and names the replacement. Do not soften that into a warning: a
flag that is ignored still prints a result, and the user believes it applied.

`--outFile` and `--failFast` were dropped outright. Shell redirection covers the
first. `--failFast` buys nothing here: `ts.createProgram` does the work before
the first file is looked at, so stopping early saves no time. Measured on 40
files that all fail, analysis took 183ms for all of them and 185ms for one. Do
not add it back on the assumption that it speeds anything up.

The output matches the upstream CLI byte for byte, verified by diffing a real
run. The one line that differs is upstream's Windows bug: `relativeFileName`
does `fileName.replace(process.cwd(), ".")`, and `process.cwd()` uses
backslashes while `fileName` does not, so it prints an absolute path. We print
the relative one it meant to.

`strict` defaults to false, as upstream. That means `no-unclosed-tag`,
`no-invalid-css`, and `no-incompatible-property-type` are warnings, and a
project that wants them to fail CI has to declare `"strict": true`. The fixture
config declares it, which is the only reason the `bad` task still exits 1. Do
not remove it.

`src/options.ts` throws on an unknown rule id, severity, or format. That is
deliberate: a misspelled rule id would otherwise be dropped in silence and the
rule the user meant to change would keep its old severity, which is the same
silent-pass failure this package exists to avoid.

## Lint plugin conflicts

`hugoalh/sort-depends` is in `rules.exclude`. It sorts every import as one flat
group, while `import-check/enforce-import-order` wants three groups separated by
blank lines. They undo each other's fixes, and `deno lint --fix` never
converges. This is the same conflict `deno-import-check` documents about
`@ayk/lint-import-order`. Do not remove the exclusion; remove one of the two
plugins if it ever comes up again.

`hugoalh/fmt-jsdoc` and `deno fmt` also disagree, but that one is avoidable.
`fmt-jsdoc` wants a blank line inside a JSDoc block written as `" * "` with a
trailing space, and `deno fmt` strips the trailing space right back off. So
**JSDoc comments here never contain a blank line.** A doc comment is one
paragraph; rationale that needs more goes in `//` comments directly above it.
That is why several files have a `//` block sitting on top of a one-line
`/** */`.

## Version pins

`lit-analyzer@2.0.3` is the newest release and dates to January 2024. It pins
`typescript@~5.2`, which is older than the compiler `deno check` uses, so syntax
newer than TypeScript 5.2 can fail to parse here while checking fine elsewhere.
If that ever bites, the fix is upstream, not here.

Upstream is co-maintained by Lit team members but sits on a personal account and
has not shipped a release since that date. Do not assume a fix will arrive.

## File naming

Every file under `src/` uses kebab-case, and a module's entry point is always
`mod.ts`. Test files are `<name>.test.ts`, never `<name>_test.ts`.

## Layer order

The `#`-prefixed entries in `imports` are the layer order, top first: a module
may only import ones declared below it. `mod.ts` is the entry point and sits
above all of them. The order is `options`, `report`, `analyze`, `config`,
`files`, and `analyze`, `config`, and `files` do not import each other.

## ASCII only

`prefer-ascii` is on, so non-ASCII in source must be escaped: `"\u{2705}"`, not
the literal character. This applies to `src/`, not to Markdown.

## Publishing

Version bumps are manual edits to `deno.json` followed by `deno publish`.

A freshly cloned checkout may fail to resolve a recently published lint plugin
because of Deno's minimum dependency age policy. Run
`deno cache --min-dep-age 0 src/mod.ts` once to populate `deno.lock`;
`deno lint` itself does not accept that flag.
