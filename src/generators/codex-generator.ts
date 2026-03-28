import path from 'node:path';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { renderTemplate } from '../services/template-service.js';
import { BaseGenerator } from './base-generator.js';

export class CodexGenerator extends BaseGenerator {
  getTargetName(): string {
    return 'codex';
  }

  async generate(_artifacts: ArtifactCollection): Promise<GeneratedFile[]> {
    const content = await renderTemplate(
      'rules/codex/AGENTS.md.hbs',
      {
        projectName: this.config.projectName,
        agilePath: this.config.outputPaths.agile,
        date: new Date().toISOString().split('T')[0],
      },
      this.config.templateOverrides,
    );

    return [
      {
        path: path.join(this.config.outputPaths.codexConfig, 'AGENTS.md'),
        content,
      },
    ];
  }
}
