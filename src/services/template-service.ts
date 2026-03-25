import path from 'node:path';
import Handlebars from 'handlebars';
import { readFile, fileExists } from '../utils/fs.js';
import { getTemplatesDir } from '../utils/constants.js';

const compiledCache = new Map<string, HandlebarsTemplateDelegate>();

Handlebars.registerHelper('date', () => new Date().toISOString().split('T')[0]);

Handlebars.registerHelper('uppercase', (str: string) =>
  typeof str === 'string' ? str.toUpperCase() : ''
);

Handlebars.registerHelper('checkboxList', (items: string[]) => {
  if (!Array.isArray(items)) return '';
  return items.map((item) => `- [ ] ${item}`).join('\n');
});

export async function renderTemplate(
  templatePath: string,
  data: Record<string, unknown>,
  overrideDir?: string
): Promise<string> {
  const fullPath = await resolveTemplatePath(templatePath, overrideDir);
  let compiled = compiledCache.get(fullPath);
  if (!compiled) {
    const raw = await readFile(fullPath);
    compiled = Handlebars.compile(raw, { noEscape: true });
    compiledCache.set(fullPath, compiled);
  }
  return compiled(data);
}

async function resolveTemplatePath(
  templatePath: string,
  overrideDir?: string
): Promise<string> {
  if (overrideDir) {
    const overrideFull = path.join(overrideDir, templatePath);
    if (await fileExists(overrideFull)) {
      return overrideFull;
    }
  }
  return path.join(getTemplatesDir(), templatePath);
}
