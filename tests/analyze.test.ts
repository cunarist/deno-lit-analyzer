import { assert, assertEquals } from "@std/assert";
import ts from "typescript";

import { analyzeFiles, DEFAULT_RULES, type RuleConfig } from "#analyze";
import { readCompilerOptions, readNodeModulesDir } from "#config";
import { collectFiles } from "#files";

const FIXTURE_CONFIG = "tests/fixture/deno.json";

/** What the CLI runs with when neither a flag nor `deno.json` says otherwise. */
const RULE_CONFIG: RuleConfig = { strict: true, rules: DEFAULT_RULES };

Deno.test("deno.ns is dropped from lib so TypeScript keeps the rest", async () => {
  const options = await readCompilerOptions(FIXTURE_CONFIG);
  assertEquals(options.lib, [
    "lib.es2022.d.ts",
    "lib.dom.d.ts",
    "lib.dom.iterable.d.ts",
  ]);
});

Deno.test("module resolution is forced so node_modules is reachable", async () => {
  const options = await readCompilerOptions(FIXTURE_CONFIG);
  assertEquals(options.moduleResolution, ts.ModuleResolutionKind.Bundler);
});

Deno.test("nodeModulesDir is read, and its absence reads as unset", async () => {
  assertEquals(
    await readNodeModulesDir("tests/fixture/node-modules-auto.json"),
    "AUTO",
  );
  // The legacy boolean form is normalized so the caller has one thing to check.
  assertEquals(
    await readNodeModulesDir("tests/fixture/node-modules-off.json"),
    "NONE",
  );
  // Pairs with the above: a fixture that never declares the field must not be
  // mistaken for one that opts in, or the warning would never fire.
  assertEquals(await readNodeModulesDir(FIXTURE_CONFIG), "UNSET");
});

Deno.test("a sound template reports nothing", async () => {
  const options = await readCompilerOptions(FIXTURE_CONFIG);
  const filePaths = await collectFiles(["tests/fixture/good"]);
  assertEquals(analyzeFiles(filePaths, options, RULE_CONFIG), []);
});

Deno.test("an unclosed tag is reported", async () => {
  const options = await readCompilerOptions(FIXTURE_CONFIG);
  const filePaths = await collectFiles(["tests/fixture/bad"]);
  const problems = analyzeFiles(filePaths, options, RULE_CONFIG);
  assertEquals(problems.length, 1);
  assertEquals(problems[0].ruleId, "no-unclosed-tag");
  assert(problems[0].fileName.endsWith("tests/fixture/bad/element.ts"));
});

Deno.test("a string bound to a union-typed property is reported", async () => {
  const options = await readCompilerOptions(FIXTURE_CONFIG);
  const filePaths = await collectFiles(["tests/fixture/mismatch"]);
  const problems = analyzeFiles(filePaths, options, RULE_CONFIG);
  assertEquals(problems.length, 1);
  assertEquals(problems[0].ruleId, "no-incompatible-type-binding");
  assertEquals(
    problems[0].message,
    `Type 'string' is not assignable to '"brand" | "neutral"'`,
  );
  assert(problems[0].fileName.endsWith("tests/fixture/mismatch/usage.ts"));
});

// Neither preset raises this rule above a warning, and `DEFAULT_RULES`
// promotes it. If the override stops being applied the problem disappears
// silently, so the rule id is pinned here.
Deno.test("a binding followed by a stray quote is reported", async () => {
  const options = await readCompilerOptions(FIXTURE_CONFIG);
  const filePaths = await collectFiles(["tests/fixture/mixed"]);
  const problems = analyzeFiles(filePaths, options, RULE_CONFIG);
  assertEquals(problems.length, 1);
  assertEquals(problems[0].ruleId, "no-unintended-mixed-binding");
  assert(problems[0].fileName.endsWith("tests/fixture/mixed/element.ts"));
});

// `no-unknown-tag-name` is turned off, so an undefined element is silent even
// though the strict preset would report it.
Deno.test("an unknown tag is not reported", async () => {
  const options = await readCompilerOptions(FIXTURE_CONFIG);
  const filePaths = await collectFiles(["tests/fixture/unknown"]);
  assertEquals(analyzeFiles(filePaths, options, RULE_CONFIG), []);
});

// Pairs with the test above. Without this one, an override that quietly
// stopped being applied would look exactly like one that worked.
Deno.test("an unknown tag is reported once the rule is turned on", async () => {
  const options = await readCompilerOptions(FIXTURE_CONFIG);
  const filePaths = await collectFiles(["tests/fixture/unknown"]);
  const problems = analyzeFiles(filePaths, options, {
    strict: true,
    rules: { ...DEFAULT_RULES, "no-unknown-tag-name": "error" },
  });
  assertEquals(problems.length, 1);
  assertEquals(problems[0].ruleId, "no-unknown-tag-name");
  assertEquals(problems[0].severity, "error");
});

// A path that is skipped leaves no trace in the report, so an exclude that
// quietly matched nothing would look exactly like one that worked.
Deno.test("an excluded directory is skipped", async () => {
  const all = await collectFiles(["tests/fixture"]);
  assert(all.some((path) => {
    return path.endsWith("tests/fixture/bad/element.ts");
  }));

  const kept = await collectFiles(["tests/fixture"], ["tests/fixture/bad"]);
  assert(
    !kept.some((path) => {
      return path.endsWith("tests/fixture/bad/element.ts");
    }),
  );
  assert(kept.some((path) => {
    return path.endsWith("tests/fixture/good/element.ts");
  }));
});

Deno.test("an exclude written as a glob is honored", async () => {
  const kept = await collectFiles(["tests/fixture"], ["**/mixed/*.ts"]);
  assert(
    !kept.some((path) => {
      return path.endsWith("tests/fixture/mixed/element.ts");
    }),
  );
  assert(kept.some((path) => {
    return path.endsWith("tests/fixture/good/element.ts");
  }));
});

Deno.test("collected paths use forward slashes and are absolute", async () => {
  const filePaths = await collectFiles(["tests/fixture/good"]);
  assertEquals(filePaths.length, 1);
  assert(!filePaths[0].includes("\\"));
  assert(filePaths[0].endsWith("tests/fixture/good/element.ts"));
});
