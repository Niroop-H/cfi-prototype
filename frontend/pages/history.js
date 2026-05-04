import { useState, useEffect } from 'react';
import axios from 'axios';
import Head from 'next/head';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const SEV_COLOR = { CRITICAL:'#ef4444', HIGH:'#f97316', MEDIUM:'#f59e0b', LOW:'#22c55e' };
const IND_COLOR = { manufacturing:'#3b82f6', energy:'#f59e0b', logistics:'#10b981' };

export default function History() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState('all');

  useEffect(() => {
    async function fetch() {
      try {
        const res = await axios.get(`${API}/api/incidents?limit=50`);
        setIncidents(res.data);
      } catch(e) { console.error(e); }
      setLoading(false);
    }
    fetch();
    const iv = setInterval(fetch, 10000);
    return () => clearInterval(iv);
  }, []);

  const filtered = filter === 'all' ? incidents
    : incidents.filter(i => i.industry === filter);

  return (
    <>
      <Head><title>Incident History — CFI | MAH Quantum</title></Head>
      <div style={{ minHeight:'100vh', background:'#08112B', fontFamily:'system-ui,sans-serif' }}>

        <div style={{ background:'#0D1A3A', borderBottom:'2px solid #C9A42A', padding:'12px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <Link href="/" style={{ color:'#7A8A9A', textDecoration:'none', fontSize:12 }}>← Dashboard</Link>
            <span style={{ color:'#334155' }}>|</span>
            <span style={{ color:'#C9A42A', fontWeight:700, fontSize:15 }}>📋 Incident History</span>
          </div>
          <span style={{ color:'#7A8A9A', fontSize:11 }}>{incidents.length} incidents logged · auto-refreshes every 10s</span>
        </div>

        <div style={{ padding:20, maxWidth:1200, margin:'0 auto' }}>

          {/* Filter */}
          <div style={{ display:'flex', gap:7, marginBottom:16 }}>
            {['all','manufacturing','energy','logistics'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ background: filter===f ? (f==='all'?'#C9A42A':IND_COLOR[f]||'#C9A42A') : '#0D1A3A', border:`1px solid ${filter===f?(f==='all'?'#C9A42A':IND_COLOR[f]||'#C9A42A'):'#1e3a5f'}`, color: filter===f?'white':'#7A8A9A', padding:'6px 14px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight: filter===f?600:400 }}>
                {f.charAt(0).toUpperCase()+f.slice(1)}
              </button>
            ))}
          </div>

          {/* Stats Row */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:11, marginBottom:18 }}>
            {[
              ['Total Incidents', incidents.length, '#C9A42A'],
              ['Auto Detected', incidents.filter(i=>i.type==='auto_detected').length, '#a78bfa'],
              ['Manual Sims', incidents.filter(i=>i.type==='manual_simulation').length, '#3b82f6'],
              ['Avg Impact', incidents.length ? Math.round(incidents.reduce((s,i)=>s+i.impact_score,0)/incidents.length) : 0, '#f59e0b'],
            ].map(([l,v,c]) => (
              <div key={l} style={{ background:'#0D1A3A', border:`1px solid ${c}33`, borderRadius:10, padding:'13px 15px' }}>
                <div style={{ color:'#7A8A9A', fontSize:10, marginBottom:4 }}>{l}</div>
                <div style={{ color:c, fontSize:22, fontWeight:700 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Table */}
          <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid #1e3a5f', display:'grid', gridTemplateColumns:'80px 1fr 100px 90px 80px 100px 100px', gap:10 }}>
              {['ID','Node','Industry','Impact','Affected','Time to Crit','Type'].map(h => (
                <span key={h} style={{ color:'#7A8A9A', fontSize:10, fontWeight:600 }}>{h}</span>
              ))}
            </div>
            <div style={{ maxHeight:520, overflowY:'auto' }}>
              {loading && <div style={{ color:'#7A8A9A', textAlign:'center', padding:30, fontSize:13 }}>Loading incidents...</div>}
              {!loading && filtered.length===0 && (
                <div style={{ color:'#7A8A9A', textAlign:'center', padding:40, fontSize:13 }}>
                  <div style={{ fontSize:32, marginBottom:10 }}>📋</div>
                  No incidents yet — auto-simulation will populate this automatically
                </div>
              )}
              {filtered.map((inc, i) => (
                <div key={i} style={{ padding:'11px 16px', borderBottom:'1px solid #0a1628', display:'grid', gridTemplateColumns:'80px 1fr 100px 90px 80px 100px 100px', gap:10, alignItems:'center', background: i%2===0?'#0a1628':'transparent' }}>
                  <span style={{ color:'#C9A42A', fontSize:11, fontWeight:600 }}>{inc.id}</span>
                  <div>
                    <div style={{ color:'white', fontSize:12, fontWeight:500 }}>{inc.node_name||inc.node}</div>
                    <div style={{ color:'#7A8A9A', fontSize:9 }}>{new Date(inc.timestamp).toLocaleString()}</div>
                  </div>
                  <span style={{ background:(IND_COLOR[inc.industry]||'#334155')+'22', color:IND_COLOR[inc.industry]||'#7A8A9A', fontSize:10, padding:'2px 8px', borderRadius:10, width:'fit-content' }}>{inc.industry}</span>
                  <span style={{ color: inc.impact_score>100?'#ef4444':inc.impact_score>50?'#f59e0b':'#22c55e', fontSize:14, fontWeight:700 }}>{inc.impact_score}</span>
                  <span style={{ color:'#a78bfa', fontSize:13, fontWeight:600 }}>{inc.affected_count}</span>
                  <span style={{ color:'#f97316', fontSize:11 }}>{inc.time_to_critical}</span>
                  <span style={{ background: inc.type==='auto_detected'?'#26164d':'#0f2a0f', color: inc.type==='auto_detected'?'#a78bfa':'#22c55e', fontSize:9, padding:'2px 7px', borderRadius:10 }}>
                    {inc.type==='auto_detected'?'🤖 Auto':'👤 Manual'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
