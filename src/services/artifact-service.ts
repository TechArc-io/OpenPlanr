import path from 'node:path';
import { ensureDir, writeFile, readFile, listFiles } from '../utils/fs.js';
import { slugify } from '../utils/slugify.js';
import { parseMarkdown } from '../utils/markdown.js';
import { getNextId } from './id-service.js';
import { renderTemplate } from './template-service.js';
import type { OpenPlanrConfig, ArtifactType } from '../models/types.js';

const ARTIFACT_DIR_MAP: Record<string, string> = {
  epic: 'epics',
  feature: 'features',
  story: 'stories',
  task: 'tasks',
  adr: 'adrs',
  checklist: 'checklists',
};

export function getArtifactDir(config: OpenPlanrConfig, type: ArtifactType): string {
  return path.join(config.outputPaths.agile, ARTIFACT_DIR_MAP[type] || type);
}

export async function createArtifact(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  templateFile: string,
  data: Record<string, unknown>
): Promise<{ id: string; filePath: string }> {
  const dir = path.join(projectDir, getArtifactDir(config, type));
  await ensureDir(dir);

  const prefixKey = type as keyof typeof config.idPrefix;
  const prefix = config.idPrefix[prefixKey] || type.toUpperCase();
  const id = await getNextId(dir, prefix);
  const title = (data.title as string) || 'untitled';
  const slug = slugify(title);
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(dir, filename);

  const content = await renderTemplate(templateFile, {
    ...data,
    id,
    date: new Date().toISOString().split('T')[0],
    projectName: config.projectName,
  }, config.templateOverrides);

  await writeFile(filePath, content);
  return { id, filePath };
}

export async function listArtifacts(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType
): Promise<Array<{ id: string; title: string; filename: string }>> {
  const dir = path.join(projectDir, getArtifactDir(config, type));
  const files = await listFiles(dir, /\.md$/);
  const results: Array<{ id: string; title: string; filename: string }> = [];

  for (const filename of files.sort()) {
    const match = filename.match(/^([A-Z]+-\d{3})-(.+)\.md$/);
    if (match) {
      results.push({
        id: match[1],
        title: match[2].replace(/-/g, ' '),
        filename,
      });
    }
  }
  return results;
}

export async function readArtifact(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  id: string
): Promise<{ data: Record<string, unknown>; content: string; filePath: string } | null> {
  const dir = path.join(projectDir, getArtifactDir(config, type));
  const files = await listFiles(dir, new RegExp(`^${id}-.*\\.md$`));
  if (files.length === 0) return null;

  const filePath = path.join(dir, files[0]);
  const raw = await readFile(filePath);
  const parsed = parseMarkdown(raw);
  return { ...parsed, filePath };
}
