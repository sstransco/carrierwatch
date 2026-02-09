import { useState } from "react";
import Filters from "./Filters";
import Leaderboard from "./Leaderboard";

interface SidebarProps {
  onFlyTo: (lng: number, lat: number, zoom?: number) => void;
}

export default function Sidebar({ onFlyTo }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<"leaderboard" | "filters">("leaderboard");

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${activeTab === "leaderboard" ? "active" : ""}`}
          onClick={() => setActiveTab("leaderboard")}
        >
          Flagged Addresses
        </button>
        <button
          className={`sidebar-tab ${activeTab === "filters" ? "active" : ""}`}
          onClick={() => setActiveTab("filters")}
        >
          Filters
        </button>
      </div>
      <div className="sidebar-content">
        {activeTab === "leaderboard" ? (
          <Leaderboard onFlyTo={onFlyTo} />
        ) : (
          <Filters />
        )}
      </div>
    </div>
  );
}
