import { Command } from 'commander';
import path from 'node:path';
import { createDefaultConfig, saveConfig } from '../../services/config-service.js';
import { createChecklist } from '../../services/checklist-service.js';
import { ensureDir } from '../../utils/fs.js';
import { fileExists } from '../../utils/fs.js';
import { CONFIG_FILENAME, ARTIFACT_DIRS } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';
import { promptText, promptConfirm } from '../../services/prompt-service.js';

export function registerInitCommand(program: Command) {
  program
    .command('init')
    .description('Initialize Planr in the current project')
    .option('--name <name>', 'project name')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const configPath = path.join(projectDir, CONFIG_FILENAME);

      if (await fileExists(configPath)) {
        const overwrite = await promptConfirm(
          `${CONFIG_FILENAME} already exists. Overwrite?`,
          false
        );
        if (!overwrite) {
          logger.info('Init cancelled.');
          return;
        }
      }

      const projectName =
        opts.name || (await promptText('Project name:', path.basename(projectDir)));

      const config = createDefaultConfig(projectName);

      // Create directory structure
      const agileDir = path.join(projectDir, config.outputPaths.agile);
      for (const dir of Object.values(ARTIFACT_DIRS)) {
        await ensureDir(path.join(agileDir, dir));
      }
      // Also create diagrams dir
      await ensureDir(path.join(agileDir, 'diagrams'));

      // Save config
      await saveConfig(projectDir, config);
      logger.success(`Created ${CONFIG_FILENAME}`);

      // Create checklist
      const checklistPath = await createChecklist(projectDir, config);
      logger.success(`Created agile development checklist`);

      logger.heading('Planr initialized!');
      logger.info(`Project: ${projectName}`);
      logger.info(`Artifacts: ${config.outputPaths.agile}/`);
      logger.dim('');
      logger.dim('Next steps:');
      logger.dim('  planr epic create        — Create your first epic');
      logger.dim('  planr rules generate     — Generate AI agent rules');
      logger.dim('  planr checklist show      — View the agile checklist');
    });
}
