export { createAgent } from './agent-factory.js';
export { executeImplementation } from './implementation-bridge.js';
export { composeImplementationPrompt } from './prompt-composer.js';
export { findSubtasks, getNextPending, parseTaskMarkdown } from './task-parser.js';
export type { AgentOptions, AgentResult, CodingAgent } from './types.js';
