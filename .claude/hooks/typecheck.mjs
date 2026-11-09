#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const changed = execFileSync('git', ['status', '--porcelain', '--', '*.ts'], {
  cwd: root,
  encoding: 'utf8',
});
if (!changed.trim()) process.exit(0);

try {
  execFileSync(join(root, 'node_modules/.bin/tsc'), ['--noEmit'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  });
} catch (error) {
  const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
  console.error(`pnpm typecheck fails:\n${output.split('\n').slice(0, 40).join('\n')}`);
  process.exit(2);
}
