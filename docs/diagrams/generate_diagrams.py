"""
Generate architecture diagrams as PNG files for documentation.
Run: python3 generate_diagrams.py
"""

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import matplotlib.patheffects as pe

# ── shared styles ──────────────────────────────────────────────
BG       = "#0f172a"
BOX_DARK = "#1e293b"
BOX_MID  = "#1e3a5f"
BOX_ACC  = "#312e81"
BOX_GRN  = "#14532d"
BOX_RED  = "#7f1d1d"
TXT      = "#f8fafc"
TXT_DIM  = "#94a3b8"
ACC      = "#6366f1"
GRN      = "#4ade80"
YEL      = "#fbbf24"
RED      = "#f87171"

def box(ax, x, y, w, h, label, sublabel=None, color=BOX_MID, fontsize=9, radius=0.02):
    rect = FancyBboxPatch((x, y), w, h,
                          boxstyle=f"round,pad=0",
                          linewidth=1.2, edgecolor=ACC,
                          facecolor=color, zorder=3)
    ax.add_patch(rect)
    ty = y + h/2 + (0.012 if sublabel else 0)
    ax.text(x + w/2, ty, label, ha='center', va='center',
            color=TXT, fontsize=fontsize, fontweight='bold', zorder=4)
    if sublabel:
        ax.text(x + w/2, y + h/2 - 0.018, sublabel, ha='center', va='center',
                color=TXT_DIM, fontsize=7, zorder=4)

def arrow(ax, x1, y1, x2, y2, color=ACC, label=None):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="->", color=color, lw=1.5), zorder=5)
    if label:
        mx, my = (x1+x2)/2, (y1+y2)/2
        ax.text(mx+0.01, my, label, color=TXT_DIM, fontsize=7, zorder=6)


# ══════════════════════════════════════════════════════════════
# DIAGRAM 1 — Platform Architecture
# ══════════════════════════════════════════════════════════════
def diagram_platform_architecture():
    fig, ax = plt.subplots(figsize=(14, 9))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 1.4); ax.set_ylim(0, 0.9)
    ax.axis('off')
    ax.set_title("Agent Platform — Architecture", color=TXT, fontsize=14, fontweight='bold', pad=12)

    # Browser
    box(ax, 0.05, 0.72, 1.3, 0.12, "Browser  :3000", "React UI  |  Members · MemberProfile · CaseView · AssessmentView · Nurse · Approval Console", BOX_ACC, fontsize=10)

    # Agent Runtime
    box(ax, 0.05, 0.44, 0.56, 0.22, "Agent Runtime  :8081",
        "FastAPI  |  LangGraph Orchestration\nPlanner → Router → Executor → Responder\nMemory  |  Observability  |  HITL", BOX_MID, fontsize=9)

    # Tool Gateway
    box(ax, 0.69, 0.44, 0.56, 0.22, "Tool Gateway  :8080",
        "FastAPI  |  TOOL_REGISTRY\n/tools/invoke  |  /tools/specs\n/members  |  /cases  |  /assessments", BOX_MID, fontsize=9)

    # PostgreSQL
    box(ax, 0.69, 0.14, 0.56, 0.22, "PostgreSQL  :5433",
        "members · cases · assessments · tasks\nclaims · auths · providers · case_notes\nkb_docs (pgvector — knowledge base)", BOX_DARK, fontsize=9)

    # Memory
    box(ax, 0.05, 0.14, 0.56, 0.22, "File-Based Memory\n/app/state/memory/",
        "conversation  |  assessment  |  case  |  member\nshort_term · episodic · semantic · summary\nscope rollup: assessment→case→member", BOX_DARK, fontsize=9)

    # Arrows
    arrow(ax, 0.70, 0.72, 0.33, 0.66)   # browser → agent runtime
    arrow(ax, 0.70, 0.72, 0.97, 0.66)   # browser → tool gateway (direct REST for domain context)
    arrow(ax, 0.61, 0.55, 0.69, 0.55)   # agent → tool gateway
    arrow(ax, 0.97, 0.44, 0.97, 0.36)   # tool gateway → postgres
    arrow(ax, 0.33, 0.44, 0.33, 0.36)   # agent runtime → memory

    # Labels
    ax.text(0.645, 0.58, "/tools/invoke", color=TXT_DIM, fontsize=7, ha='center')
    ax.text(1.02, 0.40, "SQL + pgvector", color=TXT_DIM, fontsize=7)
    ax.text(0.05, 0.40, "read/write JSON", color=TXT_DIM, fontsize=7)
    ax.text(0.56, 0.74, "POST /invocations", color=TXT_DIM, fontsize=7)
    ax.text(0.82, 0.74, "GET /members /cases", color=TXT_DIM, fontsize=7)

    plt.tight_layout()
    plt.savefig("platform-architecture.png", dpi=150, bbox_inches='tight', facecolor=BG)
    plt.close()
    print("✓ platform-architecture.png")


# ══════════════════════════════════════════════════════════════
# DIAGRAM 2 — Agent Request Flow
# ══════════════════════════════════════════════════════════════
def diagram_request_flow():
    fig, ax = plt.subplots(figsize=(12, 10))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 1.2); ax.set_ylim(0, 1.0)
    ax.axis('off')
    ax.set_title("Agent Request Flow — One Nurse Message", color=TXT, fontsize=13, fontweight='bold', pad=12)

    steps = [
        (0.1, 0.88, 1.0, 0.08, "1.  Nurse types message", "UI  →  POST /invocations  {prompt, tenant_id, thread_id, assessment_id}", BOX_ACC),
        (0.1, 0.77, 1.0, 0.08, "2.  Build Context", "config loader · memory read · scope resolver · context builder", BOX_MID),
        (0.1, 0.66, 1.0, 0.08, "3.  Planner", "HARD_ROUTE (keyword match) or LLM_ROUTE (OpenAI decides tool + arg)", BOX_MID),
        (0.1, 0.55, 1.0, 0.08, "4.  Router", "converts  'tool_name: arg'  →  structured tool input dict", BOX_MID),
        (0.1, 0.44, 1.0, 0.08, "5.  Executor", "POST /tools/invoke  →  Tool Gateway  →  PostgreSQL / pgvector", BOX_MID),
        (0.1, 0.33, 1.0, 0.08, "6.  Responder", "OpenAI call with: system prompt + memory context + tool result → answer", BOX_MID),
        (0.1, 0.22, 1.0, 0.08, "7.  Memory Write", "short-term turn written · episodic if tool_success · summary if N turns", BOX_GRN),
        (0.1, 0.11, 1.0, 0.08, "8.  Response to UI", "answer + memory_trace + planner_trace  →  Memory Panel + Execution Graph updated", BOX_ACC),
    ]

    for x, y, w, h, label, sub, color in steps:
        box(ax, x, y, w, h, label, sub, color, fontsize=9)

    for i in range(len(steps)-1):
        _, y, _, h, _, _, _ = steps[i]
        ax.annotate("", xy=(0.6, steps[i+1][1]+steps[i+1][3]),
                    xytext=(0.6, y),
                    arrowprops=dict(arrowstyle="->", color=ACC, lw=1.5), zorder=5)

    # HITL branch
    box(ax, 0.1, 0.44, 1.0, 0.08, "5b.  HITL — Approval Required",
        "approval_required=true  →  save to DB  →  return PENDING  →  nurse continues chatting", BOX_RED, fontsize=9)
    ax.text(0.05, 0.475, "if high\nrisk", color=YEL, fontsize=7, ha='center', va='center')

    plt.tight_layout()
    plt.savefig("agent-request-flow.png", dpi=150, bbox_inches='tight', facecolor=BG)
    plt.close()
    print("✓ agent-request-flow.png")


# ══════════════════════════════════════════════════════════════
# DIAGRAM 3 — Template to Repo Flow
# ══════════════════════════════════════════════════════════════
def diagram_template_flow():
    fig, ax = plt.subplots(figsize=(14, 8))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 1.4); ax.set_ylim(0, 0.8)
    ax.axis('off')
    ax.set_title("Template → Generated Repo Flow", color=TXT, fontsize=13, fontweight='bold', pad=12)

    # Template boxes
    ax.text(0.18, 0.76, "TEMPLATES  (edit here first)", color=ACC, fontsize=10, fontweight='bold', ha='center')
    box(ax, 0.01, 0.56, 0.34, 0.18, "agent-runtime-template",
        "common/  (platform infra)\noverlays/chat_agent/  (agent logic)\noverlays/summary_agent/  (future)", BOX_MID, fontsize=8)
    box(ax, 0.01, 0.34, 0.34, 0.18, "capability-ui-template",
        "services/ui/src/pages/\nApp.tsx  |  TraceGraph\nMemoryPanel  |  styles", BOX_MID, fontsize=8)

    # Arrow
    ax.annotate("", xy=(0.52, 0.55), xytext=(0.36, 0.55),
                arrowprops=dict(arrowstyle="->", color=GRN, lw=2.5), zorder=5)
    ax.text(0.44, 0.57, "scaffold", color=GRN, fontsize=9, ha='center', fontweight='bold')
    ax.text(0.44, 0.53, "(copy + customize)", color=TXT_DIM, fontsize=7, ha='center')

    # Generated repos
    ax.text(0.88, 0.76, "GENERATED REPOS  (do not edit directly)", color=YEL, fontsize=10, fontweight='bold', ha='center')

    box(ax, 0.52, 0.56, 0.42, 0.18, "cm-chat-buddy-assess/",
        "overlays/chat_agent/config/agent.yaml  ← customized\noverlays/chat_agent/  (agents, graph, orchestration)\nservices/agent-runtime/  (platform infra)", "#1a3a1a", fontsize=8)

    box(ax, 0.96, 0.56, 0.42, 0.18, "cm-hero-fl-app/  (UI)",
        "services/ui/src/pages/  (all pages)\nApp.tsx  |  vite.config.ts\ndocker-compose.yml", "#1a3a1a", fontsize=8)

    box(ax, 0.52, 0.34, 0.86, 0.18, "shared-infra/tool-gateway/  (shared — one per capability)",
        "src/tools/registry.py  (all tools)\nsrc/data/pg_store.py  (data queries)\ndata/sql/  (schema + seed data)          PostgreSQL + pgvector", BOX_DARK, fontsize=8)

    # What's customized
    ax.text(0.74, 0.30, "What's customized per usecase:", color=TXT_DIM, fontsize=8, ha='center')
    items = ["overlays/{agent_type}/config/agent.yaml — tools, features, risk",
             "overlays/{agent_type}/config/memory.yaml — memory scopes",
             "services/agent-runtime/config/base.yaml — capability_name, agent_type",
             "docker-compose.yml — ports, env vars"]
    for i, item in enumerate(items):
        ax.text(0.74, 0.26 - i*0.04, f"•  {item}", color=TXT_DIM, fontsize=7, ha='center')

    # Rule box
    rule = FancyBboxPatch((0.01, 0.02), 1.37, 0.10,
                          boxstyle="round,pad=0", linewidth=1.5,
                          edgecolor=YEL, facecolor="#2d2500", zorder=3)
    ax.add_patch(rule)
    ax.text(0.695, 0.08, "RULE: Always edit templates first, then copy to generated repo. Never edit generated repo directly.",
            color=YEL, fontsize=9, ha='center', va='center', fontweight='bold', zorder=4)

    plt.tight_layout()
    plt.savefig("template-to-repo-flow.png", dpi=150, bbox_inches='tight', facecolor=BG)
    plt.close()
    print("✓ template-to-repo-flow.png")


# ══════════════════════════════════════════════════════════════
# DIAGRAM 4 — Memory Hierarchy
# ══════════════════════════════════════════════════════════════
def diagram_memory_hierarchy():
    fig, ax = plt.subplots(figsize=(13, 8))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 1.3); ax.set_ylim(0, 0.8)
    ax.axis('off')
    ax.set_title("Memory Scope Hierarchy + Rollup", color=TXT, fontsize=13, fontweight='bold', pad=12)

    # Scopes (top to bottom = widest to narrowest)
    scopes = [
        (0.35, 0.66, 0.60, 0.10, "MEMBER  scope", "semantic memory · stable facts · chronic conditions · risk profile", "#1a2744"),
        (0.30, 0.52, 0.70, 0.10, "CASE  scope", "episodic memory · care events · tool executions · HITL decisions", "#1a3a2a"),
        (0.25, 0.38, 0.80, 0.10, "ASSESSMENT  scope", "episodic memory · assessment-specific events · case notes written", "#2a1a3a"),
        (0.20, 0.24, 0.90, 0.10, "CONVERSATION  scope", "short-term turns (last 12) · conversation summary (every 10 turns)", "#2a2a1a"),
    ]

    for x, y, w, h, label, sub, color in scopes:
        box(ax, x, y, w, h, label, sub, color, fontsize=9)

    # Rollup arrows
    ax.annotate("", xy=(0.65, 0.66), xytext=(0.65, 0.62),
                arrowprops=dict(arrowstyle="->", color=GRN, lw=2), zorder=5)
    ax.annotate("", xy=(0.65, 0.52), xytext=(0.65, 0.48),
                arrowprops=dict(arrowstyle="->", color=GRN, lw=2), zorder=5)
    ax.annotate("", xy=(0.65, 0.38), xytext=(0.65, 0.34),
                arrowprops=dict(arrowstyle="->", color=GRN, lw=2), zorder=5)

    ax.text(0.67, 0.64, "rolls up", color=GRN, fontsize=8)
    ax.text(0.67, 0.50, "rolls up", color=GRN, fontsize=8)
    ax.text(0.67, 0.36, "rolls up", color=GRN, fontsize=8)

    # Memory types legend
    ax.text(0.05, 0.18, "Memory Types:", color=TXT, fontsize=9, fontweight='bold')
    types = [
        (ACC,   "Short-term",  "recent conversation turns · last 12 messages · written every turn"),
        (GRN,   "Episodic",    "clinical events · tool executions · written on tool_success"),
        (YEL,   "Semantic",    "stable facts about member · written by extractor (future)"),
        ("#a78bfa", "Summary", "compressed turns · written every 10 turns · replaces raw turns"),
    ]
    for i, (color, name, desc) in enumerate(types):
        y = 0.13 - i * 0.035
        rect = FancyBboxPatch((0.05, y-0.008), 0.08, 0.018, boxstyle="round,pad=0",
                              facecolor=color, edgecolor='none', alpha=0.4, zorder=3)
        ax.add_patch(rect)
        ax.text(0.14, y, f"{name}:", color=color, fontsize=8, fontweight='bold')
        ax.text(0.28, y, desc, color=TXT_DIM, fontsize=7)

    # Rollup rule
    ax.text(1.05, 0.60, "Rollup Rule:", color=TXT, fontsize=9, fontweight='bold', ha='center')
    ax.text(1.05, 0.56, "Reading case memory", color=TXT_DIM, fontsize=8, ha='center')
    ax.text(1.05, 0.52, "includes all child", color=TXT_DIM, fontsize=8, ha='center')
    ax.text(1.05, 0.48, "assessment memories.", color=TXT_DIM, fontsize=8, ha='center')
    ax.text(1.05, 0.42, "Reading member memory", color=TXT_DIM, fontsize=8, ha='center')
    ax.text(1.05, 0.38, "includes all cases +", color=TXT_DIM, fontsize=8, ha='center')
    ax.text(1.05, 0.34, "all assessments.", color=TXT_DIM, fontsize=8, ha='center')

    plt.tight_layout()
    plt.savefig("memory-hierarchy.png", dpi=150, bbox_inches='tight', facecolor=BG)
    plt.close()
    print("✓ memory-hierarchy.png")


# ══════════════════════════════════════════════════════════════
# DIAGRAM 5 — HITL Flow
# ══════════════════════════════════════════════════════════════
def diagram_hitl_flow():
    fig, ax = plt.subplots(figsize=(13, 9))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 1.3); ax.set_ylim(0, 0.9)
    ax.axis('off')
    ax.set_title("HITL — Async Approval Flow (Internal Adapter)", color=TXT, fontsize=13, fontweight='bold', pad=12)

    # Nurse column
    ax.text(0.13, 0.87, "NURSE", color=ACC, fontsize=10, fontweight='bold', ha='center')
    nurse_steps = [
        (0.02, 0.78, 0.22, 0.07, "1. Sends message", '"write case note..."', BOX_ACC),
        (0.02, 0.56, 0.22, 0.07, "3. Sees PENDING", "amber badge in chat\ncan continue chatting", BOX_MID),
        (0.02, 0.18, 0.22, 0.07, "6. Gets notified", "approved: result shown\nrejected: reason shown", BOX_GRN),
    ]
    for x, y, w, h, l, s, c in nurse_steps:
        box(ax, x, y, w, h, l, s, c, fontsize=8)

    # Agent column
    ax.text(0.50, 0.87, "AGENT RUNTIME", color=YEL, fontsize=10, fontweight='bold', ha='center')
    agent_steps = [
        (0.29, 0.78, 0.42, 0.07, "2. Planner selects write_case_note", "risk_level=high  →  HITL triggered\nsaves ApprovalRequest to PostgreSQL", BOX_MID),
        (0.29, 0.44, 0.42, 0.07, "5a. Approved → execute tool", "write_case_note runs\nresult stored", BOX_GRN),
        (0.29, 0.35, 0.42, 0.07, "5b. Rejected → store reason", "reason saved to DB\nno tool execution", BOX_RED),
        (0.29, 0.24, 0.42, 0.07, "5c. Write to episodic memory", "decision + reason + actor\nwritten at assessment + case scope", "#1a3a2a"),
    ]
    for x, y, w, h, l, s, c in agent_steps:
        box(ax, x, y, w, h, l, s, c, fontsize=8)

    # Supervisor column
    ax.text(1.07, 0.87, "SUPERVISOR", color=RED, fontsize=10, fontweight='bold', ha='center')
    sup_steps = [
        (0.86, 0.65, 0.42, 0.07, "4. Reviews in Approval Console", "GET /hitl/pending\nfull context: member, tool input, risk", BOX_ACC),
        (0.86, 0.54, 0.42, 0.07, "Approve / Reject + reason", "POST /hitl/decide\n{decision, reason, decided_by}", "#3a1a1a"),
    ]
    for x, y, w, h, l, s, c in sup_steps:
        box(ax, x, y, w, h, l, s, c, fontsize=8)

    # Arrows
    arrow(ax, 0.24, 0.815, 0.29, 0.815)   # nurse → agent
    arrow(ax, 0.29, 0.595, 0.24, 0.595)   # agent → nurse PENDING
    arrow(ax, 0.71, 0.755, 0.86, 0.69)    # agent → supervisor (approval request)
    arrow(ax, 0.86, 0.575, 0.71, 0.48)    # supervisor → agent (decision)
    arrow(ax, 0.50, 0.44,  0.50, 0.35)    # approved → rejected branch
    arrow(ax, 0.50, 0.35,  0.50, 0.31)    # → memory write
    arrow(ax, 0.29, 0.275, 0.24, 0.22)    # agent → nurse notification

    ax.text(0.73, 0.73, "saves to PostgreSQL\nnotifies console", color=TXT_DIM, fontsize=7)
    ax.text(0.73, 0.52, "decision callback", color=TXT_DIM, fontsize=7)

    plt.tight_layout()
    plt.savefig("hitl-flow.png", dpi=150, bbox_inches='tight', facecolor=BG)
    plt.close()
    print("✓ hitl-flow.png")


# ══════════════════════════════════════════════════════════════
# DIAGRAM 6 — Taxonomy Hierarchy
# ══════════════════════════════════════════════════════════════
def diagram_taxonomy():
    fig, ax = plt.subplots(figsize=(13, 7))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 1.3); ax.set_ylim(0, 0.7)
    ax.axis('off')
    ax.set_title("Platform Taxonomy — Capability → Usecase → Agent → Application", color=TXT, fontsize=12, fontweight='bold', pad=12)

    # Level labels
    for label, x in [("CAPABILITY", 0.09), ("USECASE", 0.35), ("AGENT (Overlay)", 0.65), ("APPLICATION", 0.99)]:
        ax.text(x, 0.64, label, color=ACC, fontsize=9, fontweight='bold', ha='center')

    # Capability
    box(ax, 0.01, 0.44, 0.16, 0.18, "care-management", "healthcare\nnurse workflows", BOX_MID, 8)
    box(ax, 0.01, 0.14, 0.16, 0.18, "appeals-mgmt", "appeals &\ndeterminations", BOX_DARK, 8)

    # Usecases
    box(ax, 0.23, 0.52, 0.22, 0.10, "UC_PreCall_Assess", "pre-call assessment", BOX_MID, 8)
    box(ax, 0.23, 0.38, 0.22, 0.10, "UC_PostCall_Doc", "post-call documentation", BOX_DARK, 8)
    box(ax, 0.23, 0.14, 0.22, 0.10, "UC_Appeal_Intake", "appeal intake assist", BOX_DARK, 8)

    # Agents
    box(ax, 0.52, 0.58, 0.22, 0.08, "chat_agent", "interactive chat\nllm planner", BOX_MID, 8)
    box(ax, 0.52, 0.46, 0.22, 0.08, "summary_agent", "assessment summary\nbatch summarizer", BOX_DARK, 8)
    box(ax, 0.52, 0.34, 0.22, 0.08, "chat_agent", "post-call chat", BOX_DARK, 8)
    box(ax, 0.52, 0.14, 0.22, 0.08, "multi_agent", "supervisor + sub-agents", BOX_DARK, 8)

    # Applications
    box(ax, 0.82, 0.58, 0.22, 0.08, "Nurse App :3000", "cm-hero-fl-app", "#1a3a1a", 8)
    box(ax, 0.82, 0.46, 0.22, 0.08, "Nurse App :3000", "same UI, diff agent", BOX_DARK, 8)
    box(ax, 0.82, 0.34, 0.22, 0.08, "Post-Call Portal", "different UI", BOX_DARK, 8)
    box(ax, 0.82, 0.14, 0.22, 0.08, "Appeals Portal", "cm-appeals-app", BOX_DARK, 8)

    # Connecting arrows
    connections = [
        (0.17, 0.53, 0.23, 0.57),
        (0.17, 0.53, 0.23, 0.43),
        (0.17, 0.23, 0.23, 0.19),
        (0.45, 0.57, 0.52, 0.62),
        (0.45, 0.57, 0.52, 0.50),
        (0.45, 0.43, 0.52, 0.38),
        (0.45, 0.19, 0.52, 0.18),
        (0.74, 0.62, 0.82, 0.62),
        (0.74, 0.50, 0.82, 0.50),
        (0.74, 0.38, 0.82, 0.38),
        (0.74, 0.18, 0.82, 0.18),
    ]
    for x1, y1, x2, y2 in connections:
        arrow(ax, x1, y1, x2, y2, color="#475569")

    plt.tight_layout()
    plt.savefig("taxonomy.png", dpi=150, bbox_inches='tight', facecolor=BG)
    plt.close()
    print("✓ taxonomy.png")


# ══════════════════════════════════════════════════════════════
# DIAGRAM 7 — AgentCore Compatibility Layers
# ══════════════════════════════════════════════════════════════
def diagram_agentcore_layers():
    fig, ax = plt.subplots(figsize=(14, 8))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 1.4); ax.set_ylim(0, 0.9)
    ax.axis('off')
    ax.set_title("AWS AgentCore Compatibility — Platform Layer vs AgentCore Layer", color=TXT, fontsize=12, fontweight='bold', pad=12)

    AWS_BLUE  = "#1a3a5c"
    AWS_BDR   = "#2563eb"
    OUR_COLOR = "#1e3a2f"
    OUR_BDR   = "#4ade80"
    SWAP_COLOR= "#3b2a00"
    SWAP_BDR  = "#fbbf24"

    def colored_box(ax, x, y, w, h, label, sublabel=None, fc="#1e293b", ec=ACC, fontsize=9):
        rect = FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0",
                              linewidth=1.5, edgecolor=ec, facecolor=fc, zorder=3)
        ax.add_patch(rect)
        cy = y + h/2 + (0.012 if sublabel else 0)
        ax.text(x + w/2, cy, label, color=TXT, fontsize=fontsize,
                ha='center', va='center', fontweight='bold', zorder=4)
        if sublabel:
            ax.text(x + w/2, y + h/2 - 0.022, sublabel, color=TXT_DIM,
                    fontsize=fontsize - 1.5, ha='center', va='center', zorder=4)

    # ── Column headers ──────────────────────────────────────────
    ax.text(0.25, 0.86, "OUR PLATFORM", color=OUR_BDR, fontsize=10, fontweight='bold', ha='center')
    ax.text(0.25, 0.83, "unchanged — core design", color=TXT_DIM, fontsize=8, ha='center')

    ax.text(0.75, 0.86, "AWS AGENTCORE", color=AWS_BDR, fontsize=10, fontweight='bold', ha='center')
    ax.text(0.75, 0.83, "managed backend layer", color=TXT_DIM, fontsize=8, ha='center')

    ax.text(1.2, 0.86, "STATUS", color=YEL, fontsize=10, fontweight='bold', ha='center')

    # ── Row definitions ─────────────────────────────────────────
    rows = [
        # y,    our label,                our sub,                  aws label,             aws sub,                    status,   status_color
        (0.70, "Overlay Pattern",        "agent_type/graph/config", "AgentCore Runtime",   "managed containers",       "UNCHANGED", GRN),
        (0.58, "LangGraph Graphs",       "planner→executor→resp",   "AgentCore Runtime",   "LangGraph supported natively","UNCHANGED", GRN),
        (0.46, "Memory Architecture",    "scopes/rollup/4 types",   "AgentCore Memory",    "managed storage backend",  "CONCEPTS STAY\nbackend swaps", YEL),
        (0.34, "Agent Observability",    "tracer.py / TraceGraph",  "NOT PROVIDED",        "infra-only (CloudWatch)",  "WE OWN THIS", RED),
        (0.22, "HITL Adapter",           "pluggable interface",      "AgentCore HITL",      "managed approval flow",    "SWAP ADAPTER", YEL),
        (0.10, "Tool Gateway",           "registry.py / pg_store",  "AgentCore Tools",     "managed tool catalog",     "LIFT+SHIFT\nor migrate", YEL),
    ]

    for y, our_lbl, our_sub, aws_lbl, aws_sub, status, sc in rows:
        colored_box(ax, 0.03, y, 0.42, 0.09, our_lbl, our_sub, fc=OUR_COLOR, ec=OUR_BDR, fontsize=8)
        colored_box(ax, 0.53, y, 0.42, 0.09, aws_lbl, aws_sub, fc=AWS_BLUE,  ec=AWS_BDR, fontsize=8)
        ax.text(1.13, y + 0.045, status, color=sc, fontsize=7.5, fontweight='bold', ha='center', va='center')

    # ── Arrows between columns ───────────────────────────────────
    for y, *_ in rows:
        ax.annotate("", xy=(0.53, y + 0.045), xytext=(0.45, y + 0.045),
                    arrowprops=dict(arrowstyle="->", color="#475569", lw=1.2))

    # ── Observability callout ────────────────────────────────────
    ax.text(0.50, 0.375, "AgentCore sees:\nPOST /invocations → 200 OK\n(black box)",
            color="#f87171", fontsize=7, ha='center', va='center',
            bbox=dict(boxstyle='round,pad=0.3', facecolor="#3b0f0f", edgecolor=RED, lw=1))

    ax.text(0.50, 0.29, "Our tracer sees:\nplanner: HARD_ROUTE (12ms)\nexecutor: tool call + result (340ms)\nmemory write: episodic (8ms)\nresponder: 412 tokens (850ms)",
            color=GRN, fontsize=7, ha='center', va='center',
            bbox=dict(boxstyle='round,pad=0.3', facecolor="#0f2a1a", edgecolor=GRN, lw=1))

    # ── Legend ───────────────────────────────────────────────────
    legend_items = [
        (OUR_BDR, "Our platform — unchanged"),
        (YEL,     "Backend swap — concepts preserved"),
        (RED,     "Gap — AgentCore does NOT provide agent-level observability"),
    ]
    for i, (c, label) in enumerate(legend_items):
        ax.plot([0.03 + i*0.45], [0.045], 's', color=c, markersize=8, zorder=5)
        ax.text(0.06 + i*0.45, 0.045, label, color=TXT_DIM, fontsize=7.5, va='center')

    plt.tight_layout()
    plt.savefig("agentcore-layers.png", dpi=150, bbox_inches='tight', facecolor=BG)
    plt.close()
    print("✓ agentcore-layers.png")


if __name__ == "__main__":
    print("Generating diagrams...")
    diagram_platform_architecture()
    diagram_request_flow()
    diagram_template_flow()
    diagram_memory_hierarchy()
    diagram_hitl_flow()
    diagram_taxonomy()
    diagram_agentcore_layers()
    print("\nAll diagrams saved to docs/diagrams/")
    print("Insert PNG files directly into Word or PowerPoint.")
