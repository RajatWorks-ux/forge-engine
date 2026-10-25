/**
 * FORGE — AI Code-Rendered Video Engine v2
 * Pipeline with Supabase live reporting + cloud upload
 *
 * CLI:    node src/pipeline.js "prompt" [style] [duration_seconds]
 * Server: node src/pipeline.js "prompt" style duration JOB_ID
 */

import 'dotenv/config';
import { generateBlueprint, generateScript, generateSceneCode, getBrainPoolStatus } from './brain/groq_client.js';
import { beginApiJob, endApiJob } from './brain/api_router.js';
import { generateVoiceover } from './audio/elevenlabs_client.js';
import { analyzeWaveform, saveWaveformData } from './audio/waveform_analyzer.js';
import { generateCaptions } from './captions/caption_generator.js';
import { buildRemotionProject } from './renderer/remotion_builder.js';
import { renderVideo } from './renderer/render_engine.js';
import { runQualityCheck } from './validator/quality_check.js';
import { conductResearch } from './research/research_engine.js';
import { log, error, success, stage } from './utils/logger.js';
import { saveJobState } from './utils/job_state.js';
import { assertNonEmptyFile, writeFileAtomic, ensureDirs } from './utils/fs_helpers.js';
import {
  reportStage,
  reportSceneProgress,
  reportDone,
  reportFailed,
} from './utils/supabase_reporter.js';
import path from 'path';
import fs from 'fs';

const STYLE_OPTIONS = [
  'particle_cosmos', 'geometric_sharp', 'fluid_organic',
  'data_manifold', 'abstract_kinetic', 'cinematic_dark', 'typographic_storm',
];

async function uploadToSupabase(videoPath, jobId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    log('  No Supabase credentials — skipping upload, returning local path');
    return null;
  }
  log(`  Uploading to Supabase Storage...`);
  const buffer = fs.readFileSync(videoPath);
  const res = await fetch(`${url}/storage/v1/object/forge-videos/${jobId}.mp4`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'video/mp4',
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase upload failed: HTTP ${res.status} — ${txt.slice(0, 300)}`);
  }
  const videoUrl = `${url}/storage/v1/object/public/forge-videos/${jobId}.mp4`;
  log(`  Uploaded: ${videoUrl}`);
  return videoUrl;
}

async function runPipeline(userPrompt, style = 'cinematic_dark', targetDuration = 60, existingJobId = null) {
  if (!String(userPrompt || '').trim()) throw new Error('Prompt cannot be empty.');
  if (!STYLE_OPTIONS.includes(style)) throw new Error(`Unsupported style: ${style}`);
  if (!Number.isInteger(targetDuration) || targetDuration < 30 || targetDuration > 1200) {
    throw new Error('Duration must be an integer between 30 and 1200 seconds.');
  }

  const jobId = existingJobId || `job_${Date.now()}`;
  const jobDir = path.resolve(`./output/${jobId}`);
  const tempDir = path.resolve(`./temp/${jobId}`);

  await ensureDirs([jobDir, tempDir, './output', './temp']);

  log(`\n${'='.repeat(60)}`);
  log(`FORGE v2 — Job: ${jobId}`);
  log(`Prompt: "${userPrompt}" | Style: ${style} | Duration: ${targetDuration}s`);
  log(`${'='.repeat(60)}\n`);

  const job = {
    id: jobId, prompt: userPrompt, style,
    targetDuration, status: 'running',
    startTime: Date.now(), stages: {},
  };
  await saveJobState(jobDir, job);
  beginApiJob(jobId);

  try {
    // ── STAGE 0: RESEARCH ────────────────────────────────────────────
    stage('0/9', 'Conducting deep research...');
    await reportStage(jobId, 'research', 5);

    const factsBrief = await conductResearch(userPrompt);
    job.factsBrief = { total_facts: factsBrief.total_facts, sources: factsBrief.sources_used };
    job.stages.research = { status: 'done', completedAt: Date.now() };
    await saveJobState(jobDir, job);
    log(`  Research: ${factsBrief.total_facts} facts from ${factsBrief.sources_used.join(', ')}`);

    // ── STAGE 1: BLUEPRINT ───────────────────────────────────────────
    stage('1/9', 'Generating video blueprint...');
    await reportStage(jobId, 'blueprint', 15);

    const blueprint = await generateBlueprint(userPrompt, style, targetDuration, factsBrief);
    job.blueprint = blueprint;
    job.stages.blueprint = { status: 'done', completedAt: Date.now() };
    await saveJobState(jobDir, job);
    log(`  Blueprint: "${blueprint.video_meta.title}" — ${blueprint.total_scenes} scenes`);

    // ── STAGE 2: SCRIPT ──────────────────────────────────────────────
    stage('2/9', 'Writing narration script...');
    await reportStage(jobId, 'script', 25);

    let script = await generateScript(blueprint, factsBrief);
    log(`  Script: ${script.script_meta.total_word_count} words`);

    // ── STAGE 3: VOICEOVER ───────────────────────────────────────────
    stage('3/9', 'Generating voiceover...');
    await reportStage(jobId, 'audio', 35);

    const durationTolerance = Math.max(0.01, Number(process.env.FORGE_AUDIO_DURATION_TOLERANCE || 0.05));
    const audioAttempts = Math.max(1, Math.min(4, Number(process.env.FORGE_AUDIO_DURATION_ATTEMPTS || 3)));
    let audioResult = null;
    let durationRecovery = '';

    for (let attempt = 1; attempt <= audioAttempts; attempt++) {
      if (durationRecovery) {
        log(`  Audio recovery attempt ${attempt}/${audioAttempts}...`);
        script = await generateScript(blueprint, factsBrief, durationRecovery);
      }
      const fullNarration = script.scenes.map(s => s.narration_text).join(' ');
      const candidate = await generateVoiceover(fullNarration, script.script_meta.voice_style, tempDir);
      const ratio = candidate.durationSeconds / targetDuration;
      const min = targetDuration * (1 - durationTolerance);
      const max = targetDuration * (1 + durationTolerance);
      log(`  Audio gate: ${candidate.durationSeconds.toFixed(2)}s (target: ${min.toFixed(2)}-${max.toFixed(2)}s)`);
      if (candidate.durationSeconds >= min && candidate.durationSeconds <= max) {
        audioResult = candidate;
        break;
      }
      if (attempt === audioAttempts) throw new Error(`AUDIO_DURATION_GATE_FAILED after ${audioAttempts} attempts`);
      const currentWords = script.scenes.reduce((s, sc) => s + String(sc.narration_text || '').trim().split(/\s+/).filter(Boolean).length, 0);
      const suggested = Math.max(20, Math.min(2400, Math.round(currentWords / Math.max(0.25, ratio))));
      durationRecovery = `Previous TTS was ${candidate.durationSeconds.toFixed(2)}s, target is ${targetDuration}s. Rewrite to ~${suggested} words. Return complete script JSON.`;
    }

    if (!audioResult) throw new Error('AUDIO_DURATION_GATE_FAILED');
    job.script = script;
    job.audioPath = audioResult.audioPath;
    job.wordTimestamps = audioResult.timestamps;
    job.stages.script = { status: 'done', completedAt: Date.now() };
    job.stages.audio = { status: 'done', completedAt: Date.now(), durationSeconds: audioResult.durationSeconds };
    await saveJobState(jobDir, job);
    assertNonEmptyFile(audioResult.audioPath, 'voiceover.mp3');

    // ── STAGE 4: WAVEFORM ────────────────────────────────────────────
    stage('4/9', 'Analyzing audio waveform...');
    await reportStage(jobId, 'waveform', 45);

    const waveformData = await analyzeWaveform(
      audioResult.audioPath,
      blueprint.style_manifest.canvas.fps,
      blueprint.video_meta.total_duration_seconds
    );
    const waveformPath = saveWaveformData(waveformData, tempDir);
    job.waveformPath = waveformPath;
    job.stages.waveform = { status: 'done', completedAt: Date.now() };
    await saveJobState(jobDir, job);
    log(`  Waveform: ${waveformData.total_frames} frames | reactive: ${waveformData.has_audio ? 'YES' : 'NO'}`);

    // ── STAGE 5: SCENE GENERATION ────────────────────────────────────
    stage('5/9', `Generating ${blueprint.total_scenes} scenes in parallel...`);
    await reportStage(jobId, 'scenes', 45);

    const apiPool = getBrainPoolStatus();
    const requestedWorkers = Math.max(1, Number(process.env.FORGE_SCENE_WORKERS || 16));
    const configuredCapacity = apiPool.reduce((sum, api) => sum + Math.max(1, api.maxConcurrency), 0) || 1;
    // REMOVED the hard cap of 4 — use all configured workers
    const workerCapacity = Math.max(1, Math.min(requestedWorkers, configuredCapacity));

    log(`  Pool: ${apiPool.length} providers | Workers: ${workerCapacity}`);

    const sceneQueue = [...blueprint.scenes];
    const generatedScenes = [];
    let completedScenes = 0;

    async function sceneWorker(workerId) {
      while (sceneQueue.length > 0) {
        const sceneSpec = sceneQueue.shift();
        if (!sceneSpec) return;
        const scriptScene = script.scenes.find(s => s.scene_id === sceneSpec.scene_id);
        log(`  Worker ${workerId}: Scene ${sceneSpec.scene_id}/${blueprint.total_scenes} — ${sceneSpec.title}`);

        const rawCode = await generateSceneCode(
          sceneSpec, scriptScene, blueprint.style_manifest,
          sceneSpec.scene_id - 1, waveformData.has_audio
        );
        const scenePath = path.join(tempDir, `Scene${sceneSpec.scene_id}.js`);
        writeFileAtomic(scenePath, rawCode);
        assertNonEmptyFile(scenePath, `Scene ${sceneSpec.scene_id}`);
        generatedScenes.push({ scene_id: sceneSpec.scene_id, spec: sceneSpec, script: scriptScene, codePath: scenePath, code: rawCode });
        completedScenes++;
        await reportSceneProgress(jobId, completedScenes, blueprint.total_scenes);
        log(`    Worker ${workerId}: Scene ${sceneSpec.scene_id} OK (${completedScenes}/${blueprint.total_scenes})`);
      }
    }

    const results = await Promise.allSettled(
      Array.from({ length: workerCapacity }, (_, i) => sceneWorker(i + 1))
    );
    const failures = results.filter(r => r.status === 'rejected').map(r => r.reason?.message || String(r.reason));
    if (failures.length) throw new Error(`Scene generation failed: ${failures.join(' || ')}`);
    generatedScenes.sort((a, b) => a.scene_id - b.scene_id);
    if (generatedScenes.length !== blueprint.total_scenes) {
      throw new Error(`Scene count mismatch: ${generatedScenes.length}/${blueprint.total_scenes}`);
    }
    job.stages.scene_code = { status: 'done', completedAt: Date.now(), count: generatedScenes.length };
    await saveJobState(jobDir, job);

    // ── STAGE 6: CAPTIONS ────────────────────────────────────────────
    stage('6/9', 'Generating captions...');
    await reportStage(jobId, 'captions', 80);

    const captionsData = await generateCaptions(
      script, audioResult.timestamps, blueprint.style_manifest, tempDir, audioResult.durationSeconds
    );
    job.captionsPath = captionsData.srtPath;
    job.stages.captions = { status: 'done', completedAt: Date.now() };
    await saveJobState(jobDir, job);
    log(`  Captions: ${captionsData.lineCount} lines`);

    // ── STAGE 7: REMOTION BUILD ──────────────────────────────────────
    stage('7/9', 'Building render project...');
    await reportStage(jobId, 'build', 85);

    const remotionProjectPath = await buildRemotionProject(
      blueprint, script, generatedScenes,
      captionsData, audioResult, waveformPath, tempDir
    );
    job.remotionProjectPath = remotionProjectPath;
    job.stages.build = { status: 'done', completedAt: Date.now() };
    await saveJobState(jobDir, job);

    // ── STAGE 8: RENDER ──────────────────────────────────────────────
    stage('8/9', 'Rendering video...');
    await reportStage(jobId, 'render', 85);

    const outputVideoPath = path.join(jobDir, `${jobId}_final.mp4`);
    await renderVideo(remotionProjectPath, outputVideoPath, blueprint.style_manifest.canvas, jobId);
    job.outputPath = outputVideoPath;
    job.stages.render = { status: 'done', completedAt: Date.now() };
    await saveJobState(jobDir, job);

    // ── STAGE 9: QUALITY CHECK ───────────────────────────────────────
    stage('9/9', 'Quality check...');
    const qualityReport = await runQualityCheck(outputVideoPath, blueprint, job);
    job.qualityReport = qualityReport;
    if (qualityReport.overall_quality === 'failed' || qualityReport.overall_quality === 'low') {
      throw new Error(`QUALITY_GATE_FAILED: ${qualityReport.issues?.join(' | ') || 'unknown'}`);
    }

    job.status = 'complete';
    job.endTime = Date.now();
    job.totalDurationMs = job.endTime - job.startTime;
    await saveJobState(jobDir, job);

    // ── UPLOAD ───────────────────────────────────────────────────────
    await reportStage(jobId, 'upload', 99);
    const videoUrl = await uploadToSupabase(outputVideoPath, jobId);
    await reportDone(jobId, videoUrl || outputVideoPath);

    const mins = Math.floor(job.totalDurationMs / 60000);
    const secs = Math.floor((job.totalDurationMs % 60000) / 1000);

    log(`\n${'='.repeat(60)}`);
    success(`PIPELINE COMPLETE`);
    log(`Output: ${outputVideoPath}`);
    if (videoUrl) log(`URL: ${videoUrl}`);
    log(`Time: ${mins}m ${secs}s | Quality: ${qualityReport.overall_quality}`);
    log(`${'='.repeat(60)}\n`);

    endApiJob();
    return { success: true, outputPath: outputVideoPath, videoUrl, job };

  } catch (err) {
    error(`Pipeline failed: ${err.message}`);
    job.status = 'failed';
    job.error = err.message;
    job.endTime = Date.now();
    await saveJobState(jobDir, job);
    await reportFailed(jobId, err.message);
    endApiJob();
    throw err;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('\nUsage: node src/pipeline.js "prompt" [style] [duration_seconds] [job_id]');
  console.log(`Styles: ${STYLE_OPTIONS.join(', ')}`);
  process.exit(0);
}

runPipeline(
  args[0],
  args[1] || 'cinematic_dark',
  parseInt(args[2]) || 60,
  args[3] || null
)
  .then(r => { console.log(`\nDone: ${r.videoUrl || r.outputPath}`); process.exit(0); })
  .catch(err => { console.error(`\nFailed: ${err.message}`); process.exit(1); });
