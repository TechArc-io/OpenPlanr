import fse from 'fs-extra';
import path from 'node:path';

export async function ensureDir(dirPath: string): Promise<void> {
  await fse.ensureDir(dirPath);
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  await fse.ensureDir(path.dirname(filePath));
  await fse.writeFile(filePath, content, 'utf-8');
}

export async function readFile(filePath: string): Promise<string> {
  return fse.readFile(filePath, 'utf-8');
}

export async function fileExists(filePath: string): Promise<boolean> {
  return fse.pathExists(filePath);
}

export async function listFiles(dirPath: string, pattern?: RegExp): Promise<string[]> {
  const exists = await fse.pathExists(dirPath);
  if (!exists) return [];

  const entries = await fse.readdir(dirPath);
  if (pattern) {
    return entries.filter((e) => pattern.test(e));
  }
  return entries;
}
