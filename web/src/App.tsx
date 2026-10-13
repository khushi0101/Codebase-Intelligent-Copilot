import { Route, Routes } from "react-router-dom";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { CodeDrawer } from "./components/CodeDrawer";
import { useApp } from "./lib/app-context";
import { AskPage } from "./pages/AskPage";
import { ExplorePage } from "./pages/ExplorePage";
import { RetrievalPage } from "./pages/RetrievalPage";
import { ReposPage } from "./pages/ReposPage";
import { InsightsPage } from "./pages/InsightsPage";
import { SettingsPage } from "./pages/SettingsPage";

function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "success" ? <CheckCircle2 size={16} /> : t.kind === "error" ? <AlertTriangle size={16} /> : <Info size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<AskPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/retrieval" element={<RetrievalPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/repos" element={<ReposPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<AskPage />} />
        </Routes>
      </main>
      <CodeDrawer />
      <Toasts />
    </div>
  );
}
