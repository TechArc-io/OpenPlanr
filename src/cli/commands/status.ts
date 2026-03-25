import { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import { listArtifacts } from '../../services/artifact-service.js';
import { logger } from '../../utils/logger.js';
import type { ArtifactType } from '../../models/types.js';

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Show project planning status')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      logger.heading(`OpenPlanr Status — ${config.projectName}`);
      console.log('');

      const types: Array<{ type: ArtifactType; label: string }> = [
        { type: 'epic', label: 'Epics' },
        { type: 'feature', label: 'Features' },
        { type: 'story', label: 'User Stories' },
        { type: 'task', label: 'Task Lists' },
      ];

      for (const { type, label } of types) {
        const items = await listArtifacts(projectDir, config, type);
        const count = items.length;
        const icon = count > 0 ? '●' : '○';
        console.log(`  ${icon} ${label}: ${count}`);
        if (count > 0) {
          for (const item of items.slice(0, 5)) {
            console.log(`    ${item.id}  ${item.title}`);
          }
          if (count > 5) {
            console.log(`    ... and ${count - 5} more`);
          }
        }
      }

      console.log('');
      logger.dim('Targets: ' + config.targets.join(', '));
      logger.dim('Artifacts: ' + config.outputPaths.agile + '/');
    });
}
