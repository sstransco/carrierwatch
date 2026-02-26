import { useState } from "react";
import Leaderboard from "./Leaderboard";
import RiskLeaderboard from "./RiskLeaderboard";

interface SidebarProps {
  onFlyTo: (lng: number, lat: number, zoom?: number) => void;
  open?: boolean;
  onClose?: () => void;
  activeOnly: boolean;
}

export default function Sidebar({ onFlyTo, open, onClose, activeOnly }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<"leaderboard" | "risk">("leaderboard");

  return (
    <div className={`sidebar ${open ? "open" : ""}`}>
      <button className="sidebar-close" onClick={onClose}>&times;</button>
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${activeTab === "leaderboard" ? "active" : ""}`}
          onClick={() => setActiveTab("leaderboard")}
        >
          Flagged Addresses
        </button>
        <button
          className={`sidebar-tab ${activeTab === "risk" ? "active" : ""}`}
          onClick={() => setActiveTab("risk")}
        >
          Top Risk
        </button>
      </div>
      <div className="sidebar-content">
        {activeTab === "leaderboard" ? (
          <Leaderboard onFlyTo={onFlyTo} activeOnly={activeOnly} />
        ) : (
          <RiskLeaderboard onFlyTo={onFlyTo} />
        )}
      </div>
    </div>
  );
}
