import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import CarrierDetailPage from "./components/CarrierDetail";
import AddressDetailPage from "./components/AddressDetail";
import AboutPage from "./components/About";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/carrier/:dotNumber" element={<CarrierDetailPage />} />
        <Route path="/address/:addressHash" element={<AddressDetailPage />} />
        <Route path="/about" element={<AboutPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
