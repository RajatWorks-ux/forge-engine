'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STYLES = [
  { id:'particle_cosmos', name:'Particle Cosmos', desc:'Deep space energy', color:'#6C63FF', icon:'✦' },
  { id:'geometric_sharp',  name:'Geometric Sharp',  desc:'Technical precision',  color:'#00F5A0', icon:'◈' },
  { id:'fluid_organic',    name:'Fluid Organic',    desc:'Natural flow',         color:'#FF6B9D', icon:'⬡' },
  { id:'data_manifold',    name:'Data Manifold',    desc:'Charts & graphs',      color:'#00D9FF', icon:'⌬' },
  { id:'abstract_kinetic', name:'Abstract Kinetic', desc:'Pure motion art',      color:'#FF9500', icon:'◉' },
  { id:'cinematic_dark',   name:'Cinematic Dark',   desc:'Dramatic storytelling',color:'#C084FC', icon:'▣' },
  { id:'typographic_storm',name:'Typographic Storm',desc:'Words as visuals',     color:'#F43F5E', icon:'⎔' },
];

const DURATIONS = [
  {value:30,label:'30s'},{value:60,label:'1 min'},
  {value:120,label:'2 min'},{value:300,label:'5 min'},
  {value:600,label:'10 min'},{value:1200,label:'20 min'},
];

export default function HomePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('cinematic_dark');
  const [duration, setDuration] = useState(60);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const sel = STYLES.find(s => s.id === style);

  async function submit() {
    if (!prompt.trim()) { setErr('Please enter a topic.'); return; }
    setErr(''); setLoading(true);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), style, duration }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Something went wrong.'); setLoading(false); return; }
      router.push(`/job/${data.job_id}`);
    } catch { setErr('Network error. Please try again.'); setLoading(false); }
  }

  return (
    <div style={{maxWidth:860,margin:'0 auto',padding:'0 16px 80px'}}>
      <header style={{textAlign:'center',padding:'56px 0 40px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:12,marginBottom:14}}>
          <span style={{fontSize:40}}>🔥</span>
          <span style={{fontSize:42,fontWeight:800,letterSpacing:'0.14em',background:'linear-gradient(135deg,#00F5A0,#00D9FF)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>FORGE</span>
        </div>
        <p style={{color:'#8D99AE',fontSize:16,margin:0}}>Every frame is AI-written code. No stock footage. No templates.</p>
      </header>

      <div style={{background:'#0D1117',border:'1px solid #21262D',borderRadius:16,padding:'32px 24px',display:'flex',flexDirection:'column',gap:28}}>

        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <label style={{fontSize:14,fontWeight:600}}>What should FORGE make a video about?</label>
          <textarea
            value={prompt} onChange={e=>setPrompt(e.target.value)}
            placeholder="How black holes form and destroy galaxies..."
            rows={3} maxLength={500}
            onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))submit()}}
            style={{background:'#080B10',border:'1px solid #21262D',borderRadius:10,padding:'14px 16px',color:'#EDF2F4',fontSize:15,lineHeight:1.6,resize:'vertical',outline:'none',width:'100%'}}
          />
          <div style={{fontSize:12,color:'#484F58',textAlign:'right'}}>{prompt.length}/500</div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <label style={{fontSize:14,fontWeight:600}}>Visual style</label>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))',gap:10}}>
            {STYLES.map(s=>(
              <button key={s.id} onClick={()=>setStyle(s.id)} style={{
                background:style===s.id?`${s.color}18`:'#080B10',
                border:`2px solid ${style===s.id?s.color:'transparent'}`,
                borderRadius:10,padding:'14px 12px',
                display:'flex',flexDirection:'column',gap:6,cursor:'pointer',textAlign:'left',transition:'all 0.15s',
              }}>
                <span style={{fontSize:22,color:s.color}}>{s.icon}</span>
                <span style={{fontSize:13,fontWeight:600,color:'#EDF2F4'}}>{s.name}</span>
                <span style={{fontSize:11,color:'#8D99AE',lineHeight:1.4}}>{s.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <label style={{fontSize:14,fontWeight:600}}>Duration</label>
          <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
            {DURATIONS.map(d=>(
              <button key={d.value} onClick={()=>setDuration(d.value)} style={{
                background:duration===d.value?sel.color:'#080B10',
                color:duration===d.value?'#080B10':'#8D99AE',
                border:`1px solid ${duration===d.value?sel.color:'#21262D'}`,
                borderRadius:8,padding:'8px 18px',fontSize:14,cursor:'pointer',
                fontWeight:duration===d.value?700:400,transition:'all 0.15s',
              }}>{d.label}</button>
            ))}
          </div>
        </div>

        {err && <div style={{background:'rgba(244,63,94,0.1)',border:'1px solid rgba(244,63,94,0.3)',borderRadius:8,padding:'10px 14px',color:'#F43F5E',fontSize:14}}>{err}</div>}

        <button onClick={submit} disabled={loading||!prompt.trim()} style={{
          border:'none',borderRadius:12,padding:'16px 28px',fontSize:16,fontWeight:700,
          color:'#080B10',width:'100%',cursor:loading||!prompt.trim()?'not-allowed':'pointer',
          background:loading||!prompt.trim()?'#21262D':`linear-gradient(135deg,${sel.color},${sel.color}CC)`,
          animation:!loading&&prompt.trim()?'glow 2s ease-in-out infinite':'none',transition:'all 0.2s',
        }}>
          {loading
            ? <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,color:'#8D99AE'}}>
                <span style={{display:'inline-block',animation:'spin 1s linear infinite'}}>⟳</span> Starting render...
              </span>
            : `Generate Video — ${DURATIONS.find(d=>d.value===duration)?.label}`
          }
        </button>
        <p style={{color:'#484F58',fontSize:12,textAlign:'center',margin:0}}>Ctrl+Enter to generate · Renders on cloud · Free</p>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))',gap:14,marginTop:28}}>
        {[
          {icon:'🔬',t:'Deep Research',d:'Wikipedia, arXiv, live web sources'},
          {icon:'🧠',t:'AI Blueprint',d:'Scene-by-scene structure with timing'},
          {icon:'🎙️',t:'Voiceover',d:'Professional narration via ElevenLabs'},
          {icon:'⚡',t:'Code Render',d:'AI writes React animation per frame'},
        ].map((s,i)=>(
          <div key={i} style={{background:'#0D1117',border:'1px solid #21262D',borderRadius:12,padding:'16px 14px',display:'flex',gap:14}}>
            <span style={{fontSize:24,flexShrink:0}}>{s.icon}</span>
            <div>
              <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>{s.t}</div>
              <div style={{fontSize:12,color:'#8D99AE',lineHeight:1.5}}>{s.d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
