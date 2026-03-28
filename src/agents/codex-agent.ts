/**
 * OpenAI Codex CLI agent adapter.
 *
 * Invokes the `codex` CLI binary with the implementation prompt
 * and streams output in real time.
 */

import { spawn } from 'node:child_process';
import type { CodingAgent, AgentOptions, AgentResult } from './types.js';
import { which } from './utils.js';

export class CodexAgent implements CodingAgent {
  readonly name = 'codex';

  async isAvailable(): Promise<boolean> {
    return (await which('codex')) !== null;
  }

  async execute(prompt: string, options: AgentOptions): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('codex', [prompt], {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      const chunks: string[] = [];

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        chunks.push(text);
        if (options.stream) {
          process.stdout.write(text);
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        if (options.stream) {
          process.stderr.write(text);
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to launch codex CLI: ${err.message}`));
      });

      child.on('close', (code) => {
        resolve({
          output: chunks.join(''),
          exitCode: code ?? 1,
        });
      });
    });
  }
}
