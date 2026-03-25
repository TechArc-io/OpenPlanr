import { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import { createArtifact, listArtifacts, readArtifact } from '../../services/artifact-service.js';
import { promptText, promptMultiText } from '../../services/prompt-service.js';
import { logger } from '../../utils/logger.js';

export function registerFeatureCommand(program: Command) {
  const feature = program.command('feature').description('Manage features');

  feature
    .command('create')
    .description('Create a new feature from an epic')
    .requiredOption('--epic <epicId>', 'parent epic ID (e.g., EPIC-001)')
    .option('--title <title>', 'feature title')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      // Verify epic exists
      const epicData = await readArtifact(projectDir, config, 'epic', opts.epic);
      if (!epicData) {
        logger.error(`Epic ${opts.epic} not found.`);
        process.exit(1);
      }

      logger.heading(`Create Feature (from ${opts.epic})`);

      const title = opts.title || (await promptText('Feature title:'));
      const owner = await promptText('Owner:', config.author);
      const overview = await promptText('Overview:');
      const functionalRequirements = await promptMultiText(
        'Functional requirements',
        'comma-separated'
      );
      const dependencies = await promptText('Dependencies:', 'None');
      const technicalConsiderations = await promptText('Technical considerations:', 'None');
      const risks = await promptText('Risks:', 'None');
      const successMetrics = await promptText('Success metrics:');

      const { id, filePath } = await createArtifact(
        projectDir,
        config,
        'feature',
        'features/feature.md.hbs',
        {
          title,
          epicId: opts.epic,
          owner,
          overview,
          functionalRequirements,
          dependencies,
          technicalConsiderations,
          risks,
          successMetrics,
          storyIds: [],
        }
      );

      logger.success(`Created feature ${id}: ${title}`);
      logger.dim(`  ${filePath}`);
      logger.dim('');
      logger.dim(`Next: planr story create --feature ${id}`);
    });

  feature
    .command('list')
    .description('List features')
    .option('--epic <epicId>', 'filter by epic ID')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const features = await listArtifacts(projectDir, config, 'feature');

      if (features.length === 0) {
        logger.info('No features found. Run "planr feature create --epic <ID>" to create one.');
        return;
      }

      logger.heading('Features');
      for (const f of features) {
        console.log(`  ${f.id}  ${f.title}`);
      }
    });
}
