/* CDE Register - read-only phone viewer for the MEP Drawing Platform CDE.
   Loads cde-phone.json (published from the desktop app), keeps it in the phone's IndexedDB and shows it offline.
   Nothing is ever sent anywhere. */
"use strict";

const STATES = ["WIP", "Shared", "Published", "Archive", "Unassigned"];
const PAGE = 120;

// ------------------------------------------------------------------ tiny helpers
const $ = (s) => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

// IndexedDB (falls back to memory if the browser blocks it)
let memStore = null;
function idb() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open("cde-phone", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function saveSnap(s) {
  memStore = s;
  try {
    const db = await idb();
    await new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(s, "snapshot"); t.oncomplete = res; t.onerror = () => rej(t.error); });
  } catch (e) { toast("Could not keep a copy on this phone - it will be gone when you close the app."); }
}
async function loadSnap() {
  try {
    const db = await idb();
    return await new Promise((res, rej) => { const r = db.transaction("kv").objectStore("kv").get("snapshot"); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
  } catch (e) { return memStore; }
}

// ------------------------------------------------------------------ state
const S = {
  snap: null, sample: false, pid: null, tab: "docs",
  q: "", state: "All", latest: true, issues: false, shown: PAGE,
};

function revRank(r) {
  const m = /^([PCT])(\d+)$/i.exec(r || "");
  if (!m) return -1;
  return ({ T: 0, P: 1, C: 2 }[m[1].toUpperCase()]) * 1000 + parseInt(m[2], 10);
}
function project() { return S.snap && (S.snap.projects.find((p) => p.id === S.pid) || S.snap.projects[0]); }
function ageText(gen) {
  const d = new Date(String(gen || "").replace(" ", "T"));
  if (isNaN(d)) return { text: gen || "", days: 0 };
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  const days = Math.floor(mins / 1440);
  let t;
  if (mins < 2) t = "just now"; else if (mins < 60) t = mins + " min ago"; else if (mins < 1440) t = Math.round(mins / 60) + " h ago";
  else t = days === 1 ? "yesterday" : days + " days ago";
  return { text: t, days };
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}

// ------------------------------------------------------------------ filtering
function filtered(p, ignoreState) {
  const terms = S.q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = p.docs.filter((d) => {
    if (S.latest && !d.latest) return false;
    if (S.issues && !d.issues.length) return false;
    if (!ignoreState && S.state !== "All" && d.state !== S.state) return false;
    if (terms.length) {
      const hay = (d.id + " " + d.title + " " + d.file + " " + d.rev + " " + d.status + " " + d.state + " " + d.path).toLowerCase();
      for (const t of terms) if (!hay.includes(t)) return false;
    }
    return true;
  });
  out.sort((a, b) => {
    const ia = a.id || "~" + a.file, ib = b.id || "~" + b.file;
    if (ia !== ib) return ia < ib ? -1 : 1;
    return revRank(b.rev) - revRank(a.rev);
  });
  return out;
}

// ------------------------------------------------------------------ rendering
function render() {
  const p = project();
  $("#tabs").hidden = !p;
  $("#project").hidden = !(S.snap && S.snap.projects.length > 1);
  renderMeta();
  const main = $("#main");
  main.replaceChildren();
  if (!p) { main.append(emptyState()); return; }
  for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-current", b.dataset.tab === S.tab ? "page" : "false");
  if (S.sample) main.append(h("div", { class: "banner", text: "Sample data - tap Load register to see your own projects." }));
  if (S.tab === "docs") main.append(...docsView(p));
  else if (S.tab === "tx") main.append(...txView(p));
  else main.append(...promoView(p));
}

function renderMeta() {
  const m = $("#meta");
  m.classList.remove("stale");
  if (!S.snap) { m.textContent = "No register loaded"; return; }
  const a = ageText(S.snap.generated);
  const sc = project() && project().scanned;
  m.textContent = (S.sample ? "Sample data" : "Published " + a.text + (S.snap.by ? " by " + S.snap.by : "")) + (sc && !S.sample ? " - folder scanned " + sc : "");
  if (!S.sample && a.days >= 7) { m.classList.add("stale"); m.textContent += " - may be out of date"; }
}

function emptyState() {
  return h("div", { class: "empty" },
    h("h2", { text: "Your CDE register, on your phone" }),
    h("p", { text: "Look up any document's revision, status and container, and see what has been promoted or issued." }),
    h("ol", { class: "steps" },
      h("li", { text: "On your PC, in the Drawing Platform: CDE > Publish Register to Phone..." }),
      h("li", { text: "Here, tap Load register and pick cde-phone.json from your Google Drive." })),
    h("div", { class: "row", style: "justify-content:center" },
      h("button", { class: "btn primary", type: "button", onclick: () => $("#file").click(), text: "Load register" }),
      h("button", { class: "btn", type: "button", onclick: loadSample, text: "Try sample data" })));
}

function docsView(p) {
  const list = filtered(p);
  const counts = {}; for (const d of filtered(p, true)) counts[d.state] = (counts[d.state] || 0) + 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const search = h("input", { class: "search", type: "search", placeholder: "Search ID, title, file, revision, status...", value: S.q,
    "aria-label": "Search documents", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
  search.addEventListener("input", () => { S.q = search.value; S.shown = PAGE; renderList(p); });

  const chips = h("div", { class: "chips", role: "group", "aria-label": "Container" },
    chip("All", total, S.state === "All", () => setState("All")),
    STATES.filter((s) => counts[s]).map((s) => chip(s, counts[s], S.state === s, () => setState(s))));
  const toggles = h("div", { class: "toggles" },
    h("button", { class: "chip", type: "button", "aria-pressed": String(S.latest), onclick: () => { S.latest = !S.latest; S.shown = PAGE; render(); }, text: "Latest revisions only" }),
    h("button", { class: "chip", type: "button", "aria-pressed": String(S.issues), onclick: () => { S.issues = !S.issues; S.shown = PAGE; render(); }, text: "Issues only" }));
  const controls = h("div", { class: "controls" }, search, chips, toggles);
  const holder = h("div", { id: "docList" });
  const out = [controls, holder];
  renderList.holder = holder; renderList.list = null;
  renderList(p);
  return out;
}
function chip(label, n, on, fn) {
  return h("button", { class: "chip", type: "button", "aria-pressed": String(on), onclick: fn }, label, h("span", { class: "n", text: String(n) }));
}
function setState(s) { S.state = s; S.shown = PAGE; render(); }

function renderList(p) {
  const holder = renderList.holder; if (!holder) return;
  const list = filtered(p);
  holder.replaceChildren();
  holder.append(h("div", { class: "count", role: "status", text: list.length + (list.length === 1 ? " document" : " documents") }));
  if (!list.length) { holder.append(h("div", { class: "empty" }, h("p", { text: "Nothing matches. Clear the search or untick a filter." }))); return; }
  const wrap = h("div", { class: "list" });
  for (const d of list.slice(0, S.shown)) wrap.append(docCard(d));
  holder.append(wrap);
  if (list.length > S.shown) holder.append(h("div", { class: "row", style: "justify-content:center;margin:12px 0" },
    h("button", { class: "btn", type: "button", onclick: () => { S.shown += PAGE; renderList(p); }, text: "Show more (" + (list.length - S.shown) + " left)" })));
}

function docCard(d) {
  const hasErr = d.issues.some((i) => i[0] === "error"), hasWarn = !hasErr && d.issues.length > 0;
  const card = h("button", { class: "card s-" + d.state + (d.latest ? "" : " old") + (hasErr ? " has-error" : hasWarn ? " has-warn" : ""), type: "button",
    "aria-label": (d.id || d.file) + ", " + d.state + (d.rev ? ", revision " + d.rev : ""), onclick: () => openDoc(d) });
  card.append(h("div", { class: "id", text: d.id || d.file }));
  if (d.title || (!d.id ? "" : d.file)) card.append(h("div", { class: "sub", text: d.title || d.file }));
  const row = h("div", { class: "row" }, h("span", { class: "badge state-" + d.state, text: d.state }));
  if (d.rev) row.append(h("span", { class: "badge", text: "Rev " + d.rev }));
  if (d.status) row.append(h("span", { class: "badge", text: d.status }));
  if (!d.latest) row.append(h("span", { class: "badge", text: "Older revision" }));
  if (hasErr) row.append(h("span", { class: "badge bad", text: "Name error" }));
  else if (hasWarn) row.append(h("span", { class: "badge warn", text: d.issues.length > 1 ? d.issues.length + " warnings" : "Warning" }));
  card.append(row);
  if (d.issues.length) card.append(h("div", { class: "note", text: d.issues[0][1] }));
  return card;
}

function txView(p) {
  if (!p.transmittals.length) return [h("div", { class: "empty" }, h("p", { text: "No transmittals have been issued for this project yet." }))];
  const wrap = h("div", { class: "list" });
  for (const t of p.transmittals) {
    wrap.append(h("button", { class: "card s-Shared", type: "button", onclick: () => openTx(t) },
      h("div", { class: "id", text: t.number }),
      h("div", { class: "sub", text: t.date + " - to " + (t.to || "(not recorded)") }),
      h("div", { class: "row" }, h("span", { class: "badge", text: t.count + (t.count === 1 ? " document" : " documents") }),
        t.purpose ? h("span", { class: "badge", text: t.purpose }) : null)));
  }
  return [h("div", { class: "count", text: p.transmittals.length + " transmittals" }), wrap];
}
function promoView(p) {
  if (!p.promotions.length) return [h("div", { class: "empty" }, h("p", { text: "Nothing has been promoted yet." }))];
  const wrap = h("div", { class: "list" });
  for (const b of p.promotions) {
    const move = b.promoted ? (b.from && b.to ? b.from + " → " + b.to : "to " + b.to) : "Moved to Archive";
    wrap.append(h("button", { class: "card s-" + (b.to || "Archive") + (b.status === "undone" ? " old" : ""), type: "button", onclick: () => openPromo(b) },
      h("div", { class: "id", text: move }),
      h("div", { class: "sub", text: b.when + (b.by ? " - " + b.by : "") + (b.approved_by ? " - approved by " + b.approved_by : "") }),
      h("div", { class: "row" }, h("span", { class: "badge", text: b.promoted + " promoted" }), b.archived ? h("span", { class: "badge", text: b.archived + " archived" }) : null,
        b.status === "undone" ? h("span", { class: "badge warn", text: "Undone" }) : null),
      b.note ? h("div", { class: "sub", text: b.note }) : null));
  }
  return [h("div", { class: "count", text: p.promotions.length + " promotions" }), wrap];
}

// ------------------------------------------------------------------ detail sheet
let lastFocus = null, sheetOpen = false;
function openSheet(title, nodes) {
  lastFocus = document.activeElement; $("#toast").hidden = true;
  const body = $("#sheetBody"); body.replaceChildren(h("h2", { id: "sheetTitle", text: title }), ...nodes);
  $("#scrim").hidden = false; $("#sheet").hidden = false; $("#sheet").scrollTop = 0;
  if (!sheetOpen) { history.pushState({ sheet: 1 }, ""); sheetOpen = true; }
  body.querySelector("button, a")?.focus({ preventScroll: true });
}
function closeSheet(fromPop) {
  if (!sheetOpen) return;
  $("#scrim").hidden = true; $("#sheet").hidden = true; sheetOpen = false;
  if (!fromPop && history.state && history.state.sheet) history.back();
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}
function kv(pairs) {
  const dl = h("dl", { class: "kv" });
  for (const [k, v] of pairs) if (v !== "" && v != null) dl.append(h("dt", { text: k }), h("dd", { text: String(v) }));
  return dl;
}
function bytes(n) { if (!n) return ""; return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
function copy(text, what) {
  const done = () => toast(what + " copied");
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast("Could not copy"));
  else { const t = h("textarea", { style: "position:fixed;opacity:0" }); t.value = text; document.body.append(t); t.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Could not copy"); } t.remove(); }
}

function openDoc(d) {
  const p = project();
  const nodes = [];
  nodes.push(h("div", { class: "row" }, h("span", { class: "badge state-" + d.state, text: d.state }), d.rev ? h("span", { class: "badge", text: "Rev " + d.rev }) : null,
    d.status ? h("span", { class: "badge", text: d.status }) : null, !d.latest ? h("span", { class: "badge", text: "Older revision" }) : null));
  if (d.issues.length) { nodes.push(h("h3", { text: "Needs attention" })); for (const [lvl, msg] of d.issues) nodes.push(h("div", { class: "issue " + (lvl === "error" ? "error" : "warn"), text: msg })); }
  nodes.push(h("h3", { text: "Details" }), kv([["Title", d.title], ["File", d.file], ["Folder", d.path.includes("/") ? d.path.slice(0, d.path.lastIndexOf("/")) : ""], ["Size", bytes(d.size)], ["Modified", d.modified], ["Project", p.name]]));
  const key = (d.id || "").toLowerCase();
  const others = key ? p.docs.filter((x) => x !== d && x.id.toLowerCase() === key).sort((a, b) => revRank(b.rev) - revRank(a.rev)) : [];
  if (others.length) {
    nodes.push(h("h3", { text: "Other revisions of this document" }));
    for (const o of others) nodes.push(h("div", { class: "hist" }, h("div", { text: (o.rev ? "Rev " + o.rev : "No revision") + (o.status ? " " + o.status : "") + " - " + o.state }), h("div", { class: "when", text: o.file })));
  }
  const tx = [];
  if (key) for (const t of p.transmittals) for (const it of t.items) if ((it.id || "").toLowerCase() === key) tx.push([t, it]);
  if (tx.length) {
    nodes.push(h("h3", { text: "Issued on" }));
    for (const [t, it] of tx) nodes.push(h("div", { class: "hist" }, h("div", { text: t.number + " - rev " + (it.rev || "-") + " " + (it.status || "") }), h("div", { class: "when", text: t.date + " - to " + (t.to || "") + (t.purpose ? " (" + t.purpose + ")" : "") })));
  }
  const pr = [];
  if (key) for (const b of p.promotions) { const hit = b.ops.find((o) => (o[1] + " " + o[2]).toLowerCase().includes(key)); if (hit) pr.push(b); }
  if (pr.length) {
    nodes.push(h("h3", { text: "Promotion history" }));
    for (const b of pr) nodes.push(h("div", { class: "hist" }, h("div", { text: (b.from && b.to ? b.from + " → " + b.to : "Archive") + (b.status === "undone" ? " (undone)" : "") }),
      h("div", { class: "when", text: b.when + (b.by ? " - " + b.by : "") + (b.approved_by ? " - approved by " + b.approved_by : "") })));
  }
  const acts = h("div", { class: "actions" },
    h("a", { class: "btn primary", href: "https://drive.google.com/drive/search?q=" + encodeURIComponent(d.file), target: "_blank", rel: "noopener noreferrer", text: "Find in Drive" }),
    h("button", { class: "btn", type: "button", onclick: () => copy(d.id || d.file, "Document ID"), text: "Copy ID" }));
  if (navigator.share) acts.append(h("button", { class: "btn", type: "button", text: "Share",
    onclick: () => navigator.share({ title: d.id || d.file, text: [d.id || d.file, d.rev && "Rev " + d.rev, d.status, d.state, p.name].filter(Boolean).join(" - ") }).catch(() => {}) }));
  acts.append(h("button", { class: "btn", type: "button", onclick: () => closeSheet(), text: "Close" }));
  nodes.push(acts);
  openSheet(d.id || d.file, nodes);
}
function openTx(t) {
  const nodes = [kv([["Date", t.date], ["To", t.to], ["Purpose", t.purpose], ["Issued by", t.by], ["Reply by", t.response_by]]), h("h3", { text: t.count + " documents" })];
  for (const it of t.items) nodes.push(h("div", { class: "hist" }, h("div", { class: "id", text: it.id || it.file }), h("div", { class: "when", text: "Rev " + (it.rev || "-") + " " + (it.status || "") })));
  nodes.push(h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => closeSheet(), text: "Close" })));
  openSheet(t.number, nodes);
}
function openPromo(b) {
  const nodes = [kv([["When", b.when], ["By", b.by], ["Approved by", b.approved_by], ["Note", b.note], ["Status", b.status === "undone" ? "Undone" : "Done"]]), h("h3", { text: "Files" })];
  const name = (s) => s.slice(s.lastIndexOf("/") + 1);
  for (const [op, src, dst] of b.ops) nodes.push(h("div", { class: "hist" }, h("div", { text: ({ copy: "Copied", stamp: "Stamped copy", archive: "Archived" }[op] || op) + ": " + name(dst) }), h("div", { class: "when", text: "from " + src })));
  nodes.push(h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => closeSheet(), text: "Close" })));
  openSheet((b.from && b.to ? b.from + " → " + b.to : "Archive move"), nodes);
}

// ------------------------------------------------------------------ loading a register
function validate(j) {
  if (!j || j.format !== "cde-phone" || !Array.isArray(j.projects)) throw new Error("That is not a CDE register file. Choose cde-phone.json.");
  if ((j.version || 1) > 1) throw new Error("This register was made by a newer version. Refresh the app (close and reopen it) and try again.");
  for (const p of j.projects) { p.docs = p.docs || []; p.promotions = p.promotions || []; p.transmittals = p.transmittals || []; for (const d of p.docs) { d.issues = d.issues || []; d.id = d.id || ""; d.title = d.title || ""; d.file = d.file || ""; d.path = d.path || d.file; } }
  return j;
}
function adopt(j, sample) {
  S.snap = j; S.sample = !!sample;
  const sel = $("#project"); sel.replaceChildren(...j.projects.map((p) => h("option", { value: String(p.id), text: p.name + (p.code ? " (" + p.code + ")" : "") })));
  const want = Number(lsGet("cde.pid", "")) ;
  S.pid = (j.projects.find((p) => p.id === want) || j.projects[0] || {}).id;
  sel.value = String(S.pid);
  S.q = ""; S.state = "All"; S.shown = PAGE;
  render();
}
async function onFile(ev) {
  const f = ev.target.files && ev.target.files[0]; ev.target.value = "";
  if (!f) return;
  try {
    const j = validate(JSON.parse(await f.text()));
    adopt(j, false);
    await saveSnap(j);
    toast("Loaded " + j.projects.reduce((n, p) => n + p.docs.length, 0) + " documents from " + j.projects.length + (j.projects.length === 1 ? " project" : " projects"));
  } catch (e) { toast(e instanceof SyntaxError ? "That file could not be read. Choose cde-phone.json." : e.message); }
}
function loadSample() { adopt(validate(JSON.parse(JSON.stringify(SAMPLE))), true); }

// ------------------------------------------------------------------ sample data
const SAMPLE = (() => {
  const d = (id, rev, status, state, file, extra) => Object.assign({ id, title: "", rev, status, state, file, path: ({ WIP: "01_WIP", Shared: "02_Shared", Published: "03_Published", Archive: "04_Archive" }[state] || "") + "/" + file,
    size: 1800000, modified: "2026-10-12 16:40", latest: true, ok: true, issues: [] }, extra || {});
  const P = "D4012-OAK-XX-";
  const docs = [
    d(P + "01-DR-E-0101", "", "", "WIP", P + "01-DR-E-0101.pdf"),
    d(P + "01-DR-E-0102", "", "", "WIP", P + "01-DR-E-0102.pdf"),
    d(P + "00-DR-E-0001", "P01", "S2", "Shared", P + "00-DR-E-0001-S2-P01.pdf", { latest: false, issues: [["warn", "Superseded by P02 but still in Shared - move to Archive"]] }),
    d(P + "00-DR-E-0001", "P02", "S2", "Shared", P + "00-DR-E-0001-S2-P02.pdf"),
    d(P + "00-DR-E-0002", "P01", "S3", "Shared", P + "00-DR-E-0002-S3-P01.pdf"),
    d(P + "00-DR-E-0003", "C01", "A", "Published", P + "00-DR-E-0003-A-C01.pdf"),
    d(P + "00-DR-E-0003", "P03", "S3", "Archive", P + "00-DR-E-0003-S3-P03.pdf", { latest: false }),
    d("", "", "", "Shared", "Lighting layout final v2.pdf", { ok: false, issues: [["error", "Only 1 of 7 name fields found (Project-Originator-Volume-Level-Type-Role-Number)"]] }),
  ];
  return { format: "cde-phone", version: 1, app: "sample", generated: new Date().toISOString().slice(0, 16).replace("T", " "), by: "Darren",
    projects: [{ id: 1, name: "Oakfield Court", code: "D4012", scanned: "", summary: {}, docs,
      promotions: [{ batch: "b1", when: "2026-10-12 16:41", by: "Darren", from: "Shared", to: "Published", promoted: 1, archived: 1, approved_by: "A. Morgan", note: "Stage 4 sign-off", status: "done",
        ops: [["stamp", "02_Shared/" + P + "00-DR-E-0003-S3-P03.pdf", "03_Published/" + P + "00-DR-E-0003-A-C01.pdf"], ["archive", "02_Shared/" + P + "00-DR-E-0003-S3-P03.pdf", "04_Archive/" + P + "00-DR-E-0003-S3-P03.pdf"]] }],
      transmittals: [{ number: "D4012-TRN-001", date: "2026-10-12", to: "J. Carter, Carter Mechanical Ltd", purpose: "For coordination", by: "Darren", response_by: "2026-10-26", count: 2,
        items: [{ id: P + "00-DR-E-0001", rev: "P02", status: "S2", file: P + "00-DR-E-0001-S2-P02.pdf" }, { id: P + "00-DR-E-0002", rev: "P01", status: "S3", file: P + "00-DR-E-0002-S3-P01.pdf" }] }] }] };
})();

// ------------------------------------------------------------------ start up
function init() {
  $("#loadBtn").addEventListener("click", () => $("#file").click());
  $("#file").addEventListener("change", onFile);
  $("#project").addEventListener("change", (e) => { S.pid = Number(e.target.value); lsSet("cde.pid", String(S.pid)); S.q = ""; S.state = "All"; S.shown = PAGE; render(); });
  for (const b of document.querySelectorAll("#tabs button")) b.addEventListener("click", () => { S.tab = b.dataset.tab; lsSet("cde.tab", S.tab); render(); window.scrollTo(0, 0); });
  $("#scrim").addEventListener("click", () => closeSheet());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  window.addEventListener("popstate", () => closeSheet(true));
  const tab = lsGet("cde.tab", "docs"); if (["docs", "tx", "promo"].includes(tab)) S.tab = tab;
  loadSnap().then((j) => { try { if (j) adopt(validate(j), false); else render(); } catch (e) { render(); } }, () => render());
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
}
init();
