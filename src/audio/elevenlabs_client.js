import 'dotenv/config';
/**
 * FORGE — ElevenLabs Audio Client
 * Generates voiceover with word-level timestamps and verifies real media duration.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { log } from '../utils/logger.js';
import { writeFileAtomic, assertNonEmptyFile } from '../utils/fs_helpers.js';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const BASE_URL = 'https://api.elevenlabs.io/v1';
const VOICE_MAP = {
  documentary: 'pNInz6obpgDQGcFmaJgB',
  educational: 'EXAVITQu4vr4xnSDxMaL',
  storytelling: 'VR6AewLTigWG4xSOukaG',
  journalistic: 'yoZ06aMxZJJ28mfd3POQ',
};
const DEFAULT_VOICE_ID = VOICE_MAP.documentary;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = Number(process.env.ELEVENLABS_TIMEOUT_MS || 120000);

export async function generateVoiceover(narrationText, voiceStyle, outputDir) {
  if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set in environment');
  const text = String(narrationText || '').trim();
  if (!text) throw new Error('Cannot generate voiceover from empty narration');

  const voiceId = VOICE_MAP[voiceStyle] || DEFAULT_VOICE_ID;
  log(`  Voice ID: ${voiceId} (${voiceStyle})`);
  log(`  Text length: ${text.length} characters`);

  const url = `${BASE_URL}/text-to-speech/${voiceId}/with-timestamps`;
  const requestBody = {
    text,
    model_id: 'eleven_multilingual_v2',
    voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
    output_format: 'mp3_44100_128',
  };

  let response = null;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (response.ok) break;

      const errText = await response.text();
      const error = Object.assign(new Error(`ElevenLabs API error ${response.status}: ${errText.slice(0, 1000)}`), { status: response.status });
      lastError = error;
      const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_RETRIES) break;
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter >= 0 && retryAfter <= 120 ? retryAfter * 1000 : Math.min(20000, 1500 * 2 ** (attempt - 1));
      log(`  ElevenLabs transient HTTP ${response.status} — retrying in ${Math.round(delay / 1000)}s...`);
      await sleep(delay);
    } catch (err) {
      lastError = err.name === 'AbortError'
        ? new Error(`ElevenLabs request timed out after ${REQUEST_TIMEOUT_MS}ms`)
        : err;
      if (attempt === MAX_RETRIES) break;
      const delay = Math.min(10000, 1200 * 2 ** (attempt - 1));
      log(`  ElevenLabs network failure — retrying in ${Math.round(delay / 1000)}s...`);
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }

  if (!response?.ok) throw lastError || new Error('ElevenLabs request failed without a response');

  let data;
  try { data = await response.json(); }
  catch (err) { throw new Error(`ElevenLabs returned invalid JSON: ${err.message}`); }
  if (!data?.audio_base64) throw new Error('ElevenLabs response did not contain audio_base64');

  const audioBuffer = Buffer.from(data.audio_base64, 'base64');
  if (!audioBuffer.length) throw new Error('ElevenLabs returned zero-byte audio');
  const audioPath = path.join(outputDir, 'voiceover.mp3');
  writeFileAtomic(audioPath, audioBuffer);
  assertNonEmptyFile(audioPath, 'voiceover.mp3');

  let timestamps = parseTimestamps(data.alignment, text);
  const timestampDuration = timestamps.length ? Number(timestamps[timestamps.length - 1].end_time || 0) : 0;
  const mediaDuration = probeAudioDuration(audioPath);
  if (!(mediaDuration > 0)) throw new Error('VOICEOVER_INTEGRITY_FAILED: ffprobe could not decode a valid audio duration');
  const durationSeconds = mediaDuration;
  if (timestampDuration > 0 && Math.abs(timestampDuration - mediaDuration) > 0.25) {
    const scale = mediaDuration / timestampDuration;
    timestamps = timestamps.map(t => ({ ...t, start_time: t.start_time * scale, end_time: t.end_time * scale }));
    log(`  Alignment normalized by ${scale.toFixed(4)}x to match probed audio duration`);
  }

  log(`  Audio saved: ${audioPath} (${audioBuffer.length} bytes)`);
  log(`  Duration: ${durationSeconds.toFixed(2)}s (ffprobe)`);
  return { audioPath, timestamps, durationSeconds, voiceId };
}

export function probeAudioDuration(audioPath) {
  try {
    const output = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath], { encoding: 'utf8' });
    const duration = Number.parseFloat(output.trim());
    return Number.isFinite(duration) ? duration : 0;
  } catch {
    return 0;
  }
}

function parseTimestamps(alignment, originalText) {
  if (!alignment?.characters || !Array.isArray(alignment.character_start_times_seconds) || !Array.isArray(alignment.character_end_times_seconds)) {
    log('  Warning: No alignment data returned, generating estimated timestamps');
    return generateEstimatedTimestamps(originalText);
  }
  const words = [];
  let currentWord = '';
  let wordStart = null;
  let charIndex = 0;
  const chars = alignment.characters;
  const charTimes = alignment.character_start_times_seconds;
  const charEndTimes = alignment.character_end_times_seconds;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const startTime = Number(charTimes[i]);
    const endTime = Number(charEndTimes[i]);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;
    if (char === ' ' || char === '\n' || char === '\t') {
      if (currentWord.trim()) {
        words.push({ word: currentWord.trim(), start_time: wordStart, end_time: endTime, char_index: charIndex });
        charIndex += currentWord.length + 1;
      }
      currentWord = '';
      wordStart = null;
    } else {
      if (wordStart === null) wordStart = startTime;
      currentWord += char;
    }
  }
  if (currentWord.trim() && wordStart !== null) {
    words.push({ word: currentWord.trim(), start_time: wordStart, end_time: Number(charEndTimes[chars.length - 1]) || wordStart + 0.3, char_index: charIndex });
  }
  return words;
}

function generateEstimatedTimestamps(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const timestamps = [];
  let currentTime = 0;
  for (const word of words) {
    const cleanWord = word.replace(/[.,!?;:]/g, '');
    const duration = Math.max(0.15, cleanWord.length * 0.055);
    timestamps.push({ word: cleanWord, start_time: currentTime, end_time: currentTime + duration, char_index: 0 });
    currentTime += duration + 0.04;
  }
  return timestamps;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
