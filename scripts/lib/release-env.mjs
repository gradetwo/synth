#!/usr/bin/env node
/**
 * Where a release goes, and the one secret it needs.
 *
 * Kept in one place for two reasons. The site name is a footgun — `gs1.pages.dev`
 * is *not* this app (it answers with Cloudflare request metadata and a HTTP 200,
 * which reads like success; see `docs/notes/release.md`) — and the token reader
 * must never print, log or echo what it found. `release.mjs`, `rollback.mjs` and
 * the drill all go through here.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** The one production origin. `GS1_SITE` overrides it (a mirror, a local server, a drill). */
export const SITE_DEFAULT = 'https://synth.wangda.today';

export const resolveSite = (env = process.env) => (env.GS1_SITE ?? SITE_DEFAULT).replace(/\/$/, '');

/**
 * Cloudflare token: the environment first, then the shell profile, like the
 * docs do. The value is returned, never logged.
 */
export function cloudflareToken(env = process.env, home = homedir()) {
  if (env.CLOUDFLARE_API_TOKEN) return env.CLOUDFLARE_API_TOKEN;
  for (const profile of ['.zshrc', '.bashrc', '.profile']) {
    let text;
    try {
      text = readFileSync(resolve(home, profile), 'utf8');
    } catch {
      continue;
    }
    const match = text.match(/^\s*export\s+CLOUDFLARE_API_TOKEN=(.*)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}
