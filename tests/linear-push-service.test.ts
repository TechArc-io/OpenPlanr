import { describe, expect, it } from 'vitest';
import type { ParsedSubtask } from '../src/agents/task-parser.js';
import type { Epic, Feature, UserStory } from '../src/models/types.js';
import {
  buildEpicProjectDescription,
  buildFeatureIssueBody,
  buildStoryIssueBody,
  formatTaskCheckboxBody,
} from '../src/services/linear-push-service.js';

describe('linear-push-service', () => {
  it('formatTaskCheckboxBody matches parseTaskMarkdown style', () => {
    const parsed: ParsedSubtask[] = [
      { id: '1.0', title: 'A', done: true, parentId: null, depth: 0 },
      { id: '1.1', title: 'B', done: false, parentId: '1.0', depth: 1 },
    ];
    const md = formatTaskCheckboxBody(parsed);
    expect(md).toContain('- [x] **1.0** A');
    expect(md).toContain('  - [ ] 1.1 B');
  });

  it('buildEpicProjectDescription includes major sections', () => {
    const epic: Epic = {
      id: 'EPIC-001',
      title: 'T',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      filePath: 'x',
      owner: 'o',
      businessValue: 'v',
      targetUsers: 'u',
      problemStatement: 'p',
      solutionOverview: 's',
      successCriteria: 'c',
      keyFeatures: [],
      dependencies: 'd',
      risks: 'r',
      featureIds: [],
    };
    const d = buildEpicProjectDescription(epic);
    expect(d).toMatch(/Business value/);
    expect(d).toMatch(/v/);
  });

  it('buildFeatureIssueBody lists functional requirements', () => {
    const f: Feature = {
      id: 'FEAT-001',
      title: 'F',
      createdAt: 'a',
      updatedAt: 'a',
      filePath: 'x',
      epicId: 'EPIC-001',
      owner: 'o',
      status: 'pending',
      overview: 'ov',
      functionalRequirements: ['one', 'two'],
      storyIds: [],
    };
    expect(buildFeatureIssueBody(f)).toMatch(/one/);
  });

  it('buildStoryIssueBody includes acceptance criteria', () => {
    const s: UserStory = {
      id: 'US-001',
      title: 'S',
      createdAt: 'a',
      updatedAt: 'a',
      filePath: 'x',
      featureId: 'FEAT-001',
      role: 'r',
      goal: 'g',
      benefit: 'b',
      acceptanceCriteria: 'ac',
    };
    const body = buildStoryIssueBody(s);
    expect(body).toMatch(/r/);
    expect(body).toMatch(/ac/);
  });
});
