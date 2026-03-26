export type { CodingAgent, AgentOptions, AgentResult } from './types.js';
export { createAgent } from './agent-factory.js';
export { parseTaskMarkdown, findSubtasks, getNextPending } from './task-parser.js';
export { composeImplementationPrompt } from './prompt-composer.js';
export { executeImplementation } from './implementation-bridge.js';
