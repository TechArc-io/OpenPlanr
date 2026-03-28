/**
 * Claude Code CLI agent adapter.
 *
 * Invokes the `claude` CLI binary with --print mode, writing the
 * prompt to a temp file and piping it via stdin. Output streams
 * directly to the user's terminal for real-time feedback.
 *
 * Includes retry logic for transient API errors (e.g. 400/429/500).
 */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentOptions, AgentResult, CodingAgent } from './types.js';
import { which } from './utils.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

/** Patterns in stderr that indicate a transient/retryable API error */
const RETRYABLE_PATTERNS = [
  'tool use concurrency',
  'overloaded',
  '429',
  '500',
  '503',
  'rate limit',
  'ECONNRESET',
  'socket hang up',
];

function isRetryableError(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return RETRYABLE_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClaudeAgent implements CodingAgent {
  readonly name = 'claude';

  async isAvailable(): Promise<boolean> {
    return (await which('claude')) !== null;
  }

  async execute(prompt: string, options: AgentOptions): Promise<AgentResult> {
    // Write prompt to a temp file to avoid both ARG_MAX limits and
    // Node.js stream backpressure issues with large prompts
    const tmpFile = path.join(tmpdir(), `planr-prompt-${Date.now()}.txt`);
    await writeFile(tmpFile, prompt, 'utf-8');

    try {
      let lastExitCode = 1;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delaySec = (RETRY_DELAY_MS * attempt) / 1000;
          process.stderr.write(
            `\n⟳ Retrying (attempt ${attempt + 1}/${MAX_RETRIES + 1}) in ${delaySec}s...\n`,
          );
          await sleep(RETRY_DELAY_MS * attempt);
        }

        const result = await this.spawn(tmpFile, options);
        lastExitCode = result.exitCode;

        // Success — return immediately
        if (result.exitCode === 0) {
          return { output: '', exitCode: 0 };
        }

        // Check if the error is retryable
        if (result.stderr && isRetryableError(result.stderr)) {
          continue;
        }

        // Non-retryable error — return as-is
        return { output: '', exitCode: result.exitCode };
      }

      // Exhausted retries
      return { output: '', exitCode: lastExitCode };
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  }

  private spawn(
    tmpFile: string,
    options: AgentOptions,
  ): Promise<{ output: string; exitCode: number; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['--print'], {
        cwd: options.cwd,
        // stdin: pipe from temp file; stdout: inherit for real-time; stderr: pipe to capture errors
        stdio: ['pipe', 'inherit', 'pipe'],
        env: { ...process.env },
      });

      // Stream the temp file into stdin — handles backpressure correctly
      const fileStream = createReadStream(tmpFile, 'utf-8');
      fileStream.pipe(child.stdin);

      const stderrChunks: string[] = [];

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderrChunks.push(text);
        // Still show stderr to the user in real-time
        process.stderr.write(text);
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to launch claude CLI: ${err.message}`));
      });

      child.on('close', (code) => {
        resolve({
          output: '',
          exitCode: code ?? 1,
          stderr: stderrChunks.join(''),
        });
      });
    });
  }
}
