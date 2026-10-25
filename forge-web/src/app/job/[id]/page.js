'use client';
import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const STAGES = [
  {key:'queued',   label:'Queued',          icon:'⏳', pct:0  },
  {key:'research', label:'Research',         icon:'🔬', pct:5  },
  {key:'blueprint',label:'Blueprint',        icon:'🧠', pct:15 },
  {key:'script',   label:'Script',           icon:'✍️',  pct:25 },
  {key:'audio',    label:'Voiceover',        icon:'🎙️', pct:35 },
  {key:'waveform', label:'Audio Analysis',   icon:'〰️', pct:45 },
  {key:'scenes',   label:'Scene Generation', icon:'⚡', pct:75 },
  {key:'captions', label:'Captions',         icon:'💬', pct:80 },
  {key:'build',    label:'Build Project',    icon:'🔧', pct:85 },
  {key:'render',   label:'Render Video',     icon:'🎬', pct:99 },
  {key:'done',     label:'Complete',         icon:'✅', pct:100},
];

export default function JobPage() {
  const { id } = useParams();
  const router = useRouter();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const channelRef = useRef(null);

  useEffect(() => {
    if (!id) return;
    fetchJob();

    const ch = supabase.channel(`job-${id}`)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'jobs', filter:`id=eq.${id}` },
        p => setJob(prev => ({ ...prev, ...p.new }))
      ).subscribe();
    channelRef.current = ch;

    const poll = setInterval(fetchJob, 5000);
    return () => { ch.unsubscribe(); clearInterval(poll); };
  }, [id]);

  async function fetchJob() {
    const res = await fetch(`/api/jobs/${id}`).catch(() => null);
    if (!res) return;
    if (res.status === 404) { setNotFound(true); setLoading(false); return; }
    if (res.ok) { const d = await res.json(); setJob(d); setLoading(false); }
  }

  if (loading) return (
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12}}>
      <span style={{fontSize:32,animation:'spin 1s linear infinite',display:'inline-block'}}>⟳</span>
      <p style={{color:'#8D99AE'}}>Loading...</p>
    </div>
  );

  if (notFound) return (
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16}}>
      <div style={{fontSize:48,fontWeight:800}}>404</div>
      <p style={{color:'#8D99AE'}}>Job not found.</p>
      <button onClick={()=>router.push('/')} style={{background:'#0D1117',border:'1px solid #21262D',borderRadius:8,padding:'10px 20px',color:'#EDF2F4',cursor:'pointer'}}>← Back</button>
    </div>
  );

  const done = job?.status === 'done';
  const failed = job?.status === 'failed';
  const running = !done && !failed;
  const curIdx = STAGES.findIndex(s => s.key === job?.stage);

  return (
    <div style={{maxWidth:760,margin:'0 auto',padding:'0 16px 80px',animation:'fadeIn 0.3s ease'}}>
      <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'24px 0 28px'}}>
        <button onClick={()=>router.push('/')} style={{background:'none',border:'1px solid #21262D',borderRadius:8,padding:'8px 14px',color:'#8D99AE',fontSize:14,cursor:'pointer'}}>← FORGE</button>
        <code style={{color:'#484F58',fontSize:11}}>{id}</code>
      </header>

      <div style={{display:'flex',flexDirection:'column',gap:20}}>

        <div style={{background:'#0D1117',border:'1px solid #21262D',borderRadius:12,padding:'20px 22px'}}>
          <div style={{color:'#8D99AE',fontSize:11,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:8}}>Generating video about</div>
          <p style={{color:'#EDF2F4',fontSize:18,fontWeight:600,margin:'0 0 12px',lineHeight:1.4}}>"{job?.prompt}"</p>
          <div style={{display:'flex',gap:8}}>
            <span style={{background:'#21262D',borderRadius:6,padding:'4px 10px',fontSize:12,color:'#8D99AE',textTransform:'capitalize'}}>{job?.style?.replace(/_/g,' ')}</span>
            <span style={{background:'#21262D',borderRadius:6,padding:'4px 10px',fontSize:12,color:'#8D99AE'}}>{job?.duration}s</span>
          </div>
        </div>

        {done && <div style={{background:'rgba(0,245,160,0.08)',border:'1px solid rgba(0,245,160,0.25)',borderRadius:10,padding:'14px 18px',color:'#00F5A0',fontWeight:600,fontSize:15}}>✅ Video ready!</div>}
        {failed && (
          <div style={{background:'rgba(244,63,94,0.08)',border:'1px solid rgba(244,63,94,0.25)',borderRadius:10,padding:'14px 18px',color:'#F43F5E',fontSize:14,lineHeight:1.6}}>
            ❌ {job?.error || 'Generation failed'}
            <br/><button onClick={()=>router.push('/')} style={{background:'none',border:'1px solid #F43F5E',borderRadius:6,padding:'6px 14px',color:'#F43F5E',cursor:'pointer',fontSize:13,marginTop:10}}>Try again</button>
          </div>
        )}

        <div style={{background:'#0D1117',border:'1px solid #21262D',borderRadius:12,padding:'20px 22px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <span style={{fontSize:15,fontWeight:500,color:'#EDF2F4'}}>
              {running && <span style={{animation:'pulse 1.5s ease-in-out infinite',display:'inline-block',marginRight:6}}>⚡</span>}
              {job?.stage_label || 'Processing...'}
            </span>
            <span style={{color:'#00F5A0',fontWeight:700,fontFamily:'monospace',fontSize:15}}>{job?.progress||0}%</span>
          </div>
          <div style={{background:'#21262D',borderRadius:99,height:8,overflow:'hidden'}}>
            <div style={{height:'100%',borderRadius:99,width:`${job?.progress||0}%`,background:done?'linear-gradient(90deg,#00F5A0,#00D9FF)':failed?'#F43F5E':'linear-gradient(90deg,#00F5A0,#00D9FF)',transition:'width 0.8s ease'}}/>
          </div>
        </div>

        <div style={{background:'#0D1117',border:'1px solid #21262D',borderRadius:12,padding:'20px 22px'}}>
          {STAGES.filter(s=>s.key!=='queued').map((s,i)=>{
            const completed = job?.progress >= s.pct && curIdx > STAGES.findIndex(x=>x.key===s.key);
            const current = s.key === job?.stage;
            return (
              <div key={s.key} style={{display:'flex',alignItems:'flex-start',gap:14,position:'relative'}}>
                <div style={{
                  width:30,height:30,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
                  flexShrink:0,zIndex:1,fontSize:12,
                  background:completed?'#00F5A0':current?'#00D9FF':'#21262D',
                  boxShadow:current?'0 0 12px rgba(0,217,255,0.6)':'none',
                  animation:current?'pulse 1.5s ease-in-out infinite':'none',
                  color:completed||current?'#080B10':'#8D99AE',
                }}>{completed?'✓':s.icon}</div>
                {i < STAGES.filter(s=>s.key!=='queued').length-1 && (
                  <div style={{position:'absolute',left:14,top:30,width:2,height:22,zIndex:0,background:completed?'#00F5A0':'#21262D'}}/>
                )}
                <div style={{fontSize:14,paddingTop:5,paddingBottom:18,color:current?'#EDF2F4':completed?'#00F5A0':'#484F58',fontWeight:current?600:400}}>{s.label}</div>
              </div>
            );
          })}
        </div>

        {done && job?.video_url && (
          <div style={{background:'#0D1117',border:'1px solid #21262D',borderRadius:14,overflow:'hidden'}}>
            <video src={job.video_url} controls autoPlay style={{width:'100%',display:'block',background:'#000'}}/>
            <a href={job.video_url} download={`forge-${id}.mp4`} style={{display:'block',textAlign:'center',padding:'14px',background:'rgba(0,245,160,0.08)',color:'#00F5A0',textDecoration:'none',fontWeight:600,fontSize:14,borderTop:'1px solid rgba(0,245,160,0.15)'}}>
              ⬇ Download MP4
            </a>
          </div>
        )}

        {running && (
          <div style={{background:'#0D1117',border:'1px solid #21262D',borderRadius:10,padding:'14px 18px',color:'#8D99AE',fontSize:13,textAlign:'center'}}>
            {job?.stage==='queued'
              ? '⏳ Waiting for render server (~60 seconds to start)...'
              : job?.stage==='render'
              ? '🎬 Rendering frames — longest step, almost there...'
              : '🔄 Updates live via Supabase Realtime'}
          </div>
        )}
      </div>
    </div>
  );
}
