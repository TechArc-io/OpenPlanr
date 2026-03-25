import { Command } from 'commander';
import path from 'node:path';
import { loadConfig } from '../../services/config-service.js';
import {
  createArtifact,
  listArtifacts,
  readArtifact,
  getArtifactDir,
} from '../../services/artifact-service.js';
import { promptText } from '../../services/prompt-service.js';
import { renderTemplate } from '../../services/template-service.js';
import { getNextId } from '../../services/id-service.js';
import { writeFile } from '../../utils/fs.js';
import { slugify } from '../../utils/slugify.js';
import { logger } from '../../utils/logger.js';

export function registerStoryCommand(program: Command) {
  const story = program.command('story').description('Manage user stories');

  story
    .command('create')
    .description('Create a new user story from a feature')
    .requiredOption('--feature <featureId>', 'parent feature ID (e.g., FEAT-001)')
    .option('--title <title>', 'story title')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const featureData = await readArtifact(projectDir, config, 'feature', opts.feature);
      if (!featureData) {
        logger.error(`Feature ${opts.feature} not found.`);
        process.exit(1);
      }

      logger.heading(`Create User Story (from ${opts.feature})`);

      const title = opts.title || (await promptText('Story title:'));
      const role = await promptText('As a (role):');
      const goal = await promptText('I want to (goal):');
      const benefit = await promptText('So that (benefit):');
      const additionalNotes = await promptText('Additional notes:', '');

      // Create the user story markdown
      const { id, filePath } = await createArtifact(
        projectDir,
        config,
        'story',
        'stories/user-story.md.hbs',
        {
          title,
          featureId: opts.feature,
          role,
          goal,
          benefit,
          additionalNotes: additionalNotes || undefined,
        }
      );

      // Create companion Gherkin file
      const storyDir = path.join(projectDir, getArtifactDir(config, 'story'));
      const gherkinContent = await renderTemplate(
        'stories/gherkin.feature.hbs',
        {
          id,
          title,
          role,
          goal,
          benefit,
          scenarios: [
            {
              name: 'Happy path',
              given: 'the preconditions are met',
              when: `the user ${goal.toLowerCase()}`,
              then: 'the expected outcome occurs',
            },
          ],
        },
        config.templateOverrides
      );
      const gherkinPath = path.join(storyDir, `${id}-gherkin.feature`);
      await writeFile(gherkinPath, gherkinContent);

      logger.success(`Created user story ${id}: ${title}`);
      logger.dim(`  ${filePath}`);
      logger.dim(`  ${gherkinPath}`);
      logger.dim('');
      logger.dim(`Next: planr task create --story ${id}`);
    });

  story
    .command('list')
    .description('List user stories')
    .option('--feature <featureId>', 'filter by feature ID')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const stories = await listArtifacts(projectDir, config, 'story');

      if (stories.length === 0) {
        logger.info(
          'No stories found. Run "planr story create --feature <ID>" to create one.'
        );
        return;
      }

      logger.heading('User Stories');
      for (const s of stories) {
        console.log(`  ${s.id}  ${s.title}`);
      }
    });
}
