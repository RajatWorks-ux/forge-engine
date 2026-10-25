import { getServiceClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

const VALID_STYLES = ['particle_cosmos','geometric_sharp','fluid_organic','data_manifold','abstract_kinetic','cinematic_dark','typographic_storm'];

export async function POST(request) {
  try {
    const { prompt, style, duration } = await request.json();

    if (!prompt?.trim() || prompt.trim().length < 3)
      return NextResponse.json({ error: 'Prompt must be at least 3 characters.' }, { status: 400 });
    if (prompt.trim().length > 500)
      return NextResponse.json({ error: 'Prompt must be under 500 characters.' }, { status: 400 });
    if (!VALID_STYLES.includes(style))
      return NextResponse.json({ error: `Invalid style.` }, { status: 400 });

    const dur = parseInt(duration);
    if (isNaN(dur) || dur < 30 || dur > 1200)
      return NextResponse.json({ error: 'Duration must be 30–1200 seconds.' }, { status: 400 });

    const jobId = `job_${Date.now()}`;
    const supabase = getServiceClient();

    const { error: dbErr } = await supabase.from('jobs').insert({
      id: jobId,
      prompt: prompt.trim(),
      style,
      duration: dur,
      status: 'queued',
      stage: 'queued',
      stage_label: 'Waiting in queue...',
      progress: 0,
    });

    if (dbErr) {
      console.error('Supabase insert error:', dbErr);
      return NextResponse.json({ error: 'Failed to create job.' }, { status: 500 });
    }

    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      await supabase.from('jobs').update({ status: 'failed', error: 'Render server not configured.' }).eq('id', jobId);
      return NextResponse.json({ error: 'Render server not configured.' }, { status: 500 });
    }

    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/render.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: { job_id: jobId, prompt: prompt.trim(), style, duration: String(dur) },
        }),
      }
    );

    if (!ghRes.ok) {
      const txt = await ghRes.text();
      console.error('GitHub trigger failed:', ghRes.status, txt);
      await supabase.from('jobs').update({ status: 'failed', error: `Render server error: HTTP ${ghRes.status}` }).eq('id', jobId);
      return NextResponse.json({ error: 'Failed to start render server.' }, { status: 500 });
    }

    return NextResponse.json({ job_id: jobId }, { status: 201 });
  } catch (err) {
    console.error('API error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
