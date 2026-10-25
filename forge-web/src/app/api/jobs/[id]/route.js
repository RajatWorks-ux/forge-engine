import { getServiceClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  const { id } = params;
  if (!id?.startsWith('job_'))
    return NextResponse.json({ error: 'Invalid job ID.' }, { status: 400 });
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('jobs')
      .select('id,prompt,style,duration,status,stage,stage_label,progress,video_url,error,created_at,updated_at')
      .eq('id', id)
      .single();
    if (error || !data)
      return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
