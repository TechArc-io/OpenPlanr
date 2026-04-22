/**
 * Local-only Linear ↔ OpenPlanr mapping table for `planr linear status` (FEAT-019).
 */

import type { LinearMappingTableRow, OpenPlanrConfig } from '../models/types.js';
import { listArtifacts, readArtifact } from './artifact-service.js';
import { buildCascadeOrder } from './cascade-service.js';
import { isLikelyLinearIssueId, isLikelyLinearWorkflowStateId } from './linear-service.js';

function staleNoteForIssueId(raw: string | undefined): string | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  if (isLikelyLinearWorkflowStateId(raw)) {
    return 'stale-id (value looks like a workflow state id; re-run `planr linear push`)';
  }
  // H1 — Catch non-UUID, non-identifier corruption too (typos like "ENG42",
  // truncation, ids from other tools). Anything not matching a valid Linear
  // id form is flagged here so the mapping table highlights it clearly.
  if (!isLikelyLinearIssueId(raw)) {
    return 'stale-id (value does not look like a Linear issue id; re-run `planr linear push`)';
  }
  return undefined;
}

function cell(s: string, max = 48): string {
  const t = s.trim() || '—';
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function rowForEpic(openPlanrId: string, d: Record<string, unknown>): LinearMappingTableRow {
  const pid = (d.linearProjectId as string | undefined)?.trim();
  return {
    kind: 'epic',
    openPlanrId,
    linearIdentifier: pid
      ? (d.linearProjectIdentifier as string)?.trim() || '(no identifier)'
      : '(not pushed)',
    linearUrl: pid ? (d.linearProjectUrl as string)?.trim() || '—' : '—',
    lastKnownState: '—',
  };
}

function rowForFeature(openPlanrId: string, d: Record<string, unknown>): LinearMappingTableRow {
  const issueId = (d.linearIssueId as string | undefined)?.trim();
  const stale = staleNoteForIssueId(issueId);
  return {
    kind: 'feature',
    openPlanrId,
    linearIdentifier:
      issueId && !stale
        ? (d.linearIssueIdentifier as string)?.trim() || issueId.slice(0, 8)
        : issueId
          ? issueId.slice(0, 8)
          : '(not pushed)',
    linearUrl: issueId && !stale ? (d.linearIssueUrl as string)?.trim() || '—' : '—',
    lastKnownState: String(d.status ?? '—'),
    note: stale,
  };
}

function rowForStory(openPlanrId: string, d: Record<string, unknown>): LinearMappingTableRow {
  const issueId = (d.linearIssueId as string | undefined)?.trim();
  const stale = staleNoteForIssueId(issueId);
  return {
    kind: 'story',
    openPlanrId,
    linearIdentifier:
      issueId && !stale
        ? (d.linearIssueIdentifier as string)?.trim() || issueId.slice(0, 8)
        : issueId
          ? issueId.slice(0, 8)
          : '(not pushed)',
    linearUrl: issueId && !stale ? (d.linearIssueUrl as string)?.trim() || '—' : '—',
    lastKnownState: String(d.status ?? '—'),
    note: stale,
  };
}

function rowForTask(openPlanrId: string, d: Record<string, unknown>): LinearMappingTableRow {
  const issueId = (d.linearIssueId as string | undefined)?.trim();
  const stale = staleNoteForIssueId(issueId);
  return {
    kind: 'task',
    openPlanrId,
    linearIdentifier:
      issueId && !stale
        ? (d.linearIssueIdentifier as string)?.trim() || issueId.slice(0, 8)
        : issueId
          ? issueId.slice(0, 8)
          : '(not pushed)',
    linearUrl: issueId && !stale ? (d.linearIssueUrl as string)?.trim() || '—' : '—',
    lastKnownState: String(d.status ?? '—'),
    note: stale,
  };
}

async function pushTaskRow(
  projectDir: string,
  config: OpenPlanrConfig,
  rows: LinearMappingTableRow[],
  taskId: string,
): Promise<void> {
  const a = await readArtifact(projectDir, config, 'task', taskId);
  if (!a) return;
  rows.push(rowForTask(taskId, a.data as Record<string, unknown>));
}

/**
 * Collect mapping rows from local frontmatter only (no Linear API).
 * With `scopeEpicId`, only that epic and descendants (features, stories, tasks in cascade + tasks with `featureId` in scope).
 */
export async function collectLinearMappingTable(
  projectDir: string,
  config: OpenPlanrConfig,
  scopeEpicId?: string,
): Promise<LinearMappingTableRow[]> {
  const rows: LinearMappingTableRow[] = [];

  if (scopeEpicId) {
    const plan = await buildCascadeOrder(projectDir, config, 'epic', scopeEpicId);
    const featureIdsInScope = new Set(plan.levels[1]?.artifactIds ?? []);
    const storyIdsInScope = new Set(plan.levels[2]?.artifactIds ?? []);
    const taskIdsCascade = new Set(plan.levels[3]?.artifactIds ?? []);

    const ep = await readArtifact(projectDir, config, 'epic', scopeEpicId);
    if (ep) {
      rows.push(rowForEpic(scopeEpicId, ep.data as Record<string, unknown>));
    }

    for (const fid of [...featureIdsInScope].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    )) {
      const a = await readArtifact(projectDir, config, 'feature', fid);
      if (a) {
        rows.push(rowForFeature(fid, a.data as Record<string, unknown>));
      }
    }

    for (const sid of [...storyIdsInScope].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    )) {
      const a = await readArtifact(projectDir, config, 'story', sid);
      if (a) {
        rows.push(rowForStory(sid, a.data as Record<string, unknown>));
      }
    }

    for (const tid of [...taskIdsCascade].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    )) {
      await pushTaskRow(projectDir, config, rows, tid);
    }

    const allTasks = await listArtifacts(projectDir, config, 'task');
    for (const t of allTasks.sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true }),
    )) {
      if (taskIdsCascade.has(t.id)) continue;
      const ta = await readArtifact(projectDir, config, 'task', t.id);
      const feat = ta?.data.featureId as string | undefined;
      if (feat && featureIdsInScope.has(feat)) {
        await pushTaskRow(projectDir, config, rows, t.id);
      }
    }

    return rows;
  }

  const epics = await listArtifacts(projectDir, config, 'epic');
  for (const e of epics.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
    const a = await readArtifact(projectDir, config, 'epic', e.id);
    if (a) {
      rows.push(rowForEpic(e.id, a.data as Record<string, unknown>));
    }
  }

  const features = await listArtifacts(projectDir, config, 'feature');
  for (const f of features.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
    const a = await readArtifact(projectDir, config, 'feature', f.id);
    if (a) {
      rows.push(rowForFeature(f.id, a.data as Record<string, unknown>));
    }
  }

  const stories = await listArtifacts(projectDir, config, 'story');
  for (const s of stories.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
    const a = await readArtifact(projectDir, config, 'story', s.id);
    if (a) {
      rows.push(rowForStory(s.id, a.data as Record<string, unknown>));
    }
  }

  const tasks = await listArtifacts(projectDir, config, 'task');
  for (const t of tasks.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
    await pushTaskRow(projectDir, config, rows, t.id);
  }

  return rows;
}

export function formatLinearMappingTable(rows: LinearMappingTableRow[]): string {
  const lines: string[] = [];
  const kindW = 7;
  const idW = 14;
  const idenW = 22;
  const urlW = 28;
  const stW = 14;
  lines.push(
    `${'Kind'.padEnd(kindW)}  ${'OpenPlanr id'.padEnd(idW)}  ${'Linear id'.padEnd(idenW)}  ${'URL'.padEnd(urlW)}  ${'State'.padEnd(stW)}  Note`,
  );
  lines.push(
    `${'─'.repeat(kindW)}  ${'─'.repeat(idW)}  ${'─'.repeat(idenW)}  ${'─'.repeat(urlW)}  ${'─'.repeat(stW)}  ──`,
  );
  for (const r of rows) {
    const note = r.note ? cell(r.note, 40) : '';
    lines.push(
      `${r.kind.padEnd(kindW)}  ${r.openPlanrId.padEnd(idW)}  ${cell(r.linearIdentifier, idenW).padEnd(idenW)}  ${cell(r.linearUrl, urlW).padEnd(urlW)}  ${cell(r.lastKnownState, stW).padEnd(stW)}  ${note}`,
    );
  }
  return lines.join('\n');
}
