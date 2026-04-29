import path from 'node:path';
import type { Command } from 'commander';
import { createGenerator, createGenerators } from '../../generators/generator-factory.js';
import type { ArtifactCollection, GenerationScope, TargetCLI } from '../../models/types.js';
import { loadConfig } from '../../services/config-service.js';
import { ensureDir, writeFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';

const VALID_SCOPES: GenerationScope[] = ['agile', 'pipeline', 'all'];

export function registerRulesCommand(program: Command) {
  program
    .command('rules')
    .description('Generate AI agent rule files')
    .command('generate')
    .description('Generate rule files for configured AI CLIs')
    .option('--target <target>', 'specific target: cursor, claude, codex, or all', 'all')
    .option('--scope <scope>', 'rule set to generate: agile (default), pipeline, or all', 'agile')
    .option('--dry-run', 'show what would be generated without writing files', false)
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      // Validate --scope.
      const scope = opts.scope as GenerationScope;
      if (!VALID_SCOPES.includes(scope)) {
        logger.error(
          `Invalid --scope value "${opts.scope}". Expected one of: ${VALID_SCOPES.join(', ')}.`,
        );
        process.exit(1);
      }

      // Empty artifact collection — generators read from disk as needed
      const artifacts: ArtifactCollection = {
        epics: [],
        features: [],
        stories: [],
        tasks: [],
      };

      const generators =
        opts.target === 'all'
          ? createGenerators(config, projectDir)
          : [createGenerator(opts.target as TargetCLI, config, projectDir)];

      logger.heading(`Generating AI Agent Rules — scope=${scope}`);
      let totalFiles = 0;

      for (const generator of generators) {
        generator.setScope(scope);
        const files = await generator.generate(artifacts);
        logger.info(`${generator.getTargetName()}: ${files.length} file(s)`);

        for (const file of files) {
          const fullPath = path.join(projectDir, file.path);
          if (opts.dryRun) {
            logger.dim(`  [dry-run] ${file.path}`);
          } else {
            await ensureDir(path.dirname(fullPath));
            await writeFile(fullPath, file.content);
            logger.dim(`  ${file.path}`);
          }
          totalFiles++;
        }
      }

      logger.success(`${opts.dryRun ? 'Would generate' : 'Generated'} ${totalFiles} rule file(s)`);
    });
}
