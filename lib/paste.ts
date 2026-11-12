/**
 * Turns pasted plain text into structured blocks: text tables (box-drawing, ASCII grid, markdown
 * pipe tables, tab-separated) become real tables, and column-aligned text (tree diagrams,
 * aligned output, ASCII art) is kept verbatim in a monospace block. Everything else stays text.
 */
export type PasteBlock = (
  | { type: 'table'; rows: string[][]; header: boolean }
  | { type: 'pre'; text: string }
  | { type: 'text'; lines: string[] }
) & {
  /** The input lines the block came from: `from` inclusive, `to` exclusive. */
  from: number;
  to: number;
};

const BOX = /[─-╿]/;
const BOX_VERTICAL = /[│┃║╎╏┆┇┊┋]/;
const RULE = /^[─-╿\-=+:|\s]+$/;
const HORIZONTAL = /[─━═┄┅┈┉╌╍\-=]{2,}/;
const MD_DELIMITER = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

const isRule = (line: string) => {
  const t = line.trim();
  return RULE.test(t) && HORIZONTAL.test(t);
};
const isGridRow = (line: string) => /^[│┃║|]/.test(line.trim()) && !isRule(line);

/** Cells of one bordered row: `│ a │ b │` → ['a', 'b']. */
function gridCells(line: string): string[] {
  const t = line.trim();
  const split = BOX_VERTICAL.test(t) ? /[│┃║╎╏┆┇┊┋]/ : /\|/;
  const parts = t.split(split);
  // Drop the empty strings outside the outer borders.
  if (parts.length > 1 && !parts[0].trim()) parts.shift();
  if (parts.length > 1 && !parts[parts.length - 1].trim()) parts.pop();
  return parts.map((c) => c.trim());
}

function markdownCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/** Joins the physical lines of one wrapped row, column by column. */
function mergeLines(lines: string[][]): string[] {
  const cols = Math.max(...lines.map((l) => l.length));
  return Array.from({ length: cols }, (_, c) =>
    lines.map((l) => l[c] ?? '').filter(Boolean).join(' '));
}

/** Without row separators, a line whose first cell is empty continues the row above it. */
function rowsWithContinuations(lines: string[][]): string[][] {
  const rows: string[][][] = [];
  for (const cells of lines) {
    if (rows.length && !cells[0] && cells.some(Boolean)) rows[rows.length - 1].push(cells);
    else rows.push([cells]);
  }
  return rows.map(mergeLines);
}

function markdownTable(lines: string[], i: number) {
  const head = lines[i]?.trim();
  const delimiter = lines[i + 1]?.trim();
  if (!head || !delimiter || !head.includes('|') || !MD_DELIMITER.test(delimiter) || !delimiter.includes('-')) return null;
  const header = markdownCells(head);
  if (header.length !== markdownCells(delimiter).length) return null;
  const rows = [header];
  let end = i + 2;
  while (end < lines.length && lines[end].trim() && lines[end].includes('|')) rows.push(markdownCells(lines[end++]));
  if (rows.length === 1 && header.length < 2) return null;
  return { block: { type: 'table', rows, header: true, from: i, to: end } as PasteBlock, end };
}

function gridTable(lines: string[], i: number) {
  let end = i;
  while (end < lines.length && (isRule(lines[end]) || isGridRow(lines[end]))) end++;
  const run = lines.slice(i, end);
  if (!run.some(isGridRow) || !run.some(isRule)) return null;
  // Plain `|`-and-dash runs without box characters need `+` joints (ASCII grid) to count.
  if (!run.some((l) => BOX.test(l)) && !run.some((l) => isRule(l) && l.includes('+'))) return null;

  const groups: string[][][] = [];
  let current: string[][] = [];
  for (const line of run) {
    if (isRule(line)) {
      if (current.length) groups.push(current);
      current = [];
    } else current.push(gridCells(line));
  }
  if (current.length) groups.push(current);
  if (!groups.length) return null;

  let rows: string[][];
  if (groups.length > 2) {
    // A rule between every row, so each group is one row whose cells may wrap across lines.
    rows = groups.map(mergeLines);
  } else if (groups.length === 2) {
    rows = [mergeLines(groups[0]), ...rowsWithContinuations(groups[1])];
  } else {
    rows = rowsWithContinuations(groups[0]);
  }
  const block: PasteBlock = { type: 'table', rows, header: groups.length > 1, from: i, to: end };
  return { block, end };
}

/** Tab-separated values, as spreadsheets and many tools copy them. */
function tsvTable(lines: string[], from: number): PasteBlock | null {
  if (lines.length < 2) return null;
  const counts = lines.map((l) => (l.match(/\t/g) ?? []).length);
  if (!counts[0] || counts.some((c) => c !== counts[0])) return null;
  if (!lines.some((l) => l.trimStart().includes('\t'))) return null; // only indentation
  return { type: 'table', rows: lines.map((l) => l.split('\t').map((c) => c.trim())), header: false, from, to: from + lines.length };
}

/** A line laid out for a monospace font: box/tree characters, tabs, or space-aligned columns. */
const isAligned = (line: string) => BOX.test(line) || /\S\t/.test(line) || /\S {3,}\S/.test(line);

/** Classifies lines[from, to) chunk by chunk (chunks are separated by blank lines). */
function chunkBlocks(lines: string[], from: number, to: number, out: PasteBlock[]) {
  const chunks: { start: number; lines: string[] }[] = [];
  for (let i = from; i < to; i++) {
    if (!lines[i].trim()) continue;
    const prev = chunks[chunks.length - 1];
    if (prev && prev.start + prev.lines.length === i) prev.lines.push(lines[i]);
    else chunks.push({ start: i, lines: [lines[i]] });
  }
  for (const { start, lines: chunk } of chunks) {
    const end = start + chunk.length;
    const last = out[out.length - 1];
    const tsv = tsvTable(chunk, start);
    if (tsv) {
      out.push(tsv);
    } else if (chunk.length >= 2 && chunk.filter(isAligned).length * 2 >= chunk.length) {
      const text = chunk.join('\n');
      if (last?.type === 'pre') Object.assign(last, { text: `${last.text}\n\n${text}`, to: end });
      else out.push({ type: 'pre', text, from: start, to: end });
    } else if (last?.type === 'text') {
      last.lines.push(...chunk);
      last.to = end;
    } else {
      out.push({ type: 'text', lines: chunk, from: start, to: end });
    }
  }
}

/** Removes the indentation every line shares (terminal output is often indented). */
function dedentLines(lines: string[]) {
  const filled = lines.filter((l) => l.trim());
  const indent = filled.length ? Math.min(...filled.map((l) => /^ */.exec(l)![0].length)) : 0;
  return lines.map((l) => l.slice(indent).trimEnd());
}

export function parsePaste(raw: string): PasteBlock[] {
  const lines = dedentLines(raw.replace(/\r\n?/g, '\n').split('\n'));
  const blocks: PasteBlock[] = [];
  let pending = 0;
  for (let i = 0; i < lines.length;) {
    const table = markdownTable(lines, i) ?? gridTable(lines, i);
    if (table) {
      chunkBlocks(lines, pending, i, blocks);
      blocks.push(table.block);
      i = pending = table.end;
    } else {
      i++;
    }
  }
  chunkBlocks(lines, pending, lines.length, blocks);
  return blocks;
}
