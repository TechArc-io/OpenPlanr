import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerEpicCommand } from './commands/epic.js';
import { registerFeatureCommand } from './commands/feature.js';
import { registerStoryCommand } from './commands/story.js';
import { registerTaskCommand } from './commands/task.js';
import { registerChecklistCommand } from './commands/checklist.js';
import { registerRulesCommand } from './commands/rules.js';
import { registerStatusCommand } from './commands/status.js';

const program = new Command();

program
  .name('planr')
  .description('CLI tool for agile planning with AI agents')
  .version('0.1.0')
  .option('--project-dir <path>', 'project root directory', process.cwd())
  .option('--verbose', 'verbose output', false)
  .option('--no-interactive', 'skip interactive prompts');

registerInitCommand(program);
registerEpicCommand(program);
registerFeatureCommand(program);
registerStoryCommand(program);
registerTaskCommand(program);
registerChecklistCommand(program);
registerRulesCommand(program);
registerStatusCommand(program);

program.parse(process.argv);
