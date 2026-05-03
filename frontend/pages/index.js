import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Head from 'next/head';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const SEVERITY_COLOR = {
  CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#22c55e'
};
const STATUS_COLOR = {
  normal: '#22c55e', warning: '#f59e0b', critical: '#ef4444',
  'at-risk': '#f97316', 'on-track': '#22c55e'
};
const TYPE_ICON = {
  Sensor: '📡', Machine: '⚙️', Vendor: '🏭',
  Delivery: '🚚', Revenue: '💰'
};

export default function CFIDashboard() {
  const [nodes, setNodes]           = useState([]);
  const [summary, setSummary]       = useState(null);
  const [cascade, setCascade]       = useState(null);
  const [selectedNode, setSelected] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [lastUpdated, setUpdated]   = useState('');
  const [activeTab, setActiveTab]   = useState('cascade');

  const fetchData = useCallback(async () => {
    try {
      const [n, s] = await Promise.all([
        axios.get(`${API}/api/nodes`),
        axios.get(`${API}/api/risk-summary`)
      ]);
      setNodes(n.data);
      setSummary(s.data);
      setUpdated(new Date().toLocaleTimeString());
    } catch (e) { console.error('Fetch error:', e); }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 15000);
    return () => clearInterval(iv);
  }, [fetchData]);

  async function simulate(nodeId) {
    setLoading(true);
    setSelected(nodeId);
    setCascade(null);
    try {
      const res = await axios.post(`${API}/api/simulate/${nodeId}`);
      setCascade(res.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function triggerFail(nodeId, e) {
    e.stopPropagation();
    await axios.post(`${API}/api/node/${nodeId}/fail`);
    fetchData();
    if (selectedNode === nodeId) simulate(nodeId);
  }

  async function restoreNode(nodeId, e) {
    e.stopPropagation();
    await axios.post(`${API}/api/node/${nodeId}/restore`);
    fetchData();
  }

  async function resetAll() {
    await axios.delete(`${API}/api/reset`);
    setCascade(null);
    setSelected(null);
    fetchData();
  }

  const healthColor = !summary ? '#7A8A9A'
    : summary.system_health_score > 70 ? '#22c55e'
    : summary.system_health_score > 40 ? '#f59e0b' : '#ef4444';

  return (
    <>
      <Head>
        <title>CFI — Cascading Failure Intelligence | MAH Quantum</title>
        <meta name="description" content="Cascading Failure Intelligence System by MAH Quantum & Quanta Industries" />
      </Head>

      <div style={{ minHeight: '100vh', background: '#08112B' }}>

        {/* ── Header ── */}
        <div style={{ background: '#0D1A3A', borderBottom: '2px solid #C9A42A', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>⚡</span>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: '#C9A42A', margin: 0 }}>
                Cascading Failure Intelligence
              </h1>
              <span style={{ background: '#C9A42A22', color: '#C9A42A', fontSize: 10, padding: '2px 8px', borderRadius: 20, border: '1px solid #C9A42A44' }}>BETA</span>
            </div>
            <p style={{ color: '#7A8A9A', fontSize: 11, margin: '2px 0 0 32px' }}>
              Quanta Industries × MAH Quantum · Quantum [-0-] Brain · Updated: {lastUpdated || '...'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ background: '#0a1628', border: `1px solid ${healthColor}`, borderRadius: 8, padding: '8px 16px', textAlign: 'center' }}>
              <div style={{ color: '#7A8A9A', fontSize: 10 }}>SYSTEM HEALTH</div>
              <div style={{ color: healthColor, fontSize: 20, fontWeight: 700 }}>{summary?.system_health_score ?? '—'}%</div>
            </div>
            <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: '8px 16px', textAlign: 'center' }}>
              <div style={{ color: '#7A8A9A', fontSize: 10 }}>NODES</div>
              <div style={{ color: 'white', fontSize: 20, fontWeight: 700 }}>{summary?.total_nodes ?? '—'}</div>
            </div>
            <div style={{ background: '#0a1628', border: '1px solid #7c2d12', borderRadius: 8, padding: '8px 16px', textAlign: 'center' }}>
              <div style={{ color: '#7A8A9A', fontSize: 10 }}>AT RISK</div>
              <div style={{ color: '#ef4444', fontSize: 20, fontWeight: 700 }}>{summary?.warning_nodes ?? '—'}</div>
            </div>
            <button onClick={resetAll} style={{ background: '#1e293b', border: '1px solid #334155', color: '#7A8A9A', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
              🔄 Reset
            </button>
          </div>
        </div>

        {/* ── Active Alerts ── */}
        {summary?.high_risk_cascades?.length > 0 && (
          <div style={{ background: '#2d0a0a', borderBottom: '1px solid #7c2d12', padding: '10px 24px', display: 'flex', gap: 12, overflowX: 'auto' }}>
            <span style={{ color: '#ef4444', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>🚨 ACTIVE ALERTS:</span>
            {summary.high_risk_cascades.map((c, i) => (
              <span key={i} onClick={() => simulate(c.node)} style={{ background: '#450a0a', border: '1px solid #ef4444', color: '#fca5a5', fontSize: 11, padding: '4px 12px', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {c.name} — Impact {c.impact_score} · {c.time_to_critical}
              </span>
            ))}
          </div>
        )}

        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, maxWidth: 1400, margin: '0 auto' }}>

          {/* ── Node List ── */}
          <div>
            <div style={{ background: '#0D1A3A', border: '1px solid #1e3a5f', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e3a5f', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#C9A42A', fontWeight: 600, fontSize: 13 }}>System Nodes</span>
                <span style={{ color: '#7A8A9A', fontSize: 11 }}>Click to simulate</span>
              </div>
              <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
                {nodes.length === 0 && (
                  <div style={{ color: '#7A8A9A', textAlign: 'center', padding: 20, fontSize: 13 }}>Loading nodes...</div>
                )}
                {nodes.map(node => (
                  <div
                    key={node.id}
                    onClick={() => simulate(node.id)}
                    style={{
                      background: selectedNode === node.id ? '#1e3a5f' : '#0a1628',
                      border: `1px solid ${selectedNode === node.id ? '#C9A42A' : STATUS_COLOR[node.status] || '#334155'}`,
                      borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {TYPE_ICON[node.type] || '🔵'} {node.name || node.id}
                      </div>
                      <span style={{ background: STATUS_COLOR[node.status] + '33', color: STATUS_COLOR[node.status] || '#7A8A9A', fontSize: 9, padding: '2px 6px', borderRadius: 10, border: `1px solid ${STATUS_COLOR[node.status] || '#334155'}`, whiteSpace: 'nowrap' }}>
                        {(node.status || '').toUpperCase()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={(e) => triggerFail(node.id, e)}
                        style={{ flex: 1, background: '#450a0a', border: '1px solid #7c2d12', color: '#fca5a5', padding: '4px', borderRadius: 6, cursor: 'pointer', fontSize: 10 }}
                      >⚠️ Fail</button>
                      <button
                        onClick={(e) => restoreNode(node.id, e)}
                        style={{ flex: 1, background: '#052e16', border: '1px solid #166534', color: '#86efac', padding: '4px', borderRadius: 6, cursor: 'pointer', fontSize: 10 }}
                      >✅ Restore</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Main Panel ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 2, background: '#0D1A3A', padding: 4, borderRadius: 10, border: '1px solid #1e3a5f', width: 'fit-content' }}>
              {[['cascade', '🌊 Cascade Simulation'], ['intervention', '🛡️ Intervention Plan'], ['paths', '🗺️ Risk Paths']].map(([key, label]) => (
                <button key={key} onClick={() => setActiveTab(key)} style={{ background: activeTab === key ? '#C9A42A' : 'transparent', color: activeTab === key ? '#08112B' : '#7A8A9A', border: 'none', padding: '8px 16px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: activeTab === key ? 700 : 400 }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Empty state */}
            {!cascade && !loading && (
              <div style={{ background: '#0D1A3A', border: '1px solid #1e3a5f', borderRadius: 12, padding: 60, textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
                <div style={{ color: '#C9A42A', fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Select a Node to Simulate</div>
                <div style={{ color: '#7A8A9A', fontSize: 13 }}>Click any node on the left to run a cascade failure simulation.<br/>The Quantum Brain will analyze the impact chain in real time.</div>
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div style={{ background: '#0D1A3A', border: '1px solid #C9A42A', borderRadius: 12, padding: 60, textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
                <div style={{ color: '#C9A42A', fontSize: 16, fontWeight: 600 }}>Quantum Brain Analyzing...</div>
                <div style={{ color: '#7A8A9A', fontSize: 12, marginTop: 8 }}>Running cascade simulation across dependency graph</div>
              </div>
            )}

            {/* Cascade Tab */}
            {cascade && !loading && activeTab === 'cascade' && (
              <>
                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  {[
                    ['TRIGGERED', cascade.triggered_node, '#C9A42A'],
                    ['IMPACT SCORE', cascade.total_impact_score, cascade.total_impact_score > 100 ? '#ef4444' : '#f59e0b'],
                    ['TIME TO CRITICAL', cascade.time_to_critical, '#f97316'],
                    ['NODES AFFECTED', cascade.affected_nodes.length, '#a78bfa'],
                  ].map(([label, val, color]) => (
                    <div key={label} style={{ background: '#0D1A3A', border: `1px solid ${color}33`, borderRadius: 10, padding: '14px 16px' }}>
                      <div style={{ color: '#7A8A9A', fontSize: 10, marginBottom: 6 }}>{label}</div>
                      <div style={{ color, fontSize: 22, fontWeight: 700 }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Affected nodes */}
                <div style={{ background: '#0D1A3A', border: '1px solid #1e3a5f', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e3a5f' }}>
                    <span style={{ color: '#C9A42A', fontWeight: 600, fontSize: 13 }}>Affected Nodes — Cascade Chain</span>
                  </div>
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                    {cascade.affected_nodes.length === 0 && (
                      <div style={{ color: '#22c55e', textAlign: 'center', padding: 20, fontSize: 13 }}>✅ No cascade detected — system is healthy</div>
                    )}
                    {cascade.affected_nodes.map((n, i) => (
                      <div key={i} style={{ background: '#0a1628', border: `1px solid ${SEVERITY_COLOR[n.severity]}44`, borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', align: 'center', gap: 12 }}>
                          <div style={{ background: SEVERITY_COLOR[n.severity] + '22', border: `1px solid ${SEVERITY_COLOR[n.severity]}`, color: SEVERITY_COLOR[n.severity], fontSize: 10, padding: '3px 8px', borderRadius: 6, fontWeight: 700, height: 'fit-content' }}>
                            {n.severity}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{TYPE_ICON[n.type] || '🔵'} {n.name}</div>
                            <div style={{ color: '#7A8A9A', fontSize: 11, marginTop: 2 }}>
                              Depth {n.depth} · {n.cascade_probability}% probability · Hits in {n.time_to_impact_hours}h
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ color: SEVERITY_COLOR[n.severity], fontSize: 18, fontWeight: 700 }}>{n.risk_score}</div>
                          <div style={{ color: '#7A8A9A', fontSize: 10 }}>risk score</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Intervention Tab */}
            {cascade && !loading && activeTab === 'intervention' && (
              <div style={{ background: '#0D1A3A', border: '1px solid #1e3a5f', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e3a5f' }}>
                  <span style={{ color: '#C9A42A', fontWeight: 600, fontSize: 13 }}>🛡️ Quantum Brain Intervention Plan</span>
                </div>
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {cascade.intervention_plan?.map((plan, i) => (
                    <div key={i} style={{ background: '#0a1628', borderRadius: 10, padding: '16px', borderLeft: `4px solid ${i === 0 ? '#ef4444' : i === 1 ? '#f59e0b' : '#22c55e'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>#{plan.rank} {plan.action}</span>
                        <span style={{ background: i === 0 ? '#450a0a' : i === 1 ? '#451a03' : '#052e16', color: i === 0 ? '#ef4444' : i === 1 ? '#f59e0b' : '#22c55e', fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 700 }}>
                          {plan.priority}
                        </span>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 10 }}>{plan.expected_outcome}</div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' }}>
                        <span style={{ color: '#7A8A9A' }}>⏱ {plan.time_to_implement}</span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {plan.resources?.map((r, j) => (
                            <span key={j} style={{ background: '#1e293b', color: '#94a3b8', padding: '2px 8px', borderRadius: 10, fontSize: 11 }}>{r}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk Paths Tab */}
            {cascade && !loading && activeTab === 'paths' && (
              <div style={{ background: '#0D1A3A', border: '1px solid #1e3a5f', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e3a5f' }}>
                  <span style={{ color: '#C9A42A', fontWeight: 600, fontSize: 13 }}>🗺️ Cascade Risk Paths</span>
                </div>
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 500, overflowY: 'auto' }}>
                  {cascade.risk_paths?.map((path, i) => (
                    <div key={i} style={{ background: '#0a1628', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ color: '#7A8A9A', fontSize: 11, minWidth: 24 }}>#{i+1}</span>
                      {path.map((node, j) => (
                        <span key={j} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ background: '#1e293b', color: '#C9A42A', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{node}</span>
                          {j < path.length - 1 && <span style={{ color: '#ef4444', fontSize: 14 }}>→</span>}
                        </span>
                      ))}
                    </div>
                  ))}
                  {(!cascade.risk_paths || cascade.risk_paths.length === 0) && (
                    <div style={{ color: '#22c55e', textAlign: 'center', padding: 20 }}>✅ No risk paths detected</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '20px', color: '#334155', fontSize: 11, borderTop: '1px solid #1e293b' }}>
          Cascading Failure Intelligence · MAH Quantum × Quanta Industries · Powered by Quantum [-0-] Brain
        </div>
      </div>
    </>
  );
}
