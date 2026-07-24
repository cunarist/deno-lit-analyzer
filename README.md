# Deno Lit Analyzer

Type check Lit templates in a Deno project.

The goal is to behave as much like
[`lit-analyzer`](https://github.com/runem/lit-analyzer) as possible. Same rules,
same defaults, same messages, same output, same exit codes.

`deno check` never looks inside a tagged template literal. This tool does, by
wrapping `lit-analyzer` and feeding it TypeScript `compilerOptions` from
`deno.json`.

```shell
deno run -A jsr:@cunarist/deno-lit-analyzer
```

These are not caught by `deno check` but are reported by this tool:

```ts
html`<div><img>`; // This tag isn't closed.
html`<input @click="${1}">`; // You are setting up an event listener with a non-callable type '1'
html`<input .value="${{}}">`; // Type '{}' is not assignable to 'string'
```

Pass files or directories. Directories are walked recursively for `.ts`, `.tsx`,
`.js`, and `.jsx`, skipping `node_modules`, `.git`, and anything the `exclude`
list in `deno.json` names. With no arguments it checks `src`. Any error exits 1;
warnings on their own exit 0.

## Configuration

> Type declarations for third-party custom elements are read from `node_modules`
> on disk, never from Deno's module cache. Set `"nodeModulesDir": "auto"` so
> they land where TypeScript looks; without it those elements go unchecked and
> the tool warns on stderr.

The `imports` map in `deno.json` is honored, so an element defined behind an
alias is followed to its definition and checked like any other. Entries whose
target is a file become path mappings; a trailing-slash prefix maps a whole
directory. Package specifiers such as `npm:` and `jsr:` keep their scheme and
resolve through `node_modules`.

```json
{
  "imports": {
    "#shared-components/ripple": "./src/shared-components/ripple.ts",
    "#shared-components/": "./src/shared-components/"
  }
}
```

> Remote (`https:`) imports are not followed. This is an upstream `lit-analyzer`
> limit, not a TypeScript one.

### Rules

Which rules run, and at what severity, is declared in `deno.json`:

```json
{
  "litAnalyzer": {
    "strict": true,
    "rules": {
      "no-unknown-tag-name": "error",
      "no-unclosed-tag": "warn"
    }
  }
}
```

`strict` picks the preset every rule's severity starts from, and defaults to
false. Turning it on promotes several rules from warning to error, which is what
makes them fail the run. `rules` overrides one at a time: `"off"` never reports,
`"warn"` reports without failing the run, `"error"` fails it.

For what each rule checks, see
[`lit-analyzer`'s rule list](https://github.com/runem/lit-analyzer/blob/master/docs/readme/rules.md).

### Flags

```shell
deno run -A jsr:@cunarist/deno-lit-analyzer --format list --quiet src
```

| Flag              | What it does                                  |
| ----------------- | --------------------------------------------- |
| `--help`          | Print the flags                               |
| `--format FORMAT` | `code` (default), `list`, or `markdown`       |
| `--quiet`         | Report only errors and not warnings           |
| `--maxWarnings N` | Fail once more than `N` warnings are reported |
| `--noColor`       | Print without color. `NO_COLOR` also works    |

`lit-analyzer` also takes `--strict` and `--rules` on the command line. Here
they are the `deno.json` fields above instead, because they decide what counts
as a problem and that has to be the same for everyone. Passing them fails rather
than doing nothing:

```shell
$ deno run -A jsr:@cunarist/deno-lit-analyzer --strict src
```

```
Error: --strict is not a flag here, declare "strict" under "litAnalyzer" in deno.json instead
```

## Why not use `lit-analyzer` directly

Its CLI reads compiler options from a hardcoded `tsconfig.json`, with no way to
point it at `deno.json`.

## Related

Templates tagged `svg` are not analyzed. `lit-analyzer` picks what to parse by
tag name, and `svg` is not on its list.

`lit-analyzer` is co-maintained by members of the Lit team but lives outside the
`lit` organization, and has not published a release since January 2024. This
package pins `lit-analyzer@2.0.3`, which in turn pins `typescript@~5.2`. That
compiler is older than the one `deno check` uses, so syntax newer than
TypeScript 5.2 may fail to parse here while checking fine elsewhere.

`@lit-labs/analyzer` is a different tool. It powers code generation and
documentation, and does not type check template bindings.
