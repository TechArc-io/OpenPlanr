import { describe, it, expect } from 'vitest';
import { slugify } from '../../src/utils/slugify.js';

describe('slugify', () => {
  it('converts text to lowercase kebab-case', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(slugify('User Authentication & OAuth')).toBe('user-authentication-oauth');
  });

  it('collapses multiple spaces and dashes', () => {
    expect(slugify('some   text---here')).toBe('some-text-here');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('  --hello--  ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('replaces underscores with dashes', () => {
    expect(slugify('my_cool_feature')).toBe('my-cool-feature');
  });
});
