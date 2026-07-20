import { parseArgs } from "@std/cli/parse-args";
import {
  ALL_RULE_IDS,
  type LitAnalyzerRules,
  type LitAnalyzerRuleSeverity,
} from "lit-analyzer";

import { DEFAULT_RULES, type RuleConfig } from "#analyze";
import { readAnalyzerField } from "#config";
import { REPORT_FORMATS, type ReportFormat } from "#report";

/** Everything the run needs after the flags and `deno.json` are read. */
export interface Options {
  /** Files and directories to check. */
  paths: string[];
  /** Which ruleset to run and the severities layered on top of it. */
  ruleConfig: RuleConfig;
  /** Which layout to render problems in. */
  format: ReportFormat;
  /** Drops warnings from the report entirely. */
  quiet: boolean;
  /** How many warnings may be reported before the run fails. -1 allows any. */
  maxWarnings: number;
  /** Whether escape sequences may be emitted. */
  color: boolean;
}

/** Flags this CLI accepts, besides the paths to check. */
const FLAGS = ["help", "format", "noColor", "quiet", "maxWarnings"];

/** Fields the `litAnalyzer` object in `deno.json` may declare. */
const FIELDS = ["strict", "rules"];

// These two decide which rules run at which severity, which is what a problem
// even is. That has to hold for everyone on the project, so they are read from
// `deno.json` and rejected on the command line rather than silently ignored.
/** Upstream flags that moved into `deno.json`, and the field each became. */
const MOVED = new Map<string, string>([
  ["strict", "strict"],
  ["rules", "rules"],
]);

/** Upstream flags this CLI drops, and what to use instead. */
const DROPPED = new Map<string, string>([
  ["outFile", "redirect the output instead, as in `... > report.txt`"],
  ["failFast", "the exit code already says whether the run failed"],
  ["debug", "there is nothing to debug in the argument parsing here"],
]);

/** Text `--help` prints. */
export const HELP: string = `
  Usage
    deno-lit-analyzer [<file|directory>...]

  Options
    --help                Print this message.
    --format FORMAT       Specify output format. The possible options are:
                            o code                Highlight problems in the code
                                                  (default)
                            o list                Short and precise list
                            o markdown            Markdown format
    --noColor             Print results without color. NO_COLOR works too.
    --quiet               Report only errors and not warnings.
    --maxWarnings NUMBER  Fail only when the number of warnings is larger than
                          this number.

  Which rules run, and at what severity, lives in deno.json so that it is the
  same for everyone on the project:

    "litAnalyzer": {
      "strict": true,
      "rules": { "no-unknown-tag-name": "error" }
    }

  Severity can be "off" | "warn" | "error". The possible rules are:
${
  ALL_RULE_IDS.map((ruleId) => {
    return `    o  ${ruleId}`;
  }).join("\n")
}

  Examples
    deno-lit-analyzer src
    deno-lit-analyzer src tests
    deno-lit-analyzer --format list --quiet src
`;

/** Reads the flags and `deno.json` into one set of options. */
export async function readOptions(
  args: string[],
  configPath: string,
): Promise<Options | null> {
  const parsed = parseArgs(args, {
    boolean: ["help", "noColor", "quiet"],
    string: ["format"],
  });
  if (parsed.help) {
    console.log(HELP);
    return null;
  }
  rejectUnknownFlags(Object.keys(parsed));

  const declared = await readAnalyzerField(configPath);
  rejectUnknownFields(declared);
  const paths = parsed._.map(String);

  return {
    paths: paths.length === 0 ? ["src"] : paths,
    ruleConfig: {
      strict: pickBoolean(declared.get("strict"), false),
      rules: { ...DEFAULT_RULES, ...asRules(declared.get("rules")) },
    },
    format: pickFormat(parsed.format),
    quiet: pickBoolean(parsed.quiet, false),
    maxWarnings: pickNumber(parsed.maxWarnings, -1),
    // `Deno.noColor` already reflects `NO_COLOR`, and reading it needs no
    // environment permission the way `Deno.env.get` would.
    color: !parsed.noColor && !Deno.noColor,
  };
}

// A flag that is quietly ignored is the worst outcome here, because the run
// still prints a result and the user believes the flag applied.
/** Fails on any flag this CLI does not take, naming what to use instead. */
function rejectUnknownFlags(keys: string[]): void {
  for (const key of keys) {
    if (key === "_" || FLAGS.includes(key)) {
      continue;
    }
    const field = MOVED.get(key);
    if (field !== undefined) {
      const where = `"${field}" under "litAnalyzer" in deno.json`;
      throw new Error(`--${key} is not a flag here, declare ${where} instead`);
    }
    const reason = DROPPED.get(key);
    if (reason !== undefined) {
      throw new Error(`--${key} is not supported, ${reason}`);
    }
    throw new Error(`Unknown flag --${key}`);
  }
}

// Deno ignores a field it does not know, so a stray one here reaches us and
// would otherwise be dropped just as quietly, leaving the run to look as if
// the setting applied.
/** Fails on any `litAnalyzer` field that is not read, naming the flag. */
function rejectUnknownFields(declared: Map<string, unknown>): void {
  for (const field of declared.keys()) {
    if (FIELDS.includes(field)) {
      continue;
    }
    if (FLAGS.includes(field)) {
      throw new Error(`"${field}" is not a deno.json field, pass --${field}`);
    }
    throw new Error(`Unknown "litAnalyzer" field "${field}"`);
  }
}

/** Keeps the entries of a decoded object that name a real rule. */
function asRules(value: unknown): LitAnalyzerRules {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const declared = new Map(Object.entries(value));
  const rules: LitAnalyzerRules = {};
  for (const ruleId of ALL_RULE_IDS) {
    const severity = declared.get(ruleId);
    if (severity !== undefined) {
      rules[ruleId] = asSeverity(severity, ruleId);
      declared.delete(ruleId);
    }
  }

  // A misspelled rule id would otherwise be dropped without a word, and the
  // rule the user meant to turn off would stay on.
  const [unknown] = declared.keys();
  if (unknown !== undefined) {
    throw new Error(`Unknown rule "${unknown}"`);
  }
  return rules;
}

/** Narrows a decoded value to a severity the analyzer accepts. */
function asSeverity(value: unknown, ruleId: string): LitAnalyzerRuleSeverity {
  switch (value) {
    case "off":
      return "off";
    case "warn":
      return "warn";
    case "warning":
      return "warning";
    case "error":
      return "error";
    case "on":
      return "on";
    default: {
      const given = String(value);
      const expected = `"off", "warn", or "error"`;
      throw new Error(
        `Invalid severity "${given}" for rule "${ruleId}", expected ${expected}`,
      );
    }
  }
}

/** Resolves a format name, rejecting one the report cannot render. */
function pickFormat(value: unknown): ReportFormat {
  const wanted = typeof value === "string" ? value.toLowerCase() : "code";
  switch (wanted) {
    case "code":
      return "CODE";
    case "list":
      return "LIST";
    case "markdown":
      return "MARKDOWN";
    default: {
      const expected = REPORT_FORMATS.join(", ");
      throw new Error(
        `Unknown format "${String(value)}", expected one of ${expected}`,
      );
    }
  }
}

/** Takes the declared value when it is one, and the default when it is not. */
function pickBoolean(declared: unknown, fallback: boolean): boolean {
  return typeof declared === "boolean" ? declared : fallback;
}

/** Takes the declared value when it is one, and the default when it is not. */
function pickNumber(declared: unknown, fallback: number): number {
  return typeof declared === "number" ? declared : fallback;
}
