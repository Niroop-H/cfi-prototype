import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Head from 'next/head';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const WS  = API.replace('https','wss').replace('http','ws') + '/ws';

const SEV_COLOR  = { CRITICAL:'#ef4444', HIGH:'#f97316', MEDIUM:'#f59e0b', LOW:'#22c55e' };
const STAT_COLOR = { normal:'#22c55e', warning:'#f59e0b', critical:'#ef4444', 'at-risk':'#f97316', 'on-track':'#22c55e' };
const TYPE_ICON  = { Sensor:'📡', Machine:'⚙️', Vendor:'🏭', Delivery:'🚚', Revenue:'💰', Transformer:'⚡', Generator:'🔋', Substation:'🏗️', Grid:'🌐', Hospital:'🏥', Factory:'🏭', Port:'⚓', Warehouse:'📦', Transport:'🚛', Customer:'👥' };
const IND_ICON   = { manufacturing:'⚙️', energy:'⚡', logistics:'🚚' };
const IND_COLOR  = { manufacturing:'#3b82f6', energy:'#f59e0b', logistics:'#10b981' };

export default function CFIDashboard() {
  const [nodes, setNodes]         = useState([]);
  const [summary, setSummary]     = useState(null);
  const [cascade, setCascade]     = useState(null);
  const [selected, setSelected]   = useState(null);
  const [loading, setLoading]     = useState(false);
  const [updated, setUpdated]     = useState('');
  const [tab, setTab]             = useState('cascade');
  const [industry, setIndustry]   = useState('manufacturing');
  const [wsStatus, setWsStatus]   = useState('connecting');
  const [liveEvents, setEvents]   = useState([]);
  const canvasRef                 = useRef(null);
  const wsRef                     = useRef(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (ind = industry) => {
    try {
      const [n, s] = await Promise.all([
        axios.get(`${API}/api/nodes?industry=${ind}`),
        axios.get(`${API}/api/risk-summary?industry=${ind}`)
      ]);
      setNodes(n.data);
      setSummary(s.data);
      setUpdated(new Date().toLocaleTimeString());
    } catch(e) { console.error(e); }
  }, [industry]);

  useEffect(() => { fetchData(industry); }, [industry]);
  useEffect(() => {
    const iv = setInterval(() => fetchData(industry), 15000);
    return () => clearInterval(iv);
  }, [industry, fetchData]);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const ws = new WebSocket(WS);
      wsRef.current = ws;
      ws.onopen    = () => setWsStatus('live');
      ws.onclose   = () => setWsStatus('offline');
      ws.onerror   = () => setWsStatus('offline');
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type !== 'heartbeat') {
          setEvents(prev => [{...data, time: new Date().toLocaleTimeString()}, ...prev].slice(0,8));
          if (data.type === 'node_failed') fetchData(industry);
        }
      };
      return () => ws.close();
    } catch(e) { setWsStatus('offline'); }
  }, []);

  // ── Graph Canvas ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Position nodes in a force-like layout
    const positions = {};
    const types = [...new Set(nodes.map(n => n.type))];
    nodes.forEach((node, i) => {
      const typeIdx = types.indexOf(node.type);
      const nodesOfType = nodes.filter(n => n.type === node.type);
      const idxInType = nodesOfType.indexOf(node);
      const cols = Math.ceil(nodes.length / 3);
      const angle = (typeIdx / types.length) * Math.PI * 2;
      const r = Math.min(W, H) * 0.32;
      const spread = (idxInType - (nodesOfType.length - 1) / 2) * 55;
      positions[node.id] = {
        x: W/2 + r * Math.cos(angle) + spread * Math.cos(angle + Math.PI/2),
        y: H/2 + r * Math.sin(angle) + spread * Math.sin(angle + Math.PI/2)
      };
    });

    // Draw edges
    nodes.forEach(node => {
      const from = positions[node.id];
      if (!from) return;
      nodes.forEach(target => {
        // we don't have edge list here, so skip — edges drawn via graph endpoint
      });
    });

    // Draw nodes
    nodes.forEach(node => {
      const pos = positions[node.id];
      if (!pos) return;
      const col = STAT_COLOR[node.status] || '#7A8A9A';
      const r = 22;

      // Glow for warning/critical
      if (['warning','critical','at-risk'].includes(node.status)) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 8, 0, Math.PI * 2);
        ctx.fillStyle = col + '33';
        ctx.fill();
      }

      // Circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#0D1A3A';
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = selected === node.id ? 3 : 1.5;
      ctx.stroke();

      // Icon
      ctx.font = '14px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TYPE_ICON[node.type] || '🔵', pos.x, pos.y);

      // Label
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#94a3b8';
      const label = node.name?.length > 14 ? node.name.slice(0,12)+'…' : node.name;
      ctx.fillText(label || node.id, pos.x, pos.y + r + 10);
    });

    // Draw cascade path if active
    if (cascade) {
      cascade.risk_paths?.slice(0,5).forEach(path => {
        for (let i = 0; i < path.length - 1; i++) {
          const from = positions[path[i]];
          const to   = positions[path[i+1]];
          if (!from || !to) continue;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.strokeStyle = '#ef444466';
          ctx.lineWidth = 2;
          ctx.setLineDash([4,3]);
          ctx.stroke();
          ctx.setLineDash([]);
          // Arrow
          const angle = Math.atan2(to.y - from.y, to.x - from.x);
          const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
          ctx.beginPath();
          ctx.moveTo(mx + 6*Math.cos(angle-0.4), my + 6*Math.sin(angle-0.4));
          ctx.lineTo(mx + 10*Math.cos(angle), my + 10*Math.sin(angle));
          ctx.lineTo(mx + 6*Math.cos(angle+0.4), my + 6*Math.sin(angle+0.4));
          ctx.fillStyle = '#ef4444';
          ctx.fill();
        }
      });
    }
  }, [nodes, cascade, selected]);

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
    await axios.post(`${API}/api/node/${nodeId}/fail?industry=${industry}`);
    fetchData(industry);
    simulate(nodeId);
  }

  async function restoreNode(nodeId, e) {
    e.stopPropagation();
    await axios.post(`${API}/api/node/${nodeId}/restore`);
    fetchData(industry);
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
      <Head>
        <title>CFI — Cascading Failure Intelligence | MAH Quantum</title>
      </Head>
      <div style={{ minHeight:'100vh', background:'#08112B', fontFamily:'system-ui,sans-serif' }}>

        {/* ── Header ── */}
        <div style={{ background:'#0D1A3A', borderBottom:'2px solid #C9A42A', padding:'12px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:20 }}>⚡</span>
              <span style={{ fontSize:17, fontWeight:700, color:'#C9A42A' }}>Cascading Failure Intelligence</span>
              <span style={{ background:'#C9A42A22', color:'#C9A42A', fontSize:9, padding:'2px 7px', borderRadius:20, border:'1px solid #C9A42A44' }}>v2 BETA</span>
              <span style={{ width:7, height:7, borderRadius:'50%', background: wsStatus==='live'?'#22c55e':'#ef4444', display:'inline-block' }} title={`WebSocket: ${wsStatus}`}/>
            </div>
            <div style={{ color:'#7A8A9A', fontSize:11, marginTop:2 }}>
              Quanta Industries × MAH Quantum · Updated: {updated || '...'}
            </div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            {/* Industry Selector */}
            {['manufacturing','energy','logistics'].map(ind => (
              <button key={ind} onClick={() => { setIndustry(ind); setCascade(null); setSelected(null); }}
                style={{ background: industry===ind ? IND_COLOR[ind] : '#0a1628', border:`1px solid ${industry===ind ? IND_COLOR[ind] : '#1e3a5f'}`, color: industry===ind ? 'white' : '#7A8A9A', padding:'6px 12px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight: industry===ind ? 600 : 400 }}>
                {IND_ICON[ind]} {ind.charAt(0).toUpperCase()+ind.slice(1)}
              </button>
            ))}
            <div style={{ background:'#0a1628', border:`1px solid ${healthColor}33`, borderRadius:8, padding:'6px 12px', textAlign:'center' }}>
              <div style={{ color:'#7A8A9A', fontSize:9 }}>HEALTH</div>
              <div style={{ color:healthColor, fontSize:18, fontWeight:700, lineHeight:1 }}>{summary?.system_health_score??'—'}%</div>
            </div>
            <div style={{ background:'#0a1628', border:'1px solid #7c2d12', borderRadius:8, padding:'6px 12px', textAlign:'center' }}>
              <div style={{ color:'#7A8A9A', fontSize:9 }}>AT RISK</div>
              <div style={{ color:'#ef4444', fontSize:18, fontWeight:700, lineHeight:1 }}>{summary?.warning_nodes??'—'}</div>
            </div>
            <button onClick={resetAll} style={{ background:'#1e293b', border:'1px solid #334155', color:'#7A8A9A', padding:'6px 12px', borderRadius:8, cursor:'pointer', fontSize:12 }}>🔄 Reset</button>
          </div>
        </div>

        {/* ── Alerts Bar ── */}
        {summary?.high_risk_cascades?.length > 0 && (
          <div style={{ background:'#2d0a0a', borderBottom:'1px solid #7c2d12', padding:'8px 20px', display:'flex', gap:10, overflowX:'auto', alignItems:'center' }}>
            <span style={{ color:'#ef4444', fontSize:12, fontWeight:700, whiteSpace:'nowrap' }}>🚨 ALERTS:</span>
            {summary.high_risk_cascades.map((c,i) => (
              <span key={i} onClick={() => simulate(c.node)}
                style={{ background:'#450a0a', border:'1px solid #ef4444', color:'#fca5a5', fontSize:11, padding:'3px 10px', borderRadius:20, cursor:'pointer', whiteSpace:'nowrap' }}>
                {c.name} · Impact {c.impact_score} · {c.time_to_critical}
              </span>
            ))}
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'260px 1fr 260px', gap:14, padding:14, maxWidth:1600, margin:'0 auto' }}>

          {/* ── Left: Node List ── */}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'12px 14px', borderBottom:'1px solid #1e3a5f', display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:'#C9A42A', fontWeight:600, fontSize:13 }}>Nodes</span>
                <span style={{ color:'#7A8A9A', fontSize:11 }}>{nodes.length} monitored</span>
              </div>
              <div style={{ padding:8, display:'flex', flexDirection:'column', gap:5, maxHeight:480, overflowY:'auto' }}>
                {nodes.length === 0 && <div style={{ color:'#7A8A9A', textAlign:'center', padding:20, fontSize:13 }}>Loading...</div>}
                {nodes.map(node => (
                  <div key={node.id} onClick={() => simulate(node.id)}
                    style={{ background: selected===node.id ? '#1e3a5f' : '#0a1628', border:`1px solid ${selected===node.id?'#C9A42A':STAT_COLOR[node.status]||'#334155'}`, borderRadius:8, padding:'9px 10px', cursor:'pointer', transition:'all .15s' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                      <span style={{ fontSize:12, fontWeight:600 }}>{TYPE_ICON[node.type]||'🔵'} {node.name||node.id}</span>
                      <span style={{ background:(STAT_COLOR[node.status]||'#334155')+'33', color:STAT_COLOR[node.status]||'#7A8A9A', fontSize:8, padding:'2px 6px', borderRadius:10, border:`1px solid ${STAT_COLOR[node.status]||'#334155'}` }}>
                        {(node.status||'').toUpperCase()}
                      </span>
                    </div>
                    <div style={{ display:'flex', gap:4 }}>
                      <button onClick={e=>triggerFail(node.id,e)} style={{ flex:1, background:'#450a0a', border:'1px solid #7c2d12', color:'#fca5a5', padding:'3px', borderRadius:5, cursor:'pointer', fontSize:9 }}>⚠️ Fail</button>
                      <button onClick={e=>restoreNode(node.id,e)} style={{ flex:1, background:'#052e16', border:'1px solid #166534', color:'#86efac', padding:'3px', borderRadius:5, cursor:'pointer', fontSize:9 }}>✅ Restore</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Events */}
            <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #1e3a5f', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ color:'#C9A42A', fontWeight:600, fontSize:12 }}>Live Events</span>
                <span style={{ width:6, height:6, borderRadius:'50%', background: wsStatus==='live'?'#22c55e':'#ef4444', display:'inline-block' }}/>
              </div>
              <div style={{ padding:8, display:'flex', flexDirection:'column', gap:4, maxHeight:180, overflowY:'auto' }}>
                {liveEvents.length === 0 && <div style={{ color:'#334155', fontSize:11, padding:'8px', textAlign:'center' }}>No events yet</div>}
                {liveEvents.map((ev,i) => (
                  <div key={i} style={{ background:'#0a1628', borderRadius:6, padding:'6px 8px', borderLeft:`2px solid ${ev.type==='node_failed'?'#ef4444':ev.type==='node_restored'?'#22c55e':'#C9A42A'}` }}>
                    <div style={{ color:'white', fontSize:10, fontWeight:500 }}>{ev.type.replace(/_/g,' ').toUpperCase()}</div>
                    <div style={{ color:'#7A8A9A', fontSize:9 }}>{ev.node || ''} · {ev.time}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Center: Graph + Results ── */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

            {/* Graph Canvas */}
            <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #1e3a5f', display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:'#C9A42A', fontWeight:600, fontSize:13 }}>🗺️ Live Dependency Graph — {industry.charAt(0).toUpperCase()+industry.slice(1)}</span>
                <span style={{ color:'#7A8A9A', fontSize:11 }}>Click node to simulate</span>
              </div>
              <canvas ref={canvasRef} width={620} height={280}
                style={{ width:'100%', display:'block', cursor:'crosshair' }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const scaleX = 620 / rect.width;
                  const mx = (e.clientX - rect.left) * scaleX;
                  const my = (e.clientY - rect.top) * scaleX;
                  // find closest node — simple click detection
                  const canvas = canvasRef.current;
                  const W = canvas.width, H = canvas.height;
                  const types = [...new Set(nodes.map(n => n.type))];
                  let closest = null, minDist = 30;
                  nodes.forEach(node => {
                    const typeIdx = types.indexOf(node.type);
                    const nodesOfType = nodes.filter(n => n.type === node.type);
                    const idxInType = nodesOfType.indexOf(node);
                    const angle = (typeIdx / types.length) * Math.PI * 2;
                    const r = Math.min(W,H) * 0.32;
                    const spread = (idxInType - (nodesOfType.length-1)/2) * 55;
                    const nx = W/2 + r*Math.cos(angle) + spread*Math.cos(angle+Math.PI/2);
                    const ny = H/2 + r*Math.sin(angle) + spread*Math.sin(angle+Math.PI/2);
                    const dist = Math.sqrt((mx-nx)**2 + (my-ny)**2);
                    if (dist < minDist) { minDist = dist; closest = node.id; }
                  });
                  if (closest) simulate(closest);
                }}
              />
            </div>

            {/* Tabs */}
            <div style={{ display:'flex', gap:2, background:'#0D1A3A', padding:4, borderRadius:10, border:'1px solid #1e3a5f', width:'fit-content' }}>
              {[['cascade','🌊 Cascade'],['intervention','🛡️ Intervention'],['ai','🧠 Quantum Brain'],['paths','🗺️ Risk Paths']].map(([key,label]) => (
                <button key={key} onClick={() => setTab(key)}
                  style={{ background: tab===key?'#C9A42A':'transparent', color: tab===key?'#08112B':'#7A8A9A', border:'none', padding:'7px 14px', borderRadius:7, cursor:'pointer', fontSize:12, fontWeight: tab===key?700:400 }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Empty */}
            {!cascade && !loading && (
              <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, padding:40, textAlign:'center' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>⚡</div>
                <div style={{ color:'#C9A42A', fontSize:16, fontWeight:600, marginBottom:6 }}>Click any node to simulate cascade</div>
                <div style={{ color:'#7A8A9A', fontSize:12 }}>The Quantum Brain will map the full failure chain in real time</div>
              </div>
            )}

            {loading && (
              <div style={{ background:'#0D1A3A', border:'1px solid #C9A42A', borderRadius:12, padding:40, textAlign:'center' }}>
                <div style={{ color:'#C9A42A', fontSize:15, fontWeight:600 }}>⏳ Quantum Brain Analyzing...</div>
                <div style={{ color:'#7A8A9A', fontSize:12, marginTop:6 }}>Simulating cascade across dependency graph</div>
              </div>
            )}

            {/* Cascade Tab */}
            {cascade && !loading && tab==='cascade' && (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
                  {[
                    ['TRIGGERED', cascade.triggered_node, '#C9A42A'],
                    ['IMPACT SCORE', cascade.total_impact_score, cascade.total_impact_score>100?'#ef4444':'#f59e0b'],
                    ['TIME TO CRITICAL', cascade.time_to_critical, '#f97316'],
                    ['NODES AFFECTED', cascade.affected_nodes.length, '#a78bfa'],
                  ].map(([label,val,color]) => (
                    <div key={label} style={{ background:'#0D1A3A', border:`1px solid ${color}33`, borderRadius:10, padding:'12px 14px' }}>
                      <div style={{ color:'#7A8A9A', fontSize:9, marginBottom:4 }}>{label}</div>
                      <div style={{ color, fontSize:20, fontWeight:700 }}>{val}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
                  <div style={{ padding:'12px 14px', borderBottom:'1px solid #1e3a5f' }}>
                    <span style={{ color:'#C9A42A', fontWeight:600, fontSize:13 }}>Cascade Chain</span>
                  </div>
                  <div style={{ padding:10, display:'flex', flexDirection:'column', gap:7, maxHeight:320, overflowY:'auto' }}>
                    {cascade.affected_nodes.length===0 && <div style={{ color:'#22c55e', textAlign:'center', padding:16, fontSize:13 }}>✅ No cascade — system healthy</div>}
                    {cascade.affected_nodes.map((n,i) => (
                      <div key={i} style={{ background:'#0a1628', border:`1px solid ${SEV_COLOR[n.severity]}44`, borderRadius:8, padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <span style={{ background:SEV_COLOR[n.severity]+'22', border:`1px solid ${SEV_COLOR[n.severity]}`, color:SEV_COLOR[n.severity], fontSize:9, padding:'2px 7px', borderRadius:6, fontWeight:700 }}>{n.severity}</span>
                          <div>
                            <div style={{ fontWeight:600, fontSize:13 }}>{TYPE_ICON[n.type]||'🔵'} {n.name}</div>
                            <div style={{ color:'#7A8A9A', fontSize:11, marginTop:2 }}>Depth {n.depth} · {n.cascade_probability}% prob · hits in {n.time_to_impact_hours}h</div>
                          </div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ color:SEV_COLOR[n.severity], fontSize:18, fontWeight:700 }}>{n.risk_score}</div>
                          <div style={{ color:'#7A8A9A', fontSize:9 }}>risk</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Intervention Tab */}
            {cascade && !loading && tab==='intervention' && (
              <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'12px 14px', borderBottom:'1px solid #1e3a5f' }}>
                  <span style={{ color:'#C9A42A', fontWeight:600, fontSize:13 }}>🛡️ Intervention Plan</span>
                </div>
                <div style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>
                  {cascade.intervention_plan?.map((plan,i) => (
                    <div key={i} style={{ background:'#0a1628', borderRadius:10, padding:'14px', borderLeft:`4px solid ${i===0?'#ef4444':i===1?'#f59e0b':'#22c55e'}` }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8, flexWrap:'wrap', gap:6 }}>
                        <span style={{ fontWeight:700, fontSize:14 }}>#{plan.rank} {plan.action}</span>
                        <span style={{ background:i===0?'#450a0a':i===1?'#451a03':'#052e16', color:i===0?'#ef4444':i===1?'#f59e0b':'#22c55e', fontSize:10, padding:'2px 8px', borderRadius:20, fontWeight:700 }}>{plan.priority}</span>
                      </div>
                      <div style={{ color:'#94a3b8', fontSize:12, marginBottom:8 }}>{plan.expected_outcome}</div>
                      <div style={{ display:'flex', gap:14, fontSize:12, flexWrap:'wrap' }}>
                        <span style={{ color:'#7A8A9A' }}>⏱ {plan.time_to_implement}</span>
                        <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                          {plan.resources?.map((r,j) => (
                            <span key={j} style={{ background:'#1e293b', color:'#94a3b8', padding:'2px 7px', borderRadius:10, fontSize:10 }}>{r}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Tab */}
            {cascade && !loading && tab==='ai' && (
              <div style={{ background:'#0D1A3A', border:'1px solid #C9A42A44', borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'12px 14px', borderBottom:'1px solid #C9A42A44', background:'#C9A42A11' }}>
                  <span style={{ color:'#C9A42A', fontWeight:600, fontSize:13 }}>🧠 Quantum Brain Analysis</span>
                </div>
                <div style={{ padding:16 }}>
                  {cascade.ai_analysis ? (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                      {[
                        ['ROOT CAUSE', cascade.ai_analysis.root_cause, '#ef4444'],
                        ['KEY INSIGHT', cascade.ai_analysis.key_insight, '#C9A42A'],
                        ['URGENCY', cascade.ai_analysis.urgency, SEV_COLOR[cascade.ai_analysis.urgency]||'#f59e0b'],
                        ['RECOMMENDATION', cascade.ai_analysis.recommendation, '#22c55e'],
                      ].map(([label,val,color]) => (
                        <div key={label} style={{ background:'#0a1628', borderRadius:10, padding:'14px', borderTop:`3px solid ${color}` }}>
                          <div style={{ color:'#7A8A9A', fontSize:10, marginBottom:6 }}>{label}</div>
                          <div style={{ color:'white', fontSize:13, lineHeight:1.6, fontWeight: label==='URGENCY'?700:400 }}>{val}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign:'center', padding:30 }}>
                      <div style={{ color:'#7A8A9A', fontSize:13, marginBottom:8 }}>AI analysis not available</div>
                      <div style={{ color:'#334155', fontSize:11 }}>Add GROQ_API_KEY to Render environment variables to enable Quantum Brain AI reasoning</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Paths Tab */}
            {cascade && !loading && tab==='paths' && (
              <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'12px 14px', borderBottom:'1px solid #1e3a5f' }}>
                  <span style={{ color:'#C9A42A', fontWeight:600, fontSize:13 }}>🗺️ Risk Paths ({cascade.risk_paths?.length || 0})</span>
                </div>
                <div style={{ padding:12, display:'flex', flexDirection:'column', gap:7, maxHeight:420, overflowY:'auto' }}>
                  {cascade.risk_paths?.map((path,i) => (
                    <div key={i} style={{ background:'#0a1628', borderRadius:8, padding:'9px 12px', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                      <span style={{ color:'#7A8A9A', fontSize:10, minWidth:22 }}>#{i+1}</span>
                      {path.map((node,j) => (
                        <span key={j} style={{ display:'flex', alignItems:'center', gap:3 }}>
                          <span style={{ background:'#1e293b', color:'#C9A42A', padding:'3px 9px', borderRadius:6, fontSize:11, fontWeight:600 }}>{node}</span>
                          {j < path.length-1 && <span style={{ color:'#ef4444', fontSize:13 }}>→</span>}
                        </span>
                      ))}
                    </div>
                  ))}
                  {(!cascade.risk_paths||cascade.risk_paths.length===0) && (
                    <div style={{ color:'#22c55e', textAlign:'center', padding:16 }}>✅ No risk paths detected</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Summary Panel ── */}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

            {/* System Stats */}
            <div style={{ background:'#0D1A3A', border:'1px solid #1e3a5f', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'12px 14px', borderBottom:'1px solid #1e3a5f' }}>
                <span style={{ color:'#C9A42A', fontWeight:600, fontSize:13 }}>System Status</span>
              </div>
              <div style={{ padding:12, display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  ['Total Nodes', summary?.total_nodes??'—', '#7A8A9A'],
                  ['Healthy', summary?.healthy_nodes??'—', '#22c55e'],
                  ['At Risk', summary?.warning_nodes??'—', '#ef4444'],
                  ['Active Cascades', summary?.high_risk_cascades?.length??'—', '#f59e0b'],
                ].map(([label,val,color]) => (
                  <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', background:'#0a1628', borderRadius:8, padding:'10px 12px' }}>
                    <span style={{ color:'#7A8A9A', fontSize:12 }}>{label}</span>
                    <span style={{ color, fontSize:18, fontWeight:700 }}>{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Active Cascades */}
            {summary?.high_risk_cascades?.length > 0 && (
              <div style={{ background:'#0D1A3A', border:'1px solid #7c2d12', borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'12px 14px', borderBottom:'1px solid #7c2d12', background:'#2d0a0a' }}>
                  <span style={{ color:'#ef4444', fontWeight:600, fontSize:13 }}>🚨 Active Cascades</span>
                </div>
                <div style={{ padding:10, display:'flex', flexDirection:'column', gap:7 }}>
                  {summary.high_risk_cascades.map((c,i) => (
                    <div key={i} onClick={() => simulate(c.node)}
                      style={{ background:'#0a1628', border:'1px solid #7c2d12', borderRadius:8, padding:'10px 12px', cursor:'pointer' }}>
                      <div style={{ color:'white', fontSize:12, fontWeight:600, marginBottom:4 }}>{c.name}</div>
                      <div style={{ display:'flex', justifyContent:'space-between' }}>
                        <span style={{ color:'#ef4444', fontSize:11 }}>Impact: {c.impact_score}</span>
                        <span style={{ color:'#f59e0b', fontSize:11 }}>{c.time_to_critical}</span>
                      </div>
                      <div style={{ color:'#7A8A9A', fontSize:10, marginTop:2 }}>{c.affected_count} nodes affected</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Industry Info */}
            <div style={{ background:'#0D1A3A', border:`1px solid ${IND_COLOR[industry]}33`, borderRadius:12, padding:'14px' }}>
              <div style={{ color:IND_COLOR[industry], fontWeight:600, fontSize:12, marginBottom:8 }}>
                {IND_ICON[industry]} {industry.charAt(0).toUpperCase()+industry.slice(1)} Scenario
              </div>
              <div style={{ color:'#7A8A9A', fontSize:11, lineHeight:1.6 }}>
                {industry==='manufacturing' && 'Factory floor with sensors, machines, vendors, and delivery tracking. Cascade from a machine failure propagates to shipments and revenue.'}
                {industry==='energy' && 'Power grid with generators, transformers, substations and consumers. Cascade from a transformer fault can cause city-wide outages.'}
                {industry==='logistics' && 'Port-to-customer supply chain. A port delay cascades through warehouses, fleets, and customer SLAs to revenue loss.'}
              </div>
            </div>

            {/* Groq Setup Hint */}
            {!cascade?.ai_analysis && (
              <div style={{ background:'#0D1A3A', border:'1px solid #C9A42A33', borderRadius:12, padding:'14px' }}>
                <div style={{ color:'#C9A42A', fontWeight:600, fontSize:12, marginBottom:6 }}>🧠 Enable AI Analysis</div>
                <div style={{ color:'#7A8A9A', fontSize:11, lineHeight:1.6, marginBottom:8 }}>
                  Get free AI-powered Quantum Brain analysis by adding a Groq API key.
                </div>
                <div style={{ color:'#334155', fontSize:10 }}>
                  1. Go to console.groq.com → free signup<br/>
                  2. Create API key<br/>
                  3. Add GROQ_API_KEY to Render env vars
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign:'center', padding:'16px', color:'#334155', fontSize:11, borderTop:'1px solid #1e293b' }}>
          Cascading Failure Intelligence v2 · MAH Quantum × Quanta Industries · Quantum [-0-] Brain
        </div>
      </div>
    </>
  );
}
