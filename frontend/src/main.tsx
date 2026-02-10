import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import "./styles/index.css";

const CarrierDetailPage = lazy(() => import("./components/CarrierDetail"));
const AddressDetailPage = lazy(() => import("./components/AddressDetail"));
const AboutPage = lazy(() => import("./components/About"));
const PrincipalsLeaderboard = lazy(() => import("./components/PrincipalsLeaderboard"));
const CDLSchoolsPage = lazy(() => import("./components/CDLSchools"));
const NetworkGraphPage = lazy(() => import("./components/NetworkGraph"));
const FraudSpotlightPage = lazy(() => import("./components/FraudSpotlight"));

const Loading = () => (
  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#0a0a0a", color: "#888" }}>
    Loading…
  </div>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/carrier/:dotNumber" element={<CarrierDetailPage />} />
          <Route path="/address/:addressHash" element={<AddressDetailPage />} />
          <Route path="/principals" element={<PrincipalsLeaderboard />} />
          <Route path="/cdl-schools" element={<CDLSchoolsPage />} />
          <Route path="/network/:officerName" element={<NetworkGraphPage />} />
          <Route path="/network" element={<NetworkGraphPage />} />
          <Route path="/spotlight" element={<FraudSpotlightPage />} />
          <Route path="/about" element={<AboutPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>,
);
