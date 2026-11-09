#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { tool_input: input } = JSON.parse(readFileSync(0, 'utf8'));
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
if (input?.file_path) {
  try {
    execFileSync(
      join(root, 'node_modules/.bin/biome'),
      [
        'format',
        '--write',
        '--no-errors-on-unmatched',
        '--files-ignore-unknown=true',
        input.file_path,
      ],
      { cwd: root, stdio: 'ignore', timeout: 10_000 },
    );
  } catch {
    // A file Biome cannot parse yet is left as written; lint reports it later.
  }
}
