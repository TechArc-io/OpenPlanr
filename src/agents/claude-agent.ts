/**
 * Claude Code CLI agent adapter.
 *
 * Invokes the `claude` CLI binary with --print mode, piping
 * the implementation prompt via stdin and streaming output.
 */

import { spawn } from 'node:child_process';
import type { AgentOptions, AgentResult, CodingAgent } from './types.js';
import { which } from './utils.js';

export class ClaudeAgent implements CodingAgent {
  readonly name = 'claude';

  async isAvailable(): Promise<boolean> {
    return (await which('claude')) !== null;
  }

  async execute(prompt: string, options: AgentOptions): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['--print'], {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      // Pass the prompt via stdin to avoid OS argument length limits
      child.stdin.write(prompt);
      child.stdin.end();

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
        reject(new Error(`Failed to launch claude CLI: ${err.message}`));
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
