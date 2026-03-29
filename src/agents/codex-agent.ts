/**
 * OpenAI Codex CLI agent adapter.
 *
 * Invokes `codex exec` (non-interactive mode) with the prompt via stdin.
 * Uses --json for structured output and shows a progress spinner while
 * Codex works. Includes retry logic for transient errors.
 */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProgressSpinner } from './progress.js';
import type { AgentOptions, AgentResult, CodingAgent } from './types.js';
import { isRetryableError, MAX_RETRIES, RETRY_DELAY_MS, sleep, which } from './utils.js';

export class CodexAgent implements CodingAgent {
  readonly name = 'codex';

  async isAvailable(): Promise<boolean> {
    return (await which('codex')) !== null;
  }

  async execute(prompt: string, options: AgentOptions): Promise<AgentResult> {
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

        const result = await this.spawnCodex(tmpFile, options);
        lastExitCode = result.exitCode;

        if (result.exitCode === 0) return result;
        if (result.stderr && isRetryableError(result.stderr)) continue;
        return result;
      }

      return { output: '', exitCode: lastExitCode };
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  }

  private spawnCodex(
    tmpFile: string,
    options: AgentOptions,
  ): Promise<AgentResult & { stderr: string }> {
    return new Promise((resolve, reject) => {
      // Use `codex exec` for non-interactive mode, reading prompt from stdin.
      // `codex exec resume --last` continues the previous session (like --continue).
      const args = options.continueSession ? ['exec', 'resume', '--last'] : ['exec'];

      const child = spawn('codex', args, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      // Stream the temp file into stdin
      const fileStream = createReadStream(tmpFile, 'utf-8');
      fileStream.pipe(child.stdin);

      const spinner = createProgressSpinner();
      const outputChunks: string[] = [];
      const stderrChunks: string[] = [];
      let gotFirstOutput = false;

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        outputChunks.push(text);

        if (!gotFirstOutput) {
          gotFirstOutput = true;
          spinner.stop();
        }

        // Stream to terminal in real-time
        process.stdout.write(text);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderrChunks.push(text);

        if (!gotFirstOutput) {
          gotFirstOutput = true;
          spinner.stop();
        }
        process.stderr.write(text);
      });

      child.on('error', (err) => {
        spinner.stop();
        reject(new Error(`Failed to launch codex CLI: ${err.message}`));
      });

      child.on('close', (code) => {
        spinner.stop();

        const output = outputChunks.join('');
        const stderr = stderrChunks.join('');

        if (code !== 0 && stderr && !gotFirstOutput) {
          process.stderr.write(stderr);
        }

        resolve({
          output,
          exitCode: code ?? 1,
          stderr,
        });
      });
    });
  }
}
