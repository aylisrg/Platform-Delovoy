/** Required release gate. Usage: node scripts/verify-gazebo-assets.mjs */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'design/gazebos/asset-manifest.json'), 'utf8'));
const failures = [];
let hashes = [];
try { hashes = JSON.parse(await readFile(resolve(root, 'design/gazebos/asset-hashes.json'), 'utf8')); }
catch { failures.push('Missing derivative/source checksums: run prepare-gazebo-assets.mjs first.'); }
for (const item of manifest.photos) {
  try {
    const bytes = await readFile(resolve(root, item.target));
    const meta = await sharp(bytes).metadata();
    const scale = Math.min(1, 1600 / Math.max(item.width, item.height));
    if (meta.format !== 'webp' || meta.width !== Math.round(item.width * scale) || meta.height !== Math.round(item.height * scale)) throw new Error('expected an optimized WebP preserving original orientation and aspect ratio');
    const hash = hashes.find((entry) => entry.path === item.target);
    if (!hash || hash.sha256 !== createHash('sha256').update(bytes).digest('hex') || hash.source_sha256 !== item.source_sha256 || !/^[a-f0-9]{64}$/.test(hash.source_sha256)) {
      throw new Error('source/derivative checksum record missing or mismatched');
    }
  } catch (error) { failures.push(`${item.target}: ${error.message}`); }
}
if (manifest.photos.length !== 15 || new Set(manifest.photos.map((item) => item.target)).size !== 15) failures.push('Expected exactly 15 unique approved assets.');
if (failures.length) {
  console.error('RELEASE BLOCKED: gazebo assets are incomplete or invalid.\n' + failures.join('\n'));
  process.exitCode = 1;
} else console.log('PASS: all 15 approved gazebo assets are present, decoded and checksum-verified.');
