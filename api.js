// Talks to the CashCow server. Every request carries your CashCow sign-in.
import { currentToken } from "./account.js";

const API = "https://cashcow-reviews-api.onrender.com/api/guard";

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
    throw new Error("Couldn't reach ScamShield. It may be waking up; try again in a moment.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Something went wrong. Please try again.";
    throw Object.assign(new Error(detail), { status: res.status });
  }
  return data;
}

export const me = () => call("/me");
export const addAddress = (email) => call("/addresses", { email });
export const removeAddress = (id) => call(`/addresses/${id}/delete`, {});
export const setAlerts = (id, alerts) => call(`/addresses/${id}/alerts`, { alerts });
