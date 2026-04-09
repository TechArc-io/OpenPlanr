import { checkbox, confirm, editor, input, password, select } from '@inquirer/prompts';
import { logger } from '../utils/logger.js';
import { isNonInteractive } from './interactive-state.js';

/** Prompt the user for a single line of text input. Falls back to defaultValue in non-interactive mode. */
export async function promptText(message: string, defaultValue?: string): Promise<string> {
  if (isNonInteractive()) {
    if (defaultValue !== undefined) {
      logger.dim(`  [auto] ${message} → "${defaultValue}"`);
      return defaultValue;
    }
    throw new Error(`Non-interactive mode: no default value for prompt "${message}"`);
  }
  return input({ message, default: defaultValue });
}

/** Prompt the user to select one option from a list. */
export async function promptSelect<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T }>,
  defaultValue?: T,
): Promise<T> {
  if (isNonInteractive()) {
    const value = defaultValue ?? choices[0].value;
    logger.dim(`  [auto] ${message} → "${value}"`);
    return value;
  }
  return select({ message, choices, default: defaultValue });
}

/** Prompt the user for a yes/no confirmation. */
export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
  if (isNonInteractive()) {
    logger.dim(`  [auto] ${message} → ${defaultValue ? 'yes' : 'no'}`);
    return defaultValue;
  }
  return confirm({ message, default: defaultValue });
}

/** Open the user's default editor for multi-line text input. */
export async function promptEditor(message: string, defaultValue?: string): Promise<string> {
  if (isNonInteractive()) {
    if (defaultValue !== undefined) {
      logger.dim(`  [auto] ${message} → (default)`);
      return defaultValue;
    }
    throw new Error(
      `Non-interactive mode: editor prompt requires a default value for "${message}"`,
    );
  }
  return editor({ message, default: defaultValue });
}

/** Prompt the user for sensitive input with masked characters. */
export async function promptSecret(message: string): Promise<string> {
  if (isNonInteractive()) {
    logger.dim('  [auto] Skipping secret prompt (set via environment variable)');
    return '';
  }
  return password({ message, mask: '*' });
}

/** Prompt the user to select multiple options from a checkbox list. */
export async function promptCheckbox<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T; checked?: boolean }>,
): Promise<T[]> {
  if (isNonInteractive()) {
    const checked = choices.filter((c) => c.checked).map((c) => c.value);
    logger.dim(`  [auto] ${message} → ${checked.length} pre-selected item(s)`);
    return checked;
  }
  return checkbox({ message, choices });
}

/** Prompt the user for comma-separated text values, returned as a trimmed array. */
export async function promptMultiText(message: string, hint?: string): Promise<string[]> {
  if (isNonInteractive()) {
    throw new Error(
      `Non-interactive mode: multi-text prompt "${message}" requires interactive input`,
    );
  }
  const result = await input({
    message: `${message}${hint ? ` (${hint})` : ''}`,
  });
  return result
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
