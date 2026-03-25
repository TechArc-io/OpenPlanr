import { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import {
  readChecklist,
  resetChecklist,
  createChecklist,
} from '../../services/checklist-service.js';
import { logger } from '../../utils/logger.js';

export function registerChecklistCommand(program: Command) {
  const checklist = program
    .command('checklist')
    .description('Manage the agile development checklist');

  checklist
    .command('show')
    .description('Display the agile development checklist')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      let content = await readChecklist(projectDir, config);
      if (!content) {
        logger.info('No checklist found. Creating one...');
        await createChecklist(projectDir, config);
        content = await readChecklist(projectDir, config);
      }

      if (content) {
        console.log(content);
      }
    });

  checklist
    .command('reset')
    .description('Reset the checklist to its initial state')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      await resetChecklist(projectDir, config);
      logger.success('Checklist has been reset.');
    });
}
