from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
import networkx as nx
from pydantic import BaseModel
from typing import List, Optional
import os, json, asyncio, requests, random
from datetime import datetime

app = FastAPI(title="CFI — Cascading Failure Intelligence", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                  allow_methods=["*"], allow_headers=["*"])

# ── Connections ────────────────────────────────────────────────────────────────
NEO4J_URI      = os.environ.get("NEO4J_URI")
NEO4J_USERNAME = os.environ.get("NEO4J_USERNAME", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD")
GROQ_API_KEY   = os.environ.get("GROQ_API_KEY", "")

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD))

# ── In-memory incident log ─────────────────────────────────────────────────────
incident_log = []

# ── WebSocket Manager ──────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []
    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)
    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

manager = ConnectionManager()

# ── Industry Scenarios ─────────────────────────────────────────────────────────
SCENARIOS = {
    "manufacturing": """
        CREATE (s1:Sensor   {id:'S1', name:'Vibration Sensor A',    status:'warning',  type:'Sensor',       industry:'manufacturing'})
        CREATE (s2:Sensor   {id:'S2', name:'Temperature Sensor B',  status:'normal',   type:'Sensor',       industry:'manufacturing'})
        CREATE (s3:Sensor   {id:'S3', name:'Pressure Gauge C',      status:'normal',   type:'Sensor',       industry:'manufacturing'})
        CREATE (m1:Machine  {id:'M1', name:'CNC Machine Alpha',     status:'warning',  type:'Machine',      industry:'manufacturing'})
        CREATE (m2:Machine  {id:'M2', name:'Assembly Line 1',       status:'normal',   type:'Machine',      industry:'manufacturing'})
        CREATE (m3:Machine  {id:'M3', name:'Packaging Unit',        status:'normal',   type:'Machine',      industry:'manufacturing'})
        CREATE (v1:Vendor   {id:'V1', name:'Parts Supplier X',      status:'normal',   type:'Vendor',       industry:'manufacturing'})
        CREATE (v2:Vendor   {id:'V2', name:'Raw Materials Co',      status:'warning',  type:'Vendor',       industry:'manufacturing'})
        CREATE (d1:Delivery {id:'D1', name:'Shipment Batch 47',     status:'on-track', type:'Delivery',     industry:'manufacturing'})
        CREATE (d2:Delivery {id:'D2', name:'Export Order 12',       status:'on-track', type:'Delivery',     industry:'manufacturing'})
        CREATE (r1:Revenue  {id:'R1', name:'Q2 Contract $2.8M',     status:'at-risk',  type:'Revenue',      industry:'manufacturing'})
        CREATE (s1)-[:MONITORS  {weight:0.9}] ->(m1)
        CREATE (s2)-[:MONITORS  {weight:0.85}]->(m1)
        CREATE (s3)-[:MONITORS  {weight:0.8}] ->(m2)
        CREATE (v1)-[:SUPPLIES  {weight:0.95}]->(m1)
        CREATE (v2)-[:SUPPLIES  {weight:0.9}] ->(m2)
        CREATE (m1)-[:FEEDS_INTO{weight:0.9}] ->(m2)
        CREATE (m2)-[:FEEDS_INTO{weight:0.95}]->(m3)
        CREATE (m3)-[:PRODUCES  {weight:1.0}] ->(d1)
        CREATE (m3)-[:PRODUCES  {weight:0.8}] ->(d2)
        CREATE (d1)-[:IMPACTS   {weight:0.8}] ->(r1)
        CREATE (d2)-[:IMPACTS   {weight:0.7}] ->(r1)
    """,
    "energy": """
        CREATE (t1:Transformer {id:'T1', name:'Transformer Alpha 110kV', status:'warning',  type:'Transformer', industry:'energy'})
        CREATE (t2:Transformer {id:'T2', name:'Transformer Beta 110kV',  status:'normal',   type:'Transformer', industry:'energy'})
        CREATE (g1:Generator   {id:'G1', name:'Gas Turbine Unit 1',      status:'normal',   type:'Generator',   industry:'energy'})
        CREATE (g2:Generator   {id:'G2', name:'Solar Array Block A',     status:'warning',  type:'Generator',   industry:'energy'})
        CREATE (sub1:Substation{id:'SB1',name:'City North Substation',   status:'normal',   type:'Substation',  industry:'energy'})
        CREATE (sub2:Substation{id:'SB2',name:'Industrial Zone Sub',     status:'normal',   type:'Substation',  industry:'energy'})
        CREATE (grid:Grid      {id:'GR1',name:'Main Distribution Grid',  status:'at-risk',  type:'Grid',        industry:'energy'})
        CREATE (h1:Critical    {id:'H1', name:'City Hospital Power',     status:'normal',   type:'Critical',    industry:'energy'})
        CREATE (f1:Consumer    {id:'F1', name:'Industrial Complex A',    status:'normal',   type:'Consumer',    industry:'energy'})
        CREATE (t1)-[:FEEDS    {weight:0.95}]->(sub1)
        CREATE (t2)-[:FEEDS    {weight:0.9}] ->(sub2)
        CREATE (g1)-[:POWERS   {weight:0.9}] ->(t1)
        CREATE (g2)-[:POWERS   {weight:0.85}]->(t2)
        CREATE (sub1)-[:CONNECTS{weight:0.9}]->(grid)
        CREATE (sub2)-[:CONNECTS{weight:0.85}]->(grid)
        CREATE (grid)-[:SUPPLIES{weight:1.0}]->(h1)
        CREATE (grid)-[:SUPPLIES{weight:0.9}]->(f1)
    """,
    "logistics": """
        CREATE (port:Port     {id:'P1', name:'Mumbai Port Terminal',     status:'warning',  type:'Port',      industry:'logistics'})
        CREATE (wh1:Warehouse {id:'W1', name:'Distribution Hub North',   status:'normal',   type:'Warehouse', industry:'logistics'})
        CREATE (wh2:Warehouse {id:'W2', name:'Distribution Hub South',   status:'normal',   type:'Warehouse', industry:'logistics'})
        CREATE (tr1:Transport {id:'TR1',name:'Fleet Alpha 12 trucks',    status:'warning',  type:'Transport', industry:'logistics'})
        CREATE (tr2:Transport {id:'TR2',name:'Fleet Beta 8 trucks',      status:'normal',   type:'Transport', industry:'logistics'})
        CREATE (c1:Customer   {id:'C1', name:'Retail Chain A 200 stores',status:'normal',   type:'Customer',  industry:'logistics'})
        CREATE (c2:Customer   {id:'C2', name:'E-commerce Platform B',    status:'normal',   type:'Customer',  industry:'logistics'})
        CREATE (rev:Revenue   {id:'RL1',name:'Logistics Contract $1.2M', status:'at-risk',  type:'Revenue',   industry:'logistics'})
        CREATE (port)-[:ROUTES_TO {weight:0.9}] ->(wh1)
        CREATE (port)-[:ROUTES_TO {weight:0.85}]->(wh2)
        CREATE (wh1)-[:DISPATCHES {weight:0.95}]->(tr1)
        CREATE (wh2)-[:DISPATCHES {weight:0.9}] ->(tr2)
        CREATE (tr1)-[:DELIVERS_TO{weight:0.9}] ->(c1)
        CREATE (tr2)-[:DELIVERS_TO{weight:0.85}]->(c2)
        CREATE (c1)-[:IMPACTS     {weight:0.8}] ->(rev)
        CREATE (c2)-[:IMPACTS     {weight:0.75}]->(rev)
    """
}

def seed_database(industry="manufacturing"):
    try:
        with driver.session() as session:
            count = session.run(
                "MATCH (n {industry:$ind}) RETURN count(n) as c", ind=industry
            ).single()["c"]
            if count == 0:
                session.run(SCENARIOS[industry])
                print(f"✅ Seeded {industry}")
    except Exception as e:
        print(f"⚠️ Seed error {industry}: {e}")

for ind in ["manufacturing", "energy", "logistics"]:
    seed_database(ind)

# ── Models ─────────────────────────────────────────────────────────────────────
class CascadeResult(BaseModel):
    triggered_node: str
    affected_nodes: List[dict]
    risk_paths: List[List[str]]
    total_impact_score: float
    time_to_critical: str
    intervention_plan: List[dict]
    ai_analysis: Optional[dict] = None
    timestamp: Optional[str] = None
    industry: Optional[str] = None

# ── Helpers ────────────────────────────────────────────────────────────────────
def get_graph(industry: str = None):
    G = nx.DiGraph()
    with driver.session() as session:
        result = session.run("""
            MATCH (a)-[r]->(b)
            WHERE ($industry IS NULL OR a.industry = $industry)
            RETURN a.id as src, b.id as dst,
                   a.name as src_name, b.name as dst_name,
                   a.status as src_status, b.status as dst_status,
                   labels(a)[0] as src_type, labels(b)[0] as dst_type,
                   r.weight as weight
        """, industry=industry)
        for rec in result:
            G.add_node(rec["src"], name=rec["src_name"],
                       status=rec["src_status"], type=rec["src_type"])
            G.add_node(rec["dst"], name=rec["dst_name"],
                       status=rec["dst_status"], type=rec["dst_type"])
            G.add_edge(rec["src"], rec["dst"],
                       weight=float(rec["weight"] or 1.0))
    return G

def build_intervention_plan(affected, triggered):
    plans = []
    critical = [n for n in affected if n['severity'] == 'CRITICAL']
    high     = [n for n in affected if n['severity'] == 'HIGH']
    if critical:
        plans.append({"rank":1,"priority":"IMMEDIATE",
            "action": f"Isolate {triggered} — stop cascade to {critical[0]['name']}",
            "expected_outcome": "Prevents cascade reaching critical nodes",
            "time_to_implement": "30 minutes",
            "resources": ["Operations Manager","On-site Engineer","Maintenance Team"]})
    if high:
        plans.append({"rank":2,"priority":"URGENT",
            "action": f"Pre-emptively pause {high[0]['name']} and run diagnostics",
            "expected_outcome": "Reduces cascade probability by ~60%",
            "time_to_implement": "1-2 hours",
            "resources": ["Shift Supervisor","Technical Team"]})
    plans.append({"rank":3,"priority":"STANDARD",
        "action": "Activate contingency protocols and notify downstream stakeholders",
        "expected_outcome": "Limits operational and financial impact",
        "time_to_implement": "2-4 hours",
        "resources": ["Operations Lead","Communications Team"]})
    return plans

def groq_analyze(cascade_data: dict) -> dict:
    if not GROQ_API_KEY:
        return {
            "root_cause": f"Failure at {cascade_data.get('triggered_node')}",
            "urgency": "HIGH" if cascade_data.get("total_impact_score",0) > 100 else "MEDIUM",
            "key_insight": f"Cascade affects {len(cascade_data.get('affected_nodes',[]))} nodes",
            "recommendation": "Execute intervention plan immediately — prioritise CRITICAL nodes"
        }
    try:
        res = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}",
                     "Content-Type": "application/json"},
            json={"model": "mixtral-8x7b-32768",
                  "messages": [{"role":"user","content":
                    f"""You are the Quantum Brain AI for CFI. Analyze this cascade and respond ONLY with valid JSON:
Triggered: {cascade_data.get('triggered_node')}
Affected nodes: {len(cascade_data.get('affected_nodes',[]))}
Impact score: {cascade_data.get('total_impact_score')}
Time to critical: {cascade_data.get('time_to_critical')}
Top affected: {[n['name'] for n in cascade_data.get('affected_nodes',[])[:3]]}

JSON format: {{"root_cause":"...","urgency":"CRITICAL/HIGH/MEDIUM/LOW","key_insight":"...","recommendation":"..."}}"""
                  }],
                  "max_tokens":300,"temperature":0.3},
            timeout=10
        )
        if res.status_code == 200:
            raw = res.json()["choices"][0]["message"]["content"]
            s, e = raw.find('{'), raw.rfind('}')+1
            return json.loads(raw[s:e])
    except Exception as ex:
        print(f"Groq error: {ex}")
    return {"root_cause": f"Failure at {cascade_data.get('triggered_node')}",
            "urgency": "HIGH", "key_insight": "Multiple nodes at risk",
            "recommendation": "Execute intervention plan immediately"}

def simulate_cascade(G, failed_node, use_ai=False, industry=None):
    affected, risk_paths = [], []
    if failed_node not in G:
        return CascadeResult(triggered_node=failed_node, affected_nodes=[],
                             risk_paths=[], total_impact_score=0,
                             time_to_critical="N/A", intervention_plan=[],
                             timestamp=datetime.now().isoformat(), industry=industry)
    visited = set()
    queue = [(failed_node, 0, 1.0, [failed_node])]
    while queue:
        node, depth, prob, path = queue.pop(0)
        for neighbor in G.successors(node):
            if neighbor not in visited:
                visited.add(neighbor)
                w = G[node][neighbor].get('weight', 1.0)
                cp = prob * w
                rs = round(cp * 100 * (0.9 ** depth), 1)
                th = [2, 12, 24, 48, 72][min(depth, 4)]
                sev = ("CRITICAL" if rs>70 else "HIGH" if rs>40
                       else "MEDIUM" if rs>20 else "LOW")
                affected.append({"id":neighbor,
                    "name": G.nodes[neighbor].get('name', neighbor),
                    "type": G.nodes[neighbor].get('type', 'Unknown'),
                    "cascade_probability": round(cp*100,1),
                    "risk_score": rs, "depth": depth+1,
                    "time_to_impact_hours": th, "severity": sev})
                risk_paths.append(path + [neighbor])
                queue.append((neighbor, depth+1, cp, path+[neighbor]))
    total = sum(n['risk_score'] for n in affected)
    min_time = min((n['time_to_impact_hours'] for n in affected), default=0)
    plan = build_intervention_plan(affected, failed_node)
    result = CascadeResult(
        triggered_node=failed_node, affected_nodes=affected,
        risk_paths=risk_paths, total_impact_score=round(total,1),
        time_to_critical=f"{min_time} hours", intervention_plan=plan,
        timestamp=datetime.now().isoformat(), industry=industry
    )
    if use_ai:
        result.ai_analysis = groq_analyze(result.dict())
    return result

# ── Auto Simulation Background Task ───────────────────────────────────────────
auto_sim_active = {"value": True}

async def auto_simulation_loop():
    """Automatically trigger random failures and recoveries every 30-60s"""
    await asyncio.sleep(15)  # initial delay
    while True:
        try:
            if auto_sim_active["value"]:
                industries = ["manufacturing", "energy", "logistics"]
                ind = random.choice(industries)
                G = get_graph(ind)
                if not G.nodes():
                    await asyncio.sleep(30)
                    continue

                nodes_list = list(G.nodes())
                # 70% chance: trigger a warning, 30% chance: restore a node
                action = "fail" if random.random() < 0.7 else "restore"
                node_id = random.choice(nodes_list)

                if action == "fail":
                    current = G.nodes[node_id].get('status', 'normal')
                    if current == 'normal':
                        with driver.session() as session:
                            session.run("MATCH (n {id:$id}) SET n.status='warning'",
                                        id=node_id)
                        result = simulate_cascade(G, node_id, use_ai=False, industry=ind)
                        if result.total_impact_score > 20:
                            incident = {
                                "id": f"INC-{len(incident_log)+1:04d}",
                                "node": node_id,
                                "node_name": G.nodes[node_id].get('name', node_id),
                                "industry": ind,
                                "impact_score": result.total_impact_score,
                                "affected_count": len(result.affected_nodes),
                                "time_to_critical": result.time_to_critical,
                                "timestamp": datetime.now().isoformat(),
                                "type": "auto_detected",
                                "status": "active"
                            }
                            incident_log.append(incident)
                            if len(incident_log) > 50:
                                incident_log.pop(0)
                            await manager.broadcast({
                                "type": "auto_cascade_detected",
                                "industry": ind,
                                "node": node_id,
                                "node_name": G.nodes[node_id].get('name', node_id),
                                "impact_score": result.total_impact_score,
                                "affected_count": len(result.affected_nodes),
                                "timestamp": datetime.now().isoformat()
                            })
                else:
                    current = G.nodes[node_id].get('status', 'normal')
                    if current in ['warning', 'critical']:
                        with driver.session() as session:
                            session.run("MATCH (n {id:$id}) SET n.status='normal'",
                                        id=node_id)
                        await manager.broadcast({
                            "type": "auto_node_restored",
                            "node": node_id,
                            "industry": ind,
                            "timestamp": datetime.now().isoformat()
                        })

        except Exception as e:
            print(f"Auto-sim error: {e}")

        await asyncio.sleep(random.randint(25, 45))

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(auto_simulation_loop())
    print("✅ Auto-simulation loop started")

# ── WebSocket ──────────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Send current state on connect
        G = get_graph()
        warning = [n for n in G.nodes()
                   if G.nodes[n].get('status') in ['warning','critical','at-risk']]
        await websocket.send_json({
            "type": "connected",
            "total_nodes": len(G.nodes()),
            "warning_count": len(warning),
            "timestamp": datetime.now().isoformat()
        })
        while True:
            await asyncio.sleep(20)
            await websocket.send_json({
                "type": "heartbeat",
                "timestamp": datetime.now().isoformat()
            })
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ── Routes ─────────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "✅ CFI v3 Online",
            "company": "MAH Quantum × Quanta Industries",
            "auto_sim": auto_sim_active["value"]}

@app.get("/api/nodes")
def get_nodes(industry: str = None):
    G = get_graph(industry)
    return [{"id": n, **G.nodes[n]} for n in G.nodes()]

@app.get("/api/graph")
def get_graph_data(industry: str = None):
    G = get_graph(industry)
    nodes = [{"id": n, **G.nodes[n]} for n in G.nodes()]
    edges = [{"source": u, "target": v, "weight": G[u][v].get('weight',1.0)}
             for u, v in G.edges()]
    return {"nodes": nodes, "edges": edges}

@app.get("/api/industries")
def get_industries():
    return ["manufacturing", "energy", "logistics"]

@app.post("/api/simulate/{node_id}")
async def run_simulation(node_id: str, industry: str = None, ai: bool = False):
    G = get_graph(industry)
    result = simulate_cascade(G, node_id, use_ai=ai, industry=industry)
    incident = {
        "id": f"INC-{len(incident_log)+1:04d}",
        "node": node_id,
        "node_name": G.nodes[node_id].get('name', node_id) if node_id in G else node_id,
        "industry": industry or "all",
        "impact_score": result.total_impact_score,
        "affected_count": len(result.affected_nodes),
        "time_to_critical": result.time_to_critical,
        "timestamp": datetime.now().isoformat(),
        "type": "manual_simulation",
        "status": "simulated"
    }
    incident_log.append(incident)
    if len(incident_log) > 50:
        incident_log.pop(0)
    await manager.broadcast({
        "type": "cascade_simulated",
        "node": node_id, "industry": industry,
        "impact_score": result.total_impact_score,
        "affected_count": len(result.affected_nodes)
    })
    return result

@app.post("/api/node/{node_id}/fail")
async def trigger_failure(node_id: str, industry: str = None):
    with driver.session() as session:
        session.run("MATCH (n {id:$id}) SET n.status='critical'", id=node_id)
    G = get_graph(industry)
    result = simulate_cascade(G, node_id, use_ai=bool(GROQ_API_KEY), industry=industry)
    await manager.broadcast({
        "type": "node_failed", "node": node_id,
        "impact_score": result.total_impact_score,
        "timestamp": datetime.now().isoformat()
    })
    return result

@app.post("/api/node/{node_id}/restore")
async def restore_node(node_id: str):
    with driver.session() as session:
        session.run("MATCH (n {id:$id}) SET n.status='normal'", id=node_id)
    await manager.broadcast({"type": "node_restored", "node": node_id,
                              "timestamp": datetime.now().isoformat()})
    return {"success": True, "node": node_id, "status": "normal"}

@app.get("/api/risk-summary")
def risk_summary(industry: str = None):
    G = get_graph(industry)
    total = len(G.nodes())
    warning = [n for n in G.nodes()
               if G.nodes[n].get('status') in ['warning','critical','at-risk']]
    cascades = []
    for node in warning:
        r = simulate_cascade(G, node, industry=industry)
        if r.total_impact_score > 30:
            cascades.append({
                "node": node,
                "name": G.nodes[node].get('name', node),
                "impact_score": r.total_impact_score,
                "affected_count": len(r.affected_nodes),
                "time_to_critical": r.time_to_critical
            })
    health = round((1 - len(warning)/max(total,1)) * 100, 1)
    return {"total_nodes": total, "healthy_nodes": total-len(warning),
            "warning_nodes": len(warning), "high_risk_cascades": cascades,
            "system_health_score": health}

@app.get("/api/incidents")
def get_incidents(limit: int = 20):
    return list(reversed(incident_log))[:limit]

@app.post("/api/autosim/toggle")
async def toggle_autosim():
    auto_sim_active["value"] = not auto_sim_active["value"]
    await manager.broadcast({
        "type": "autosim_toggled",
        "active": auto_sim_active["value"]
    })
    return {"auto_sim": auto_sim_active["value"]}

@app.get("/api/autosim/status")
def autosim_status():
    return {"active": auto_sim_active["value"]}

@app.delete("/api/reset")
async def reset_db(industry: str = None):
    with driver.session() as session:
        if industry:
            session.run("MATCH (n {industry:$ind}) DETACH DELETE n", ind=industry)
            seed_database(industry)
        else:
            session.run("MATCH (n) DETACH DELETE n")
            for ind in ["manufacturing", "energy", "logistics"]:
                seed_database(ind)
    incident_log.clear()
    await manager.broadcast({"type": "reset", "industry": industry or "all"})
    return {"success": True}
