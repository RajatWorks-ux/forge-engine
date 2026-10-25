/**
 * FORGE — Filesystem Helpers
 * Atomic, integrity-first file operations for generated artifacts and job state.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export async function ensureDirs(dirs) {
  for (const dir of dirs) fs.mkdirSync(path.resolve(dir), { recursive: true });
}

export async function cleanTemp(tempDir) {
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
}

export function fileExists(filePath) { return fs.existsSync(filePath); }

export function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) throw new Error(`JSON file is empty: ${filePath}`);
  return JSON.parse(raw);
}

export function writeFileAtomic(filePath, data, options = {}) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), options.encoding || 'utf8');
  try {
    fs.writeFileSync(tmp, buffer);
    const fd = fs.openSync(tmp, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (buffer.length === 0) throw new Error(`Refusing to create zero-byte file: ${filePath}`);
    fs.renameSync(tmp, filePath);
    return filePath;
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

export function writeJson(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  if (!json || json === 'undefined') throw new Error(`Cannot serialize JSON for ${filePath}`);
  return writeFileAtomic(filePath, json);
}

export function copyFileAtomic(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) throw new Error(`Source file missing: ${sourcePath}`);
  const data = fs.readFileSync(sourcePath);
  if (!data.length) throw new Error(`Source file is empty: ${sourcePath}`);
  return writeFileAtomic(destinationPath, data);
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function assertNonEmptyFile(filePath, label = filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} is missing`);
  const size = fs.statSync(filePath).size;
  if (size <= 0) throw new Error(`${label} is empty`);
  return size;
}
