import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { api, type AppConfig } from "../lib/api";
import { useApp } from "../lib/app-context";
import { getUserKey, setUserKey } from "../lib/userKey";
import { PageHeader, Spinner } from "../components/ui";

function KeySection() {
  const { health, toast } = useApp();
  const [value, setValue] = useState(getUserKey() ?? "");
  const [show, setShow] = useState(false);
  const saved = getUserKey();

  return (
    <section className="card section">
      <div className="section-head">
        <h2>
          <KeyRound size={17} /> Your Gemini API key <span className="pill">optional</span>
        </h2>
      </div>
      <p className="muted small">
        {health?.public
          ? "This demo answers with a shared free-tier key, which is rate-limited. Add your own key to skip the limits."
          : "Overrides the server's GEMINI_API_KEY for questions you ask from this browser."}{" "}
        It's stored only in this browser and sent with each question over HTTPS. The server uses it for that one request
        and never stores or logs it. Get a free key at{" "}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
          aistudio.google.com/apikey
        </a>
        .
      </p>
      <form
        className="row gap-s"
        onSubmit={(e) => {
          e.preventDefault();
          setUserKey(value.trim() || null);
          toast(value.trim() ? "Key saved in this browser" : "Key removed", "success");
        }}
      >
        <div className="input-with-btn">
          <input
            className="input mono"
            type={show ? "text" : "password"}
            placeholder="AIza…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="icon-btn sm" onClick={() => setShow((s) => !s)} aria-label="Show key">
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <button className="btn btn-primary">Save</button>
        {saved && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setUserKey(null);
              setValue("");
              toast("Key removed", "success");
            }}
          >
            Remove
          </button>
        )}
      </form>
    </section>
  );
}

export function SettingsPage() {
  const { health, serverDown } = useApp();
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    api
      .config()
      .then((c) => {
        setCfg(c);
        setVersion(c.settings["Prompt version"] as string);
      })
      .catch(() => {});
  }, []);

  const checks = [
    { label: "API server", ok: !serverDown, hint: "codecopilot serve" },
    { label: "Postgres + pgvector", ok: !!health?.database, hint: "CODECOPILOT_DB_* in .env" },
    { label: "Gemini key", ok: !!health?.llm_key || !!getUserKey(), hint: "GEMINI_API_KEY in .env, or add yours below" },
  ];

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Configuration is read from environment variables (CODECOPILOT_*) at server start." />

      <section className="card section">
        <div className="section-head">
          <h2>System status</h2>
        </div>
        <div className="checks">
          {checks.map((c) => (
            <div key={c.label} className="check">
              <span className={`dot ${c.ok ? "good" : "bad"}`} />
              <span>{c.label}</span>
              {!c.ok && <span className="muted small mono">{c.hint}</span>}
            </div>
          ))}
        </div>
      </section>

      <KeySection />

      <section className="card section">
        <div className="section-head">
          <h2>Configuration</h2>
        </div>
        {!cfg ? (
          <Spinner />
        ) : (
          <dl className="kv">
            {Object.entries(cfg.settings).map(([k, v]) => (
              <div key={k} className="kv-row">
                <dt>{k}</dt>
                <dd className="mono">{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {cfg && (
        <section className="card section">
          <div className="section-head">
            <div>
              <h2>Prompt template</h2>
              <p className="muted small">
                Versioned in <code>prompts/</code>. Every trace records which version produced the answer.
              </p>
            </div>
            {cfg.prompt_versions.length > 1 && (
              <select className="input select" value={version} onChange={(e) => setVersion(e.target.value)}>
                {cfg.prompt_versions.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            )}
          </div>
          <pre className="prompt-view">{cfg.prompts[version]}</pre>
        </section>
      )}
    </div>
  );
}
