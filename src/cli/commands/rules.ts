import { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import { createGenerators, createGenerator } from '../../generators/generator-factory.js';
import { writeFile, ensureDir } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import path from 'node:path';
import type { TargetCLI, ArtifactCollection } from '../../models/types.js';

export function registerRulesCommand(program: Command) {
  program
    .command('rules')
    .description('Generate AI agent rule files')
    .command('generate')
    .description('Generate rule files for configured AI CLIs')
    .option('--target <target>', 'specific target: cursor, claude, codex, or all', 'all')
    .option('--dry-run', 'show what would be generated without writing files', false)
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

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

      logger.heading('Generating AI Agent Rules');
      let totalFiles = 0;

      for (const generator of generators) {
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

      logger.success(
        `${opts.dryRun ? 'Would generate' : 'Generated'} ${totalFiles} rule file(s)`
      );
    });
}
