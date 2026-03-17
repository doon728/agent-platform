import React from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Nurse from "./pages/Nurse";
import Supervisor from "./pages/Supervisor";

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
          <NavLink to="/supervisor" label="Approval Console" />
        </div>
      </div>

      <Routes>
        <Route path="/" element={<Navigate to="/nurse" replace />} />
        <Route path="/nurse" element={<Nurse />} />
        <Route path="/supervisor" element={<Supervisor />} />
      </Routes>
    </div>
  );
}