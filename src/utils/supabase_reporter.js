/**
 * FORGE — Supabase Stage Reporter
 * Reports every pipeline stage to Supabase Realtime
 * so the frontend shows live progress.
 * Safe to use without Supabase credentials — just skips silently.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const STAGE_LABELS = {
  queued:    'Waiting in queue...',
  research:  'Researching your topic...',
  blueprint: 'Designing video structure...',
  script:    'Writing narration script...',
  audio:     'Generating voiceover...',
  waveform:  'Analyzing audio waveform...',
  scenes:    'Generating visual scenes...',
  captions:  'Creating captions...',
  build:     'Building render project...',
  render:    'Rendering video frames...',
  upload:    'Uploading to cloud...',
  done:      'Complete!',
  failed:    'Failed',
};

async function supabaseUpdate(jobId, fields) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !jobId) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(fields),
    });
  } catch (err) {
    // Never crash the pipeline due to reporting failure
    console.warn(`[Supabase Reporter] Update skipped: ${err.message}`);
  }
}

export async function reportStage(jobId, stage, progress) {
  await supabaseUpdate(jobId, {
    stage,
    progress,
    status: 'running',
    stage_label: STAGE_LABELS[stage] || stage,
  });
}

export async function reportSceneProgress(jobId, completed, total) {
  const progress = Math.round(45 + (completed / total) * 30);
  await supabaseUpdate(jobId, {
    stage: 'scenes',
    progress,
    status: 'running',
    stage_label: `Generating scene ${completed} of ${total}...`,
  });
}

export async function reportDone(jobId, videoUrl) {
  await supabaseUpdate(jobId, {
    status: 'done',
    stage: 'done',
    progress: 100,
    stage_label: 'Complete!',
    video_url: videoUrl,
  });
}

export async function reportFailed(jobId, errorMessage) {
  await supabaseUpdate(jobId, {
    status: 'failed',
    stage: 'failed',
    stage_label: 'Failed',
    error: String(errorMessage).slice(0, 1000),
  });
}
