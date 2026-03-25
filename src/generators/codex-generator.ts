import path from 'node:path';
import { BaseGenerator } from './base-generator.js';
import { renderTemplate } from '../services/template-service.js';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';

export class CodexGenerator extends BaseGenerator {
  getTargetName(): string {
    return 'codex';
  }

  async generate(artifacts: ArtifactCollection): Promise<GeneratedFile[]> {
    const content = await renderTemplate(
      'rules/codex/AGENTS.md.hbs',
      {
        projectName: this.config.projectName,
        agilePath: this.config.outputPaths.agile,
        date: new Date().toISOString().split('T')[0],
      },
      this.config.templateOverrides
    );

    return [
      {
        path: path.join(this.config.outputPaths.codexConfig, 'AGENTS.md'),
        content,
      },
    ];
  }
}
