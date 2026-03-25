import path from 'node:path';
import { fileExists, readFile, writeFile } from '../utils/fs.js';
import { renderTemplate } from './template-service.js';
import type { OpenPlanrConfig } from '../models/types.js';

const CHECKLIST_FILENAME = 'AGILE-DEVELOPMENT-GUIDE.md';

export function getChecklistPath(projectDir: string, config: OpenPlanrConfig): string {
  return path.join(projectDir, config.outputPaths.agile, 'checklists', CHECKLIST_FILENAME);
}

export async function createChecklist(
  projectDir: string,
  config: OpenPlanrConfig
): Promise<string> {
  const filePath = getChecklistPath(projectDir, config);
  const content = await renderTemplate(
    'checklists/agile-checklist.md.hbs',
    {
      projectName: config.projectName,
      date: new Date().toISOString().split('T')[0],
    },
    config.templateOverrides
  );
  await writeFile(filePath, content);
  return filePath;
}

export async function readChecklist(
  projectDir: string,
  config: OpenPlanrConfig
): Promise<string | null> {
  const filePath = getChecklistPath(projectDir, config);
  if (!(await fileExists(filePath))) return null;
  return readFile(filePath);
}

export async function resetChecklist(
  projectDir: string,
  config: OpenPlanrConfig
): Promise<string> {
  return createChecklist(projectDir, config);
}
