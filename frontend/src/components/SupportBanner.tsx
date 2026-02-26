import { useState } from "react";

const ERC20 = "0x01637b42EC8D88D35fa3b1C1A551E6440C82e75c";
const BTC = "bc1qjg3cvxhx4vrfgx64h6q5mrvf09rg2wqumy6s5l";
const STORAGE_KEY = "support_banner_dismissed";

export default function SupportBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "1"
  );
  const [copied, setCopied] = useState<"erc20" | "btc" | null>(null);

  if (dismissed) return null;

  function copy(type: "erc20" | "btc") {
    navigator.clipboard.writeText(type === "erc20" ? ERC20 : BTC);
    setCopied(type);
    window.setTimeout(() => setCopied(null), 2000);
  }

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="support-banner">
      <span className="support-banner-label">Support CarrierWatch</span>
      <button className="support-addr-btn" onClick={() => copy("btc")} title={BTC}>
        <span className="support-coin">BTC</span>
        <span className="support-addr">{BTC.slice(0, 14)}…</span>
        <span className="support-copy">{copied === "btc" ? "Copied!" : "Copy"}</span>
      </button>
      <button className="support-addr-btn" onClick={() => copy("erc20")} title={ERC20}>
        <span className="support-coin">ETH/ERC20</span>
        <span className="support-addr">{ERC20.slice(0, 12)}…</span>
        <span className="support-copy">{copied === "erc20" ? "Copied!" : "Copy"}</span>
      </button>
      <button className="support-banner-close" onClick={dismiss} title="Dismiss">×</button>
    </div>
  );
}
