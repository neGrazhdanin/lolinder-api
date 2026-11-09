#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const { tool_input: input } = JSON.parse(readFileSync(0, 'utf8'));
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const path = input?.file_path ?? input?.notebook_path;
if (!path) process.exit(0);

const rel = relative(root, resolve(root, path));
if (!rel.startsWith('prisma/migrations/')) process.exit(0);

try {
  execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: root, stdio: 'ignore' });
} catch {
  process.exit(0);
}
console.error(
  `${rel} is a committed migration and may already be applied. Change prisma/schema.prisma and run \`pnpm db:migrate --name <change>\` instead.`,
);
process.exit(2);
