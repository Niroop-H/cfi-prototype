import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Head from 'next/head';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const WS  = API.replace('https','wss').replace('http','ws') + '/ws';

const SEV_COLOR  = { CRITICAL:'#ef4444', HIGH:'#f97316', MEDIUM:'#f59e0b', LOW:'#22c55e' };
const STAT_COLOR = { normal:'#22c55e', warning:'#f59e0b', critical:'#ef4444', 'at-risk':'#f97316', 'on-track':'#22c55e' };
const TYPE_ICON  = { Sensor:'📡', Machine:'⚙️', Vendor:'🏭', Delivery:'🚚', Revenue:'💰',
                     Transformer:'⚡', Generator:'🔋', Substation:'🏗️', Grid:'🌐',
                     Critical:'🏥', Consumer:'🏢', Port:'⚓', Warehouse:'📦',
                     Transport:'🚛', Customer:'👥' };
const IND_COLOR  = { manufacturing:'#3b82f6', energy:'#f59e0b', logistics:'#10b981' };
const IND_ICON   = { manufacturing:'⚙️', energy:'⚡', logistics:'🚚' };

export default function CFIDashboard() {
  const [nodes, setNodes]       = useState([]);
  const [edges, setEdges]       = useState([]);
  const [summary, setSummary]   = useState(null);
  const [cascade, setCascade]   = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [updated, setUpdated]   = useState('');
  const [tab, setTab]           = useState('cascade');
  const [industry, setIndustry] = useState('manufacturing');
  const [wsStatus, setWsStatus] = useState('connecting');
  const [events, setEvents]     = useState([]);
  const [autoSim, setAutoSim]   = useState(true);
  const canvasRef               = useRef(null);
  const nodePositions           = useRef({});

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (ind) => {
    const i = ind || industry;
    try {
      const [n, s, g] = await Promise.all([
        axios.get(`${API}/api/nodes?industry=${i}`),
        axios.get(`${API}/api/risk-summary?industry=${i}`),
        axios.get(`${API}/api/graph?industry=${i}`)
      ]);
      setNodes(n.data);
      setSummary(s.data);
      setEdges(g.data.edges || []);
      setUpdated(new Date().toLocaleTimeString());
    } catch(e) { console.error(e); }
  }, [industry]);

  useEffect(() => { fetchData(industry); }, [industry]);
  useEffect(() => {
    const iv = setInterval(() => fetchData(industry), 20000);
    return () => clearInterval(iv);
  }, [industry, fetchData]);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let ws;
    const connect = () => {
      try {
        ws = new WebSocket(WS);
        ws.onopen = () => setWsStatus('live');
        ws.onclose = () => { setWsStatus('offline'); setTimeout(connect, 5000); };
        ws.onerror = () => setWsStatus('offline');
        ws.onmessage = (e) => {
          const data = JSON.parse(e.data);
          if (data.type === 'heartbeat') return;
          setEvents(prev => [{...data, time: new Date().toLocaleTimeString()}, ...prev].slice(0,10));
          if (['node_failed','node_restored','auto_cascade_detected','auto_node_restored','reset'].includes(data.type)) {
            fetchData(industry);
          }
          if (data.type === 'autosim_toggled') setAutoSim(data.active);
        };
      } catch(e) { setWsStatus('offline'); }
    };
    connect();
    return () => ws?.close();
  }, [industry]);

  // ── Canvas Graph ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Calculate positions
    const types = [...new Set(nodes.map(n => n.type))];
    const pos = {};
    nodes.forEach(node => {
      const ti = types.indexOf(node.type);
      const sameType = nodes.filter(n => n.type === node.type);
      const idx = sameType.indexOf(node);
      const angle = (ti / types.length) * Math.PI * 2 - Math.PI/2;
      const r = Math.min(W, H) * 0.33;
      const spread = (idx - (sameType.length-1)/2) * 52;
      pos[node.id] = {
        x: W/2 + r*Math.cos(angle) + spread*Math.cos(angle+Math.PI/2),
        y: H/2 + r*Math.sin(angle) + spread*Math.sin(angle+Math.PI/2)
      };
    });
    nodePositions.current = pos;

    // Draw edges
    edges.forEach(edge => {
      const from = pos[edge.source];
      const to   = pos[edge.target];
      if (!from || !to) return;
      const isInCascade = cascade?.risk_paths?.some(path =>
        path.includes(edge.source) && path.includes(edge.target)
      );
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = isInCascade ? '#ef444488' : '#1e3a5f';
      ctx.lineWidth = isInCascade ? 2 : 1;
      ctx.setLineDash(isInCascade ? [5,3] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrowhead
      const angle2 = Math.atan2(to.y - from.y, to.x - from.x);
      const nodeR = 22;
      const ax = to.x - nodeR * Math.cos(angle2);
      const ay = to.y - nodeR * Math.sin(angle2);
      ctx.beginPath();
      ctx.moveTo(ax - 5*Math.cos(angle2-0.4), ay - 5*Math.sin(angle2-0.4));
      ctx.lineTo(ax, ay);
      ctx.lineTo(ax - 5*Math.cos(angle2+0.4), ay - 5*Math.sin(angle2+0.4));
      ctx.strokeStyle = isInCascade ? '#ef4444' : '#334155';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // Draw nodes
    nodes.forEach(node => {
      const p = pos[node.id];
      if (!p) return;
      const col = STAT_COLOR[node.status] || '#7A8A9A';
      const r = 22;
      const isSelected = selected === node.id;
      const isCascadeNode = cascade?.affected_nodes?.some(n => n.id === node.id);

      // Pulse ring for warning/critical
      if (['warning','critical','at-risk'].includes(node.status)) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r+8, 0, Math.PI*2);
        ctx.fillStyle = col + '22';
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI*2);
      ctx.fillStyle = isCascadeNode ? col + '33' : '#0D1A3A';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#C9A42A' : col;
      ctx.lineWidth = isSelected ? 3 : 1.5;
      ctx.stroke();

      // Icon
      ctx.font = '13px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TYPE_ICON[node.type] || '●', p.x, p.y);

      // Label
      ctx.font = `${isSelected ? 'bold ' : ''}9px sans-serif`;
      ctx.fillStyle = isSelected ? '#C9A42A' : '#94a3b8';
      const label = node.name?.length > 13 ? node.name.slice(0,11)+'…' : (node.name||node.id);
      ctx.fillText(label, p.x, p.y + r + 10);

      // Status dot
      ctx.beginPath();
      ctx.arc(p.x + r*0.7, p.y - r*0.7, 5, 0, Math.PI*2);
      ctx.fillStyle = col;
      ctx.fill();
    });

  }, [nodes, edges, cascade, selected]);

  // Canvas click
  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleX;
    let closest = null, minDist = 28;
    Object.entries(nodePositions.current).forEach(([id, p]) => {
      const d = Math.sqrt((mx-p.x)**2 + (my-p.y)**2);
      if (d < minDist) { minDist = d; closest = id; }
    });
    if (closest) simulate(closest);
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  async function simulate(nodeId) {
    setLoading(true); setSelected(nodeId); setCascade(null);
    try {
      const res = await axios.post(`${API}/api/simulate/${nodeId}?industry=${industry}&ai=true`);
      setCascade(res.data);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  async function triggerFail(nodeId, e) {
    e.stopPropagation();
    setLoading(true);
    const res = await axios.post(`${API}/api/node/${nodeId}/fail?industry=${industry}`);
    setCascade(res.data); setSelected(nodeId);
    fetchData(industry); setLoading(false);
  }

  async function restoreNode(nodeId, e) {
    e.stopPropagation();
    await axios.post(`${API}/api/node/${nodeId}/restore`);
    fetchData(industry);
  }

  async function toggleAutoSim() {
    const res = await axios.post(`${API}/api/autosim/toggle`);
    setAutoSim(res.data.auto_sim);
  }

  async function resetAll() {
    await axios.delete(`${API}/api/reset?industry=${industry}`);
    setCascade(null); setSelected(null); fetchData(industry);
  }

  const healthColor = !summary ? '#7A8A9A'
    : summary.system_health_score > 70 ? '#22c55e'
    : summary.system_health_score > 40 ? '#f59e0b' : '#ef4444';

  return (
    <>
      <Head><title>CFI — Cascading Failure Intelligence | MAH Quantum</title></Head>
      <div style={{ minHeight:'100vh', background:'#08112B', fontFamily:'system-ui,sans-serif' }}>

        {/* Header */}
        <div style={{ background:'#0D1A3A', borderBottom:'2px solid #C9A42A', padding:'11px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:18 }}>⚡</span>
              <span style={{ fontSize:16, fontWeight:700, color:'#C9A42A' }}>Cascading Failure Intelligence</span>
              <span style={{ background:'#C9A42A22', color:'#C9A42A', fontSize:9, padding:'2px 6px', borderRadius:20, border:'1px solid #C9A42A44' }}>v3</span>
              <span style={{ width:6, height:6, borderRadius:'50%', background: wsStatus==='live'?'#22c55e':'#ef4444', display:'inline-block' }} title={wsStatus}/>
              {autoSim && <span style={{ background:'#052e16', color:'#22c55e', fontSize:9, padding:'2px 6px', borderRadius:20, border:'1px solid #166534' }}>AUTO-SIM ON</span>}
            </div>
            <div style={{ color:'#7A8A9A', fontSize:11, marginTop:1 }}>Quanta Industries × MAH Quantum · {updated || '...'}</div>
          </div>
          <div style={{ display:'flex', gap:7, alignItems:'center', flexWrap:'wrap' }}>
            {['manufacturing','energy','logistics'].map(ind => (
              <button key={ind} onClick={() => { setIndustry(ind); setCascade(null); setSelected(null); }}
                style={{ background: industry===ind ? IND_COLOR[ind] : '#0a1628', border:`1px solid ${industry===ind?IND_COLOR[ind]:'#1e3a5f'}`, color: industry===ind?'white':'#7A8A9A', padding:'5px 11px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight: industry===ind?700:400 }}>
                {IND_ICON[ind]} {ind.charAt(0).toUpperCase()+ind.slice(1)}
              </button>
            ))}
            <Link href="/history" style={{ background:'#1e293b', border:'1px solid #334155', color:'#94a3b8', padding:'5px 11px', borderRadius:8, cursor:'pointer', fontSize:11, textDecoration:'none' }}>📋 History</Link>
            <button onClick={toggleAutoSim}
              style={{ background: autoSim?'#052e16':'#1e293b', border:`1px solid ${autoSim?'#166534':'#334155'}`, color: autoSim?'#22c55e':'#7A8A9A', padding:'5px 11px', borderRadius:8, cursor:'pointer', fontSize:11 }}>
              {autoSim ? '⏸ Pause Auto' : '▶ Start Auto'}
            </button>
            <div style={{ background:'#0a1628', border:`1px solid ${healthColor}33`, borderRadius:8, padding:'5px 10px', textAlign:'center' }}>
              <div style={{ color:'#7A8A9A', fontSize:9 }}>HEALTH</div>
              <div style={{ color:healthColor, fontSize:17, fontWeight:700, lineHeight:1 }}>{summary?.system_health_score??'—'}%</div>
            </div>
            <button onClick={resetAll} style={{ background:'#1e293b', border:'1px solid #334155', color:'#7A8A9A', padding:'5px 10px', borderRadius:8, cursor:'pointer', fontSize:11 }}>🔄</button>
          </div>
        </div>

        {/* Alerts */}
        {summary?.high_risk_cascades?.length > 0 && (
          <div style={{ background:'#2d0a0a', borderBottom:'1px solid #7c2d12', padding:'7px 18px', display:'flex', gap:8, overflowX:'auto', alignItems:'center' }}>
            <span style={{ color:'#ef4444', fontSize:11, fontWeight:700, whiteSpace:'nowrap' }}>🚨 LIVE ALERTS:</span>
            {summary.high_risk_cascades.map((c,i) => (
              <span key={i} onClick={() => simulate(c.node)}
                style={{ background:'#450a0a', border:'1px solid #ef4444', color:'#fca5a5', fontSize:10, padding:'3px 9px', borderRadius:20, cursor:'pointer', whiteSpace:'nowrap' }}>
                {c.name} · Impact {c.impact_score} · {c.time_to_critical}
              </span>
            ))}
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'240px 1fr 240px', gap:12, padding:12, maxWidth:1600, margin:'0 auto' }}>

          {/* Left */}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'10px 12px', borderBottom:'1px solid #1e3a5f', display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:'#C9A42A', fontWeight:600, fontSize:12 }}>Nodes</span>
                <span style={{ color:'#7A8A9A', fontSize:10 }}>{nodes.length}</span>
              </div>
              <div style={{ padding:7, display:'flex', flexDirection:'column', gap:5, maxHeight:440, overflowY:'auto' }}>
                {nodes.length===0 && <div style={{ color:'#7A8A9A', textAlign:'center', padding:16, fontSize:12 }}>Loading...</div>}
                {nodes.map(node => (
                  <div key={node.id} onClick={() => simulate(node.id)}
                    style={{ background: selected===node.id?'#1e3a5f':'#0a1628', border:`1px solid ${selected===node.id?'#C9A42A':STAT_COLOR[node.status]||'#334155'}`, borderRadius:8, padding:'8px 10px', cursor:'pointer', transition:'all .15s' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                      <span style={{ fontSize:11, fontWeight:600 }}>{TYPE_ICON[node.type]||'🔵'} {node.name?.slice(0,16)||node.id}</span>
                      <span style={{ background:(STAT_COLOR[node.status]||'#334155')+'33', color:STAT_COLOR[node.status]||'#7A8A9A', fontSize:8, padding:'1px 5px', borderRadius:10 }}>
                        {(node.status||'').toUpperCase()}
                      </span>
                    </div>
                    <div style={{ display:'flex', gap:4 }}>
                      <button onClick={e=>triggerFail(node.id,e)} style={{ flex:1, background:'#450a0a', border:'1px solid #7c2d12', color:'#fca5a5', padding:'2px', borderRadius:5, cursor:'pointer', fontSize:9 }}>⚠️ Fail</button>
                      <button onClick={e=>restoreNode(node.id,e)} style={{ flex:1, background:'#052e16', border:'1px solid #166534', color:'#86efac', padding:'2px', borderRadius:5, cursor:'pointer', fontSize:9 }}>✅ OK</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Events */}
            <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'9px 12px', borderBottom:'1px solid #1e3a5f', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ color:'#C9A42A', fontWeight:600, fontSize:11 }}>Live Feed</span>
                <span style={{ width:5, height:5, borderRadius:'50%', background: wsStatus==='live'?'#22c55e':'#ef4444', display:'inline-block' }}/>
              </div>
              <div style={{ padding:7, display:'flex', flexDirection:'column', gap:4, maxHeight:200, overflowY:'auto' }}>
                {events.length===0 && <div style={{ color:'#334155', fontSize:10, padding:8, textAlign:'center' }}>Waiting for events...</div>}
                {events.map((ev,i) => (
                  <div key={i} style={{ background:'#0a1628', borderRadius:6, padding:'5px 8px', borderLeft:`2px solid ${ev.type.includes('fail')||ev.type.includes('cascade')?'#ef4444':ev.type.includes('restore')?'#22c55e':'#C9A42A'}` }}>
                    <div style={{ color:'white', fontSize:9, fontWeight:500 }}>{ev.type.replace(/_/g,' ').toUpperCase()}</div>
                    <div style={{ color:'#7A8A9A', fontSize:9 }}>{ev.node||ev.industry||''} · {ev.time}</div>
                    {ev.impact_score && <div style={{ color:'#ef4444', fontSize:9 }}>Impact: {ev.impact_score}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Center */}
          <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
            {/* Graph */}
            <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #1e3a5f', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ color:'#C9A42A', fontWeight:600, fontSize:12 }}>🗺️ Live Dependency Graph — {IND_ICON[industry]} {industry}</span>
                <span style={{ color:'#7A8A9A', fontSize:10 }}>{edges.length} connections · click node to simulate</span>
              </div>
              <canvas ref={canvasRef} width={680} height={300}
                onClick={handleCanvasClick}
                style={{ width:'100%', display:'block', cursor:'crosshair' }}/>
            </div>

            {/* Tabs */}
            <div style={{ display:'flex', gap:2, background:'#0D1A3A', padding:3, borderRadius:10, border:'1px solid #1e3a5f', width:'fit-content' }}>
              {[['cascade','🌊 Cascade'],['intervention','🛡️ Plan'],['ai','🧠 AI'],['paths','🗺️ Paths']].map(([key,label]) => (
                <button key={key} onClick={() => setTab(key)}
                  style={{ background: tab===key?'#C9A42A':'transparent', color: tab===key?'#08112B':'#7A8A9A', border:'none', padding:'6px 12px', borderRadius:7, cursor:'pointer', fontSize:11, fontWeight: tab===key?700:400 }}>
                  {label}
                </button>
              ))}
            </div>

            {!cascade && !loading && (
              <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, padding:36, textAlign:'center' }}>
                <div style={{ fontSize:36, marginBottom:10 }}>⚡</div>
                <div style={{ color:'#C9A42A', fontSize:15, fontWeight:600, marginBottom:5 }}>Click any node to simulate cascade</div>
                <div style={{ color:'#7A8A9A', fontSize:11 }}>Auto-simulation is {autoSim?'ON — watch nodes change automatically':'OFF'}</div>
              </div>
            )}

            {loading && (
              <div style={{ background:'#0D1A3A', border:'1px solid #C9A42A', borderRadius:12, padding:36, textAlign:'center' }}>
                <div style={{ color:'#C9A42A', fontSize:14, fontWeight:600 }}>⏳ Quantum Brain Analyzing...</div>
              </div>
            )}

            {cascade && !loading && tab==='cascade' && (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:9 }}>
                  {[
                    ['TRIGGERED', cascade.triggered_node, '#C9A42A'],
                    ['IMPACT', cascade.total_impact_score, cascade.total_impact_score>100?'#ef4444':'#f59e0b'],
                    ['TIME TO CRIT', cascade.time_to_critical, '#f97316'],
                    ['AFFECTED', cascade.affected_nodes.length, '#a78bfa'],
                  ].map(([l,v,c]) => (
                    <div key={l} style={{ background:'#0D1A3A', border:`1px solid ${c}33`, borderRadius:10, padding:'11px 13px' }}>
                      <div style={{ color:'#7A8A9A', fontSize:9, marginBottom:3 }}>{l}</div>
                      <div style={{ color:c, fontSize:18, fontWeight:700 }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
                  <div style={{ padding:'10px 13px', borderBottom:'1px solid #1e3a5f', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ color:'#C9A42A', fontWeight:600, fontSize:12 }}>Cascade Chain</span>
                    <button onClick={() => {
                      const blob = new Blob([JSON.stringify(cascade, null, 2)], {type:'application/json'});
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = `cascade_${cascade.triggered_node}_${Date.now()}.json`;
                      a.click();
                    }} style={{ background:'#1e293b', border:'1px solid #334155', color:'#7A8A9A', padding:'3px 9px', borderRadius:6, cursor:'pointer', fontSize:10 }}>
                      ⬇️ Export
                    </button>
                  </div>
                  <div style={{ padding:9, display:'flex', flexDirection:'column', gap:6, maxHeight:300, overflowY:'auto' }}>
                    {cascade.affected_nodes.length===0 && <div style={{ color:'#22c55e', textAlign:'center', padding:14, fontSize:12 }}>✅ No cascade — system healthy</div>}
                    {cascade.affected_nodes.map((n,i) => (
                      <div key={i} style={{ background:'#0a1628', border:`1px solid ${SEV_COLOR[n.severity]}44`, borderRadius:8, padding:'9px 12px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                          <span style={{ background:SEV_COLOR[n.severity]+'22', border:`1px solid ${SEV_COLOR[n.severity]}`, color:SEV_COLOR[n.severity], fontSize:8, padding:'2px 6px', borderRadius:6, fontWeight:700 }}>{n.severity}</span>
                          <div>
                            <div style={{ fontWeight:600, fontSize:12 }}>{TYPE_ICON[n.type]||'🔵'} {n.name}</div>
                            <div style={{ color:'#7A8A9A', fontSize:10, marginTop:1 }}>Depth {n.depth} · {n.cascade_probability}% · {n.time_to_impact_hours}h</div>
                          </div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ color:SEV_COLOR[n.severity], fontSize:17, fontWeight:700 }}>{n.risk_score}</div>
                          <div style={{ color:'#7A8A9A', fontSize:9 }}>risk</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {cascade && !loading && tab==='intervention' && (
              <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'10px 13px', borderBottom:'1px solid #1e3a5f' }}>
                  <span style={{ color:'#C9A42A', fontWeight:600, fontSize:12 }}>🛡️ Intervention Plan</span>
                </div>
                <div style={{ padding:12, display:'flex', flexDirection:'column', gap:9 }}>
                  {cascade.intervention_plan?.map((plan,i) => (
                    <div key={i} style={{ background:'#0a1628', borderRadius:10, padding:'13px', borderLeft:`4px solid ${i===0?'#ef4444':i===1?'#f59e0b':'#22c55e'}` }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:7, flexWrap:'wrap', gap:5 }}>
                        <span style={{ fontWeight:700, fontSize:13 }}>#{plan.rank} {plan.action}</span>
                        <span style={{ background:i===0?'#450a0a':i===1?'#451a03':'#052e16', color:i===0?'#ef4444':i===1?'#f59e0b':'#22c55e', fontSize:9, padding:'2px 7px', borderRadius:20, fontWeight:700 }}>{plan.priority}</span>
                      </div>
                      <div style={{ color:'#94a3b8', fontSize:11, marginBottom:7 }}>{plan.expected_outcome}</div>
                      <div style={{ display:'flex', gap:12, fontSize:11, flexWrap:'wrap' }}>
                        <span style={{ color:'#7A8A9A' }}>⏱ {plan.time_to_implement}</span>
                        {plan.resources?.map((r,j) => <span key={j} style={{ background:'#1e293b', color:'#94a3b8', padding:'2px 7px', borderRadius:10, fontSize:10 }}>{r}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {cascade && !loading && tab==='ai' && (
              <div style={{ background:'#0D1A3A', border:'1px solid #C9A42A44', borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'10px 13px', borderBottom:'1px solid #C9A42A44', background:'#C9A42A0A' }}>
                  <span style={{ color:'#C9A42A', fontWeight:600, fontSize:12 }}>🧠 Quantum Brain AI Analysis</span>
                </div>
                <div style={{ padding:14 }}>
                  {cascade.ai_analysis ? (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
                      {[['ROOT CAUSE',cascade.ai_analysis.root_cause,'#ef4444'],
                        ['KEY INSIGHT',cascade.ai_analysis.key_insight,'#C9A42A'],
                        ['URGENCY',cascade.ai_analysis.urgency,SEV_COLOR[cascade.ai_analysis.urgency]||'#f59e0b'],
                        ['RECOMMENDATION',cascade.ai_analysis.recommendation,'#22c55e']
                      ].map(([label,val,color]) => (
                        <div key={label} style={{ background:'#0a1628', borderRadius:10, padding:'13px', borderTop:`3px solid ${color}` }}>
                          <div style={{ color:'#7A8A9A', fontSize:9, marginBottom:5 }}>{label}</div>
                          <div style={{ color:'white', fontSize:12, lineHeight:1.6, fontWeight:label==='URGENCY'?700:400 }}>{val}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign:'center', padding:24 }}>
                      <div style={{ color:'#C9A42A', fontSize:12, marginBottom:6 }}>Add GROQ_API_KEY to Render to enable AI</div>
                      <div style={{ color:'#334155', fontSize:10 }}>console.groq.com → free signup → API key → Render env vars</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {cascade && !loading && tab==='paths' && (
              <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'10px 13px', borderBottom:'1px solid #1e3a5f' }}>
                  <span style={{ color:'#C9A42A', fontWeight:600, fontSize:12 }}>🗺️ Risk Paths ({cascade.risk_paths?.length||0})</span>
                </div>
                <div style={{ padding:10, display:'flex', flexDirection:'column', gap:6, maxHeight:380, overflowY:'auto' }}>
                  {cascade.risk_paths?.map((path,i) => (
                    <div key={i} style={{ background:'#0a1628', borderRadius:8, padding:'8px 11px', display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
                      <span style={{ color:'#7A8A9A', fontSize:9, minWidth:20 }}>#{i+1}</span>
                      {path.map((node,j) => (
                        <span key={j} style={{ display:'flex', alignItems:'center', gap:3 }}>
                          <span style={{ background:'#1e293b', color:'#C9A42A', padding:'2px 8px', borderRadius:6, fontSize:10, fontWeight:600 }}>{node}</span>
                          {j < path.length-1 && <span style={{ color:'#ef4444', fontSize:12 }}>→</span>}
                        </span>
                      ))}
                    </div>
                  ))}
                  {(!cascade.risk_paths||cascade.risk_paths.length===0) && (
                    <div style={{ color:'#22c55e', textAlign:'center', padding:14 }}>✅ No risk paths</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right */}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'10px 12px', borderBottom:'1px solid #1e3a5f' }}>
                <span style={{ color:'#C9A42A', fontWeight:600, fontSize:12 }}>System Status</span>
              </div>
              <div style={{ padding:10, display:'flex', flexDirection:'column', gap:7 }}>
                {[['Total Nodes',summary?.total_nodes??'—','#7A8A9A'],
                  ['Healthy',summary?.healthy_nodes??'—','#22c55e'],
                  ['At Risk',summary?.warning_nodes??'—','#ef4444'],
                  ['Cascades',summary?.high_risk_cascades?.length??'—','#f59e0b'],
                ].map(([l,v,c]) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', background:'#0a1628', borderRadius:8, padding:'9px 11px' }}>
                    <span style={{ color:'#7A8A9A', fontSize:11 }}>{l}</span>
                    <span style={{ color:c, fontSize:17, fontWeight:700 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {summary?.high_risk_cascades?.length > 0 && (
              <div style={{ background:'#0D1A3A', border:'1px solid #7c2d12', borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'9px 12px', borderBottom:'1px solid #7c2d12', background:'#2d0a0a' }}>
                  <span style={{ color:'#ef4444', fontWeight:600, fontSize:11 }}>🚨 Active Cascades</span>
                </div>
                <div style={{ padding:9, display:'flex', flexDirection:'column', gap:6 }}>
                  {summary.high_risk_cascades.map((c,i) => (
                    <div key={i} onClick={() => simulate(c.node)}
                      style={{ background:'#0a1628', border:'1px solid #7c2d12', borderRadius:8, padding:'9px 11px', cursor:'pointer' }}>
                      <div style={{ color:'white', fontSize:11, fontWeight:600, marginBottom:3 }}>{c.name}</div>
                      <div style={{ display:'flex', justifyContent:'space-between' }}>
                        <span style={{ color:'#ef4444', fontSize:10 }}>Impact: {c.impact_score}</span>
                        <span style={{ color:'#f59e0b', fontSize:10 }}>{c.time_to_critical}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ background:'#0D1A3A', border:`1px solid ${IND_COLOR[industry]}33`, borderRadius:12, padding:'13px' }}>
              <div style={{ color:IND_COLOR[industry], fontWeight:600, fontSize:11, marginBottom:6 }}>
                {IND_ICON[industry]} {industry.charAt(0).toUpperCase()+industry.slice(1)} Scenario
              </div>
              <div style={{ color:'#7A8A9A', fontSize:10, lineHeight:1.6 }}>
                {industry==='manufacturing'&&'Factory: sensors → machines → vendors → delivery → revenue. A machine fault cascades to shipments.'}
                {industry==='energy'&&'Grid: generators → transformers → substations → grid → critical consumers.'}
                {industry==='logistics'&&'Port → warehouses → fleets → customers → revenue. Port delays cascade to SLA breaches.'}
              </div>
            </div>

            {!cascade?.ai_analysis && (
              <div style={{ background:'#0D1A3A', border:'1px solid #C9A42A22', borderRadius:12, padding:'13px' }}>
                <div style={{ color:'#C9A42A', fontWeight:600, fontSize:11, marginBottom:5 }}>🧠 Enable Quantum Brain</div>
                <div style={{ color:'#7A8A9A', fontSize:10, lineHeight:1.6 }}>
                  1. console.groq.com → free signup<br/>
                  2. Create API key<br/>
                  3. Render → Env → GROQ_API_KEY
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign:'center', padding:'14px', color:'#334155', fontSize:10, borderTop:'1px solid #1e293b' }}>
          CFI v3 · MAH Quantum × Quanta Industries · Quantum [-0-] Brain
        </div>
      </div>
    </>
  );
}
