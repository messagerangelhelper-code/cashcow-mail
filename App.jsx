import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, supabase } from "./account.js";
import Account from "./Account.jsx";
import * as api from "./api.js";

const STATUS_LABEL = { subscribed: "Subscribed", pending: "Waiting to confirm", unsubscribed: "Unsubscribed", bounced: "Bounced", complained: "Marked as spam" };
const CAMPAIGN_LABEL = { draft: "Draft", scheduled: "Scheduled", sending: "Sending…", sent: "Sent", canceled: "Canceled" };
const VERDICT = { safe: ["✅", "Safe"], suspicious: ["⚠️", "Be careful"], dangerous: ["⛔", "Dangerous"] };
const CATEGORY = { lead: "Lead", reply: "Reply", unsubscribe: "Unsubscribe request", auto: "Auto-reply", spam: "Spam / scam" };
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const EMPTY = { name: "", subject: "", preheader: "", body: "", audience: [] };

const FORMAT_HELP = `# Big heading
## Smaller heading
Plain text becomes paragraphs. Leave a blank line between them.
**bold**  *italic*  [link text](https://...)
- bullet point
[[Button text|https://...]]
---  (a divider line)
{{first_name}}  {{name}}  {{email}}  (filled in for each person)`;

function ScanReport({ report }) {
  if (!report) return null;
  return (
    <section className="card scan">
      <div className="scan-head">
        <span className={`grade grade-${report.grade}`}>{report.grade}</span>
        <div>
          <h2>Scan result</h2>
          <p className="muted small">
            {report.blockers.length ? "Fix the red items before you can send." : report.warnings.length ? "Ready to send. The yellow items are worth fixing." : "Ready to send."}
            {typeof report.audience_count === "number" && ` Goes to ${report.audience_count} ${report.audience_count === 1 ? "person" : "people"}.`}
          </p>
        </div>
      </div>
      {report.blockers.length > 0 && (
        <>
          <h3 className="bad">Must fix</h3>
          <ul className="findings">{report.blockers.map((b) => <li key={b} className="bad">⛔ {b}</li>)}</ul>
        </>
      )}
      {report.warnings.length > 0 && (
        <>
          <h3 className="warn">Should fix</h3>
          <ul className="findings">{report.warnings.map((w) => <li key={w} className="warn">⚠️ {w}</li>)}</ul>
        </>
      )}
      {report.passes.length > 0 && (
        <>
          <h3 className="good">Looks good</h3>
          <ul className="findings">{report.passes.map((p) => <li key={p} className="good">✅ {p}</li>)}</ul>
        </>
      )}
    </section>
  );
}

function Editor({ id, info, onBack, onChanged }) {
  const [c, setC] = useState(EMPTY);
  const [meta, setMeta] = useState(null); // full campaign row
  const [count, setCount] = useState(null);
  const [report, setReport] = useState(null);
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [at, setAt] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const load = useCallback(async (cid) => {
    const got = await api.getCampaign(cid);
    const row = got.campaign;
    setMeta(row);
    setCount(got.audience_count);
    setC({ name: row.name, subject: row.subject, preheader: row.preheader, body: row.body, audience: row.audience || [] });
    setReport(row.scan);
    setDirty(false);
    return row;
  }, []);

  useEffect(() => {
    if (id) load(id).then((row) => api.preview(row).then((p) => setHtml(p.html))).catch((e) => setError(e.message));
  }, [id, load]);

  // Keep the numbers moving while it sends.
  useEffect(() => {
    if (!meta || !["sending", "scheduled"].includes(meta.status)) return undefined;
    const t = setInterval(() => load(meta.id).then(onChanged).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [meta, load, onChanged]);

  const locked = meta && !["draft", "canceled"].includes(meta.status);
  const set = (k, v) => { setC((x) => ({ ...x, [k]: v })); setDirty(true); setNote(""); };

  async function run(label, fn) {
    setBusy(label); setError(""); setNote("");
    try { return await fn(); } catch (e) { setError(e.message); return null; } finally { setBusy(""); }
  }
  async function save() {
    const saved = await api.saveCampaign({ ...(meta ? { id: meta.id } : {}), ...c });
    const row = await load(saved.id);
    onChanged(row);
    setReport(null);
    const p = await api.preview(c);
    setHtml(p.html);
    return row;
  }
  const doSave = () => run("save", async () => { await save(); setNote("Saved. Scan it before sending."); });
  const doScan = () => run("scan", async () => {
    const row = dirty || !meta ? await save() : meta;
    const r = await api.scan(row.id);
    setReport(r);
    await load(row.id);
  });
  const doTest = () => run("test", async () => {
    const row = dirty || !meta ? await save() : meta;
    const r = await api.sendTest(row.id);
    setNote(`Test sent to ${r.to}. Check your inbox (and spam folder).`);
  });
  const doSend = (scheduled) => run("send", async () => {
    if (scheduled && !at) throw new Error("Pick a date and time first.");
    const iso = scheduled ? new Date(at).toISOString() : "";
    if (scheduled && new Date(at) < new Date()) throw new Error("Pick a time in the future.");
    const who = `${count} ${count === 1 ? "person" : "people"}`;
    if (!window.confirm(scheduled ? `Schedule this campaign for ${new Date(at).toLocaleString()} to ${who}?` : `Send this campaign now to ${who}? This can't be undone.`)) return;
    await api.send(meta.id, iso);
    const row = await load(meta.id);
    onChanged(row);
    setNote(scheduled ? "Scheduled." : "Sending now. The numbers update every few seconds.");
  });
  const doCancel = () => run("cancel", async () => {
    if (!window.confirm(meta.status === "sending" ? "Stop sending? People who already got it keep it." : "Cancel the schedule? It goes back to a draft.")) return;
    await api.cancel(meta.id);
    onChanged(await load(meta.id));
  });
  const doDelete = () => run("delete", async () => {
    if (!window.confirm("Delete this draft?")) return;
    await api.remove(meta.id);
    onChanged(null);
    onBack();
  });

  const tags = info?.tags || {};
  const canSend = meta && meta.status === "draft" && !dirty && report && report.blockers.length === 0;

  return (
    <>
      <button type="button" className="link back" onClick={onBack}>← All campaigns</button>
      <section className="card">
        <div className="row-between">
          <h1>{meta ? meta.name : "New campaign"}</h1>
          {meta && <span className={`pill pill-${meta.status}`}>{CAMPAIGN_LABEL[meta.status]}</span>}
        </div>
        {meta && ["sending", "sent"].includes(meta.status) && (
          <p className="stats"><strong>{meta.sent_count}</strong> sent{meta.failed_count > 0 && <> · <strong>{meta.failed_count}</strong> couldn't be delivered</>}{meta.finished_at && ` · finished ${when(meta.finished_at)}`}</p>
        )}
        {meta?.status === "scheduled" && <p className="stats">Goes out {when(meta.scheduled_at)}.</p>}
        {locked && <p className="muted small">This campaign is {CAMPAIGN_LABEL[meta.status].toLowerCase()}, so it can't be edited.</p>}

        <div className="field"><label className="label" htmlFor="c-name">Campaign name (only you see this)</label>
          <input id="c-name" value={c.name} maxLength={100} disabled={locked} placeholder="Fall home tips" onChange={(e) => set("name", e.target.value)} /></div>
        <div className="field"><label className="label" htmlFor="c-subject">Subject line</label>
          <input id="c-subject" value={c.subject} maxLength={200} disabled={locked} placeholder="5 fall jobs that save you money" onChange={(e) => set("subject", e.target.value)} />
          <p className="muted small">{c.subject.length} characters. Under 50 reads best on phones.</p></div>
        <div className="field"><label className="label" htmlFor="c-pre">Preview text (the gray line after the subject)</label>
          <input id="c-pre" value={c.preheader} maxLength={200} disabled={locked} placeholder="Gutters, filters and a free checklist" onChange={(e) => set("preheader", e.target.value)} /></div>
        <div className="field">
          <div className="row-between">
            <label className="label" htmlFor="c-body">Email</label>
            <button type="button" className="link small" onClick={() => setShowHelp((v) => !v)}>{showHelp ? "Hide" : "How to format"}</button>
          </div>
          {showHelp && <pre className="help">{FORMAT_HELP}</pre>}
          <textarea id="c-body" rows={14} value={c.body} disabled={locked} placeholder={"Hi {{first_name}},\n\nWrite your email here. Paste in a draft from the weekly marketing doc if you like."} onChange={(e) => set("body", e.target.value)} />
        </div>
        <fieldset className="field" disabled={locked}>
          <legend className="label">Who gets it</legend>
          <p className="muted small">Pick apps to send only to people interested in them. Pick none to send to everyone subscribed.</p>
          <div className="chips">
            {Object.entries(tags).map(([tag, label]) => {
              const on = c.audience.includes(tag);
              return <button key={tag} type="button" className={on ? "chip on" : "chip"} aria-pressed={on}
                onClick={() => set("audience", on ? c.audience.filter((x) => x !== tag) : [...c.audience, tag])}>{label}</button>;
            })}
          </div>
          {count !== null && !dirty && <p className="muted small">Right now this goes to <strong>{count}</strong> {count === 1 ? "person" : "people"}.</p>}
        </fieldset>

        {error && <p className="error" role="alert">{error}</p>}
        {note && <p className="ok" role="status">{note}</p>}
        {!locked && (
          <div className="button-row">
            <button type="button" className="btn-secondary" disabled={!!busy} onClick={doSave}>{busy === "save" ? "Saving…" : "Save draft"}</button>
            <button type="button" className="btn-primary" disabled={!!busy || !c.subject.trim()} onClick={doScan}>{busy === "scan" ? "Scanning…" : "🔍 Scan"}</button>
            <button type="button" className="btn-secondary" disabled={!!busy || !info?.ses_ready} onClick={doTest}>{busy === "test" ? "Sending…" : "Send me a test"}</button>
            {meta && meta.status !== "sent" && <button type="button" className="link danger" onClick={doDelete}>Delete</button>}
          </div>
        )}
        {meta && ["scheduled", "sending"].includes(meta.status) && (
          <div className="button-row"><button type="button" className="btn-secondary" onClick={doCancel}>{meta.status === "sending" ? "Stop sending" : "Cancel schedule"}</button></div>
        )}
      </section>

      <ScanReport report={dirty ? null : report} />
      {dirty && report && <p className="muted small center">You changed the campaign. Scan again before sending.</p>}

      {meta && meta.status === "draft" && (
        <section className="card">
          <h2>Send it</h2>
          {!canSend && <p className="muted">{dirty ? "Save and scan your changes first." : !report ? "Scan the campaign first." : "Fix the red items in the scan first."}</p>}
          <div className="button-row">
            <button type="button" className="btn-primary" disabled={!canSend || !!busy} onClick={() => doSend(false)}>{busy === "send" ? "Starting…" : "Send now"}</button>
          </div>
          <div className="field schedule">
            <label className="label" htmlFor="c-at">Or schedule it</label>
            <input id="c-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            <button type="button" className="btn-secondary" disabled={!canSend || !!busy || !at} onClick={() => doSend(true)}>Schedule</button>
          </div>
          <p className="muted small">Scheduled campaigns go out within a minute or two of the time while the CashCow server is awake.</p>
        </section>
      )}

      {html && (
        <section className="card">
          <h2>Preview</h2>
          <p className="muted small">As it will look in an inbox (shown with a sample name).</p>
          <iframe title="Email preview" className="preview" sandbox="" srcDoc={html} />
        </section>
      )}
    </>
  );
}

function Campaigns({ info }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(undefined); // undefined = list, null = new, id = edit
  const [error, setError] = useState("");
  const refresh = useCallback(() => api.campaigns().then(setList).catch((e) => setError(e.message)), []);
  useEffect(() => { refresh(); }, [refresh]);
  if (open !== undefined) return <Editor id={open} info={info} onBack={() => { setOpen(undefined); refresh(); }} onChanged={() => refresh()} />;
  return (
    <section className="card">
      <div className="row-between">
        <h1>Campaigns</h1>
        <button type="button" className="btn-primary small-btn" onClick={() => setOpen(null)}>+ New campaign</button>
      </div>
      {error && <p className="error">{error}</p>}
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="muted">No campaigns yet. Start one, scan it, send yourself a test, then send.</p> : (
        <ul className="rows">
          {list.map((c) => (
            <li key={c.id} className="row">
              <button type="button" className="row-main" onClick={() => setOpen(c.id)}>
                <span className="row-title">{c.name}</span>
                <span className="row-sub">{c.subject || "No subject yet"}</span>
                <span className="row-sub">
                  {c.status === "sent" ? `Sent ${when(c.finished_at)} · ${c.sent_count} delivered` : c.status === "scheduled" ? `Goes out ${when(c.scheduled_at)}` : c.status === "sending" ? `${c.sent_count} sent so far` : `Edited ${when(c.updated_at)}`}
                </span>
              </button>
              <span className="row-end">
                <span className={`pill pill-${c.status}`}>{CAMPAIGN_LABEL[c.status]}</span>
                {c.grade && <span className={`grade small-grade grade-${c.grade}`}>{c.grade}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Subscribers({ info }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [paste, setPaste] = useState("");
  const [addTags, setAddTags] = useState([]);
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState("");
  const timer = useRef(null);

  const load = useCallback((qq, st, off) => api.subscribers(qq, st, off).then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load(q, status, offset), 300);
    return () => clearTimeout(timer.current);
  }, [q, status, offset, load]);

  async function add(e) {
    e.preventDefault();
    setError(""); setResult("");
    const rows = paste.split(/\n+/).map((line) => {
      const [email, ...rest] = line.split(/[,;\t]/).map((s) => s.trim());
      return email ? { email, name: rest.join(" ").trim(), tags: addTags } : null;
    }).filter(Boolean);
    if (!rows.length) return setError("Paste at least one email address.");
    try {
      const r = await api.addSubscribers(rows, consent);
      setResult(`Added ${r.added}. ${r.skipped ? `${r.skipped} already on the list (left as they were). ` : ""}${r.invalid ? `${r.invalid} weren't valid emails.` : ""}`);
      setPaste(""); setConsent(false); load(q, status, offset);
    } catch (err) { setError(err.message); }
  }

  const tags = info?.tags || {};
  return (
    <>
      <section className="card">
        <div className="row-between">
          <h1>Subscribers</h1>
          <button type="button" className="btn-secondary small-btn" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "+ Add people"}</button>
        </div>
        {adding && (
          <form className="add-form" onSubmit={add}>
            <label className="label" htmlFor="paste">One person per line: email, then name (optional)</label>
            <textarea id="paste" rows={5} value={paste} placeholder={"dana@example.com, Dana Smith\nkim@example.com"} onChange={(e) => setPaste(e.target.value)} />
            <p className="label">Interested in (optional)</p>
            <div className="chips">
              {Object.entries(tags).map(([tag, label]) => {
                const on = addTags.includes(tag);
                return <button key={tag} type="button" className={on ? "chip on" : "chip"} aria-pressed={on} onClick={() => setAddTags(on ? addTags.filter((x) => x !== tag) : [...addTags, tag])}>{label}</button>;
              })}
            </div>
            <label className="toggle">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>These people agreed to get email from CashCow. (The law requires it, and emailing people who didn't agree gets your account suspended.)</span>
            </label>
            <button type="submit" className="btn-primary" disabled={!consent}>Add to list</button>
            {result && <p className="ok">{result}</p>}
          </form>
        )}
        <div className="filters">
          <label className="sr-only" htmlFor="sq">Search</label>
          <input id="sq" type="search" value={q} placeholder="Search email or name" onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
          <label className="sr-only" htmlFor="sst">Status</label>
          <select id="sst" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
            <option value="">Everyone</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {error && <p className="error">{error}</p>}
        {data === null ? <p className="muted">Loading…</p> : (
          <>
            <p className="muted small">{data.total} {data.total === 1 ? "person" : "people"}</p>
            <ul className="rows">
              {data.rows.map((s) => (
                <li key={s.id} className="row">
                  <span className="row-main static">
                    <span className="row-title">{s.email}</span>
                    <span className="row-sub">{[s.name, STATUS_LABEL[s.status], s.tags.map((t) => tags[t] || t).join(", ")].filter(Boolean).join(" · ")}</span>
                  </span>
                  {["subscribed", "pending"].includes(s.status) && (
                    <button type="button" className="link danger small" onClick={async () => {
                      if (!window.confirm(`Unsubscribe ${s.email}? Only they can sign up again.`)) return;
                      try { await api.updateSubscriber(s.id, { unsubscribe: true }); load(q, status, offset); } catch (err) { setError(err.message); }
                    }}>Unsubscribe</button>
                  )}
                </li>
              ))}
            </ul>
            <div className="button-row">
              {offset > 0 && <button type="button" className="btn-secondary small-btn" onClick={() => setOffset(Math.max(0, offset - 50))}>← Newer</button>}
              {offset + 50 < data.total && <button type="button" className="btn-secondary small-btn" onClick={() => setOffset(offset + 50)}>Older →</button>}
            </div>
          </>
        )}
      </section>
    </>
  );
}

function Inbox({ info }) {
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState("new");
  const [error, setError] = useState("");
  const refresh = useCallback(() => api.inbox().then(setList).catch((e) => setError(e.message)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const shown = (list || []).filter((m) => filter === "all" || (filter === "new" ? m.status === "new" : m.verdict !== "safe"));
  return (
    <section className="card">
      <h1>Scanned inbox</h1>
      <p className="muted small">
        Replies to your campaigns are checked like ScamShield. Scams and spam stay here and never reach you. Unsubscribe
        requests are handled automatically. Leads and replies are forwarded to your email with a safety note.
      </p>
      {!info?.inbox_ready && <p className="callout small">Not connected yet: set MAIL_REPLY_TO and MAIL_FORWARD_TO on Render and finish the Amazon receiving steps in the setup guide.</p>}
      <div className="chips">
        {[["new", "New"], ["risky", "Scams & suspicious"], ["all", "Everything"]].map(([k, label]) => (
          <button key={k} type="button" className={filter === k ? "chip on" : "chip"} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {list === null ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">Nothing here.</p> : (
        <ul className="rows">
          {shown.map((m) => (
            <li key={m.id} className={`row msg msg-${m.verdict}`}>
              <span className="row-main static">
                <span className="row-title">{VERDICT[m.verdict][0]} {m.subject || "(no subject)"}</span>
                <span className="row-sub">{m.from_name ? `${m.from_name} · ` : ""}{m.from_addr} · {when(m.received_at)}</span>
                <span className="row-sub"><span className={`pill pill-cat-${m.category}`}>{CATEGORY[m.category]}</span> {VERDICT[m.verdict][1]}{m.forwarded ? " · forwarded to you" : ""}</span>
                {m.flags.length > 0 && <span className="row-sub flags">Why: {m.flags.join("; ")}</span>}
                {m.snippet && <span className="row-sub snippet">“{m.snippet.slice(0, 220)}{m.snippet.length > 220 ? "…" : ""}”</span>}
              </span>
              {m.status === "new" && (
                <button type="button" className="btn-secondary small-btn" onClick={async () => { await api.updateInbox(m.id, "done").catch((e) => setError(e.message)); refresh(); }}>Done</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Dashboard({ info, go }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api.summary().then(setS).catch((e) => setError(e.message)); }, []);
  const subs = s?.subscribers || {};
  const tags = info?.tags || {};
  return (
    <>
      {error && <p className="error">{error}</p>}
      <section className="stat-grid">
        <div className="stat"><strong>{subs.subscribed || 0}</strong><span>Subscribed</span></div>
        <div className="stat"><strong>{subs.pending || 0}</strong><span>Waiting to confirm</span></div>
        <div className="stat"><strong>{(subs.unsubscribed || 0) + (subs.bounced || 0) + (subs.complained || 0)}</strong><span>Unsubscribed or bounced</span></div>
        <button type="button" className="stat stat-btn" onClick={() => go("inbox")}><strong>{s?.inbox_new || 0}</strong><span>New in inbox</span></button>
      </section>
      <section className="card">
        <div className="row-between">
          <h2>Recent campaigns</h2>
          <button type="button" className="btn-primary small-btn" onClick={() => go("campaigns")}>Campaigns</button>
        </div>
        {!s ? <p className="muted">Loading…</p> : s.campaigns.length === 0 ? <p className="muted">No campaigns yet.</p> : (
          <ul className="rows">
            {s.campaigns.map((c) => (
              <li key={c.id} className="row"><span className="row-main static"><span className="row-title">{c.name}</span>
                <span className="row-sub">{CAMPAIGN_LABEL[c.status]}{c.status === "sent" ? ` · ${c.sent_count} delivered` : ""}</span></span></li>
            ))}
          </ul>
        )}
      </section>
      {s && Object.keys(s.tags).length > 0 && (
        <section className="card">
          <h2>Interested in</h2>
          <ul className="rows">
            {Object.entries(s.tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
              <li key={t} className="row"><span className="row-main static"><span className="row-title">{tags[t] || t}</span></span><strong>{n}</strong></li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Setup({ info }) {
  const items = [
    [info.ses_ready, "Amazon SES connected (AWS_SES_ACCESS_KEY_ID, AWS_SES_SECRET_ACCESS_KEY, MAIL_FROM)"],
    [info.address_set, "Mailing address set (MAIL_POSTAL_ADDRESS), required by law"],
    [info.webhook_set, "Webhook key set (MAIL_WEBHOOK_KEY), so bounces and complaints are handled"],
    [info.inbox_ready, "Scanned inbox set up (MAIL_REPLY_TO and MAIL_FORWARD_TO), optional"],
  ];
  if (items.slice(0, 3).every(([ok]) => ok)) return null; // the inbox is optional; its tab says how
  return (
    <section className="card setup">
      <h2>Finish setup</h2>
      <ul className="findings">{items.map(([ok, text]) => <li key={text} className={ok ? "good" : "warn"}>{ok ? "✅" : "⬜"} {text}</li>)}</ul>
      <p className="muted small">These are set on Render: cashcow-reviews-api → Environment. Follow the setup guide.</p>
    </section>
  );
}

export default function App() {
  const { ready, user } = useAuth();
  const [info, setInfo] = useState(null);
  const [denied, setDenied] = useState("");
  const [tab, setTab] = useState("dashboard");

  useEffect(() => {
    document.title = "CashCow Mail";
    if (!user) { setInfo(null); setDenied(""); return; }
    api.me().then((d) => { setInfo(d); setDenied(""); }).catch((e) => setDenied(e.message));
  }, [user]);

  let body;
  if (!ready) body = <section className="card"><p className="muted">Loading…</p></section>;
  else if (!user) body = <Account premium={false} intro="CashCow Mail is private. Sign in with the CashCow account that's set as an admin on the server." />;
  else if (denied) body = (
    <section className="card">
      <h1>No access</h1>
      <p>{denied}</p>
      <p className="muted small">Signed in as {user.email}. Add this email to MAIL_ADMIN_EMAILS on Render if it should have access.</p>
      <button type="button" className="btn-secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </section>
  );
  else if (!info) body = <section className="card"><p className="muted">Waking up the CashCow server…</p></section>;
  else body = (
    <>
      <Setup info={info} />
      <nav className="tabs" aria-label="CashCow Mail">
        {[["dashboard", "Home"], ["campaigns", "Campaigns"], ["subscribers", "People"], ["inbox", "Inbox"]].map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "tab on" : "tab"} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      {tab === "dashboard" && <Dashboard info={info} go={setTab} />}
      {tab === "campaigns" && <Campaigns info={info} />}
      {tab === "subscribers" && <Subscribers info={info} />}
      {tab === "inbox" && <Inbox info={info} />}
    </>
  );

  return (
    <div className="app">
      <header className="top">
        <span className="brand">✉️ CashCow Mail</span>
        {user && <button type="button" className="link light" onClick={() => supabase.auth.signOut()}>Sign out</button>}
      </header>
      <main>{body}</main>
    </div>
  );
}
