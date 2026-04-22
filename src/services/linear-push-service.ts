/**
 * `planr linear push` — map Epic → Linear Project, Feature → top-level project issue,
 * Story and TaskList → sub-issues of the feature issue (FEAT-016).
 */

import type { LinearClient } from '@linear/sdk';
import { type ParsedSubtask, parseTaskMarkdown } from '../agents/task-parser.js';
import type {
  Epic,
  Feature,
  LinearMappingStrategy,
  OpenPlanrConfig,
  TaskStatus,
  UserStory,
} from '../models/types.js';
import { logger } from '../utils/logger.js';
import {
  findArtifactTypeById,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  updateArtifactFields,
} from './artifact-service.js';
import {
  createLinearIssue,
  createLinearProject,
  createProjectMilestone,
  ensureIssueLabel,
  isLikelyLinearIssueId,
  isLikelyLinearWorkflowStateId,
  updateLinearIssue,
  updateLinearProject,
  withLinearRetry,
} from './linear-service.js';

/**
 * N2 — Convert an unknown frontmatter value to an optional string at the type
 * boundary. Cheaper and safer than `v as string | undefined`, which silently
 * misinterprets non-strings if the parser ever returns something unexpected.
 */
function toOptionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Same pattern as `toOptionalString` but for an array-of-strings frontmatter value. */
function toOptionalStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((item): item is string => typeof item === 'string');
  return out.length > 0 ? out : undefined;
}

/**
 * Validate a stored `linearMappingStrategy` frontmatter value at the type
 * boundary. Returns `undefined` for anything that isn't one of the three
 * known strategies — the caller falls back to `'project'` in that case.
 */
function toOptionalStrategy(v: unknown): LinearMappingStrategy | undefined {
  if (v === 'project' || v === 'milestone-of' || v === 'label-on') return v;
  return undefined;
}

/**
 * H1 — Decide whether a stored `linearIssueId` frontmatter value should be
 * trusted for an update call, or treated as stale/corrupted so we fall
 * through to the create path instead. Logs a warning either way so the user
 * can spot the repair.
 */
function isUsableLinearIssueId(value: string | undefined, artifactLabel: string): value is string {
  if (!value) return false;
  if (!isLikelyLinearIssueId(value)) {
    logger.warn(
      `${artifactLabel}: stored linearIssueId "${value}" is not a valid Linear id (expected uuid or \`ENG-42\` identifier). Falling through to the create path — re-push will write a fresh, valid id.`,
    );
    return false;
  }
  return true;
}

export type LinearPushItemKind =
  | 'project'
  | 'feature'
  | 'story'
  | 'taskList'
  | 'quickTask'
  | 'backlogItem';

export type LinearPushAction = 'create' | 'update' | 'skip';

/** Scope of a granular push — what subtree `runLinearPush(artifactId)` touches. */
export type LinearPushScope = 'epic' | 'feature' | 'story' | 'taskFile' | 'quick' | 'backlog';

export interface LinearPushPlanRow {
  kind: LinearPushItemKind;
  /** Epic id, feature id, story id, or task file id. */
  artifactId: string;
  title: string;
  action: LinearPushAction;
  detail?: string;
}

export interface LinearPushPlan {
  /** The artifact the user pointed `planr linear push` at (may be any supported id prefix). */
  rootArtifactId: string;
  /** The epic that owns this push's subtree; `undefined` for standalone QT/BL pushes. */
  epicId?: string;
  scope: LinearPushScope;
  rows: LinearPushPlanRow[];
  /** Counts by kind for non-`skip` rows. Missing kinds are 0. */
  counts: {
    project: number;
    features: number;
    stories: number;
    taskLists: number;
    quickTasks: number;
    backlogItems: number;
    total: number;
  };
}

export interface LinearPushOptions {
  /** Only update existing linked entities; never create new ones. */
  updateOnly?: boolean;
  /**
   * When true and a FEAT/US/TASK push's parent chain is not yet in Linear,
   * push the missing parents first without prompting. Non-interactive mode
   * requires this to be set explicitly to auto-cascade.
   */
  pushParents?: boolean;
  /**
   * Phase 2: first-time epic mapping override — used when the user passes
   * `--as project|milestone-of:<id>|label-on:<id>` or picks a strategy at the
   * interactive first-push prompt. Ignored on subsequent pushes when the
   * epic already has `linearMappingStrategy` stored (re-strategize is Phase 5).
   */
  strategyOverride?: {
    strategy: LinearMappingStrategy;
    /** For milestone-of / label-on only: the Linear project UUID to attach into. */
    targetProjectId?: string;
  };
}

/**
 * Phase 2 internal: the strategy-resolved context used to attach descendant
 * issues into Linear correctly (milestone propagation, label propagation).
 * Assembled once per push from the epic's stored strategy (or override).
 */
interface StrategyContext {
  strategy: LinearMappingStrategy;
  /** Always set — the Linear project that contains the epic's descendants. */
  projectId: string;
  /** Set when strategy === 'milestone-of' — written to every descendant issue. */
  milestoneId?: string;
  /** Set when strategy === 'label-on' — merged into every descendant issue's labelIds. */
  labelId?: string;
}

function sortByArtifactId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id, undefined, { numeric: true });
}

function asTaskStatus(s: unknown): TaskStatus {
  if (s === 'pending' || s === 'in-progress' || s === 'done') return s;
  return 'pending';
}

/** OpenPlanr status → Linear `stateId` for create/update (FEAT-016). Prefer `linear.pushStateIds`. */
function resolveStateIdForPush(
  config: OpenPlanrConfig,
  status: string | undefined,
): string | undefined {
  if (!status) return undefined;
  const s = asTaskStatus(status);
  const push = config.linear?.pushStateIds;
  if (push) {
    const v = push[s] ?? push[status];
    if (v) return v;
  }
  const m = config.linear?.statusMap;
  if (m) {
    const v = m[s] ?? m[status];
    if (v && isLikelyLinearWorkflowStateId(v)) return v;
  }
  return undefined;
}

/** Epic → Project `description` (markdown). */
export function buildEpicProjectDescription(epic: Epic): string {
  const lines: string[] = [];
  if (epic.businessValue) lines.push(`**Business value**\n\n${epic.businessValue.trim()}`);
  if (epic.problemStatement) lines.push(`**Problem**\n\n${epic.problemStatement.trim()}`);
  if (epic.solutionOverview) lines.push(`**Solution**\n\n${epic.solutionOverview.trim()}`);
  if (epic.successCriteria) lines.push(`**Success criteria**\n\n${epic.successCriteria.trim()}`);
  if (epic.targetUsers) lines.push(`**Target users**\n\n${epic.targetUsers.trim()}`);
  if (epic.risks) lines.push(`**Risks**\n\n${epic.risks.trim()}`);
  if (epic.dependencies) lines.push(`**Dependencies**\n\n${epic.dependencies.trim()}`);
  return lines.join('\n\n');
}

export function buildFeatureIssueBody(feature: Feature): string {
  const lines: string[] = [feature.overview?.trim() || ''];
  if (feature.functionalRequirements?.length) {
    lines.push('**Functional requirements**');
    for (const r of feature.functionalRequirements) {
      lines.push(`- ${r}`);
    }
  }
  return lines.filter(Boolean).join('\n\n');
}

export function buildStoryIssueBody(story: UserStory): string {
  const head = `As a **${story.role}**, I want **${story.goal}** so that **${story.benefit}**.`;
  const ac = story.acceptanceCriteria?.trim();
  if (!ac) return head;
  return `${head}\n\n**Acceptance criteria**\n\n${ac}`;
}

/** Render parsed task lines to markdown checkboxes (Linear description). */
export function formatTaskCheckboxBody(parsed: ParsedSubtask[]): string {
  if (parsed.length === 0) return '';
  return parsed
    .map((p) => {
      const mark = p.done ? 'x' : ' ';
      if (p.depth === 0) {
        return `- [${mark}] **${p.id}** ${p.title}`;
      }
      return `  - [${mark}] ${p.id} ${p.title}`;
    })
    .join('\n');
}

interface ScopedTaskFile {
  id: string;
  title: string;
}

interface ScopedStory {
  id: string;
  title: string;
  data: UserStory;
}

export interface ScopedFeature {
  id: string;
  title: string;
  data: Feature;
  stories: ScopedStory[];
  taskFiles: ScopedTaskFile[];
}

/**
 * Build merged task list body for a feature (all task artifacts with this `featureId`),
 * or empty string when there is no checkbox content to sync.
 */
export async function buildMergedTaskListBody(
  projectDir: string,
  config: OpenPlanrConfig,
  featureId: string,
  taskFiles: ScopedTaskFile[],
): Promise<string> {
  const sections: string[] = [];
  const sorted = [...taskFiles].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  for (const tf of sorted) {
    const raw = await readArtifactRaw(projectDir, config, 'task', tf.id);
    if (!raw) continue;
    const data = (await readArtifact(projectDir, config, 'task', tf.id))?.data;
    const fId = toOptionalString(data?.featureId);
    if (fId !== featureId) continue;
    const parsed = parseTaskMarkdown(raw);
    if (parsed.length === 0) continue;
    const body = formatTaskCheckboxBody(parsed);
    if (taskFiles.length > 1) {
      sections.push(`## ${tf.id}\n\n${body}`);
    } else {
      sections.push(body);
    }
  }
  return sections.join('\n\n');
}

/**
 * Load epic, features under the epic, stories per feature, and task file ids per feature.
 */
export async function loadLinearPushScope(
  projectDir: string,
  config: OpenPlanrConfig,
  epicId: string,
): Promise<{
  epic: Epic;
  features: ScopedFeature[];
} | null> {
  const epicArt = await readArtifact(projectDir, config, 'epic', epicId);
  if (!epicArt) return null;
  const d = epicArt.data;
  const created =
    (d.createdAt as string) || (d.created as string) || new Date().toISOString().split('T')[0];
  const updated =
    (d.updatedAt as string) || (d.updated as string) || new Date().toISOString().split('T')[0];
  const epic: Epic = {
    id: (d.id as string) || epicId,
    title: (d.title as string) || '',
    createdAt: created,
    updatedAt: updated,
    filePath: epicArt.filePath,
    owner: (d.owner as string) || '',
    businessValue: (d.businessValue as string) || '',
    targetUsers: (d.targetUsers as string) || '',
    problemStatement: (d.problemStatement as string) || '',
    solutionOverview: (d.solutionOverview as string) || '',
    successCriteria: (d.successCriteria as string) || '',
    keyFeatures: (d.keyFeatures as string[]) || [],
    dependencies: (d.dependencies as string) || '',
    risks: (d.risks as string) || '',
    featureIds: (d.featureIds as string[]) || [],
    linearProjectId: toOptionalString(d.linearProjectId),
    linearProjectIdentifier: toOptionalString(d.linearProjectIdentifier),
    linearProjectUrl: toOptionalString(d.linearProjectUrl),
    linearMappingStrategy: toOptionalStrategy(d.linearMappingStrategy),
    linearMilestoneId: toOptionalString(d.linearMilestoneId),
    linearLabelId: toOptionalString(d.linearLabelId),
  };

  const allFeatures = (await listArtifacts(projectDir, config, 'feature')).sort(sortByArtifactId);
  const allStories = (await listArtifacts(projectDir, config, 'story')).sort(sortByArtifactId);
  const allTasks = (await listArtifacts(projectDir, config, 'task')).sort(sortByArtifactId);

  const featuresUnderEpic: ScopedFeature[] = [];

  for (const f of allFeatures) {
    const a = await readArtifact(projectDir, config, 'feature', f.id);
    if (!a || (a.data.epicId as string) !== epicId) continue;
    const fd = a.data;
    const fCreated =
      (fd.createdAt as string) || (fd.created as string) || new Date().toISOString().split('T')[0];
    const fUpdated =
      (fd.updatedAt as string) || (fd.updated as string) || new Date().toISOString().split('T')[0];
    const feature: Feature = {
      id: (fd.id as string) || f.id,
      title: (fd.title as string) || f.title,
      createdAt: fCreated,
      updatedAt: fUpdated,
      filePath: a.filePath,
      epicId: fd.epicId as string,
      owner: (fd.owner as string) || '',
      status: asTaskStatus(fd.status),
      overview: (fd.overview as string) || '',
      functionalRequirements: (fd.functionalRequirements as string[]) || [],
      storyIds: (fd.storyIds as string[]) || [],
      linearIssueId: toOptionalString(fd.linearIssueId),
      linearIssueIdentifier: toOptionalString(fd.linearIssueIdentifier),
      linearIssueUrl: toOptionalString(fd.linearIssueUrl),
      linearProjectMilestoneId: toOptionalString(fd.linearProjectMilestoneId),
      linearLabelIds: toOptionalStringArray(fd.linearLabelIds),
    };

    const stories: ScopedStory[] = [];
    for (const s of allStories) {
      const st = await readArtifact(projectDir, config, 'story', s.id);
      if (!st || (st.data.featureId as string) !== feature.id) continue;
      const sd = st.data;
      const sCreated =
        (sd.createdAt as string) ||
        (sd.created as string) ||
        new Date().toISOString().split('T')[0];
      const sUpdated =
        (sd.updatedAt as string) ||
        (sd.updated as string) ||
        new Date().toISOString().split('T')[0];
      const story: UserStory = {
        id: (sd.id as string) || s.id,
        title: (sd.title as string) || s.title,
        createdAt: sCreated,
        updatedAt: sUpdated,
        filePath: st.filePath,
        featureId: sd.featureId as string,
        status: asTaskStatus(sd.status),
        role: (sd.role as string) || '',
        goal: (sd.goal as string) || '',
        benefit: (sd.benefit as string) || '',
        acceptanceCriteria: (sd.acceptanceCriteria as string) || '',
        additionalNotes: toOptionalString(sd.additionalNotes),
        linearIssueId: toOptionalString(sd.linearIssueId),
        linearIssueIdentifier: toOptionalString(sd.linearIssueIdentifier),
        linearIssueUrl: toOptionalString(sd.linearIssueUrl),
        linearParentIssueId: toOptionalString(sd.linearParentIssueId),
        linearProjectMilestoneId: toOptionalString(sd.linearProjectMilestoneId),
        linearLabelIds: toOptionalStringArray(sd.linearLabelIds),
      };
      stories.push({ id: story.id, title: story.title, data: story });
    }

    const taskFiles: ScopedTaskFile[] = [];
    for (const t of allTasks) {
      const ta = await readArtifact(projectDir, config, 'task', t.id);
      const pfeat = toOptionalString(ta?.data.featureId);
      if (pfeat === feature.id) {
        taskFiles.push({ id: t.id, title: t.title });
      }
    }

    featuresUnderEpic.push({
      id: feature.id,
      title: feature.title,
      data: feature,
      stories,
      taskFiles,
    });
  }

  return { epic, features: featuresUnderEpic };
}

/**
 * Read the parent-chain context needed to push a feature: the feature itself (with its
 * stories and task files) plus its parent epic. Returns `null` if the feature can't be
 * resolved or has no valid `epicId` pointer.
 */
export async function loadForFeature(
  projectDir: string,
  config: OpenPlanrConfig,
  featureId: string,
): Promise<{ epic: Epic; sf: ScopedFeature } | null> {
  const featureArt = await readArtifact(projectDir, config, 'feature', featureId);
  if (!featureArt) return null;
  const parentEpicId = toOptionalString(featureArt.data.epicId);
  if (!parentEpicId) return null;
  const epicScope = await loadLinearPushScope(projectDir, config, parentEpicId);
  if (!epicScope) return null;
  const sf = epicScope.features.find((f) => f.id === featureId);
  if (!sf) return null;
  return { epic: epicScope.epic, sf };
}

/**
 * Read the parent-chain context needed to push a story: the story itself, its feature
 * (with all sibling stories + tasklists) and the containing epic. Returns `null` if
 * any link in the chain is missing.
 */
export async function loadForStory(
  projectDir: string,
  config: OpenPlanrConfig,
  storyId: string,
): Promise<{
  epic: Epic;
  sf: ScopedFeature;
  story: { id: string; title: string; data: UserStory };
} | null> {
  const storyArt = await readArtifact(projectDir, config, 'story', storyId);
  if (!storyArt) return null;
  const parentFeatureId = toOptionalString(storyArt.data.featureId);
  if (!parentFeatureId) return null;
  const ctx = await loadForFeature(projectDir, config, parentFeatureId);
  if (!ctx) return null;
  const story = ctx.sf.stories.find((s) => s.id === storyId);
  if (!story) return null;
  return { epic: ctx.epic, sf: ctx.sf, story };
}

/**
 * Read the parent-chain context needed to push a task file: the containing feature
 * (with all its task files merged into one Linear sub-issue body) and the epic.
 */
export async function loadForTaskFile(
  projectDir: string,
  config: OpenPlanrConfig,
  taskId: string,
): Promise<{ epic: Epic; sf: ScopedFeature } | null> {
  const taskArt = await readArtifact(projectDir, config, 'task', taskId);
  if (!taskArt) return null;
  const parentFeatureId = toOptionalString(taskArt.data.featureId);
  if (!parentFeatureId) return null;
  return loadForFeature(projectDir, config, parentFeatureId);
}

/**
 * Phase 3: shape needed to push a quick task — the raw markdown (so we can
 * parse and re-render the checkbox list) plus the frontmatter (for linear* fields).
 */
export interface ScopedStandaloneArtifact {
  id: string;
  title: string;
  raw: string;
  frontmatter: Record<string, unknown>;
}

export async function loadForQuickTask(
  projectDir: string,
  config: OpenPlanrConfig,
  qtId: string,
): Promise<ScopedStandaloneArtifact | null> {
  const art = await readArtifact(projectDir, config, 'quick', qtId);
  if (!art) return null;
  const raw = (await readArtifactRaw(projectDir, config, 'quick', qtId)) ?? '';
  return {
    id: (art.data.id as string) || qtId,
    title: (art.data.title as string) || qtId,
    raw,
    frontmatter: art.data,
  };
}

export async function loadForBacklogItem(
  projectDir: string,
  config: OpenPlanrConfig,
  blId: string,
): Promise<ScopedStandaloneArtifact | null> {
  const art = await readArtifact(projectDir, config, 'backlog', blId);
  if (!art) return null;
  const raw = (await readArtifactRaw(projectDir, config, 'backlog', blId)) ?? '';
  return {
    id: (art.data.id as string) || blId,
    title: (art.data.title as string) || blId,
    raw,
    frontmatter: art.data,
  };
}

/** Phase 3: Render a backlog item's body as a Linear issue description. */
export function buildBacklogItemBody(bl: ScopedStandaloneArtifact): string {
  const fm = bl.frontmatter;
  const lines: string[] = [];
  const priority = toOptionalString(fm.priority);
  if (priority) lines.push(`**Priority:** ${priority}`);
  if (Array.isArray(fm.tags) && fm.tags.length > 0) {
    const tags = (fm.tags as unknown[]).filter((t): t is string => typeof t === 'string');
    if (tags.length) lines.push(`**Tags:** ${tags.join(', ')}`);
  }
  const description = toOptionalString(fm.description);
  if (description) lines.push(description.trim());
  const ac = toOptionalString(fm.acceptanceCriteria);
  if (ac) lines.push(`**Acceptance criteria**\n\n${ac.trim()}`);
  const notes = toOptionalString(fm.notes);
  if (notes) lines.push(`**Notes**\n\n${notes.trim()}`);
  return lines.join('\n\n');
}

function projectRow(epic: Epic): LinearPushPlanRow {
  const id = epic.linearProjectId;
  return {
    kind: 'project',
    artifactId: epic.id,
    title: `${epic.id}: ${epic.title}`.trim(),
    action: id ? 'update' : 'create',
  };
}

function featureRow(f: Feature): LinearPushPlanRow {
  return {
    kind: 'feature',
    artifactId: f.id,
    title: `${f.id}: ${f.title}`.trim(),
    action: f.linearIssueId ? 'update' : 'create',
  };
}

function storyRow(s: UserStory): LinearPushPlanRow {
  return {
    kind: 'story',
    artifactId: s.id,
    title: `${s.id}: ${s.title}`.trim(),
    action: s.linearIssueId ? 'update' : 'create',
  };
}

function taskListPlanRow(
  featureId: string,
  taskFiles: ScopedTaskFile[],
  hasBody: boolean,
  hadIssue: boolean,
): LinearPushPlanRow {
  if (!hasBody && !hadIssue) {
    return {
      kind: 'taskList',
      artifactId: featureId,
      title: `Tasks (${featureId})`,
      action: 'skip',
      detail: 'No task checkbox lines in task file(s) for this feature.',
    };
  }
  const label = taskFiles[0]?.id ?? featureId;
  return {
    kind: 'taskList',
    artifactId: label,
    title: `Tasks: ${featureId}`,
    action: hadIssue ? 'update' : 'create',
  };
}

function applyUpdateOnly(rows: LinearPushPlanRow[], updateOnly: boolean): LinearPushPlanRow[] {
  if (!updateOnly) return rows;
  return rows.map((r) =>
    r.action === 'create'
      ? {
          ...r,
          action: 'skip' as const,
          detail: r.detail
            ? `${r.detail} (not created: --update-only)`
            : 'not created: --update-only',
        }
      : r,
  );
}

function summarizePlan(
  rootArtifactId: string,
  epicId: string | undefined,
  scope: LinearPushScope,
  rows: LinearPushPlanRow[],
): LinearPushPlan {
  const countKind = (k: LinearPushItemKind) =>
    rows.filter((r) => r.kind === k && r.action !== 'skip').length;
  const project = countKind('project');
  const features = countKind('feature');
  const stories = countKind('story');
  const taskLists = countKind('taskList');
  const quickTasks = countKind('quickTask');
  const backlogItems = countKind('backlogItem');
  return {
    rootArtifactId,
    epicId,
    scope,
    rows,
    counts: {
      project,
      features,
      stories,
      taskLists,
      quickTasks,
      backlogItems,
      total: project + features + stories + taskLists + quickTasks + backlogItems,
    },
  };
}

async function buildFeaturePlanRows(
  projectDir: string,
  config: OpenPlanrConfig,
  sf: ScopedFeature,
): Promise<LinearPushPlanRow[]> {
  const rows: LinearPushPlanRow[] = [];
  rows.push(featureRow(sf.data));
  for (const st of sf.stories) {
    rows.push(storyRow(st.data));
  }
  const withLinear = await Promise.all(
    sf.taskFiles.map(async (tf) => {
      const a = await readArtifact(projectDir, config, 'task', tf.id);
      return { tf, issueId: toOptionalString(a?.data.linearIssueId) };
    }),
  );
  const hadIssue = Boolean(withLinear.find((x) => x.issueId)?.issueId);
  const body = await buildMergedTaskListBody(projectDir, config, sf.data.id, sf.taskFiles);
  const hasBody = body.trim().length > 0;
  rows.push(taskListPlanRow(sf.data.id, sf.taskFiles, hasBody, hadIssue));
  return rows;
}

async function buildEpicPlanRows(
  projectDir: string,
  config: OpenPlanrConfig,
  epicScope: { epic: Epic; features: ScopedFeature[] },
): Promise<LinearPushPlanRow[]> {
  const rows: LinearPushPlanRow[] = [];
  rows.push(projectRow(epicScope.epic));
  for (const sf of epicScope.features) {
    rows.push(...(await buildFeaturePlanRows(projectDir, config, sf)));
  }
  return rows;
}

/**
 * Build a push preview (and counts) for `planr linear push --dry-run` at any granularity.
 * Accepts any supported artifact id prefix (EPIC/FEAT/US/TASK); returns `null` when the
 * artifact can't be resolved or is not pushable.
 */
export async function buildLinearPushPlan(
  projectDir: string,
  config: OpenPlanrConfig,
  artifactId: string,
  options?: { updateOnly?: boolean },
): Promise<LinearPushPlan | null> {
  const updateOnly = options?.updateOnly === true;
  const type = findArtifactTypeById(artifactId);
  if (!type) return null;

  if (type === 'epic') {
    const scope = await loadLinearPushScope(projectDir, config, artifactId);
    if (!scope) return null;
    const rows = applyUpdateOnly(await buildEpicPlanRows(projectDir, config, scope), updateOnly);
    return summarizePlan(artifactId, scope.epic.id, 'epic', rows);
  }

  if (type === 'feature') {
    const ctx = await loadForFeature(projectDir, config, artifactId);
    if (!ctx) return null;
    const rows = applyUpdateOnly(
      await buildFeaturePlanRows(projectDir, config, ctx.sf),
      updateOnly,
    );
    return summarizePlan(artifactId, ctx.epic.id, 'feature', rows);
  }

  if (type === 'story') {
    const ctx = await loadForStory(projectDir, config, artifactId);
    if (!ctx) return null;
    const rows = applyUpdateOnly([storyRow(ctx.story.data)], updateOnly);
    return summarizePlan(artifactId, ctx.epic.id, 'story', rows);
  }

  if (type === 'task') {
    const ctx = await loadForTaskFile(projectDir, config, artifactId);
    if (!ctx) return null;
    const withLinear = await Promise.all(
      ctx.sf.taskFiles.map(async (tf) => {
        const a = await readArtifact(projectDir, config, 'task', tf.id);
        return { tf, issueId: toOptionalString(a?.data.linearIssueId) };
      }),
    );
    const hadIssue = Boolean(withLinear.find((x) => x.issueId)?.issueId);
    const body = await buildMergedTaskListBody(
      projectDir,
      config,
      ctx.sf.data.id,
      ctx.sf.taskFiles,
    );
    const hasBody = body.trim().length > 0;
    const rows = applyUpdateOnly(
      [taskListPlanRow(ctx.sf.data.id, ctx.sf.taskFiles, hasBody, hadIssue)],
      updateOnly,
    );
    return summarizePlan(artifactId, ctx.epic.id, 'taskFile', rows);
  }

  if (type === 'quick') {
    const qt = await loadForQuickTask(projectDir, config, artifactId);
    if (!qt) return null;
    const hasId = Boolean(toOptionalString(qt.frontmatter.linearIssueId));
    const rows = applyUpdateOnly(
      [
        {
          kind: 'quickTask',
          artifactId,
          title: `${qt.id}: ${qt.title}`,
          action: hasId ? 'update' : 'create',
        },
      ],
      updateOnly,
    );
    return summarizePlan(artifactId, undefined, 'quick', rows);
  }

  if (type === 'backlog') {
    const bl = await loadForBacklogItem(projectDir, config, artifactId);
    if (!bl) return null;
    const hasId = Boolean(toOptionalString(bl.frontmatter.linearIssueId));
    const rows = applyUpdateOnly(
      [
        {
          kind: 'backlogItem',
          artifactId,
          title: `${bl.id}: ${bl.title}`,
          action: hasId ? 'update' : 'create',
        },
      ],
      updateOnly,
    );
    return summarizePlan(artifactId, undefined, 'backlog', rows);
  }

  // sprint / adr / checklist — not supported.
  return null;
}

// ---------------------------------------------------------------------------
// Phase 2 — strategy resolution + label merge helpers
// ---------------------------------------------------------------------------

/** Resolve the epic-mapping strategy for an already-pushed epic (read-only). */
function strategyFromEpic(epic: Epic, config: OpenPlanrConfig): LinearMappingStrategy {
  return epic.linearMappingStrategy ?? config.linear?.defaultEpicStrategy ?? 'project';
}

/**
 * Build the descendant-propagation context for a feature/story/tasklist push
 * **without** invoking any Linear mutation. Used by granular push scopes
 * (FEAT/US/TASK) where the epic is already mapped — the strategy is whatever
 * the epic's frontmatter says it is, and the containing projectId + milestoneId
 * + labelId are read-only from that frontmatter.
 */
function contextFromMappedEpic(epic: Epic, config: OpenPlanrConfig): StrategyContext {
  const strategy = strategyFromEpic(epic, config);
  const projectId = epic.linearProjectId ?? '';
  return {
    strategy,
    projectId,
    milestoneId: strategy === 'milestone-of' ? epic.linearMilestoneId : undefined,
    labelId: strategy === 'label-on' ? epic.linearLabelId : undefined,
  };
}

/**
 * Read an issue's existing labelIds from Linear so we can merge (not stomp)
 * when the push re-applies the epic's label. Only called in the `label-on`
 * branch, so the extra round-trip is isolated to that strategy.
 */
async function readExistingLabelIds(client: LinearClient, issueId: string): Promise<string[]> {
  return withLinearRetry('read label ids', async () => {
    const issue = await client.issue(issueId);
    const ids = (issue as unknown as { labelIds?: string[] })?.labelIds;
    return Array.isArray(ids) ? ids : [];
  });
}

/** Dedupe helper — merges `extra` into `base`, preserving order. */
function mergeLabelIds(base: string[], extra: string | undefined): string[] {
  if (!extra) return [...base];
  if (base.includes(extra)) return [...base];
  return [...base, extra];
}

// ---------------------------------------------------------------------------
// Per-feature / per-story / per-tasklist push primitives.
// Shared between epic-scope pushes (which loop over features) and granular
// scope pushes (which push a single feature / story / task subtree).
// ---------------------------------------------------------------------------

/**
 * Push one feature issue and its descendants (stories + merged tasklist) under
 * an already-resolved Linear project. Returns the feature's Linear issue id,
 * or `null` when `updateOnly` is set and the feature has no prior linear link
 * (caller decides whether to propagate the skip).
 *
 * Strategy propagation: when `strategyCtx.strategy === 'milestone-of'` the
 * feature issue gets `projectMilestoneId` set; when `'label-on'` the epic's
 * label is merged into the issue's labelIds (existing labels preserved).
 */
async function pushOneFeatureAndDescendants(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  sf: ScopedFeature,
  strategyCtx: StrategyContext,
  teamId: string,
  updateOnly: boolean,
): Promise<string | null> {
  const f = sf.data;
  const featureTitle = `${f.id}: ${f.title}`.trim();
  const featureBody = buildFeatureIssueBody(f);
  const stateF = resolveStateIdForPush(config, f.status);
  const { projectId } = strategyCtx;

  let featureIssueId: string;
  if (isUsableLinearIssueId(f.linearIssueId, `Feature ${f.id}`)) {
    const labelIds =
      strategyCtx.strategy === 'label-on' && strategyCtx.labelId
        ? mergeLabelIds(await readExistingLabelIds(client, f.linearIssueId), strategyCtx.labelId)
        : undefined;
    const u = await updateLinearIssue(client, f.linearIssueId, {
      title: featureTitle,
      description: featureBody,
      projectId,
      teamId,
      stateId: stateF ?? null,
      projectMilestoneId: strategyCtx.milestoneId ?? null,
      ...(labelIds ? { labelIds } : {}),
    });
    featureIssueId = u.id;
    const fmUpdate: Record<string, string | string[]> = {
      linearIssueId: u.id,
      linearIssueIdentifier: u.identifier,
      linearIssueUrl: u.url,
    };
    if (strategyCtx.milestoneId) fmUpdate.linearProjectMilestoneId = strategyCtx.milestoneId;
    if (labelIds) fmUpdate.linearLabelIds = labelIds;
    await updateArtifactFields(projectDir, config, 'feature', f.id, fmUpdate);
  } else {
    if (updateOnly) {
      logger.warn(
        `Update-only: skipping feature ${f.id} (no linearIssueId) — not creating it; stories and tasks under this feature are skipped.`,
      );
      return null;
    }
    const initialLabelIds =
      strategyCtx.strategy === 'label-on' && strategyCtx.labelId
        ? [strategyCtx.labelId]
        : undefined;
    const c = await createLinearIssue(client, {
      teamId,
      projectId,
      title: featureTitle,
      description: featureBody,
      stateId: stateF ?? null,
      ...(strategyCtx.milestoneId ? { projectMilestoneId: strategyCtx.milestoneId } : {}),
      ...(initialLabelIds ? { labelIds: initialLabelIds } : {}),
    });
    featureIssueId = c.id;
    const fmUpdate: Record<string, string | string[]> = {
      linearIssueId: c.id,
      linearIssueIdentifier: c.identifier,
      linearIssueUrl: c.url,
    };
    if (strategyCtx.milestoneId) fmUpdate.linearProjectMilestoneId = strategyCtx.milestoneId;
    if (initialLabelIds) fmUpdate.linearLabelIds = initialLabelIds;
    await updateArtifactFields(projectDir, config, 'feature', f.id, fmUpdate);
  }

  for (const st of sf.stories) {
    await pushOneStoryUnderFeature(
      projectDir,
      config,
      client,
      st.data,
      featureIssueId,
      strategyCtx,
      teamId,
      updateOnly,
    );
  }

  await pushOneTaskListForFeature(
    projectDir,
    config,
    client,
    sf,
    featureIssueId,
    strategyCtx,
    teamId,
    updateOnly,
  );

  return featureIssueId;
}

/**
 * Create or update one story sub-issue under a resolved feature Linear parent.
 * Inherits milestone/label attributes from the containing epic via `strategyCtx`.
 */
async function pushOneStoryUnderFeature(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  s: UserStory,
  featureIssueId: string,
  strategyCtx: StrategyContext,
  teamId: string,
  updateOnly: boolean,
): Promise<void> {
  const storyTitle = `${s.id}: ${s.title}`.trim();
  const storyBody = buildStoryIssueBody(s);
  const stateS = resolveStateIdForPush(config, s.status);
  const { projectId } = strategyCtx;
  if (isUsableLinearIssueId(s.linearIssueId, `Story ${s.id}`)) {
    const labelIds =
      strategyCtx.strategy === 'label-on' && strategyCtx.labelId
        ? mergeLabelIds(await readExistingLabelIds(client, s.linearIssueId), strategyCtx.labelId)
        : undefined;
    const u = await updateLinearIssue(client, s.linearIssueId, {
      title: storyTitle,
      description: storyBody,
      projectId,
      teamId,
      parentId: featureIssueId,
      stateId: stateS ?? null,
      projectMilestoneId: strategyCtx.milestoneId ?? null,
      ...(labelIds ? { labelIds } : {}),
    });
    const fmUpdate: Record<string, string | string[]> = {
      linearIssueId: u.id,
      linearIssueIdentifier: u.identifier,
      linearIssueUrl: u.url,
      linearParentIssueId: featureIssueId,
    };
    if (strategyCtx.milestoneId) fmUpdate.linearProjectMilestoneId = strategyCtx.milestoneId;
    if (labelIds) fmUpdate.linearLabelIds = labelIds;
    await updateArtifactFields(projectDir, config, 'story', s.id, fmUpdate);
    return;
  }
  if (updateOnly) {
    logger.warn(`Update-only: skipping story ${s.id} (no linearIssueId).`);
    return;
  }
  const initialLabelIds =
    strategyCtx.strategy === 'label-on' && strategyCtx.labelId ? [strategyCtx.labelId] : undefined;
  const c = await createLinearIssue(client, {
    teamId,
    projectId,
    parentId: featureIssueId,
    title: storyTitle,
    description: storyBody,
    stateId: stateS ?? null,
    ...(strategyCtx.milestoneId ? { projectMilestoneId: strategyCtx.milestoneId } : {}),
    ...(initialLabelIds ? { labelIds: initialLabelIds } : {}),
  });
  const fmUpdate: Record<string, string | string[]> = {
    linearIssueId: c.id,
    linearIssueIdentifier: c.identifier,
    linearIssueUrl: c.url,
    linearParentIssueId: featureIssueId,
  };
  if (strategyCtx.milestoneId) fmUpdate.linearProjectMilestoneId = strategyCtx.milestoneId;
  if (initialLabelIds) fmUpdate.linearLabelIds = initialLabelIds;
  await updateArtifactFields(projectDir, config, 'story', s.id, fmUpdate);
}

/**
 * Create or update the single "Tasks for <feature>" sub-issue that aggregates
 * all task-file checkboxes for a feature. Merges all task files sharing this
 * feature into one body. Returns without writing when there is nothing to
 * push and no existing linear issue to keep in sync.
 */
async function pushOneTaskListForFeature(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  sf: ScopedFeature,
  featureIssueId: string,
  strategyCtx: StrategyContext,
  teamId: string,
  updateOnly: boolean,
): Promise<void> {
  const f = sf.data;
  const { projectId } = strategyCtx;
  const mergedBody = await buildMergedTaskListBody(projectDir, config, f.id, sf.taskFiles);
  const issueFromFiles = await Promise.all(
    sf.taskFiles.map(async (tf) => {
      const a = await readArtifact(projectDir, config, 'task', tf.id);
      return toOptionalString(a?.data.linearIssueId);
    }),
  );
  const rawExistingTaskIssueId = issueFromFiles.find(Boolean);
  const existingTaskIssueId = isUsableLinearIssueId(
    rawExistingTaskIssueId,
    `TaskList under ${f.id}`,
  )
    ? rawExistingTaskIssueId
    : undefined;

  if (!mergedBody.trim() && !existingTaskIssueId) {
    return;
  }
  const title =
    sf.taskFiles.length > 1 ? `Tasks: ${f.id} (${sf.taskFiles.length} files)` : `Tasks: ${f.id}`;

  if (existingTaskIssueId) {
    const labelIds =
      strategyCtx.strategy === 'label-on' && strategyCtx.labelId
        ? mergeLabelIds(
            await readExistingLabelIds(client, existingTaskIssueId),
            strategyCtx.labelId,
          )
        : undefined;
    const u = await updateLinearIssue(client, existingTaskIssueId, {
      title,
      description: mergedBody || '_No open tasks in OpenPlanr task file(s)._',
      projectId,
      teamId,
      parentId: featureIssueId,
      projectMilestoneId: strategyCtx.milestoneId ?? null,
      ...(labelIds ? { labelIds } : {}),
    });
    const synced = new Date().toISOString();
    for (const tf of sf.taskFiles) {
      const fmUpdate: Record<string, string | string[]> = {
        linearIssueId: u.id,
        linearIssueIdentifier: u.identifier,
        linearIssueUrl: u.url,
        linearParentIssueId: featureIssueId,
        linearTaskChecklistSyncedAt: synced,
      };
      if (strategyCtx.milestoneId) fmUpdate.linearProjectMilestoneId = strategyCtx.milestoneId;
      if (labelIds) fmUpdate.linearLabelIds = labelIds;
      await updateArtifactFields(projectDir, config, 'task', tf.id, fmUpdate);
    }
    return;
  }

  if (updateOnly) {
    logger.warn(
      `Update-only: skipping task list issue for feature ${f.id} (no existing linearIssueId on task files).`,
    );
    return;
  }
  const initialLabelIds =
    strategyCtx.strategy === 'label-on' && strategyCtx.labelId ? [strategyCtx.labelId] : undefined;
  const c = await createLinearIssue(client, {
    teamId,
    projectId,
    parentId: featureIssueId,
    title,
    description: mergedBody,
    ...(strategyCtx.milestoneId ? { projectMilestoneId: strategyCtx.milestoneId } : {}),
    ...(initialLabelIds ? { labelIds: initialLabelIds } : {}),
  });
  const synced = new Date().toISOString();
  for (const tf of sf.taskFiles) {
    const fmUpdate: Record<string, string | string[]> = {
      linearIssueId: c.id,
      linearIssueIdentifier: c.identifier,
      linearIssueUrl: c.url,
      linearParentIssueId: featureIssueId,
      linearTaskChecklistSyncedAt: synced,
    };
    if (strategyCtx.milestoneId) fmUpdate.linearProjectMilestoneId = strategyCtx.milestoneId;
    if (initialLabelIds) fmUpdate.linearLabelIds = initialLabelIds;
    await updateArtifactFields(projectDir, config, 'task', tf.id, fmUpdate);
  }
}

/**
 * Epic-scope push: resolves the mapping strategy (first-time choice persisted,
 * subsequent runs read from frontmatter), creates/updates the Linear container
 * (project + optional milestone or label), and cascades through every feature.
 */
async function pushEpicScope(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  epicId: string,
  updateOnly: boolean,
  teamId: string,
  leadId: string | undefined,
  override: LinearPushOptions['strategyOverride'],
): Promise<LinearPushPlan | null> {
  const scope = await loadLinearPushScope(projectDir, config, epicId);
  if (!scope) {
    throw new Error(`Epic not found: ${epicId}`);
  }
  const { epic, features } = scope;
  const plan = await buildLinearPushPlan(projectDir, config, epicId, { updateOnly });
  if (!plan) return null;

  // Resolve strategy: stored on epic > override > config default > 'project'.
  const stored = epic.linearMappingStrategy;
  const chosen: LinearMappingStrategy =
    stored ?? override?.strategy ?? config.linear?.defaultEpicStrategy ?? 'project';

  // Phase 5 (re-strategize) is out of scope for this release — refuse to
  // silently migrate an epic to a different mapping.
  if (stored && override?.strategy && override.strategy !== stored) {
    throw new Error(
      `Epic ${epic.id} is already mapped as '${stored}'. Re-strategizing to '${override.strategy}' is not supported in this release (planned for Phase 5). Use \`planr linear unlink ${epic.id}\` + re-push once that arrives.`,
    );
  }

  if (updateOnly && !epic.linearProjectId) {
    throw new Error(
      'Cannot use --update-only: this epic has no `linearProjectId` in frontmatter. Run `planr linear push` without --update-only once to create the Linear project.',
    );
  }

  const projectName = `${epic.id}: ${epic.title}`.trim();
  const projectDescription = buildEpicProjectDescription(epic);

  let strategyCtx: StrategyContext;

  if (chosen === 'project') {
    let projectId: string;
    if (epic.linearProjectId) {
      const updated = await updateLinearProject(client, epic.linearProjectId, {
        name: projectName,
        description: projectDescription,
        leadId: leadId ?? null,
      });
      projectId = updated.id;
      await updateArtifactFields(projectDir, config, 'epic', epic.id, {
        linearProjectId: updated.id,
        linearProjectIdentifier: updated.identifier,
        linearProjectUrl: updated.url,
        linearMappingStrategy: chosen,
      });
    } else {
      const created = await createLinearProject(client, {
        name: projectName,
        teamIds: [teamId],
        description: projectDescription,
        leadId: leadId ?? null,
      });
      projectId = created.id;
      await updateArtifactFields(projectDir, config, 'epic', epic.id, {
        linearProjectId: created.id,
        linearProjectIdentifier: created.identifier,
        linearProjectUrl: created.url,
        linearMappingStrategy: chosen,
      });
    }
    strategyCtx = { strategy: 'project', projectId };
  } else if (chosen === 'milestone-of') {
    const targetProjectId = epic.linearProjectId ?? override?.targetProjectId;
    if (!targetProjectId) {
      throw new Error(
        `milestone-of strategy requires a Linear project to attach into. Re-run with \`--as milestone-of:<projectId>\`.`,
      );
    }
    let milestoneId = epic.linearMilestoneId;
    if (!milestoneId) {
      const m = await createProjectMilestone(client, {
        projectId: targetProjectId,
        name: projectName,
        description: projectDescription,
      });
      milestoneId = m.id;
    }
    await updateArtifactFields(projectDir, config, 'epic', epic.id, {
      linearProjectId: targetProjectId,
      linearMilestoneId: milestoneId,
      linearMappingStrategy: chosen,
    });
    strategyCtx = { strategy: 'milestone-of', projectId: targetProjectId, milestoneId };
  } else {
    // label-on
    const targetProjectId = epic.linearProjectId ?? override?.targetProjectId;
    if (!targetProjectId) {
      throw new Error(
        `label-on strategy requires a Linear project to attach into. Re-run with \`--as label-on:<projectId>\`.`,
      );
    }
    const label = await ensureIssueLabel(client, {
      teamId,
      name: `${epic.id}: ${epic.title}`.trim(),
      description: `OpenPlanr epic ${epic.id} (auto-created by \`planr linear push\`).`,
    });
    await updateArtifactFields(projectDir, config, 'epic', epic.id, {
      linearProjectId: targetProjectId,
      linearLabelId: label.id,
      linearMappingStrategy: chosen,
    });
    strategyCtx = { strategy: 'label-on', projectId: targetProjectId, labelId: label.id };
  }

  for (const sf of features) {
    await pushOneFeatureAndDescendants(
      projectDir,
      config,
      client,
      sf,
      strategyCtx,
      teamId,
      updateOnly,
    );
  }

  return plan;
}

/**
 * Feature-scope push: exactly one feature issue + its stories + its tasklist.
 * Requires the parent epic's Linear project to already exist (or `pushParents`).
 */
async function pushFeatureScope(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  featureId: string,
  options: LinearPushOptions,
  teamId: string,
  leadId: string | undefined,
): Promise<LinearPushPlan | null> {
  const ctx = await loadForFeature(projectDir, config, featureId);
  if (!ctx) {
    throw new Error(`Feature not found or has no \`epicId\`: ${featureId}`);
  }
  const updateOnly = options.updateOnly === true;

  if (!ctx.epic.linearProjectId) {
    if (options.pushParents) {
      logger.info(
        `Parent epic ${ctx.epic.id} is not in Linear yet — pushing the full epic first (--push-parents).`,
      );
      return pushEpicScope(
        projectDir,
        config,
        client,
        ctx.epic.id,
        updateOnly,
        teamId,
        leadId,
        options.strategyOverride,
      );
    }
    throw new Error(
      `Parent epic ${ctx.epic.id} has not been pushed to Linear yet. Run \`planr linear push ${ctx.epic.id}\` first, or re-run with \`--push-parents\`.`,
    );
  }

  const strategyCtx = contextFromMappedEpic(ctx.epic, config);
  await pushOneFeatureAndDescendants(
    projectDir,
    config,
    client,
    ctx.sf,
    strategyCtx,
    teamId,
    updateOnly,
  );

  return buildLinearPushPlan(projectDir, config, featureId, { updateOnly });
}

/**
 * Story-scope push: one story sub-issue under an already-mapped feature.
 */
async function pushStoryScope(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  storyId: string,
  options: LinearPushOptions,
  teamId: string,
  leadId: string | undefined,
): Promise<LinearPushPlan | null> {
  const ctx = await loadForStory(projectDir, config, storyId);
  if (!ctx) {
    throw new Error(`Story not found or has no \`featureId\`: ${storyId}`);
  }
  const updateOnly = options.updateOnly === true;

  if (!isUsableLinearIssueId(ctx.sf.data.linearIssueId, `Feature ${ctx.sf.data.id}`)) {
    if (options.pushParents) {
      logger.info(
        `Parent feature ${ctx.sf.data.id} is not in Linear yet — pushing the feature subtree first (--push-parents).`,
      );
      return pushFeatureScope(
        projectDir,
        config,
        client,
        ctx.sf.data.id,
        { ...options, pushParents: true },
        teamId,
        leadId,
      );
    }
    throw new Error(
      `Parent feature ${ctx.sf.data.id} has not been pushed to Linear yet. Run \`planr linear push ${ctx.sf.data.id}\` first, or re-run with \`--push-parents\`.`,
    );
  }

  // Ensure parent epic also has a Linear project — required for the story's `projectId`.
  if (!ctx.epic.linearProjectId) {
    throw new Error(
      `Parent epic ${ctx.epic.id} has no \`linearProjectId\`. Run \`planr linear push ${ctx.epic.id}\` first.`,
    );
  }

  const strategyCtx = contextFromMappedEpic(ctx.epic, config);
  const featureIssueId = ctx.sf.data.linearIssueId;
  await pushOneStoryUnderFeature(
    projectDir,
    config,
    client,
    ctx.story.data,
    featureIssueId,
    strategyCtx,
    teamId,
    updateOnly,
  );

  return buildLinearPushPlan(projectDir, config, storyId, { updateOnly });
}

/**
 * Task-file-scope push: update the single "Tasks for <feature>" sub-issue, merging
 * checkbox bodies across all task files under the same feature (matches epic-scope
 * behavior — one Linear sub-issue per feature regardless of how many task files exist).
 */
async function pushTaskFileScope(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  taskId: string,
  options: LinearPushOptions,
  teamId: string,
  leadId: string | undefined,
): Promise<LinearPushPlan | null> {
  const ctx = await loadForTaskFile(projectDir, config, taskId);
  if (!ctx) {
    throw new Error(`Task file not found or has no \`featureId\`: ${taskId}`);
  }
  const updateOnly = options.updateOnly === true;

  if (!isUsableLinearIssueId(ctx.sf.data.linearIssueId, `Feature ${ctx.sf.data.id}`)) {
    if (options.pushParents) {
      logger.info(
        `Parent feature ${ctx.sf.data.id} is not in Linear yet — pushing the feature subtree first (--push-parents).`,
      );
      return pushFeatureScope(
        projectDir,
        config,
        client,
        ctx.sf.data.id,
        { ...options, pushParents: true },
        teamId,
        leadId,
      );
    }
    throw new Error(
      `Parent feature ${ctx.sf.data.id} has not been pushed to Linear yet. Run \`planr linear push ${ctx.sf.data.id}\` first, or re-run with \`--push-parents\`.`,
    );
  }
  if (!ctx.epic.linearProjectId) {
    throw new Error(
      `Parent epic ${ctx.epic.id} has no \`linearProjectId\`. Run \`planr linear push ${ctx.epic.id}\` first.`,
    );
  }

  const strategyCtx = contextFromMappedEpic(ctx.epic, config);
  const featureIssueId = ctx.sf.data.linearIssueId;
  await pushOneTaskListForFeature(
    projectDir,
    config,
    client,
    ctx.sf,
    featureIssueId,
    strategyCtx,
    teamId,
    updateOnly,
  );

  return buildLinearPushPlan(projectDir, config, taskId, { updateOnly });
}

/**
 * Phase 3: Push one quick task as a top-level issue in the configured
 * standalone Linear project. No parent, no milestone, no labels (QTs are
 * plain "get-it-done" issues; tagging by label is a user-side concern).
 */
async function pushQuickTaskScope(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  qtId: string,
  options: LinearPushOptions,
  teamId: string,
): Promise<LinearPushPlan | null> {
  const projectId = config.linear?.standaloneProjectId;
  if (!projectId) {
    throw new Error(
      'No standalone Linear project configured for quick tasks and backlog items. Run `planr linear push <QT-ID>` interactively to pick one, or set `linear.standaloneProjectId` in `.planr/config.json`.',
    );
  }
  const updateOnly = options.updateOnly === true;
  const qt = await loadForQuickTask(projectDir, config, qtId);
  if (!qt) {
    throw new Error(`Quick task not found: ${qtId}`);
  }

  const parsed = parseTaskMarkdown(qt.raw);
  const body = parsed.length > 0 ? formatTaskCheckboxBody(parsed) : '';
  const title = `${qt.id}: ${qt.title}`.trim();
  const rawExistingId = toOptionalString(qt.frontmatter.linearIssueId);
  const existingId = isUsableLinearIssueId(rawExistingId, `QuickTask ${qt.id}`)
    ? rawExistingId
    : undefined;

  if (existingId) {
    const u = await updateLinearIssue(client, existingId, {
      title,
      description: body,
      projectId,
      teamId,
    });
    await updateArtifactFields(projectDir, config, 'quick', qt.id, {
      linearIssueId: u.id,
      linearIssueIdentifier: u.identifier,
      linearIssueUrl: u.url,
    });
  } else if (!updateOnly) {
    const c = await createLinearIssue(client, {
      teamId,
      projectId,
      title,
      description: body,
    });
    await updateArtifactFields(projectDir, config, 'quick', qt.id, {
      linearIssueId: c.id,
      linearIssueIdentifier: c.identifier,
      linearIssueUrl: c.url,
    });
  } else {
    logger.warn(`Update-only: skipping quick task ${qt.id} (no linearIssueId).`);
  }

  return buildLinearPushPlan(projectDir, config, qtId, { updateOnly });
}

/**
 * Phase 3: Push one backlog item as a top-level issue in the configured
 * standalone Linear project, auto-applying a team-scoped `backlog` label so
 * PMs can filter. The label is ensured idempotently (reuses an existing one
 * by exact name when present).
 */
async function pushBacklogItemScope(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  blId: string,
  options: LinearPushOptions,
  teamId: string,
): Promise<LinearPushPlan | null> {
  const projectId = config.linear?.standaloneProjectId;
  if (!projectId) {
    throw new Error(
      'No standalone Linear project configured for quick tasks and backlog items. Run `planr linear push <BL-ID>` interactively to pick one, or set `linear.standaloneProjectId` in `.planr/config.json`.',
    );
  }
  const updateOnly = options.updateOnly === true;
  const bl = await loadForBacklogItem(projectDir, config, blId);
  if (!bl) {
    throw new Error(`Backlog item not found: ${blId}`);
  }

  const backlogLabel = await ensureIssueLabel(client, {
    teamId,
    name: 'backlog',
    color: '#888888',
    description: 'OpenPlanr backlog items (auto-applied by `planr linear push BL-*`).',
  });

  const title = `${bl.id}: ${bl.title}`.trim();
  const body = buildBacklogItemBody(bl);
  const rawExistingId = toOptionalString(bl.frontmatter.linearIssueId);
  const existingId = isUsableLinearIssueId(rawExistingId, `Backlog ${bl.id}`)
    ? rawExistingId
    : undefined;

  if (existingId) {
    const existingLabels = await readExistingLabelIds(client, existingId);
    const labelIds = mergeLabelIds(existingLabels, backlogLabel.id);
    const u = await updateLinearIssue(client, existingId, {
      title,
      description: body,
      projectId,
      teamId,
      labelIds,
    });
    await updateArtifactFields(projectDir, config, 'backlog', bl.id, {
      linearIssueId: u.id,
      linearIssueIdentifier: u.identifier,
      linearIssueUrl: u.url,
      linearLabelIds: labelIds,
    });
  } else if (!updateOnly) {
    const c = await createLinearIssue(client, {
      teamId,
      projectId,
      title,
      description: body,
      labelIds: [backlogLabel.id],
    });
    await updateArtifactFields(projectDir, config, 'backlog', bl.id, {
      linearIssueId: c.id,
      linearIssueIdentifier: c.identifier,
      linearIssueUrl: c.url,
      linearLabelIds: [backlogLabel.id],
    });
  } else {
    logger.warn(`Update-only: skipping backlog item ${bl.id} (no linearIssueId).`);
  }

  return buildLinearPushPlan(projectDir, config, blId, { updateOnly });
}

/**
 * Granular push entry point: dispatches on the artifact-id prefix. Accepts any
 * supported artifact type (EPIC/FEAT/US/TASK); errors with an actionable
 * message for types that are not pushable (ADR/SPRINT/checklist) or not yet
 * supported in this release (QT/BL — arrives in Phase 3).
 */
export async function runLinearPush(
  projectDir: string,
  config: OpenPlanrConfig,
  client: LinearClient,
  artifactId: string,
  options?: LinearPushOptions,
): Promise<LinearPushPlan | null> {
  const teamId = config.linear?.teamId;
  if (!teamId) {
    throw new Error('`linear.teamId` is not set. Run `planr linear init` first.');
  }
  const leadId = config.linear?.defaultProjectLead;
  const opts: LinearPushOptions = options ?? {};
  const updateOnly = opts.updateOnly === true;

  const type = findArtifactTypeById(artifactId);
  if (!type) {
    throw new Error(
      `Unknown artifact id: ${artifactId}. Expected an EPIC-/FEAT-/US-/TASK- prefix.`,
    );
  }
  if (type === 'sprint' || type === 'adr' || type === 'checklist') {
    throw new Error(
      `planr linear push does not support ${type}s in this release. Push its parent epic instead: planr linear push <EPIC-ID>.`,
    );
  }

  if (type === 'epic') {
    return pushEpicScope(
      projectDir,
      config,
      client,
      artifactId,
      updateOnly,
      teamId,
      leadId,
      opts.strategyOverride,
    );
  }
  if (type === 'feature') {
    return pushFeatureScope(projectDir, config, client, artifactId, opts, teamId, leadId);
  }
  if (type === 'story') {
    return pushStoryScope(projectDir, config, client, artifactId, opts, teamId, leadId);
  }
  if (type === 'task') {
    return pushTaskFileScope(projectDir, config, client, artifactId, opts, teamId, leadId);
  }
  if (type === 'quick') {
    return pushQuickTaskScope(projectDir, config, client, artifactId, opts, teamId);
  }
  if (type === 'backlog') {
    return pushBacklogItemScope(projectDir, config, client, artifactId, opts, teamId);
  }
  return null;
}
