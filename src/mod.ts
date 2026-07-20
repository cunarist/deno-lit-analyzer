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

import { analyzeFiles, type LitProblem } from "#analyze";
import { readCompilerOptions, readExcludes } from "#config";
import { collectFiles, normalize } from "#files";
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
  const excludes = await readExcludes(CONFIG_PATH);
  const filePaths = await collectFiles(options.paths, excludes);
  if (filePaths.length === 0) {
    console.error("Error: No source files found");
    Deno.exit(1);
  }

  console.log(renderProgress(filePaths.length));
  const found = analyzeFiles(filePaths, compilerOptions, options.ruleConfig);
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
