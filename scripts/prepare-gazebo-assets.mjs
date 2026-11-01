/** Offline asset preparation. Usage: node scripts/prepare-gazebo-assets.mjs /absolute/source-directory
 * No downloads, credentials or deployment. Originals must be available locally; checksums identify each source photograph.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const source = process.argv[2];
if (!source || !isAbsolute(source)) throw new Error('Pass the absolute directory containing the 15 materialized original photos.');
const manifest = JSON.parse(await readFile(resolve(root, 'design/gazebos/asset-manifest.json'), 'utf8'));
const inputs = [];
// Validate every original before writing any derivative.
for (const item of manifest.photos) {
  const bytes = await readFile(resolve(source, item.file_name));
  if (bytes.length !== item.size_bytes) throw new Error(`Original byte count mismatch: ${item.file_name}`);
  if (createHash('sha256').update(bytes).digest('hex') !== item.source_sha256) throw new Error(`Original checksum mismatch: ${item.file_name}`);
  const meta = await sharp(bytes).metadata();
  if (meta.format !== 'webp' || meta.width !== item.width || meta.height !== item.height) {
    throw new Error(`Original format/dimensions mismatch: ${item.file_name}`);
  }
  inputs.push({ item, bytes });
}
const hashes = [];
for (const { item, bytes } of inputs) {
  const optimized = await sharp(bytes).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78, effort: 6 }).toBuffer();
  const target = resolve(root, item.target);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, optimized);
  hashes.push({ path: item.target,
    source_sha256: createHash('sha256').update(bytes).digest('hex'),
    sha256: createHash('sha256').update(optimized).digest('hex'), bytes: optimized.length });
}
await writeFile(resolve(root, 'design/gazebos/asset-hashes.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(`Prepared ${hashes.length} genuine photographs; ${hashes.reduce((total, item) => total + item.bytes, 0)} bytes total.`);
