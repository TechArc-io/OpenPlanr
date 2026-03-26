/**
 * Factory for creating coding agent instances.
 */

import type { CodingAgent } from './types.js';
import type { CodingAgentName } from '../models/types.js';

export async function createAgent(name: CodingAgentName): Promise<CodingAgent> {
  switch (name) {
    case 'claude': {
      const { ClaudeAgent } = await import('./claude-agent.js');
      return new ClaudeAgent();
    }
    case 'cursor': {
      const { CursorAgent } = await import('./cursor-agent.js');
      return new CursorAgent();
    }
    case 'codex': {
      const { CodexAgent } = await import('./codex-agent.js');
      return new CodexAgent();
    }
    default:
      throw new Error(`Unknown coding agent: ${name}. Supported: claude, cursor, codex.`);
  }
}
