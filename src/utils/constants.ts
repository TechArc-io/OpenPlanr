import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArtifactType } from '../models/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CONFIG_FILENAME = '.planr/config.json';

export const DEFAULT_AGILE_DIR = '.planr';
export const DEFAULT_CURSOR_RULES_DIR = '.cursor/rules';

export const ARTIFACT_DIRS = {
  epics: 'epics',
  features: 'features',
  stories: 'stories',
  tasks: 'tasks',
  quick: 'quick',
  backlog: 'backlog',
  sprints: 'sprints',
  adrs: 'adrs',
  checklists: 'checklists',
} as const;

export const ID_PREFIXES = {
  epic: 'EPIC',
  feature: 'FEAT',
  story: 'US',
  task: 'TASK',
  quick: 'QT',
  backlog: 'BL',
  sprint: 'SPRINT',
  adr: 'ADR',
} as const;

export const VALID_STATUSES: Partial<Record<ArtifactType, readonly string[]>> = {
  epic: ['planning', 'in-progress', 'done'],
  feature: ['planning', 'in-progress', 'done'],
  story: ['planning', 'in-progress', 'done'],
  task: ['pending', 'in-progress', 'done'],
  quick: ['pending', 'in-progress', 'done'],
  backlog: ['open', 'closed', 'promoted'],
  sprint: ['planning', 'active', 'completed'],
};

/**
 * Spec-driven mode (third planning posture) uses a richer status lifecycle
 * because each phase corresponds to a different role transition:
 * PO authoring → AI decomposition → human review → handoff to openplanr-pipeline.
 *
 * - pending             — SPEC created, body not yet written
 * - shaping             — SPEC body authored (manually or via `planr spec shape`)
 * - decomposing         — `planr spec decompose` is running (AI generating US + tasks)
 * - decomposed          — US + Task files written, awaiting human review
 * - ready-for-pipeline  — `planr spec promote` validated; ready for openplanr-pipeline
 * - in-pipeline         — openplanr-pipeline `/plan` or `/ship` is running
 * - done                — DEV phase complete, code shipped
 */
export const VALID_SPEC_STATUSES = [
  'pending',
  'shaping',
  'decomposing',
  'decomposed',
  'ready-for-pipeline',
  'in-pipeline',
  'done',
] as const;

export type SpecStatus = (typeof VALID_SPEC_STATUSES)[number];

/** US/Task statuses inside a spec — simpler than the SPEC lifecycle. */
export const VALID_SPEC_STORY_STATUSES = ['pending', 'implementing', 'done', 'blocked'] as const;
export const VALID_SPEC_TASK_STATUSES = ['pending', 'in-progress', 'done', 'blocked'] as const;

export function getTemplatesDir(): string {
  return path.resolve(__dirname, '..', 'templates');
}
