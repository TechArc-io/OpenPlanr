import chalk from 'chalk';
import { describe, expect, it } from 'vitest';
import { renderDiff } from '../../src/services/diff-service.js';
import { unifiedDiff } from '../../src/utils/diff.js';

// Force chalk to emit ANSI codes even when stdout is not a TTY (vitest child).
// Level 1 = basic 16-color terminal support.
chalk.level = 1;

describe('unifiedDiff', () => {
  it('returns empty string for identical inputs', () => {
    expect(unifiedDiff('hello\nworld\n', 'hello\nworld\n')).toBe('');
  });

  it('returns empty string when only a trailing newline differs', () => {
    expect(unifiedDiff('hello\nworld', 'hello\nworld\n')).toBe('');
  });

  it('emits +++/--- headers', () => {
    const result = unifiedDiff('a\n', 'b\n', {
      oldLabel: 'artifact.md (before)',
      newLabel: 'artifact.md (proposed)',
    });
    expect(result).toContain('--- artifact.md (before)');
    expect(result).toContain('+++ artifact.md (proposed)');
  });

  it('shows + for added lines and - for removed lines', () => {
    const result = unifiedDiff('alpha\nbeta\ngamma\n', 'alpha\nBETA\ngamma\n');
    const lines = result.split('\n');
    expect(lines.some((l) => l === '-beta')).toBe(true);
    expect(lines.some((l) => l === '+BETA')).toBe(true);
    expect(lines.some((l) => l === ' alpha')).toBe(true);
    expect(lines.some((l) => l === ' gamma')).toBe(true);
  });

  it('emits hunk headers with @@ and 1-based line numbers', () => {
    const result = unifiedDiff('a\nb\nc\n', 'a\nB\nc\n');
    expect(result).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('handles pure additions', () => {
    const result = unifiedDiff('', 'new\nlines\n');
    expect(result).toContain('+new');
    expect(result).toContain('+lines');
  });

  it('handles pure deletions', () => {
    const result = unifiedDiff('gone\n', '');
    expect(result).toContain('-gone');
  });

  it('keeps context lines around changes', () => {
    const oldText = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
    const newText = ['a', 'b', 'c', 'D', 'e', 'f', 'g'].join('\n');
    const result = unifiedDiff(oldText, newText, { context: 2 });
    // Should include b, c (context before) and e, f (context after)
    expect(result).toContain(' b');
    expect(result).toContain(' c');
    expect(result).toContain(' e');
    expect(result).toContain(' f');
    expect(result).toContain('-d');
    expect(result).toContain('+D');
  });
});

describe('renderDiff', () => {
  it('returns empty string when inputs are identical', () => {
    expect(renderDiff('x\n', 'x\n')).toBe('');
  });

  it('emits the raw diff when color is disabled', () => {
    const result = renderDiff('a\n', 'b\n', { color: false });
    expect(result).toContain('-a');
    expect(result).toContain('+b');
    expect(result).not.toContain('\u001b['); // no ANSI codes
  });

  it('wraps +/- lines in ANSI color codes by default', () => {
    const result = renderDiff('a\n', 'b\n');
    expect(result).toContain('\u001b['); // ANSI present
  });
});
