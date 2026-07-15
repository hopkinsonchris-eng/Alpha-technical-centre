// ============================================================================
//  ALPHA ELA — backend client (optional)
//  If a backend is present (GET /api/me reachable), scenarios sync to the
//  server and partners log in. If not (pure static hosting), everything falls
//  back to localStorage transparently. The app calls ELAStore.* and doesn't
//  care which mode is active.
// ============================================================================
(function (global) {
  "use strict";
  const LSK = "ela_scenarios_v1", TKK = "ela_token";
  let MODE = "local";              // "local" | "server"
  let TOKEN = null, USER = null;

  function token() { return TOKEN || localStorage.getItem(TKK); }
  async function api(path, opts = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    const t = token(); if (t) headers.Authorization = "Bearer " + t;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (!res.ok) throw Object.assign(new Error("API " + res.status), { status: res.status });
    return res.status === 204 ? null : res.json();
  }

  // detect backend on load
  async function detect() {
    try { const r = await fetch("/api/me", { headers: token() ? { Authorization: "Bearer " + token() } : {} });
      if (r.status === 200) { MODE = "server"; USER = (await r.json()).user; return; }
      if (r.status === 401) { MODE = "server"; return; }  // backend present, needs login
    } catch (e) { /* no backend */ }
    MODE = "local";
  }

  async function login(email, password) {
    const r = await api("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
    TOKEN = r.token; USER = r.user; localStorage.setItem(TKK, r.token); MODE = "server"; return r.user;
  }
  function logout() { TOKEN = null; USER = null; localStorage.removeItem(TKK); }

  // --- unified scenario API ----------------------------------------------
  // list() -> [{id?,name,state,shared?,ownerEmail?,updated?}]
  async function list() {
    if (MODE === "server") {
      const metas = await api("/api/scenarios");
      return metas; // metadata only; full state fetched on open()
    }
    const o = JSON.parse(localStorage.getItem(LSK) || "{}");
    return Object.keys(o).map(n => ({ id: n, name: n, shared: false, local: true, updated: o[n].saved }));
  }
  async function open(idOrName) {
    if (MODE === "server") return (await api("/api/scenarios/" + idOrName)).state;
    const o = JSON.parse(localStorage.getItem(LSK) || "{}"); return o[idOrName] ? o[idOrName].state : null;
  }
  async function saveScenario(name, state, shared) {
    if (MODE === "server") return api("/api/scenarios", { method: "POST", body: JSON.stringify({ name, state, shared: !!shared }) });
    const o = JSON.parse(localStorage.getItem(LSK) || "{}"); o[name] = { state, saved: Date.now() };
    localStorage.setItem(LSK, JSON.stringify(o)); return { id: name, name };
  }
  async function remove(idOrName) {
    if (MODE === "server") return api("/api/scenarios/" + idOrName, { method: "DELETE" });
    const o = JSON.parse(localStorage.getItem(LSK) || "{}"); delete o[idOrName]; localStorage.setItem(LSK, JSON.stringify(o));
  }

  const API = { detect, login, logout, list, open, saveScenario, remove,
                mode: () => MODE, user: () => USER, needsLogin: () => MODE === "server" && !USER };
  global.ELAStore = API;
})(typeof window !== "undefined" ? window : globalThis);
