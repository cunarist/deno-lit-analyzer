import { dirname, fromFileUrl, relative } from "@std/path";
import type ts from "typescript";

import { normalize } from "#files";

// A specifier that begins with a dot is a relative path TypeScript resolves on
// its own; every other one, an alias or a bare name, is what it cannot see.
const RELATIVE = /^\.\.?\//;

// TypeScript resolution adds the extension back, and a value that kept its own
// would be looked for as `ripple.ts.ts`, so every module extension is stripped.
const MODULE_EXT = /\.[mc]?[jt]sx?$/;

// `lit-analyzer` builds a plain TypeScript program whose resolver knows nothing
// about Deno's import map, workspaces, or remote modules, so an aliased import
// resolves to nothing and the element it defines reads as an unregistered tag.
// Deno already resolves all of that. The `@deno/graph` library on its own is not
// config aware and leaves an alias unresolved, so this drives `deno info`, which
// is that same graph engine with the project's config and workspace applied, and
// turns what it resolved into the `paths` the analyzer does read.
/** Resolves every alias in the given files into TypeScript path mappings. */
export async function readGraphPaths(
  filePaths: string[],
  configPath: string,
): Promise<ts.MapLike<string[]>> {
  if (filePaths.length === 0) {
    return {};
  }
  // The entry lives inside the project so Deno discovers the same config the
  // files resolve against; importing them by relative path pulls every one into
  // a single graph.
  const projectDir = dirname(configPath) || ".";
  const entry = await Deno.makeTempFile({ dir: projectDir, suffix: ".ts" });
  try {
    await Deno.writeTextFile(entry, entrySource(entry, filePaths));
    const graph = await runDenoInfo(entry, configPath);
    return graph === null ? {} : readPaths(graph);
  } finally {
    await Deno.remove(entry).catch(() => {});
  }
}

/** The resolved specifier on one side of a dependency edge. */
interface Resolved {
  specifier?: string;
}

/** One dependency edge, as `deno info --json` reports it. */
interface Dependency {
  specifier: string;
  code?: Resolved;
  type?: Resolved;
}

/** A module and the specifiers it depends on, as `deno info --json` reports it. */
interface GraphModule {
  dependencies?: Dependency[];
}

/** The whole graph document `deno info --json` prints. */
interface Graph {
  modules: GraphModule[];
}

/** Writes an entry that imports each file so one graph covers them all. */
function entrySource(entry: string, filePaths: string[]): string {
  const from = dirname(entry);
  return filePaths.map((path) => {
    const rel = normalize(relative(from, path));
    const specifier = rel.startsWith(".") ? rel : `./${rel}`;
    return `import ${JSON.stringify(specifier)};`;
  }).join("\n");
}

/** Runs `deno info --json`, returning the parsed graph or null on failure. */
async function runDenoInfo(
  entry: string,
  configPath: string,
): Promise<Graph | null> {
  // The config is named rather than discovered so resolution uses the same
  // import map the analyzer was pointed at, whatever the working directory is.
  const command = new Deno.Command("deno", {
    args: ["info", "--json", "--config", configPath, entry],
    stdout: "piped",
    stderr: "null",
  });
  const output = await command.output().catch(() => {
    return null;
  });
  if (output === null || !output.success) {
    return null;
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(output.stdout));
  if (
    parsed === null || typeof parsed !== "object" || !("modules" in parsed) ||
    !Array.isArray(parsed.modules)
  ) {
    return null;
  }
  return { modules: parsed.modules };
}

/** Collects each aliased specifier and the file Deno resolved it to. */
function readPaths(graph: Graph): ts.MapLike<string[]> {
  const paths: ts.MapLike<string[]> = {};
  for (const module of graph.modules) {
    for (const dependency of module.dependencies ?? []) {
      addPath(paths, dependency);
    }
  }
  return paths;
}

/** Records one dependency as a path mapping when it names a project file. */
function addPath(paths: ts.MapLike<string[]>, dependency: Dependency): void {
  const { specifier } = dependency;
  // A `npm:` or `jsr:` package resolves under its own scheme rather than to a
  // file, and even one that resolved to a cached file belongs to node
  // resolution, which reads its types out of `node_modules`. Mapping is for the
  // project's own files, so a package is left alone whichever way it resolved.
  const resolved = dependency.code?.specifier ?? dependency.type?.specifier;
  if (
    RELATIVE.test(specifier) || specifier in paths ||
    resolved === undefined || !resolved.startsWith("file:") ||
    resolved.includes("/node_modules/")
  ) {
    return;
  }
  paths[specifier] = [normalize(fromFileUrl(resolved)).replace(MODULE_EXT, "")];
}
