/**
 * Linear API wrapper (EPIC-004, FEAT-015/016) — auth, teams, mutations, and permission checks
 * using the official @linear/sdk client.
 */

import { LinearClient, LinearError, LinearErrorType, RatelimitedLinearError } from '@linear/sdk';
import { logger } from '../utils/logger.js';

type LinearIssueCreate = Parameters<LinearClient['createIssue']>[0];
type LinearIssueUpdate = Parameters<LinearClient['updateIssue']>[1];
type LinearProjectCreate = Parameters<LinearClient['createProject']>[0];
type LinearProjectUpdate = Parameters<LinearClient['updateProject']>[1];
type LinearProjectMilestoneCreate = Parameters<LinearClient['createProjectMilestone']>[0];
type LinearIssueLabelCreate = Parameters<LinearClient['createIssueLabel']>[0];

export const LINEAR_CREDENTIAL_KEY = 'linear' as const;

export interface LinearViewerSummary {
  id: string;
  name: string;
  email?: string;
}

export interface LinearTeamOption {
  id: string;
  name: string;
  key: string;
}

export function createLinearClient(apiKey: string): LinearClient {
  return new LinearClient({ apiKey });
}

/**
 * Heuristic: Linear API workflow state id (uuid) vs human-readable state name.
 * The `/i` flag is intentional — Linear's API canonicalizes UUIDs to lowercase,
 * but defensive acceptance of uppercase hex matches RFC 4122 and protects
 * against tools that normalize differently.
 */
export function isLikelyLinearWorkflowStateId(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim(),
  );
}

/**
 * Validate a value plausibly identifies a Linear issue. Two valid shapes:
 *   1. UUIDv4 (e.g. `9b2f4c3e-...`) — canonical API form
 *   2. Linear identifier (e.g. `ENG-42`) — human-readable, also accepted by `client.issue()`
 * Anything else is treated as stale/corrupted frontmatter and skipped before
 * hitting the API (BL H1 — prevents 404s and wrong-issue updates).
 */
export function isLikelyLinearIssueId(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  if (isLikelyLinearWorkflowStateId(trimmed)) return true;
  return /^[A-Z]{2,}-\d+$/.test(trimmed);
}

export interface LinearProjectSummary {
  id: string;
  identifier: string;
  name: string;
  url: string;
}

export interface LinearIssueSummary {
  id: string;
  identifier: string;
  url: string;
}

export interface LinearMilestoneSummary {
  id: string;
  name: string;
}

export interface LinearLabelSummary {
  id: string;
  name: string;
}

const DEFAULT_RETRIES = 3;

function isRetriableLinearError(err: unknown): boolean {
  if (err instanceof LinearError) {
    const t = (err as { type?: string }).type ?? LinearErrorType.Unknown;
    return t === LinearErrorType.Ratelimited || t === LinearErrorType.NetworkError;
  }
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

/** Wraps a Linear call with small exponential backoff on rate limit / network errors. */
export async function withLinearRetry<T>(
  op: string,
  fn: () => Promise<T>,
  retries: number = DEFAULT_RETRIES,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (attempt < retries && isRetriableLinearError(err)) {
        // Prefer Linear's own `Retry-After` when the error is a rate-limit
        // (surfaced on the `RatelimitedLinearError` subclass as a seconds value).
        // Fall back to exponential backoff for network errors and when the
        // server didn't advertise a retry hint. Use `Math.max` so we respect
        // both: never retry sooner than Linear asked, never faster than our
        // own backoff schedule.
        const retryAfterMs =
          err instanceof RatelimitedLinearError && typeof err.retryAfter === 'number'
            ? Math.max(0, err.retryAfter) * 1000
            : 0;
        const backoffMs = Math.min(30_000, 500 * 2 ** attempt);
        const waitMs = Math.max(retryAfterMs, backoffMs);
        logger.dim(`Linear ${op}: retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw mapLinearError(err, op);
    }
  }
  throw mapLinearError(last, op);
}

export async function createLinearProject(
  client: LinearClient,
  input: LinearProjectCreate,
): Promise<LinearProjectSummary> {
  return withLinearRetry('create project', async () => {
    const payload = await client.createProject(input);
    if (!payload?.success) {
      throw new Error('Linear did not return success when creating a project.');
    }
    const id = payload.projectId;
    if (!id) {
      throw new Error('Linear did not return a project id when creating a project.');
    }
    const project = await client.project(id);
    if (!project) {
      throw new Error('Failed to load the created project from Linear.');
    }
    return {
      id: project.id,
      identifier: project.slugId,
      name: project.name,
      url: project.url,
    };
  });
}

export async function updateLinearProject(
  client: LinearClient,
  projectId: string,
  input: LinearProjectUpdate,
): Promise<LinearProjectSummary> {
  return withLinearRetry('update project', async () => {
    const payload = await client.updateProject(projectId, input);
    if (!payload?.success) {
      throw new Error('Linear did not return success when updating a project.');
    }
    const project = await client.project(projectId);
    if (!project) {
      throw new Error('Failed to load the updated project from Linear.');
    }
    return {
      id: project.id,
      identifier: project.slugId,
      name: project.name,
      url: project.url,
    };
  });
}

export async function createLinearIssue(
  client: LinearClient,
  input: LinearIssueCreate,
): Promise<LinearIssueSummary> {
  return withLinearRetry('create issue', async () => {
    const payload = await client.createIssue(input);
    if (!payload?.success) {
      throw new Error('Linear did not return success when creating an issue.');
    }
    const id = payload.issueId;
    if (!id) {
      throw new Error('Linear did not return an issue id when creating an issue.');
    }
    const issue = await client.issue(id);
    if (!issue) {
      throw new Error('Failed to load the created issue from Linear.');
    }
    return {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
    };
  });
}

export async function updateLinearIssue(
  client: LinearClient,
  issueId: string,
  input: LinearIssueUpdate,
): Promise<LinearIssueSummary> {
  return withLinearRetry('update issue', async () => {
    const payload = await client.updateIssue(issueId, input);
    if (!payload?.success) {
      throw new Error('Linear did not return success when updating an issue.');
    }
    const issue = await client.issue(issueId);
    if (!issue) {
      throw new Error('Failed to load the updated issue from Linear.');
    }
    return {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
    };
  });
}

/**
 * Phase 2: create a new ProjectMilestone inside an existing Linear project. Returned
 * id is what we store on the epic's `linearMilestoneId` and propagate as
 * `projectMilestoneId` on every descendant issue.
 */
export async function createProjectMilestone(
  client: LinearClient,
  input: LinearProjectMilestoneCreate,
): Promise<LinearMilestoneSummary> {
  return withLinearRetry('create milestone', async () => {
    const payload = await client.createProjectMilestone(input);
    if (!payload?.success) {
      throw new Error('Linear did not return success when creating a project milestone.');
    }
    const id = payload.projectMilestoneId;
    if (!id) {
      throw new Error('Linear did not return a milestone id when creating a project milestone.');
    }
    return { id, name: input.name };
  });
}

/**
 * Phase 2: idempotent team-scoped label creation. Looks up an existing label by
 * exact name + team before creating, so re-running push is a no-op on the
 * label side. Matches the "Push re-applies the label idempotently" contract
 * from EPIC-LINEAR-GRANULAR-PUSH.
 */
export async function ensureIssueLabel(
  client: LinearClient,
  input: { teamId: string; name: string; color?: string; description?: string },
): Promise<LinearLabelSummary> {
  return withLinearRetry('ensure label', async () => {
    const existing = await client.issueLabels({
      filter: {
        team: { id: { eq: input.teamId } },
        name: { eq: input.name },
      },
      first: 1,
    });
    const hit = existing.nodes?.[0];
    if (hit?.id) {
      return { id: hit.id, name: hit.name };
    }
    const created: LinearIssueLabelCreate = {
      teamId: input.teamId,
      name: input.name,
      color: input.color,
      description: input.description,
    };
    const payload = await client.createIssueLabel(created);
    if (!payload?.success) {
      throw new Error('Linear did not return success when creating an issue label.');
    }
    const id = payload.issueLabelId;
    if (!id) {
      throw new Error('Linear did not return a label id when creating an issue label.');
    }
    return { id, name: input.name };
  });
}

/**
 * Phase 2 helper for the mapping-strategy prompt: list the team's projects so
 * the user can pick a target for `milestone-of` / `label-on`.
 */
export async function getTeamProjects(
  client: LinearClient,
  teamId: string,
  limit = 50,
): Promise<Array<{ id: string; name: string; url: string }>> {
  return withLinearRetry('list team projects', async () => {
    const team = await client.team(teamId);
    if (!team?.id) {
      throw new Error(`Team ${teamId} was not found.`);
    }
    const projects = await team.projects({ first: limit });
    return (projects.nodes ?? []).map((p) => ({ id: p.id, name: p.name, url: p.url }));
  });
}

const ISSUE_STATE_FETCH_CHUNK = 50;

/**
 * Batched: load each issue’s current workflow state **name** (one GraphQL round-trip per chunk).
 */
export async function fetchLinearIssueStateNames(
  client: LinearClient,
  issueIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(issueIds.map((i) => i.trim()).filter(Boolean))];
  for (let i = 0; i < unique.length; i += ISSUE_STATE_FETCH_CHUNK) {
    const chunk = unique.slice(i, i + ISSUE_STATE_FETCH_CHUNK);
    const result = await withLinearRetry('fetch issue states', async () => {
      const connection = await client.issues({
        filter: { id: { in: chunk } },
        first: chunk.length,
      });
      return connection;
    });
    for (const issue of result.nodes) {
      const st = await issue.state;
      const name = st?.name?.trim() ?? '';
      if (name) {
        out.set(issue.id, name);
      }
    }
  }
  return out;
}

export async function getLinearIssueDescription(
  client: LinearClient,
  issueId: string,
): Promise<string> {
  return withLinearRetry('load issue', async () => {
    const issue = await client.issue(issueId);
    return (issue?.description as string | undefined) ?? '';
  });
}

/** Resolves the current user; throws if the token is invalid or lacks API access. */
export async function validateToken(client: LinearClient): Promise<LinearViewerSummary> {
  try {
    const user = await client.viewer;
    if (!user?.id) {
      throw new Error('Linear API returned an empty viewer — check your personal access token.');
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
    };
  } catch (err) {
    throw mapLinearError(err, 'validating token');
  }
}

/** Teams the authenticated user can access (first page, up to 100). */
export async function getAvailableTeams(client: LinearClient): Promise<LinearTeamOption[]> {
  try {
    const connection = await client.teams({ first: 100 });
    const nodes = connection.nodes ?? [];
    return nodes.map((t) => ({ id: t.id, name: t.name, key: t.key }));
  } catch (err) {
    throw mapLinearError(err, 'loading teams');
  }
}

/**
 * Verifies the team exists and the token can read it (incl. project listing).
 * A missing project-create permission is surfaced via GraphQL on later mutations;
 * this catches inaccessible teams and read failures early.
 */
export async function validateTeamAccess(
  client: LinearClient,
  teamId: string,
): Promise<{ name: string; key: string }> {
  try {
    const team = await client.team(teamId);
    if (!team?.id) {
      throw new Error(
        `Team ${teamId} was not found or your token cannot access it. Ensure the PAT has read scope for teams and projects.`,
      );
    }
    await team.projects({ first: 1 });
    return { name: team.name, key: team.key };
  } catch (err) {
    throw mapLinearError(err, 'checking team access');
  }
}

function mapLinearError(err: unknown, context: string): Error {
  if (err instanceof Error && err.name === 'AbortError') {
    return new Error(`Network error while ${context}: request was cancelled or timed out.`);
  }
  if (err instanceof LinearError) {
    const t = (err as { type?: string }).type ?? LinearErrorType.Unknown;
    if (t === LinearErrorType.AuthenticationError) {
      return new Error(
        `Linear rejected this token while ${context}. Create a new PAT at https://linear.app/settings/account/security (app, read, write as needed) and run \`planr linear init\` again.`,
      );
    }
    if (t === LinearErrorType.Forbidden) {
      return new Error(
        `Permission denied while ${context}. The token may be missing required OAuth scopes, or your user cannot access this resource.`,
      );
    }
    if (t === LinearErrorType.NetworkError) {
      return new Error(
        `Cannot reach Linear while ${context}. Check your network connection, try again, and see https://status.linear.app for outages.`,
      );
    }
    if (t === LinearErrorType.Ratelimited) {
      return new Error(
        'Linear rate limit reached. Wait about 1–2 minutes (longer if you are polling heavily), then retry. See https://status.linear.app if issues persist.',
      );
    }
  }
  // Unknown / unclassified error: log the full object at debug level so
  // operators can inspect it with `--verbose`, but do NOT surface the raw
  // message to end users — LinearError bodies can contain the failed GraphQL
  // query, its variables, or raw response content we shouldn't echo.
  logger.debug(`Linear error (${context})`, err);
  const klass = err instanceof Error ? err.constructor.name : 'Unknown';
  return new Error(
    `Linear error while ${context} (${klass}). Re-run with --verbose for diagnostic details.`,
  );
}
