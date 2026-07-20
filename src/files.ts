import { globToRegExp, resolve } from "@std/path";

/** Extensions TypeScript can hand to the analyzer. */
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

// `deno lint` and `deno fmt` skip these two whatever the config says, so a
// project that never wrote an `exclude` list still behaves the way its other
// Deno tooling does.
/** Directories skipped before `exclude` is even consulted. */
const ALWAYS_SKIPPED = ["node_modules", ".git"];

// Paths use forward slashes on every platform because TypeScript normalizes
// `SourceFile.fileName` that way. A path built with the platform separator
// would never match one, and every diagnostic would be silently dropped.
/** Resolves the given files and directories into absolute source paths. */
export async function collectFiles(
  paths: string[],
  excludes: string[] = [],
): Promise<string[]> {
  const patterns = excludes.map(toPattern);
  const collected = new Set<string>();
  for (const path of paths) {
    await collectPath(normalize(resolve(path)), patterns, collected);
  }
  return [...collected].sort();
}

/** Adds one file, or every source file under one directory, to the set. */
async function collectPath(
  path: string,
  patterns: RegExp[],
  collected: Set<string>,
): Promise<void> {
  const info = await Deno.stat(path).catch(() => {
    throw new Error(`No such file or directory: ${path}`);
  });
  if (!info.isDirectory) {
    collected.add(path);
    return;
  }
  for await (const entry of Deno.readDir(path)) {
    const child = `${path}/${entry.name}`;
    if (ALWAYS_SKIPPED.includes(entry.name) || isExcluded(child, patterns)) {
      continue;
    }
    if (entry.isDirectory) {
      await collectPath(child, patterns, collected);
    } else if (
      EXTENSIONS.some((extension) => {
        return entry.name.endsWith(extension);
      })
    ) {
      collected.add(child);
    }
  }
}

// An entry without a glob in it names a file or a directory, and excluding a
// directory has to exclude everything under it, so a plain entry matches as a
// prefix rather than exactly.
/** Turns one `exclude` entry into the pattern a path is tested against. */
function toPattern(entry: string): RegExp {
  const path = normalize(resolve(entry));
  if (/[*?[\]{}]/.test(entry)) {
    return globToRegExp(path, { globstar: true });
  }
  return new RegExp(`^${escapeRegExp(path)}(/|$)`);
}

/** Decides whether a path was excluded by `deno.json`. */
function isExcluded(path: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => {
    return pattern.test(path);
  });
}

/** Escapes the characters that would otherwise be regular expression syntax. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrites platform separators as forward slashes. */
export function normalize(path: string): string {
  return path.replaceAll("\\", "/");
}
