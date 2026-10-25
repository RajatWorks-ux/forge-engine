/**
 * FORGE — Job State Manager
 * Atomic state writes with automatic .bak recovery.
 */

import fs from 'fs';
import path from 'path';
import { writeJson, readJson } from './fs_helpers.js';

export async function saveJobState(jobDir, job) {
  fs.mkdirSync(jobDir, { recursive: true });
  const statePath = path.join(jobDir, 'job.json');
  const backupPath = `${statePath}.bak`;

  if (fs.existsSync(statePath)) {
    try { fs.copyFileSync(statePath, backupPath); } catch {}
  }
  writeJson(statePath, job);
}

export async function loadJobState(jobDir) {
  const statePath = path.join(jobDir, 'job.json');
  const backupPath = `${statePath}.bak`;
  for (const candidate of [statePath, backupPath]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const job = readJson(candidate);
      if (job && typeof job === 'object' && job.id) return job;
    } catch {}
  }
  return null;
}
