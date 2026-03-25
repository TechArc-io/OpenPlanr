import matter from 'gray-matter';

export interface ParsedMarkdown {
  data: Record<string, unknown>;
  content: string;
}

export function parseMarkdown(raw: string): ParsedMarkdown {
  const { data, content } = matter(raw);
  return { data, content };
}

export function toMarkdownWithFrontmatter(data: Record<string, unknown>, content: string): string {
  return matter.stringify(content, data);
}
