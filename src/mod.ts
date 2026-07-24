/**
 * A CLI that type checks Lit `html` and `css` templates in a Deno project.
 * `deno check` never looks inside a tagged template literal, so an attribute
 * bound to the wrong type is invisible to it. This wraps `lit-analyzer`, which
 * builds a real TypeScript program and checks the bindings against it. The
 * upstream CLI reads its compiler options from a `tsconfig.json` in the working
 * directory, and a Deno project has none, so this reads `compilerOptions` from
 * `deno.json` and hands the program to the analyzer directly. Everything that
 * decides what counts as a problem is declared in a `litAnalyzer` field there
 * rather than passed as a flag, so a run means the same thing for everyone on
 * the project. The process exits with code 0 when the run passes and 1 when it
 * does not, which makes it usable directly in CI or a pre-commit hook.
 * @module
 */

import { dirname } from "@std/path";

import { analyzeFiles, type LitProblem } from "#analyze";
import { readCompilerOptions, readExcludes, readNodeModulesDir } from "#config";
import { collectFiles, normalize } from "#files";
import { readGraphPaths } from "#graph";
import { readOptions } from "#options";
import { renderProgress, renderReport } from "#report";

/** The file both the compiler options and this tool's settings are read from. */
const CONFIG_PATH = "deno.json";

/** Runs the analyzer over the paths given on the command line. */
async function main(): Promise<void> {
  const options = await readOptions(Deno.args, CONFIG_PATH);
  if (options === null) {
    return;
  }

  const compilerOptions = await readCompilerOptions(CONFIG_PATH);
  await warnIfElementsUnreachable(CONFIG_PATH);
  const excludes = await readExcludes(CONFIG_PATH);
  const filePaths = await collectFiles(options.paths, excludes);
  if (filePaths.length === 0) {
    console.error("Error: No source files found");
    Deno.exit(1);
  }

  console.log(renderProgress(filePaths.length));
  const paths = await readGraphPaths(filePaths, CONFIG_PATH);
  const resolved = { ...compilerOptions, baseUrl: dirname(CONFIG_PATH), paths };
  const found = analyzeFiles(filePaths, resolved, options.ruleConfig);
  const problems = options.quiet
    ? found.filter((problem) => {
      return problem.severity === "error";
    })
    : found;

  console.log(renderReport(problems, filePaths.length, {
    format: options.format,
    color: options.color,
    currentDir: normalize(Deno.cwd()),
  }));

  if (isFailure(problems, options.maxWarnings)) {
    Deno.exit(1);
  }
}

// This mirrors `isSuccessful` in the upstream CLI: any error fails the run, and
// warnings only fail it once `maxWarnings` is set to something other than -1
// and the count goes past it.
/** Decides whether the reported problems should fail the run. */
function isFailure(problems: LitProblem[], maxWarnings: number): boolean {
  let warnings = 0;
  for (const problem of problems) {
    if (problem.severity === "error") {
      return true;
    }
    warnings += 1;
  }
  return maxWarnings !== -1 && warnings > maxWarnings;
}

// Third-party custom elements are typed from declarations that live in
// `node_modules`, and TypeScript only reads that directory from disk, not from
// Deno's module cache. When `nodeModulesDir` does not create it, those elements
// resolve to nothing and their bindings go unchecked while the run still passes.
// That is the one silent gap the report itself cannot show, so it is called out
// on stderr. The directory is looked for up the tree because a project resolves
// against a parent's `node_modules` the same way TypeScript does, and warning
// when one is reachable would be a false alarm.
/** Warns when the config will not put dependency types where TypeScript looks. */
async function warnIfElementsUnreachable(configPath: string): Promise<void> {
  const setting = await readNodeModulesDir(configPath);
  if (setting === "AUTO" || setting === "MANUAL") {
    return;
  }
  if (await nodeModulesReachable(Deno.cwd())) {
    return;
  }
  const shown = setting === "UNSET" ? "not set" : `"${setting.toLowerCase()}"`;
  console.error(
    `Warning: nodeModulesDir is ${shown} and no node_modules directory was ` +
      "found, so third-party custom elements are not type checked. Set " +
      `"nodeModulesDir": "auto" in ${configPath} to enable them.`,
  );
}

/** Reports whether a `node_modules` directory exists at `dir` or any parent. */
async function nodeModulesReachable(dir: string): Promise<boolean> {
  let current = dir;
  while (true) {
    try {
      if ((await Deno.stat(`${current}/node_modules`)).isDirectory) {
        return true;
      }
    } catch {
      // Nothing there; keep walking toward the root.
    }
    const parent = dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}

// A stack trace tells the user nothing about a misspelled flag or a path that
// is not there, and the exit code it leaves behind is the same either way.
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    Deno.exit(1);
  }
}
