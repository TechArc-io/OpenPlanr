import type { OpenPlanrConfig, ArtifactCollection, GeneratedFile } from '../models/types.js';

export abstract class BaseGenerator {
  constructor(
    protected config: OpenPlanrConfig,
    protected projectDir: string,
  ) {}

  abstract generate(artifacts: ArtifactCollection): Promise<GeneratedFile[]>;
  abstract getTargetName(): string;
}
