import path from 'node:path';
import { BaseGenerator } from './base-generator.js';
import { renderTemplate } from '../services/template-service.js';
import { listArtifacts } from '../services/artifact-service.js';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';

export class ClaudeGenerator extends BaseGenerator {
  getTargetName(): string {
    return 'claude';
  }

  async generate(artifacts: ArtifactCollection): Promise<GeneratedFile[]> {
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
      this.config.templateOverrides
    );

    return [
      {
        path: path.join(this.config.outputPaths.claudeConfig, 'CLAUDE.md'),
        content,
      },
    ];
  }
}
