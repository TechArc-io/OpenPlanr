import path from 'node:path';
import { listFiles } from '../utils/fs.js';

export async function getNextId(dir: string, prefix: string): Promise<string> {
  const files = await listFiles(dir, new RegExp(`^${prefix}-\\d{3}`));
  let maxId = 0;
  for (const file of files) {
    const match = file.match(new RegExp(`^${prefix}-(\\d{3})`));
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxId) maxId = num;
    }
  }
  const nextNum = (maxId + 1).toString().padStart(3, '0');
  return `${prefix}-${nextNum}`;
}

export function parseId(id: string): { prefix: string; num: number } | null {
  const match = id.match(/^([A-Z]+)-(\d{3})$/);
  if (!match) return null;
  return { prefix: match[1], num: parseInt(match[2], 10) };
}
