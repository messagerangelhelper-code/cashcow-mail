import { useCallback, useEffect, useState } from "react";
import { BRAND } from "./brand.js";
import { useAuth, supabase } from "./account.js";
import Account from "./Account.jsx";
import Premium from "./Premium.jsx";
import { isPremium, checkPremiumOnce, syncAccount } from "./premium.js";
import * as api from "./api.js";

const VERDICT = {
  dangerous: ["⛔", "Likely scam", "v-danger"],
  suspicious: ["⚠️", "Be careful", "v-warn"],
  safe: ["✅", "No scam signs", "v-safe"],
};
const when = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function App() {
  const { ready, user } = useAuth();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState("home");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [showGmail, setShowGmail] = useState(false);
  const [localPremium, setLocalPremium] = useState(isPremium);

  const load = useCallback(() => api.me().then((d) => { setInfo(d); setError(""); }).catch((e) => setError(e.message)), []);

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--main", BRAND.colors.main);
    root.setProperty("--main-2", BRAND.colors.mainHover);
    root.setProperty("--soft", BRAND.colors.soft);
    document.title = BRAND.name;
    checkPremiumOnce().then((status) => {
      setLocalPremium(isPremium());
      if (status === "activated") setNotice("Email Guard is active. Thank you! Forward a suspicious email to try it.");
      else if (status === "expired") setNotice("Your Email Guard plan has ended, so checks are paused.");
      load();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT") return;
      syncAccount().then(() => setLocalPremium(isPremium()));
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  useEffect(() => { if (user) load(); else setInfo(null); }, [user, load]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const premium = !!(info?.premium || localPremium);
  const guard = info?.guard_address || "check@mail.cashcowai.online";
  const verified = (info?.addresses || []).filter((a) => a.verified);

  async function add(e) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Please enter a valid email address.");
    setBusy(true); setError("");
    try {
      const r = await api.addAddress(email.trim());
      setEmail("");
      setToast(r.verified ? "That address is already set up." : `Check ${r.email} for a confirmation link.`);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function copyGuard() {
    try { await navigator.clipboard.writeText(guard); setToast("Address copied."); } catch { setToast(guard); }
  }

  let body;
  if (!ready) body = <section className="card"><p className="muted">Loading…</p></section>;
  else if (view === "premium") body = <Premium premium={premium} onBack={() => { setView("home"); load(); }} />;
  else if (!user) body = (
    <>
      <section className="card hero">
        <h1>Is this email a scam?</h1>
        <p>Forward any email to ScamShield and get an answer back in about a minute, with the reasons in plain English.</p>
        <ul className="plain">
          <li>🔗 Spots fake and look-alike links</li>
          <li>🎭 Catches senders pretending to be your bank, Amazon or PayPal</li>
          <li>📎 Flags dangerous attachments and scam wording</li>
          <li>🛡️ Optional: check every new email automatically</li>
        </ul>
      </section>
      <Account premium={false} intro="Sign in or create a free CashCow account to set up Email Guard. The same account works in every CashCow app." />
    </>
  );
  else if (view === "settings") body = (
    <>
      <button type="button" className="link back" onClick={() => setView("home")}>← Back</button>
      <Account premium={premium} />
    </>
  );
  else body = (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {info && !info.ready && <p className="callout">Email Guard is almost ready to open. You can set up your account now.</p>}

      <section className={`card status ${premium && verified.length ? "on" : ""}`}>
        <h1>{premium && verified.length ? "🛡️ Email Guard is on" : "Set up Email Guard"}</h1>
        {premium && verified.length ? (
          <p className="muted">{info?.month?.total || 0} emails checked in the last 30 days{info?.month?.risky ? `, ${info.month.risky} flagged as risky` : ""}.</p>
        ) : (
          <p className="muted">Three quick steps.</p>
        )}
      </section>

      {!premium && (
        <section className="card premium-teaser">
          <h2>Turn on Email Guard</h2>
          <p className="muted">Email checks (up to 300 a day), automatic protection and a history of every check. From $2.99 a month.</p>
          <button type="button" className="btn-primary" onClick={() => setView("premium")}>See plans</button>
        </section>
      )}

      <section className="card">
        <h2><span className="step">1</span> Add your email address</h2>
        <p className="muted small">The address you read your email at. We'll send a link to confirm it's yours. Up to 3 addresses.</p>
        <ul className="rows">
          {(info?.addresses || []).map((a) => (
            <li key={a.id} className="row">
              <span className="row-main">
                <span className="row-title">{a.email}</span>
                <span className={`row-sub ${a.verified ? "ok-text" : "warn-text"}`}>{a.verified ? "✓ Confirmed" : "Waiting for you to tap the link we emailed"}</span>
                {a.verified && (
                  <label className="alerts">
                    <span className="row-sub">Automatic checks: email me about</span>
                    <select value={a.alerts} onChange={async (e) => { try { await api.setAlerts(a.id, e.target.value); await load(); setToast("Saved."); } catch (err) { setError(err.message); } }}>
                      <option value="risky">Risky emails only</option>
                      <option value="all">Every email</option>
                    </select>
                  </label>
                )}
              </span>
              <span className="row-actions">
                {!a.verified && <button type="button" className="link small" onClick={async () => { try { await api.addAddress(a.email); setToast("Sent another link."); } catch (err) { setError(err.message); } }}>Resend</button>}
                <button type="button" className="link danger small" aria-label={`Remove ${a.email}`} onClick={async () => {
                  if (!window.confirm(`Remove ${a.email} from Email Guard?`)) return;
                  try { await api.removeAddress(a.id); await load(); } catch (err) { setError(err.message); }
                }}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
        {(info?.addresses || []).length < 3 && (
          <form className="add-row" onSubmit={add}>
            <label className="sr-only" htmlFor="addr">Your email address</label>
            <input id="addr" type="email" value={email} maxLength={254} placeholder="you@gmail.com" autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
          </form>
        )}
      </section>

      <section className="card">
        <h2><span className="step">2</span> Forward any email you're not sure about</h2>
        <p className="muted small">From a confirmed address, forward the email to:</p>
        <div className="guard-addr">
          <code>{guard}</code>
          <button type="button" className="btn-secondary small-btn" onClick={copyGuard}>Copy</button>
        </div>
        <p className="muted small">Tip: save it as a contact named "ScamShield" so it's easy to find. You'll get an answer by email in about a minute.</p>
      </section>

      <section className="card">
        <h2><span className="step">3</span> Optional: check every email automatically</h2>
        <p className="muted small">With Gmail, a copy of each new email comes to ScamShield. You keep all your mail, and you only hear from us when something looks wrong.</p>
        <button type="button" className="link" aria-expanded={showGmail} onClick={() => setShowGmail((v) => !v)}>{showGmail ? "Hide Gmail steps ▲" : "Show Gmail steps ▼"}</button>
        {showGmail && (
          <ol className="steps">
            <li>Finish step 1 first, so your Gmail address shows as confirmed.</li>
            <li>On a computer, open Gmail → ⚙️ <strong>Settings</strong> → <strong>See all settings</strong> → <strong>Forwarding and POP/IMAP</strong>.</li>
            <li>Tap <strong>Add a forwarding address</strong> and enter <code>{guard}</code>.</li>
            <li>We'll email you the confirmation code Gmail sends us. Enter it in Gmail and tap <strong>Verify</strong>.</li>
            <li>Choose <strong>Forward a copy of incoming mail to</strong> {guard}, and <strong>keep Gmail's copy in the Inbox</strong>. Then <strong>Save Changes</strong>.</li>
          </ol>
        )}
        <p className="muted small">Using Outlook, Yahoo or iPhone Mail? Forwarding each suspicious email (step 2) works with any email app.</p>
      </section>

      <section className="card">
        <h2>Recent checks</h2>
        {!info ? <p className="muted">Loading…</p> : info.checks.length === 0 ? <p className="muted">No checks yet. Forward an email to try it.</p> : (
          <ul className="rows">
            {info.checks.map((c) => (
              <li key={c.id} className={`row check ${VERDICT[c.verdict][2]}`}>
                <span className="row-main">
                  <span className="row-title">{VERDICT[c.verdict][0]} {VERDICT[c.verdict][1]}: {c.subject || "(no subject)"}</span>
                  <span className="row-sub">From {c.from_addr || "unknown"} · {when(c.checked_at)} · {c.mode === "auto" ? "automatic" : "you forwarded it"}</span>
                  {c.flags.length > 0 && <span className="row-sub flags">{c.flags.slice(0, 3).join("; ")}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="disclaimer">
        We don't keep your emails. For each check we save only the sender, subject and result, so you can see your history.
        No automatic check catches every scam. When in doubt, contact the company using a phone number or website you already know.
      </p>
    </>
  );

  return (
    <div className="app">
      <header className="top">
        <button type="button" className="brand" onClick={() => setView("home")} aria-label={`${BRAND.name} home`}>
          <span className="logo" aria-hidden="true">🛡️</span>
          <span>{BRAND.name}</span>
        </button>
        {user && <button type="button" className="link light" onClick={() => setView("settings")}>Account</button>}
      </header>
      <main>
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button type="button" className="link" onClick={() => setNotice("")} aria-label="Dismiss">✕</button>
          </div>
        )}
        {body}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
