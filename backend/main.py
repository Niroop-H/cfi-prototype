from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
import networkx as nx
from pydantic import BaseModel
from typing import List, Optional
import os, json

# ── App Setup ──────────────────────────────────────────────────────────────────
app = FastAPI(title="CFI — Cascading Failure Intelligence", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Neo4j Connection ───────────────────────────────────────────────────────────
NEO4J_URI      = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USERNAME = os.environ.get("NEO4J_USERNAME", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "password123")

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD))

# ── Seed Sample Data ───────────────────────────────────────────────────────────
def seed_database():
    try:
        with driver.session() as session:
            count = session.run("MATCH (n) RETURN count(n) as c").single()["c"]
            if count == 0:
                session.run("""
                    CREATE (s1:Sensor   {id:'S1', name:'Vibration Sensor A',   status:'warning',  type:'Sensor'})
                    CREATE (s2:Sensor   {id:'S2', name:'Temperature Sensor B', status:'normal',   type:'Sensor'})
                    CREATE (s3:Sensor   {id:'S3', name:'Pressure Gauge C',     status:'normal',   type:'Sensor'})
                    CREATE (m1:Machine  {id:'M1', name:'CNC Machine Alpha',    status:'warning',  type:'Machine'})
                    CREATE (m2:Machine  {id:'M2', name:'Assembly Line 1',      status:'normal',   type:'Machine'})
                    CREATE (m3:Machine  {id:'M3', name:'Packaging Unit',       status:'normal',   type:'Machine'})
                    CREATE (v1:Vendor   {id:'V1', name:'Parts Supplier X',     status:'normal',   type:'Vendor'})
                    CREATE (v2:Vendor   {id:'V2', name:'Raw Materials Co',     status:'warning',  type:'Vendor'})
                    CREATE (d1:Delivery {id:'D1', name:'Shipment Batch 47',    status:'on-track', type:'Delivery'})
                    CREATE (d2:Delivery {id:'D2', name:'Export Order 12',      status:'on-track', type:'Delivery'})
                    CREATE (r1:Revenue  {id:'R1', name:'Q2 Contract $2.8M',    status:'at-risk',  type:'Revenue'})

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
                """)
                print("✅ Database seeded successfully")
    except Exception as e:
        print(f"⚠️ Seed error: {e}")

seed_database()

# ── Models ─────────────────────────────────────────────────────────────────────
class CascadeResult(BaseModel):
    triggered_node: str
    affected_nodes: List[dict]
    risk_paths: List[List[str]]
    total_impact_score: float
    time_to_critical: str
    intervention_plan: List[dict]

# ── Graph Helpers ──────────────────────────────────────────────────────────────
def get_graph():
    G = nx.DiGraph()
    with driver.session() as session:
        result = session.run("""
            MATCH (a)-[r]->(b)
            RETURN a.id as src, b.id as dst,
                   a.name as src_name, b.name as dst_name,
                   a.status as src_status, b.status as dst_status,
                   labels(a)[0] as src_type, labels(b)[0] as dst_type,
                   r.weight as weight
        """)
        for rec in result:
            G.add_node(rec["src"], name=rec["src_name"], status=rec["src_status"], type=rec["src_type"])
            G.add_node(rec["dst"], name=rec["dst_name"], status=rec["dst_status"], type=rec["dst_type"])
            G.add_edge(rec["src"], rec["dst"], weight=float(rec["weight"] or 1.0))
    return G

def build_intervention_plan(affected_nodes):
    plans = []
    critical = [n for n in affected_nodes if n['severity'] == 'CRITICAL']
    high     = [n for n in affected_nodes if n['severity'] == 'HIGH']

    if critical:
        plans.append({
            "rank": 1,
            "priority": "IMMEDIATE",
            "action": f"Isolate and inspect {critical[0]['name']} within 30 minutes",
            "expected_outcome": "Prevents cascade reaching critical downstream nodes",
            "time_to_implement": "30 minutes",
            "resources": ["Operations Manager", "On-site Engineer", "Maintenance Team"]
        })
    if high:
        plans.append({
            "rank": 2,
            "priority": "URGENT",
            "action": f"Pre-emptively pause {high[0]['name']} and run diagnostics",
            "expected_outcome": "Reduces cascade probability by ~60%",
            "time_to_implement": "1-2 hours",
            "resources": ["Shift Supervisor", "Technical Team"]
        })
    plans.append({
        "rank": 3,
        "priority": "STANDARD",
        "action": "Activate backup supplier and notify logistics partners of potential delay",
        "expected_outcome": "Limits revenue impact and maintains customer SLAs",
        "time_to_implement": "2-4 hours",
        "resources": ["Supply Chain Manager", "Customer Relations"]
    })
    return plans

def simulate_cascade(G, failed_node):
    affected, risk_paths = [], []
    if failed_node not in G:
        return CascadeResult(
            triggered_node=failed_node,
            affected_nodes=[], risk_paths=[],
            total_impact_score=0,
            time_to_critical="N/A",
            intervention_plan=[]
        )

    visited = set()
    queue = [(failed_node, 0, 1.0, [failed_node])]

    while queue:
        node, depth, prob, path = queue.pop(0)
        for neighbor in G.successors(node):
            if neighbor not in visited:
                visited.add(neighbor)
                w = G[node][neighbor].get('weight', 1.0)
                cascade_prob = prob * w
                risk_score = round(cascade_prob * 100 * (0.9 ** depth), 1)
                time_hours = [2, 12, 24, 48, 72][min(depth, 4)]
                severity = (
                    "CRITICAL" if risk_score > 70 else
                    "HIGH"     if risk_score > 40 else
                    "MEDIUM"   if risk_score > 20 else "LOW"
                )
                affected.append({
                    "id": neighbor,
                    "name": G.nodes[neighbor].get('name', neighbor),
                    "type": G.nodes[neighbor].get('type', 'Unknown'),
                    "cascade_probability": round(cascade_prob * 100, 1),
                    "risk_score": risk_score,
                    "depth": depth + 1,
                    "time_to_impact_hours": time_hours,
                    "severity": severity
                })
                risk_paths.append(path + [neighbor])
                queue.append((neighbor, depth + 1, cascade_prob, path + [neighbor]))

    total = sum(n['risk_score'] for n in affected)
    min_time = min((n['time_to_impact_hours'] for n in affected), default=0)
    plan = build_intervention_plan(affected)

    return CascadeResult(
        triggered_node=failed_node,
        affected_nodes=affected,
        risk_paths=risk_paths,
        total_impact_score=round(total, 1),
        time_to_critical=f"{min_time} hours",
        intervention_plan=plan
    )

# ── API Routes ─────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "status": "✅ CFI System Online",
        "project": "Cascading Failure Intelligence",
        "company": "MAH Quantum × Quanta Industries",
        "version": "1.0.0"
    }

@app.get("/api/nodes")
def get_nodes():
    G = get_graph()
    return [{"id": n, **G.nodes[n]} for n in G.nodes()]

@app.get("/api/graph")
def get_graph_data():
    G = get_graph()
    nodes = [{"id": n, **G.nodes[n]} for n in G.nodes()]
    edges = [{"source": u, "target": v, "weight": G[u][v].get('weight', 1.0)}
             for u, v in G.edges()]
    return {"nodes": nodes, "edges": edges}

@app.post("/api/simulate/{node_id}")
def run_simulation(node_id: str):
    G = get_graph()
    return simulate_cascade(G, node_id)

@app.post("/api/node/{node_id}/fail")
def trigger_failure(node_id: str):
    with driver.session() as session:
        session.run("MATCH (n {id:$id}) SET n.status='critical'", id=node_id)
    G = get_graph()
    return simulate_cascade(G, node_id)

@app.post("/api/node/{node_id}/restore")
def restore_node(node_id: str):
    with driver.session() as session:
        session.run("MATCH (n {id:$id}) SET n.status='normal'", id=node_id)
    return {"success": True, "node": node_id, "status": "normal"}

@app.get("/api/risk-summary")
def risk_summary():
    G = get_graph()
    total = len(G.nodes())
    warning = [n for n in G.nodes()
               if G.nodes[n].get('status') in ['warning', 'critical', 'at-risk']]
    cascades = []
    for node in warning:
        r = simulate_cascade(G, node)
        if r.total_impact_score > 30:
            cascades.append({
                "node": node,
                "name": G.nodes[node].get('name', node),
                "impact_score": r.total_impact_score,
                "affected_count": len(r.affected_nodes),
                "time_to_critical": r.time_to_critical
            })
    health = round((1 - len(warning) / max(total, 1)) * 100, 1)
    return {
        "total_nodes": total,
        "healthy_nodes": total - len(warning),
        "warning_nodes": len(warning),
        "high_risk_cascades": cascades,
        "system_health_score": health
    }

@app.delete("/api/reset")
def reset_db():
    with driver.session() as session:
        session.run("MATCH (n) DETACH DELETE n")
    seed_database()
    return {"success": True, "message": "Database reset and reseeded"}
