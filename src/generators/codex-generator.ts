import path from 'node:path';
import type { ArtifactCollection, GeneratedFile } from '../models/types.js';
import { renderTemplate } from '../services/template-service.js';
import { OPENPLANR_PROTOCOL_VERSION } from '../utils/constants.js';
import { BaseGenerator } from './base-generator.js';

export class CodexGenerator extends BaseGenerator {
  getTargetName(): string {
    return 'codex';
  }

  async generate(_artifacts: ArtifactCollection): Promise<GeneratedFile[]> {
    const baseData = {
      projectName: this.config.projectName,
      agilePath: this.config.outputPaths.agile,
      date: new Date().toISOString().split('T')[0],
    };

    // Always render the agile-mode AGENTS.md body (preserves existing behaviour
    // when scope=agile; the body is shared content across both scopes).
    let content = '';
    if (this.includesAgile()) {
      content = await renderTemplate(
        'rules/codex/AGENTS.md.hbs',
        baseData,
        this.config.templateOverrides,
      );
    }

    // When scope ⊇ pipeline, append the pipeline orchestration section.
    if (this.includesPipeline()) {
      const pipelineData = { ...baseData, protocolVersion: OPENPLANR_PROTOCOL_VERSION };
      const pipelineSection = await renderTemplate(
        'rules/codex/_pipeline-section.md.hbs',
        pipelineData,
        this.config.templateOverrides,
      );
      // If we already have agile content, separate with a thematic break;
      // if not, the pipeline section becomes the file body.
      content = content ? `${content.trimEnd()}\n\n---\n\n${pipelineSection}` : pipelineSection;
    }

    return [
      {
        path: path.join(this.config.outputPaths.codexConfig, 'AGENTS.md'),
        content,
      },
    ];
  }
}
