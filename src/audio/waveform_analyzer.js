/**
 * FORGE — Waveform Analyzer
 * Analyzes the voiceover MP3 and produces per-frame amplitude + frequency data
 * Used to drive audio-reactive visuals in every scene component
 * 100% free — uses node-wav + native Web Audio analysis
 */

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';
import { writeFileAtomic, assertNonEmptyFile } from '../utils/fs_helpers.js';

/**
 * Analyze audio file and return per-frame waveform data
 * @param {string} audioPath - path to MP3 file
 * @param {number} fps - frames per second (must match video fps)
 * @param {number} totalDurationSeconds - expected video duration
 * @returns {WaveformData} per-frame amplitude and frequency bands
 */
export async function analyzeWaveform(audioPath, fps, totalDurationSeconds) {
  log(`  Analyzing audio waveform: ${audioPath}`);
  log(`  Target: ${fps}fps × ${totalDurationSeconds}s = ${fps * totalDurationSeconds} frames`);

  // Convert MP3 to raw PCM data using ffmpeg (available in Termux)
  const pcmPath = audioPath.replace(/\.\w+$/, '_raw.pcm');
  const sampleRate = 44100;
  const channels = 1; // mono for analysis

  try {
    // Extract raw PCM: 32-bit float, mono, 44100hz
    execSync(
      `ffmpeg -i "${audioPath}" -ac ${channels} -ar ${sampleRate} -f f32le -y "${pcmPath}" 2>/dev/null`,
      { stdio: 'pipe' }
    );
    log(`  Raw PCM extracted: ${pcmPath}`);
  } catch (err) {
    throw new Error(`WAVEFORM_ANALYSIS_FAILED: ffmpeg PCM extraction failed: ${err.message}`);
  }

  // Read raw PCM samples
  let pcmBuffer;
  try {
    pcmBuffer = fs.readFileSync(pcmPath);
    fs.unlinkSync(pcmPath); // Clean up temp file
  } catch (err) {
    throw new Error(`WAVEFORM_ANALYSIS_FAILED: raw PCM could not be read: ${err.message}`);
  }

  // Convert buffer to Float32Array
  const samples = new Float32Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    Math.floor(pcmBuffer.byteLength / 4)
  );

  log(`  PCM samples loaded: ${samples.length.toLocaleString()} samples @ ${sampleRate}Hz`);

  // Calculate samples per frame
  const samplesPerFrame = Math.floor(sampleRate / fps);
  const totalFrames = Math.ceil(fps * totalDurationSeconds);

  log(`  Samples per frame: ${samplesPerFrame}`);
  log(`  Building ${totalFrames} frame data points...`);

  const frameData = [];

  for (let frame = 0; frame < totalFrames; frame++) {
    const startSample = frame * samplesPerFrame;
    const endSample = Math.min(startSample + samplesPerFrame, samples.length);

    if (startSample >= samples.length) {
      // Beyond audio — silence
      frameData.push(createSilentFrame(frame));
      continue;
    }

    const frameSamples = samples.slice(startSample, endSample);

    // ── AMPLITUDE (RMS) ──────────────────────────────────────────────────────
    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < frameSamples.length; i++) {
      const abs = Math.abs(frameSamples[i]);
      sumSquares += abs * abs;
      if (abs > peak) peak = abs;
    }
    const rms = Math.sqrt(sumSquares / frameSamples.length);

    // ── FREQUENCY BANDS (via simple DFT on small window) ────────────────────
    // We compute 4 frequency bands: sub-bass, bass, mid, high
    // Using a simplified Goertzel-like approach on windowed samples
    const bands = computeFrequencyBands(frameSamples, sampleRate);

    // ── ONSET DETECTION ─────────────────────────────────────────────────────
    // Detect if this frame starts a new spoken word (amplitude spike after low)
    const prevFrame = frameData.length > 0 ? frameData[frameData.length - 1] : null;
    const isOnset = prevFrame
      ? (rms > prevFrame.amplitude * 1.8 && rms > 0.05)
      : false;

    // ── SMOOTHED ENERGY ─────────────────────────────────────────────────────
    // Rolling average over last 6 frames for smoother visual response
    const recentFrames = frameData.slice(-6);
    const smoothedAmplitude = recentFrames.length > 0
      ? (recentFrames.reduce((sum, f) => sum + f.amplitude, 0) + rms) / (recentFrames.length + 1)
      : rms;

    frameData.push({
      frame,
      amplitude: Math.min(1.0, rms * 3),           // Normalized 0-1
      peak: Math.min(1.0, peak),                    // Normalized 0-1
      smoothed: Math.min(1.0, smoothedAmplitude * 3), // Smoothed amplitude 0-1
      is_onset: isOnset,                            // Word boundary detection
      bands: {
        sub_bass: bands[0],   // 20-80Hz (rumble, deep impacts)
        bass: bands[1],       // 80-300Hz (voice fundamental)
        mid: bands[2],        // 300-3000Hz (voice main content)
        high: bands[3],       // 3000-20000Hz (consonants, sibilance)
      },
      // Derived values useful for visual design
      energy: Math.min(1.0, (rms + peak) / 2 * 3),
      brightness: bands[3],  // High freq = visual brightness
      warmth: bands[1],      // Bass = warmth/weight in visuals
    });
  }

  // ── POST-PROCESS: NORMALIZE ──────────────────────────────────────────────
  // Find max amplitude and normalize so loud narration always reaches near 1.0
  let maxAmplitude = 0;
  for (const frame of frameData) maxAmplitude = Math.max(maxAmplitude, frame.amplitude);
  if (maxAmplitude > 0) {
    const normFactor = Math.min(2.0, 0.85 / maxAmplitude);
    frameData.forEach(f => {
      f.amplitude = Math.min(1.0, f.amplitude * normFactor);
      f.smoothed = Math.min(1.0, f.smoothed * normFactor);
      f.energy = Math.min(1.0, f.energy * normFactor);
    });
  }

  log(`  Waveform analysis complete: ${frameData.length} frames`);
  log(`  Peak amplitude: ${maxAmplitude.toFixed(3)}`);
  log(`  Onset events: ${frameData.filter(f => f.is_onset).length}`);

  return {
    frame_data: frameData,
    total_frames: frameData.length,
    fps,
    sample_rate: sampleRate,
    duration_seconds: totalDurationSeconds,
    max_amplitude: maxAmplitude,
    has_audio: maxAmplitude > 0.01,
  };
}

/**
 * Compute 4 frequency bands using simplified DFT
 * Returns normalized values 0-1 for each band
 */
function computeFrequencyBands(samples, sampleRate) {
  if (samples.length < 64) return [0, 0, 0, 0];

  // Band frequency ranges as fraction of Nyquist (sampleRate/2)
  const nyquist = sampleRate / 2;
  const bandRanges = [
    [20, 80],       // Sub-bass
    [80, 300],      // Bass
    [300, 3000],    // Mid
    [3000, 16000],  // High
  ];

  const n = Math.min(samples.length, 512); // Limit DFT size for performance
  const bandEnergies = [0, 0, 0, 0];
  const bandCounts = [0, 0, 0, 0];

  // Apply Hanning window
  const windowed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    windowed[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  // Simple DFT for each frequency bin
  const step = Math.max(1, Math.floor(n / 128)); // Sample every N bins for performance
  for (let k = 1; k < n / 2; k += step) {
    const freq = (k / n) * sampleRate;

    // Compute magnitude for this frequency bin
    let real = 0, imag = 0;
    for (let t = 0; t < n; t += 4) { // Subsample for speed
      const angle = (2 * Math.PI * k * t) / n;
      real += windowed[t] * Math.cos(angle);
      imag -= windowed[t] * Math.sin(angle);
    }
    const magnitude = Math.sqrt(real * real + imag * imag) / n;

    // Assign to band
    for (let b = 0; b < bandRanges.length; b++) {
      if (freq >= bandRanges[b][0] && freq < bandRanges[b][1]) {
        bandEnergies[b] += magnitude;
        bandCounts[b]++;
      }
    }
  }

  // Normalize each band
  return bandEnergies.map((energy, i) => {
    const avg = bandCounts[i] > 0 ? energy / bandCounts[i] : 0;
    return Math.min(1.0, avg * 20); // Scale to 0-1 range
  });
}

/**
 * Generate a silent/flat waveform (fallback when ffmpeg unavailable)
 */
function generateFlatWaveform(fps, totalDurationSeconds) {
  log(`  Using flat waveform (ffmpeg not available for audio analysis)`);
  const totalFrames = Math.ceil(fps * totalDurationSeconds);
  const frameData = [];

  // Generate a subtle pulse pattern to simulate speaking rhythm
  for (let frame = 0; frame < totalFrames; frame++) {
    const t = frame / fps;
    // Simulate speech: 4Hz oscillation with some variation
    const speechRhythm = Math.max(0, Math.sin(t * 4 * Math.PI) * 0.3 + 0.2);
    const variation = Math.sin(t * 7.3) * 0.1; // Add some irregularity

    frameData.push({
      frame,
      amplitude: Math.min(1.0, Math.max(0, speechRhythm + variation)),
      peak: Math.min(1.0, speechRhythm + 0.1),
      smoothed: 0.25,
      is_onset: frame % Math.floor(fps * 0.4) === 0, // Fake onset every 0.4s
      bands: {
        sub_bass: 0.1,
        bass: speechRhythm * 0.8,
        mid: speechRhythm,
        high: speechRhythm * 0.4,
      },
      energy: speechRhythm,
      brightness: speechRhythm * 0.4,
      warmth: speechRhythm * 0.6,
    });
  }

  return {
    frame_data: frameData,
    total_frames: totalFrames,
    fps,
    sample_rate: 44100,
    duration_seconds: totalDurationSeconds,
    max_amplitude: 0.5,
    has_audio: true,
    is_estimated: true,
  };
}

function createSilentFrame(frame) {
  return {
    frame,
    amplitude: 0,
    peak: 0,
    smoothed: 0,
    is_onset: false,
    bands: { sub_bass: 0, bass: 0, mid: 0, high: 0 },
    energy: 0,
    brightness: 0,
    warmth: 0,
  };
}

/**
 * Save waveform data to disk for use by Remotion project
 */
export function saveWaveformData(waveformData, outputDir) {
  const waveformPath = path.join(outputDir, 'waveform.json');
  // Save only the frame_data array (the rest is metadata not needed at render time)
  writeFileAtomic(waveformPath, JSON.stringify(waveformData.frame_data));
  assertNonEmptyFile(waveformPath, 'waveform.json');
  log(`  Waveform saved: ${waveformPath} (${(fs.statSync(waveformPath).size / 1024).toFixed(1)} KB)`);
  return waveformPath;
}
