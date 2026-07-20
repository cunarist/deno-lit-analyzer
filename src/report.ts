import type { LitProblem } from "#analyze";

// The union is upper case because `explicit-naming` requires it. The CLI
// lowercases whatever `--format` was given before matching against it, so the
// spelling a user types is the same one `lit-analyzer` accepts.
/** How problems are laid out on the terminal. */
export type ReportFormat = "CODE" | "LIST" | "MARKDOWN";

/** Every value `--format` accepts, in the spelling a user types. */
export const REPORT_FORMATS: string[] = ["code", "list", "markdown"];

/** Everything the report needs besides the problems themselves. */
export interface ReportOptions {
  /** Which layout to render. */
  format: ReportFormat;
  /** Whether escape sequences may be emitted. */
  color: boolean;
  /** Absolute directory paths are shown relative to, using forward slashes. */
  currentDir: string;
}

/** Renders the line printed before the analyzer runs. */
export function renderProgress(fileCount: number): string {
  return `Analyzing ${fileCount} file${fileCount === 1 ? "" : "s"}...`;
}

/** Renders the whole run as the text to print, without a trailing newline. */
export function renderReport(
  problems: LitProblem[],
  fileCount: number,
  options: ReportOptions,
): string {
  const groups = groupByFile(problems);
  const lines: string[] = [];
  for (const [fileName, group] of groups) {
    const shown = relativize(fileName, options.currentDir);
    lines.push("");
    lines.push(fileHeading(shown, options));
    if (options.format === "MARKDOWN") {
      lines.push(...markdownTable([
        ["Line", "Column", "Type", "Rule", "Message"],
        ...group.map(markdownRow),
      ]));
      continue;
    }
    for (const problem of group) {
      lines.push(...renderProblem(problem, options));
    }
  }
  lines.push("");
  lines.push(...renderSummary(problems, fileCount, groups.size, options));
  return lines.join("\n");
}

// `generalReport` in the upstream CLI counts the files that had a problem, not
// the files it looked at, and only mentions the total when the run was clean.
/** Renders the count line that closes the report. */
function renderSummary(
  problems: LitProblem[],
  fileCount: number,
  filesWithProblems: number,
  options: ReportOptions,
): string[] {
  if (options.format === "MARKDOWN") {
    return renderMarkdownSummary(problems, fileCount, filesWithProblems);
  }
  if (problems.length === 0) {
    const files = count(fileCount, "file");
    return [paint(`  \u{2713} Found 0 problems in ${files}`, GREEN, options)];
  }
  const errors = problems.filter((problem) => {
    return problem.severity === "error";
  }).length;
  const message = `  \u{2716} ${count(problems.length, "problem")} in ${
    count(filesWithProblems, "file")
  } (${count(errors, "error")}, ${count(problems.length - errors, "warning")})`;
  return [paint(message, errors > 0 ? RED : YELLOW, options)];
}

/** Renders one problem in whichever layout was asked for. */
function renderProblem(
  problem: LitProblem,
  options: ReportOptions,
): string[] {
  if (options.format === "LIST") {
    const line = pad(`${problem.line}`, 5);
    const column = pad(`${problem.column - 1}`, 4, "right");
    const severity = pad(problem.severity, 18, "right");
    const painted = paint(severity, severityColor(problem), options);
    return [`${line}:${column} ${painted} ${problem.message}`];
  }
  return [
    "",
    `    ${paint(problem.message, BOLD, options)}`,
    `    ${paint(`${problem.line}:`, GRAY, options)} ${
      markLine(problem, options)
    }`,
    `    ${paint(problem.ruleId, GRAY, options)}`,
    "",
  ];
}

// Upstream collapses the indentation to a single space so the marked range
// stays near the left edge, and highlights it with a background rather than a
// caret underneath.
/** Renders the source line with the reported range highlighted. */
function markLine(problem: LitProblem, options: ReportOptions): string {
  const text = problem.lineText.replace(/^\s*/, " ");
  const start = problem.column - 1 -
    (problem.lineText.length - problem.lineText.trimStart().length) + 1;
  const before = text.slice(0, start);
  const marked = text.slice(start, start + problem.length);
  const after = text.slice(start + problem.length);
  const background = problem.severity === "error"
    ? RED_BACKGROUND
    : YELLOW_BACK;
  return `${before}${paint(marked, background, options)}${after}`;
}

/** Renders the line that names a file above its problems. */
function fileHeading(shown: string, options: ReportOptions): string {
  if (options.format === "MARKDOWN") {
    return `## ${shown}`;
  }
  return paint(shown, UNDERLINE, options);
}

/** Renders one problem as a row of the per-file markdown table. */
function markdownRow(problem: LitProblem): string[] {
  return [
    `${problem.line}`,
    `${problem.column}`,
    problem.severity === "error" ? "`error`" : "warning",
    problem.ruleId,
    problem.message,
  ];
}

/** Renders the markdown summary table that closes the report. */
function renderMarkdownSummary(
  problems: LitProblem[],
  fileCount: number,
  filesWithProblems: number,
): string[] {
  const errors = problems.filter((problem) => {
    return problem.severity === "error";
  }).length;
  return [
    "## Summary",
    ...markdownTable([
      [
        "Files analyzed",
        "Files with problems",
        "Problems",
        "Errors",
        "Warnings",
      ],
      [
        `${fileCount}`,
        `${filesWithProblems}`,
        `${problems.length}`,
        `${errors}`,
        `${problems.length - errors}`,
      ],
    ]),
  ];
}

/** Widths `markdownTable` lays cells out with, matching the upstream CLI. */
const MIN_CELL_WIDTH = 3;
const MAX_CELL_WIDTH = 50;
const CELL_PADDING = 1;

// Upstream pads every cell to the widest one in its column, so the raw
// markdown lines up when read as plain text. Columns that are empty in every
// row but the header are dropped, except the first.
/** Lays rows out as a padded markdown table, blank line on either side. */
function markdownTable(rows: string[][]): string[] {
  const escaped = dropEmptyColumns(rows).map((row) => {
    return row.map(escapeCell);
  });
  const widths = escaped[0].map((_cell, index) => {
    const longest = Math.max(
      MIN_CELL_WIDTH,
      ...escaped.map((row) => {
        return (row[index] ?? "").length;
      }),
    );
    return Math.min(MAX_CELL_WIDTH, longest + CELL_PADDING * 2);
  });

  const line = (row: string[]): string => {
    return `|${
      row.map((cell, index) => {
        return fillWidth(cell, widths[index]);
      }).join("|")
    }|`;
  };
  const divider = `|${
    widths.map((width) => {
      return "-".repeat(width);
    }).join("|")
  }|`;
  return ["", line(escaped[0]), divider, ...escaped.slice(1).map(line), ""];
}

/** Drops columns that no row but the header fills, keeping the first. */
function dropEmptyColumns(rows: string[][]): string[][] {
  const columnCount = Math.max(...rows.map((row) => {
    return row.length;
  }));
  const empty = Array.from({ length: columnCount }, (_cell, index) => {
    return index !== 0 && rows.slice(1).every((row) => {
      return (row[index] ?? "").length === 0;
    });
  });
  if (!empty.includes(true)) {
    return rows;
  }
  return rows.map((row) => {
    return row.filter((_cell, index) => {
      return !empty[index];
    });
  });
}

/** Escapes a cell so a message cannot break the table it sits in. */
function escapeCell(text: string): string {
  return text
    .replaceAll("\n", "<br />")
    .replace(/(@\S+)/g, "`$1`")
    .replace(/([|<>])/g, "\\$1");
}

/** Pads a cell to its column width, one space in from the left. */
function fillWidth(text: string, width: number): string {
  const trailing = Math.max(1, width - text.length - CELL_PADDING);
  return `${" ".repeat(CELL_PADDING)}${text}${" ".repeat(trailing)}`;
}

/** Groups problems by file, keeping the order they were reported in. */
function groupByFile(problems: LitProblem[]): Map<string, LitProblem[]> {
  const groups = new Map<string, LitProblem[]>();
  for (const problem of problems) {
    const group = groups.get(problem.fileName);
    if (group === undefined) {
      groups.set(problem.fileName, [problem]);
    } else {
      group.push(problem);
    }
  }
  return groups;
}

/** Shortens a path that sits under the current directory. */
function relativize(fileName: string, currentDir: string): string {
  return fileName.startsWith(`${currentDir}/`)
    ? `.${fileName.slice(currentDir.length)}`
    : fileName;
}

/** Writes a count with its noun, pluralized. */
function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? "" : "s"}`;
}

/** Pads text to a width, on the left unless told otherwise. */
function pad(text: string, width: number, dir?: string): string {
  const filler = " ".repeat(Math.max(0, width - text.length));
  return dir === "right" ? `${text}${filler}` : `${filler}${text}`;
}

/** Select graphic rendition parameters, paired with the code that resets one. */
const BOLD: [string, string] = ["1", "22"];
const GRAY: [string, string] = ["90", "39"];
const RED: [string, string] = ["31", "39"];
const GREEN: [string, string] = ["32", "39"];
const YELLOW: [string, string] = ["33", "39"];
const UNDERLINE: [string, string] = ["4", "24"];
const RED_BACKGROUND: [string, string] = ["101;30", "49;39"];
const YELLOW_BACK: [string, string] = ["103;30", "49;39"];

/** Picks the color a problem's severity word is printed in. */
function severityColor(problem: LitProblem): [string, string] {
  return problem.severity === "error" ? RED : YELLOW;
}

/** Wraps text in an escape sequence, unless color is turned off. */
function paint(
  text: string,
  code: [string, string],
  options: ReportOptions,
): string {
  if (!options.color) {
    return text;
  }
  return `\x1B[${code[0]}m${text}\x1B[${code[1]}m`;
}
