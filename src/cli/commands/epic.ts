import { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import { createArtifact, listArtifacts } from '../../services/artifact-service.js';
import { promptText, promptMultiText } from '../../services/prompt-service.js';
import { logger } from '../../utils/logger.js';

export function registerEpicCommand(program: Command) {
  const epic = program.command('epic').description('Manage epics');

  epic
    .command('create')
    .description('Create a new epic')
    .option('--title <title>', 'epic title')
    .option('--owner <owner>', 'epic owner')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      logger.heading('Create Epic');

      const title = opts.title || (await promptText('Epic title:'));
      const owner = opts.owner || (await promptText('Owner:', config.author));
      const businessValue = await promptText('Business value:');
      const targetUsers = await promptText('Target users:');
      const problemStatement = await promptText('Problem statement:');
      const solutionOverview = await promptText('Solution overview:');
      const successCriteria = await promptText('Success criteria:');
      const keyFeatures = await promptMultiText('Key features', 'comma-separated');
      const dependencies = await promptText('Dependencies:', 'None');
      const risks = await promptText('Risks:', 'None');

      const { id, filePath } = await createArtifact(
        projectDir,
        config,
        'epic',
        'epics/epic.md.hbs',
        {
          title,
          owner,
          businessValue,
          targetUsers,
          problemStatement,
          solutionOverview,
          successCriteria,
          keyFeatures,
          dependencies,
          risks,
          featureIds: [],
        }
      );

      logger.success(`Created epic ${id}: ${title}`);
      logger.dim(`  ${filePath}`);
      logger.dim('');
      logger.dim(`Next: planr feature create --epic ${id}`);
    });

  epic
    .command('list')
    .description('List all epics')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const epics = await listArtifacts(projectDir, config, 'epic');

      if (epics.length === 0) {
        logger.info('No epics found. Run "planr epic create" to create one.');
        return;
      }

      logger.heading('Epics');
      for (const epic of epics) {
        console.log(`  ${epic.id}  ${epic.title}`);
      }
    });
}
