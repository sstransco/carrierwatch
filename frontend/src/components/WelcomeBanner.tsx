import { useState, useEffect } from "react";

const STORAGE_KEY = "cw_welcome_dismissed";

export default function WelcomeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(STORAGE_KEY, "1");
  };

  return (
    <div className="welcome-overlay" onClick={dismiss}>
      <div className="welcome-card" onClick={(e) => e.stopPropagation()}>
        <div className="welcome-badge">PUBLIC INTELLIGENCE TOOL</div>
        <h1>
          Carrier<span className="accent">Watch</span>
        </h1>
        <p className="welcome-tagline">
          Mapping every FMCSA-registered motor carrier in the United States
        </p>
        <div className="welcome-stats">
          <div className="welcome-stat">
            <strong>4.3M+</strong>
            <span>Carriers Tracked</span>
          </div>
          <div className="welcome-stat">
            <strong>8.2M+</strong>
            <span>Inspections</span>
          </div>
          <div className="welcome-stat">
            <strong>30M+</strong>
            <span>Federal Records</span>
          </div>
        </div>
        <p className="welcome-desc">
          Cross-referencing crash history, inspections, insurance lapses, PPP loans,
          and address patterns to expose chameleon carriers and fraud.
        </p>
        <button className="welcome-cta" onClick={dismiss}>
          Explore the Map
        </button>
        <p className="welcome-free">100% free. 100% public data.</p>
      </div>
    </div>
  );
}
