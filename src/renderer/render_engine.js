/**
 * FORGE — Render Engine
 * Runs Remotion CLI to render MP4, then post-processes with ffmpeg.
 * Works on both Termux (webpack) and GitHub Actions Ubuntu (webpack).
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../utils/logger.js';
import { assertNonEmptyFile, copyFileAtomic } from '../utils/fs_helpers.js';

// Import Supabase reporter for render frame progress
let reportRenderProgress = null;
try {
  const mod = await import('../utils/supabase_reporter.js');
  reportRenderProgress = mod.reportRenderProgress || null;
} catch {}

export async function renderVideo(remotionProjectPath, outputVideoPath, canvasConfig, jobId = null) {
  const { width, height, fps } = canvasConfig;

  log(`  Starting render: ${width}x${height} @ ${fps}fps`);
  log(`  Output: ${outputVideoPath}`);

  const tempOutputPath = path.join(remotionProjectPath, 'out', 'video_raw.mp4');
  fs.mkdirSync(path.dirname(tempOutputPath), { recursive: true });

  // Determine concurrency — 2 on GitHub Actions (2 cores), 1 on Termux
  const concurrency = process.env.CI ? 2 : 1;

  const renderArgs = [
    'remotion', 'render',
    'ForgeVideo',
    tempOutputPath,
    `--codec=h264`,
    `--image-format=jpeg`,
    `--jpeg-quality=90`,
    `--concurrency=${concurrency}`,
    `--log=verbose`,
  ];

  log(`  Running: npx ${renderArgs.join(' ')}`);

  await runCommandWithProgress('npx', renderArgs, remotionProjectPath, jobId);

  if (!fs.existsSync(tempOutputPath)) {
    throw new Error(`Render completed but output file not found: ${tempOutputPath}`);
  }

  const rawStats = fs.statSync(tempOutputPath);
  log(`  Raw render: ${(rawStats.size / 1024 / 1024).toFixed(2)} MB`);

  log(`  Running ffmpeg optimization...`);
  const stagedOutput = `${outputVideoPath}.staged`;
  await optimizeWithFfmpeg(tempOutputPath, stagedOutput, fps);
  assertNonEmptyFile(stagedOutput, 'staged final video');
  fs.renameSync(stagedOutput, outputVideoPath);

  const finalStats = fs.statSync(outputVideoPath);
  log(`  Final video: ${(finalStats.size / 1024 / 1024).toFixed(2)} MB`);

  return outputVideoPath;
}

function runCommandWithProgress(cmd, args, cwd, jobId) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        REMOTION_BUNDLER: 'webpack',
        DISABLE_RSPACK: '1',
      },
    });

    let lastPct = -1;

    proc.stdout.on('data', data => {
      const text = data.toString();
      const frameMatch = text.match(/Frame (\d+)\/(\d+)/);
      if (frameMatch) {
        const current = parseInt(frameMatch[1]);
        const total = parseInt(frameMatch[2]);
        const pct = Math.floor((current / total) * 100);
        if (pct !== lastPct) {
          process.stdout.write(`\r    Rendering: ${pct}% (${current}/${total} frames)`);
          lastPct = pct;
          // Report render progress to Supabase every 5%
          if (jobId && reportRenderProgress && pct % 5 === 0) {
            reportRenderProgress(jobId, current, total).catch(() => {});
          }
        }
      }
    });

    proc.stderr.on('data', () => {});

    proc.on('close', code => {
      process.stdout.write('\n');
      if (code === 0) resolve();
      else reject(new Error(`Remotion render exited with code ${code}`));
    });

    proc.on('error', err => reject(new Error(`Render process error: ${err.message}`)));
  });
}

async function optimizeWithFfmpeg(inputPath, outputPath, fps) {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
  } catch {
    log('  ffmpeg not found — using raw render output');
    copyFileAtomic(inputPath, outputPath);
    return;
  }

  // Fast remux first
  try {
    execSync(
      `ffmpeg -i "${inputPath}" -c copy -movflags +faststart -y "${outputPath}"`,
      { stdio: 'pipe' }
    );
    return;
  } catch {
    log(`  Fast remux failed — falling back to H.264 encode`);
  }

  execSync(
    `ffmpeg -i "${inputPath}" -c:v libx264 -crf 20 -preset medium -c:a aac -b:a 192k -movflags +faststart -y "${outputPath}"`,
    { stdio: 'pipe' }
  );
}
