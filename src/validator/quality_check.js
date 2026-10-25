/**
 * FORGE — Final Quality Gate
 * A render is not successful until the output file is real, probeable, timed,
 * dimensioned, and contains both video and audio streams.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import { log } from '../utils/logger.js';

export async function runQualityCheck(videoPath, blueprint, job) {
  const issues = [];
  const checks = [];
  if (!fs.existsSync(videoPath)) return failed(['output_file_missing'], checks);

  const stats = fs.statSync(videoPath);
  if (stats.size < 10_000) issues.push('file_too_small');
  else checks.push(`file_size_ok (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);

  let probeData;
  try {
    const raw = execFileSync('ffprobe', [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', videoPath,
    ], { encoding: 'utf8' });
    probeData = JSON.parse(raw);
  } catch (err) {
    issues.push(`ffprobe_failed (${err.message})`);
    return failed(issues, checks);
  }

  const streams = Array.isArray(probeData?.streams) ? probeData.streams : [];
  const videoStream = streams.find(s => s.codec_type === 'video');
  const audioStream = streams.find(s => s.codec_type === 'audio');
  if (!videoStream) issues.push('no_video_stream');
  if (!audioStream) issues.push('no_audio_stream');
  else checks.push('audio_stream_present');

  const expected = Number(blueprint?.video_meta?.total_duration_seconds || job?.targetDuration || 0);
  const formatDuration = Number(probeData?.format?.duration || 0);
  const videoDuration = Number(videoStream?.duration || formatDuration || 0);
  const audioDuration = Number(audioStream?.duration || 0);

  if (!(videoDuration > 0)) issues.push('invalid_video_duration');
  else {
    const diff = Math.abs(videoDuration - expected);
    if (expected > 0 && diff > Math.max(0.5, expected * 0.02)) {
      issues.push(`duration_mismatch (expected ${expected}s, got ${videoDuration.toFixed(2)}s)`);
    } else checks.push(`duration_ok (${videoDuration.toFixed(2)}s)`);
  }

  if (audioStream && expected > 0) {
    const diff = Math.abs(audioDuration - expected);
    if (!(audioDuration > 0)) issues.push('invalid_audio_duration');
    else if (diff > Math.max(0.5, expected * 0.05)) {
      issues.push(`audio_duration_mismatch (expected ${expected}s, got ${audioDuration.toFixed(2)}s)`);
    } else checks.push(`audio_duration_ok (${audioDuration.toFixed(2)}s)`);
  }

  const width = Number(videoStream?.width || 0);
  const height = Number(videoStream?.height || 0);
  if (width < 1920 || height < 1080) issues.push(`low_resolution (${width}x${height})`);
  else checks.push(`resolution_ok (${width}x${height})`);

  const fps = parseRate(videoStream?.r_frame_rate || videoStream?.avg_frame_rate || '0/1');
  if (fps < 30) issues.push(`low_fps (${fps.toFixed(2)}fps)`);
  else checks.push(`fps_ok (${fps.toFixed(2)}fps)`);

  const formatName = String(probeData?.format?.format_name || '');
  if (!formatName.includes('mp4') && !formatName.includes('mov')) issues.push(`unexpected_container (${formatName || 'unknown'})`);
  else checks.push(`container_ok (${formatName})`);

  const overall_quality = issues.length === 0 ? 'high' : issues.length <= 1 ? 'acceptable' : 'failed';
  log(`  Quality checks passed: ${checks.length}`);
  log(`  Issues found: ${issues.length}`);
  if (issues.length) log(`  Issues: ${issues.join(', ')}`);
  return {
    overall_quality,
    issues,
    checks,
    file_size_mb: (stats.size / 1024 / 1024).toFixed(2),
    video_duration_seconds: videoDuration || null,
    audio_duration_seconds: audioDuration || null,
    resolution: width && height ? `${width}x${height}` : 'unknown',
    fps: fps ? fps.toFixed(2) : 'unknown',
    checked_at: new Date().toISOString(),
  };
}

function parseRate(value) {
  const [num, den] = String(value || '0/1').split('/').map(Number);
  return den > 0 && Number.isFinite(num) ? num / den : 0;
}

function failed(issues, checks) {
  return {
    overall_quality: 'failed',
    issues,
    checks,
    file_size_mb: '0',
    video_duration_seconds: null,
    audio_duration_seconds: null,
    resolution: 'unknown',
    fps: 'unknown',
    checked_at: new Date().toISOString(),
  };
}
