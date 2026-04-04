import React from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Nurse from "./pages/chat_agent/Nurse";
import Supervisor from "./pages/shared/Supervisor";
import Members from "./pages/shared/Members";
import MemberProfile from "./pages/shared/MemberProfile";
import CaseView from "./pages/shared/CaseView";
import AssessmentView from "./pages/shared/AssessmentView";

function NavLink({ to, label }: { to: string; label: string }) {
  const location = useLocation();
  const active = location.pathname === to;

  return (
    <Link
      to={to}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        textDecoration: "none",
        color: "#f8fafc",
        background: active ? "#1d4ed8" : "#1e293b",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      {label}
    </Link>
  );
}

export default function App() {
  return (
    <div className="container">
      <div
        className="row"
        style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}
      >
        <div className="h1">Agent Platform MVP UI</div>
        <div style={{ display: "flex", gap: 12 }}>
          <NavLink to="/nurse" label="Nurse" />
          <NavLink to="/members" label="Members" />
          <a
            href="/supervisor"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              textDecoration: "none",
              color: "#f8fafc",
              background: "#1e293b",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            Approval Console
          </a>
        </div>
      </div>

      <Routes>
        <Route path="/" element={<Navigate to="/nurse" replace />} />
        <Route path="/nurse" element={<Nurse />} />
        <Route path="/supervisor" element={<Supervisor />} />
        <Route path="/members" element={<Members />} />
        <Route path="/members/:memberId" element={<MemberProfile />} />
        <Route path="/cases/:caseId" element={<CaseView />} />
        <Route path="/assessments/:assessmentId" element={<AssessmentView />} />
      </Routes>
    </div>
  );
}
