// Talks to the CashCow server. Every request carries your CashCow sign-in, and the
// server only lets the admin emails set on Render (MAIL_ADMIN_EMAILS) in.
import { currentToken } from "./account.js";

const API = "https://cashcow-reviews-api.onrender.com/api/mail/admin";

async function call(path, body) {
  const token = await currentToken();
  if (!token) throw Object.assign(new Error("Please sign in."), { status: 401 });
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the CashCow server. It may be waking up; try again in a moment.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Something went wrong. Please try again.";
    throw Object.assign(new Error(detail), { status: res.status });
  }
  return data;
}

export const me = () => call("/me");
export const summary = () => call("/summary");
export const subscribers = (q = "", status = "", offset = 0) =>
  call(`/subscribers?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&offset=${offset}`);
export const addSubscribers = (rows, consent) => call("/subscribers", { rows, consent, source: "import" });
export const updateSubscriber = (id, patch) => call(`/subscribers/${id}/update`, patch);
export const campaigns = () => call("/campaigns").then((d) => d.campaigns || []);
export const getCampaign = (id) => call(`/campaigns/${id}`);
export const saveCampaign = (c) => call("/campaigns", c);
export const preview = (c) => call("/preview", { subject: c.subject || "", preheader: c.preheader || "", body: c.body || "" });
export const scan = (id) => call(`/campaigns/${id}/scan`, {});
export const sendTest = (id) => call(`/campaigns/${id}/test`, {});
export const send = (id, at) => call(`/campaigns/${id}/send`, { at: at || "" });
export const cancel = (id) => call(`/campaigns/${id}/cancel`, {});
export const remove = (id) => call(`/campaigns/${id}/delete`, {});
export const inbox = () => call("/inbox").then((d) => d.messages || []);
export const updateInbox = (id, status) => call(`/inbox/${id}/update`, { status });
