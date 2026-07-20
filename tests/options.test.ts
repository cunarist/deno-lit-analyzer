import { assertEquals, assertRejects } from "@std/assert";

import { type Options, readOptions } from "#options";

const PLAIN_CONFIG = "tests/fixture/deno.json";
const CONFIGURED = "tests/fixture/configured.json";

/** Reads options and fails the test if `--help` short circuited the read. */
async function read(
  args: string[],
  configPath: string,
): Promise<Options> {
  const options = await readOptions(args, configPath);
  if (options === null) {
    throw new Error("readOptions returned null");
  }
  return options;
}

// `strict` defaults to false, the same as the upstream CLI. The fixture used
// here declares no `litAnalyzer` field at all.
Deno.test("the package defaults apply when nothing declares otherwise", async () => {
  const options = await read([], "tests/fixture/empty.json");
  assertEquals(options.paths, ["src"]);
  assertEquals(options.ruleConfig.strict, false);
  assertEquals(options.format, "CODE");
  assertEquals(options.maxWarnings, -1);
  assertEquals(options.ruleConfig.rules["no-unknown-tag-name"], "off");
  assertEquals(
    options.ruleConfig.rules["no-unintended-mixed-binding"],
    "error",
  );
});

Deno.test("deno.json overrides the package defaults", async () => {
  const options = await read([], CONFIGURED);
  assertEquals(options.ruleConfig.strict, false);
  assertEquals(options.ruleConfig.rules["no-unknown-tag-name"], "warn");
  assertEquals(options.ruleConfig.rules["no-unclosed-tag"], "off");
  // Untouched entries keep the package default rather than being replaced.
  assertEquals(options.ruleConfig.rules["no-missing-import"], "off");
});

Deno.test("the flags are read while deno.json is left alone", async () => {
  const options = await read(
    ["--format", "markdown", "--maxWarnings", "0", "--quiet", "lib"],
    CONFIGURED,
  );
  assertEquals(options.paths, ["lib"]);
  assertEquals(options.format, "MARKDOWN");
  assertEquals(options.maxWarnings, 0);
  assertEquals(options.quiet, true);
  assertEquals(options.ruleConfig.rules["no-unclosed-tag"], "off");
});

// The mirror of rejecting a moved flag. A field Deno itself ignores would
// otherwise be dropped just as quietly, and the run would look as if it took.
Deno.test("a flag written as a deno.json field is rejected", async () => {
  await assertRejects(
    () => {
      return readOptions([], "tests/fixture/misplaced.json");
    },
    Error,
    '"quiet" is not a deno.json field, pass --quiet',
  );
});

// A flag that is quietly ignored is worse than one that fails, because the run
// still prints a result and the user believes the flag applied.
Deno.test("a setting that moved into deno.json is rejected as a flag", async () => {
  await assertRejects(
    () => {
      return readOptions(["--rules.no-unclosed-tag", "off"], PLAIN_CONFIG);
    },
    Error,
    '--rules is not a flag here, declare "rules" under "litAnalyzer"',
  );
  await assertRejects(
    () => {
      return readOptions(["--strict"], PLAIN_CONFIG);
    },
    Error,
    '--strict is not a flag here, declare "strict" under "litAnalyzer"',
  );
});

Deno.test("a dropped upstream flag says what to use instead", async () => {
  await assertRejects(
    () => {
      return readOptions(["--outFile", "report.txt"], PLAIN_CONFIG);
    },
    Error,
    "--outFile is not supported, redirect the output instead",
  );
});

Deno.test("a flag that never existed is rejected", async () => {
  await assertRejects(
    () => {
      return readOptions(["--colour"], PLAIN_CONFIG);
    },
    Error,
    "Unknown flag --colour",
  );
});

Deno.test("--help prints instead of returning options", async () => {
  assertEquals(await readOptions(["--help"], PLAIN_CONFIG), null);
});

// A misspelled rule id or severity would otherwise be dropped in silence, and
// the rule the user meant to change would keep its old severity.
Deno.test("a rule id that does not exist is rejected", async () => {
  await assertRejects(
    () => {
      return readOptions([], "tests/fixture/misspelled.json");
    },
    Error,
    'Unknown rule "no-unclosed-tags"',
  );
});

Deno.test("a severity that does not exist is rejected", async () => {
  await assertRejects(
    () => {
      return readOptions([], "tests/fixture/bad-severity.json");
    },
    Error,
    'Invalid severity "loud"',
  );
});

Deno.test("a format that cannot be rendered is rejected", async () => {
  await assertRejects(
    () => {
      return readOptions(["--format", "json"], PLAIN_CONFIG);
    },
    Error,
    'Unknown format "json"',
  );
});
