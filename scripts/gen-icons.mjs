#!/usr/bin/env node
/**
 * Generate the PWA icon set from one vector definition.
 *
 * SVG sources are always written; PNG rasterisation uses rsvg-convert or
 * ImageMagick when available and is skipped otherwise (the committed PNGs are
 * then reused, so a release build never depends on a rasteriser).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const icons = resolve(root, 'public/icons');
mkdirSync(icons, { recursive: true });

/** GS-1 mark: dark disc + amber waveform. */
const mark = (size, padding = 0, bg = true) => {
  const s = size;
  const p = padding;
  const r = (s - p * 2) / 2;
  const cx = s / 2;
  const cy = s / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  ${bg ? `<rect width="${s}" height="${s}" rx="${s * 0.22}" fill="#0b0d11"/>` : ''}
  <circle cx="${cx}" cy="${cy}" r="${r * 0.92}" fill="#14171e" stroke="#3a4152" stroke-width="${s * 0.018}"/>
  <path d="M ${cx - r * 0.72} ${cy} Q ${cx - r * 0.36} ${cy - r * 0.62} ${cx} ${cy} T ${cx + r * 0.72} ${cy}"
        fill="none" stroke="#ffb340" stroke-width="${s * 0.055}" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.1}" fill="#ffb340"/>
</svg>`;
};

const svg192 = mark(192, 8);
const svg512 = mark(512, 22);
const svgMaskable = mark(512, 72);
const favicon = mark(64, 2);
const maskIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M4.5 12 Q7.5 5 12 12 T19.5 12" fill="none" stroke="#ffb340" stroke-width="2" stroke-linecap="round"/>
</svg>`;

writeFileSync(resolve(icons, 'icon-192.svg'), svg192);
writeFileSync(resolve(icons, 'icon-512.svg'), svg512);
writeFileSync(resolve(icons, 'maskable-512.svg'), svgMaskable);
writeFileSync(resolve(icons, 'favicon.svg'), favicon);
writeFileSync(resolve(icons, 'mask-icon.svg'), maskIcon);

const raster = (svgPath, pngPath, size) => {
  try {
    if (has('rsvg-convert')) {
      execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), svgPath, '-o', pngPath], {
        stdio: 'ignore',
      });
    } else if (has('magick')) {
      execFileSync('magick', ['-background', 'none', '-resize', `${size}x${size}`, svgPath, pngPath], {
        stdio: 'ignore',
      });
    } else {
      console.warn(`[icons] no rasteriser found; keeping existing ${pngPath}`);
      return;
    }
    console.log(`[icons] ${pngPath}`);
  } catch (err) {
    console.warn(`[icons] failed to rasterise ${svgPath}: ${err.message}`);
  }
};

function has(cmd) {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

raster(resolve(icons, 'icon-192.svg'), resolve(icons, 'icon-192.png'), 192);
raster(resolve(icons, 'icon-512.svg'), resolve(icons, 'icon-512.png'), 512);
raster(resolve(icons, 'maskable-512.svg'), resolve(icons, 'maskable-512.png'), 512);
raster(resolve(icons, 'favicon.svg'), resolve(icons, 'apple-touch-icon.png'), 180);
console.log(`[icons] ${existsSync(resolve(icons, 'icon-512.png')) ? 'ok' : 'SVG only'}`);
