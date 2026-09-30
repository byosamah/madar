import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from './en.json';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function has(tree: unknown, key: string): boolean {
  let node = tree;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

describe('text keys', () => {
  it('has an English text for every literal key in the code', () => {
    const missing: string[] = [];
    for (const file of sourceFiles('src')) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (!has(en, match[1])) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('has the plan 2 and plan 3 groups', () => {
    for (const key of ['projects.new', 'project.tab.overview', 'tasks.addTask', 'schedule.today', 'files.upload', 'team.add', 'feed.task.done', 'time.minutes', 'work.group.review', 'hours.invalid', 'inbox.trigger.mention', 'comments.react', 'search.command.newTask']) {
      expect(has(en, key)).toBe(true);
    }
  });
});
