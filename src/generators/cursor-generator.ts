import path from 'node:path';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { renderTemplate } from '../services/template-service.js';
import { BaseGenerator } from './base-generator.js';

const CURSOR_RULE_TEMPLATES = [
  '2000-agile-checklist.mdc.hbs',
  '2001-agile-create-epic.mdc.hbs',
  '2002-agile-create-features.mdc.hbs',
  '2003-agile-create-user-story.mdc.hbs',
  '2100-create-task-list.mdc.hbs',
  '2101-implement-task-list.mdc.hbs',
];

export class CursorGenerator extends BaseGenerator {
  getTargetName(): string {
    return 'cursor';
  }

  async generate(artifacts: ArtifactCollection): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];
    const rulesDir = this.config.outputPaths.cursorRules;
    const data = {
      projectName: this.config.projectName,
      agilePath: this.config.outputPaths.agile,
      existingEpics: artifacts.epics.map((e) => ({ id: e.id, title: e.title })),
      existingFeatures: artifacts.features.map((f) => ({ id: f.id, title: f.title })),
      existingStories: artifacts.stories.map((s) => ({ id: s.id, title: s.title })),
    };

    for (const template of CURSOR_RULE_TEMPLATES) {
      const content = await renderTemplate(
        `rules/cursor/${template}`,
        data,
        this.config.templateOverrides,
      );
      const outputName = template.replace('.hbs', '');
      files.push({
        path: path.join(rulesDir, outputName),
        content,
      });
    }

    return files;
  }
}
