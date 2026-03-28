import path from 'node:path';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { listArtifacts } from '../services/artifact-service.js';
import { renderTemplate } from '../services/template-service.js';
import { BaseGenerator } from './base-generator.js';

export class ClaudeGenerator extends BaseGenerator {
  getTargetName(): string {
    return 'claude';
  }

  async generate(_artifacts: ArtifactCollection): Promise<GeneratedFile[]> {
    const epics = await listArtifacts(this.projectDir, this.config, 'epic');
    const features = await listArtifacts(this.projectDir, this.config, 'feature');

    const content = await renderTemplate(
      'rules/claude/CLAUDE.md.hbs',
      {
        projectName: this.config.projectName,
        agilePath: this.config.outputPaths.agile,
        date: new Date().toISOString().split('T')[0],
        existingEpics: epics,
        existingFeatures: features,
      },
      this.config.templateOverrides,
    );

    return [
      {
        path: path.join(this.config.outputPaths.claudeConfig, 'CLAUDE.md'),
        content,
      },
    ];
  }
}
