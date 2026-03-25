import { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import { createArtifact, listArtifacts, readArtifact } from '../../services/artifact-service.js';
import { promptText, promptMultiText } from '../../services/prompt-service.js';
import { logger } from '../../utils/logger.js';

export function registerTaskCommand(program: Command) {
  const task = program.command('task').description('Manage tasks');

  task
    .command('create')
    .description('Create tasks from a user story')
    .requiredOption('--story <storyId>', 'parent user story ID (e.g., US-001)')
    .option('--title <title>', 'task list title')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const storyData = await readArtifact(projectDir, config, 'story', opts.story);
      if (!storyData) {
        logger.error(`User story ${opts.story} not found.`);
        process.exit(1);
      }

      logger.heading(`Create Tasks (from ${opts.story})`);

      const title =
        opts.title || (await promptText('Task list title:', `Tasks for ${opts.story}`));
      const taskNames = await promptMultiText(
        'Enter task names',
        'comma-separated, e.g.: Setup, Implement API, Write tests'
      );

      const tasks = taskNames.map((name, i) => ({
        id: `${i + 1}.0`,
        title: name,
        status: 'pending' as const,
        subtasks: [],
      }));

      const { id, filePath } = await createArtifact(
        projectDir,
        config,
        'task',
        'tasks/task-list.md.hbs',
        {
          title,
          storyId: opts.story,
          tasks,
        }
      );

      logger.success(`Created task list ${id}: ${title}`);
      logger.dim(`  ${filePath}`);
      logger.dim(`  ${tasks.length} tasks created`);
      logger.dim('');
      logger.dim(`Next: planr task implement ${id}`);
    });

  task
    .command('list')
    .description('List task lists')
    .option('--story <storyId>', 'filter by story ID')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const tasks = await listArtifacts(projectDir, config, 'task');

      if (tasks.length === 0) {
        logger.info(
          'No task lists found. Run "planr task create --story <ID>" to create one.'
        );
        return;
      }

      logger.heading('Task Lists');
      for (const t of tasks) {
        console.log(`  ${t.id}  ${t.title}`);
      }
    });

  task
    .command('implement')
    .description('Start implementing a task')
    .argument('<taskId>', 'task list ID (e.g., TASK-001)')
    .action(async (taskId: string) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const taskData = await readArtifact(projectDir, config, 'task', taskId);
      if (!taskData) {
        logger.error(`Task list ${taskId} not found.`);
        process.exit(1);
      }

      logger.heading(`Implement: ${taskId}`);
      logger.info('Task list content:');
      console.log(taskData.content);
      logger.dim('');
      logger.dim(
        'Use your AI assistant with the generated rules to implement tasks one at a time.'
      );
    });
}
