import {
  DefaultLitAnalyzerContext,
  LitAnalyzer,
  type LitAnalyzerRules,
  type LitDiagnosticSeverity,
  makeConfig,
} from "lit-analyzer";
import ts from "typescript";

/** One problem the analyzer found inside a template. */
export interface LitProblem {
  /** Absolute path of the file, using forward slashes. */
  fileName: string;
  /** One-based line number. */
  line: number;
  /** One-based column number. */
  column: number;
  /** How many characters the problem spans, at least one. */
  length: number;
  /** The source line the problem starts on, without its line break. */
  lineText: string;
  /** Whether the problem fails the run on its own. */
  severity: LitDiagnosticSeverity;
  /** The rule that reported the problem, such as `no-unclosed-tag`. */
  ruleId: string;
  /** Human readable description of the problem. */
  message: string;
}

/** Which ruleset to run and the per-rule severities layered on top of it. */
export interface RuleConfig {
  /** Selects the analyzer's strict preset rather than its default one. */
  strict: boolean;
  /** Per-rule severities, which win over whatever the preset decided. */
  rules: LitAnalyzerRules;
}

// These are the rules whose preset severity is wrong for this tool. The `off`
// entries resolve custom elements by walking imports and report an unknown tag
// for every element a project registers indirectly, which is noise rather than
// signal: one real codebase produced 156 of them against 3 genuine errors.
// `no-unintended-mixed-binding` is a real typo the preset leaves at warning
// level, so it is promoted instead. A project can override any of these.
/** Rule severities this package applies before the project's own. */
export const DEFAULT_RULES: LitAnalyzerRules = {
  "no-unknown-tag-name": "off",
  "no-missing-import": "off",
  "no-unknown-attribute": "off",
  "no-unknown-property": "off",
  "no-unknown-slot": "off",
  "no-property-visibility-mismatch": "off",
  "no-unintended-mixed-binding": "error",
};

/** Type checks the `html` and `css` templates in the given files. */
export function analyzeFiles(
  filePaths: string[],
  options: ts.CompilerOptions,
  ruleConfig: RuleConfig,
): LitProblem[] {
  const program = ts.createProgram(filePaths, options);
  const context = new DefaultLitAnalyzerContext({
    getProgram: () => {
      return program;
    },
  });
  context.updateConfig(makeConfig({
    strict: ruleConfig.strict,
    rules: ruleConfig.rules,
  }));
  const analyzer = new LitAnalyzer(context);

  const wanted = new Set(filePaths);
  const problems: LitProblem[] = [];
  for (const file of program.getSourceFiles()) {
    if (!wanted.has(file.fileName)) {
      continue;
    }
    for (const diagnostic of analyzer.getDiagnosticsInFile(file)) {
      const position = file.getLineAndCharacterOfPosition(
        diagnostic.location.start,
      );
      problems.push({
        fileName: file.fileName,
        line: position.line + 1,
        column: position.character + 1,
        length: Math.max(
          1,
          diagnostic.location.end - diagnostic.location.start,
        ),
        lineText: lineTextAt(file, position.line),
        severity: diagnostic.severity,
        ruleId: diagnostic.source ?? "",
        message: diagnostic.message,
      });
    }
  }
  return problems;
}

/** Returns one zero-based line of a source file, without its line break. */
function lineTextAt(file: ts.SourceFile, line: number): string {
  const text = file.getFullText();
  const starts = file.getLineStarts();
  const start = starts[line];
  const end = line + 1 < starts.length ? starts[line + 1] : text.length;
  return text.slice(start, end).replace(/\r?\n$/, "");
}
