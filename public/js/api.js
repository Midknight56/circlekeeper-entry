const fixture = new URLSearchParams(location.search).get("fixture") === "1";
export async function getState(id, k) {
  const url = fixture ? "/dev/sample-state.json" : `/api/circles/${encodeURIComponent(id)}/state?k=${encodeURIComponent(k || "")}`;
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error("Can't reach Circlekeeper right now. Trying again every few seconds.");
  }
  if (response.status === 403) throw new Error("This link is not valid for this circle.");
  if (!response.ok) throw new Error("Circlekeeper had a problem loading this page. Trying again every few seconds.");
  return response.json();
}
export async function post(path, body = {}) {
  if (fixture) return { ok: true, approveUrl: "#" };
  const payload = JSON.stringify(body);
  // keepalive finishes the request after the page closes; browsers refuse it for a body over 64 KiB.
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: payload.length < 60000 });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
export function pollState(id, k, callback) {
  let timer = null; let version; let failing = false;
  const poll = async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const state = await getState(id, k);
      if (failing) callback(null, { message: "" });
      failing = false;
      if (state.version !== version) { version = state.version; callback(state); }
    } catch (error) {
      failing = true;
      callback(null, error);
    }
  };
  const start = () => { if (!timer && document.visibilityState === "visible") { poll(); timer = setInterval(poll, 2000); } };
  const stop = () => { clearInterval(timer); timer = null; };
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" ? start() : stop());
  start();
  return stop;
}
