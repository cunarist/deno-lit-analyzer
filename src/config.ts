import { parse } from "@std/jsonc";
import ts from "typescript";

// `moduleResolution` is the load-bearing entry. Without it TypeScript falls
// back to classic resolution, never looks inside `node_modules`, and every
// custom element becomes an unknown tag. The analyzer then reports nothing at
// all, so a missing value here reads as a clean run rather than a broken one.
/** Options `lit-analyzer` needs no matter what the project declares. */
const REQUIRED_OPTIONS: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  noEmit: true,
  noEmitOnError: false,
  allowJs: true,
  strictNullChecks: true,
  skipLibCheck: true,
};

/** Reads `compilerOptions` from a `deno.json` and adapts them for TypeScript. */
export async function readCompilerOptions(
  configPath: string,
): Promise<ts.CompilerOptions> {
  const text = await Deno.readTextFile(configPath);
  const declared = readCompilerOptionsField(parse(text));

  // TypeScript rejects the whole `lib` array when one entry is unknown to it,
  // and `deno.ns` always is. Dropping the Deno entries keeps `dom` and the
  // `es*` entries, which is what the templates are actually checked against.
  const lib = declared.get("lib");
  if (Array.isArray(lib)) {
    declared.set(
      "lib",
      lib.filter((entry) => {
        return typeof entry === "string" && !entry.startsWith("deno.");
      }),
    );
  }

  const { options } = ts.convertCompilerOptionsFromJson(
    Object.fromEntries(declared),
    dirname(configPath),
  );
  return { ...options, ...REQUIRED_OPTIONS };
}

// Deno ignores top level fields it does not know, so a project can keep this
// tool's settings next to the compiler options it already declares instead of
// carrying a second config file.
/** Reads the `litAnalyzer` object from a `deno.json`, if it declares one. */
export async function readAnalyzerField(
  configPath: string,
): Promise<Map<string, unknown>> {
  const text = await Deno.readTextFile(configPath);
  const config = parse(text);
  if (!isPlainObject(config)) {
    return new Map();
  }
  for (const [key, value] of Object.entries(config)) {
    if (key === "litAnalyzer" && isPlainObject(value)) {
      return new Map(Object.entries(value));
    }
  }
  return new Map();
}

/** Reads the top level `exclude` list from a `deno.json`, if it has one. */
export async function readExcludes(configPath: string): Promise<string[]> {
  const text = await Deno.readTextFile(configPath);
  const config = parse(text);
  if (!isPlainObject(config)) {
    return [];
  }
  for (const [key, value] of Object.entries(config)) {
    if (key === "exclude" && Array.isArray(value)) {
      return value.filter((entry) => {
        return typeof entry === "string";
      });
    }
  }
  return [];
}

/** Reads the `compilerOptions` object out of a parsed config, if it has one. */
function readCompilerOptionsField(config: unknown): Map<string, unknown> {
  if (!isPlainObject(config)) {
    return new Map();
  }
  for (const [key, value] of Object.entries(config)) {
    if (key === "compilerOptions" && isPlainObject(value)) {
      return new Map(Object.entries(value));
    }
  }
  return new Map();
}

/** Narrows a decoded JSON value to an object rather than an array or null. */
function isPlainObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Returns the directory part of a path that uses forward slashes. */
function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}
