/**
 * Minimal line-based unified diff for revise preview (EPIC-003, FEAT-011 §4.0).
 *
 * Implements a Wagner–Fischer LCS over lines, then prints hunks with
 * `+` / `-` prefixes. Not a general-purpose diff tool — scoped to small
 * planning artifacts (typically <1K lines), where O(m×n) time/memory is
 * comfortable. Line equality is exact after trimming trailing newlines.
 *
 * We don't pull in an npm diff library because (a) the algorithm is small,
 * (b) the format we emit is fixed and narrow, and (c) keeping the
 * dependency footprint tight is a stated project preference.
 */

interface DiffItem {
  kind: 'same' | 'add' | 'remove';
  line: string;
}

interface Hunk {
  oldStart: number;
  newStart: number;
  items: DiffItem[];
}

export interface UnifiedDiffOptions {
  /** Number of unchanged context lines around each change. Default: 3. */
  context?: number;
  /** Labels printed on the file-header `---` / `+++` rows. */
  oldLabel?: string;
  newLabel?: string;
}

/**
 * Compute a unified diff between two strings. Empty string on either side
 * is valid. Trailing newlines are normalized so a file that ends in `\n`
 * does not spuriously diff against one that does not.
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  options: UnifiedDiffOptions = {},
): string {
  const contextLines = options.context ?? 3;
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  const items = lcsDiff(oldLines, newLines);
  const hunks = buildHunks(items, contextLines);
  if (hunks.length === 0) return ''; // identical

  const out: string[] = [];
  out.push(`--- ${options.oldLabel ?? 'a'}`);
  out.push(`+++ ${options.newLabel ?? 'b'}`);
  for (const hunk of hunks) {
    const oldLen = hunk.items.filter((i) => i.kind !== 'add').length;
    const newLen = hunk.items.filter((i) => i.kind !== 'remove').length;
    out.push(`@@ -${hunk.oldStart + 1},${oldLen} +${hunk.newStart + 1},${newLen} @@`);
    for (const it of hunk.items) {
      const prefix = it.kind === 'add' ? '+' : it.kind === 'remove' ? '-' : ' ';
      out.push(`${prefix}${it.line}`);
    }
  }
  return out.join('\n');
}

function splitLines(s: string): string[] {
  if (s.length === 0) return [];
  // Preserve empty-trailing-line behavior: drop a single trailing '' so the
  // diff of "a\n" vs "a" is empty rather than noisy.
  const lines = s.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Build a sequence of DiffItems from two line arrays using LCS backtracking.
 */
function lcsDiff(a: string[], b: string[]): DiffItem[] {
  const m = a.length;
  const n = b.length;
  // dp[i][j] = length of LCS of a[0..i) and b[0..j)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      dp[i + 1][j + 1] = a[i] === b[j] ? dp[i][j] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const items: DiffItem[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      items.push({ kind: 'same', line: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      items.push({ kind: 'remove', line: a[i - 1] });
      i--;
    } else {
      items.push({ kind: 'add', line: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    items.push({ kind: 'remove', line: a[--i] });
  }
  while (j > 0) {
    items.push({ kind: 'add', line: b[--j] });
  }
  items.reverse();
  return items;
}

/** Group items into hunks that include `context` unchanged lines around each change. */
function buildHunks(items: DiffItem[], context: number): Hunk[] {
  const hunks: Hunk[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  // First pass: mark index of every item in old/new streams
  const marks = items.map((it) => {
    const m = { item: it, oldIdx, newIdx };
    if (it.kind !== 'add') oldIdx++;
    if (it.kind !== 'remove') newIdx++;
    return m;
  });

  let i = 0;
  while (i < marks.length) {
    if (marks[i].item.kind === 'same') {
      i++;
      continue;
    }
    // Change region: expand left by `context`, then run forward including
    // intermediate small same-runs (≤ 2*context apart → merge).
    const start = Math.max(0, i - context);
    let end = i;
    while (end < marks.length) {
      if (marks[end].item.kind !== 'same') {
        end++;
        continue;
      }
      // Look ahead: is the next change within 2*context?
      let sameRun = 0;
      let k = end;
      while (k < marks.length && marks[k].item.kind === 'same') {
        sameRun++;
        k++;
      }
      if (k >= marks.length || sameRun > 2 * context) {
        // Close the hunk after `context` trailing same-lines.
        end += Math.min(context, sameRun);
        break;
      }
      end = k;
    }
    const slice = marks.slice(start, Math.min(end, marks.length));
    hunks.push({
      oldStart: marks[start].oldIdx,
      newStart: marks[start].newIdx,
      items: slice.map((s) => s.item),
    });
    i = end;
  }
  return hunks;
}
