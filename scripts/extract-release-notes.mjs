#!/usr/bin/env node
/**
 * Extract markdown release notes for a given version from changelog files.
 *
 * Usage:
 *   node scripts/extract-release-notes.mjs [version]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const targetVersion = (process.argv[2] ?? pkg.version ?? '').replace(/^v/, '');

const changelogFiles = [
  'src/changelog-head.ts',
  'src/changelog.ts',
  'src/changelog-archive.ts',
];

let foundRelease = null;

for (const file of changelogFiles) {
  const filePath = resolve(root, file);
  try {
    const text = readFileSync(filePath, 'utf8');
    // Match each release block
    const releaseRegex = /\{\s*version:\s*'([^']+)',\s*date:\s*'([^']+)',\s*kind:\s*'([^']+)',\s*items:\s*\[([\s\S]*?)\n\s*\}[\],;]/g;
    let match;
    while ((match = releaseRegex.exec(text)) !== null) {
      const [, version, date, kind, rawItems] = match;
      if (version === targetVersion) {
        // Parse items
        const itemMatches = rawItems.match(/\[\s*'([\s\S]*?)',\s*'([\s\S]*?)',?\s*\]/g) ?? [];
        const items = itemMatches.map((itemStr) => {
          const parts = itemStr.match(/\[\s*'([\s\S]*?)',\s*'([\s\S]*?)',?\s*\]/);
          return [parts?.[1] ?? '', parts?.[2] ?? ''];
        });
        foundRelease = { version, date, kind, items };
        break;
      }
    }
  } catch {
    // Continue
  }
  if (foundRelease) break;
}

if (!foundRelease) {
  console.log(`## Release v${targetVersion}\n\nAutomated release for v${targetVersion}.`);
  process.exit(0);
}

const { version, date, kind, items } = foundRelease;

const output = [];
output.push(`## GROOVE SYNTH GS-1 v${version} (${date})`);
output.push(`*Type: \`${kind}\`*\n`);

if (items.length > 0) {
  output.push('### 🇨🇳 更新内容');
  for (const [zh] of items) {
    output.push(`- ${zh.replace(/\\'/g, "'").trim()}`);
  }
  output.push('');
  output.push('### 🇬🇧 What\'s Changed');
  for (const [, en] of items) {
    output.push(`- ${en.replace(/\\'/g, "'").trim()}`);
  }
}

console.log(output.join('\n'));
