// 臨床検体 採取スケジュール（iPhone 版）
// Mac の specimen_schedule_app.R と同じ CSV を、Dropbox のアプリ専用フォルダで直接読み書きする。
// ルール（群・採取ポイント・休診日）は config.js と R 側の「0. 設定」を同じにしておくこと。
"use strict";
(() => {
  const C = window.APP_CONFIG;
  const VISITS = C.VISIT_PLAN.map(v => v.visit);
  const COLS = ["subject_id", "group", ...VISITS, "note", "updated_at"];
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const DEMO = new URLSearchParams(location.search).has("demo");

  // =====================================================================
  // 日付（"YYYY-MM-DD" の文字列で扱い、計算は UTC で行う）
  // =====================================================================
  const pad = n => String(n).padStart(2, "0");
  const toT = s => { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || "").trim()); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const fromT = t => new Date(t).toISOString().slice(0, 10);
  const validDate = s => toT(s) !== null && fromT(toT(s)) === normDate(s);
  const normDate = s => { const t = toT(s); return t === null ? "" : fromT(t); };
  const addDays = (s, n) => fromT(toT(s) + n * 864e5);
  const diffDays = (a, b) => Math.round((toT(a) - toT(b)) / 864e5);
  const wday = s => new Date(toT(s)).getUTCDay();
  const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
  const nowStr = () => { const n = new Date(); return `${todayStr()} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`; };
  const fmt = s => s ? `${s} (${WD[wday(s)]})` : "";
  const fmtMD = s => { const d = new Date(toT(s)); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`; };
  const monthStart = s => s.slice(0, 8) + "01";
  const addMonths = (s, k) => { const d = new Date(toT(s)); return fromT(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1)); };

  // =====================================================================
  // CSV（R の write.csv と同じ形：全項目を "" で囲み、空の日付だけ囲まない。BOM 付き UTF-8）
  // =====================================================================
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); f = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = [];
      } else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
  }
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  function toCSV(cols, rows, naCols = []) {
    const lines = [cols.map(q).join(",")];
    for (const r of rows) lines.push(cols.map(c => (naCols.includes(c) && !r[c]) ? "" : q(r[c] ?? "")).join(","));
    return "﻿" + lines.join("\n") + "\n";
  }

  // =====================================================================
  // 祝日・休診日（R の day_state / toggle_day と同じ考え方）
  // =====================================================================
  let HOL = Object.assign({}, window.BUILTIN_HOLIDAYS || {});
  function loadHolidaysCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return;
    const h = {};
    for (const r of rows) { const d = normDate(r.date); if (d) h[d] = r.name || "祝日"; }
    HOL = Object.assign({}, window.BUILTIN_HOLIDAYS || {}, h);
  }
  const holidayYears = () => Object.keys(HOL).map(d => +d.slice(0, 4));
  const holidayName = s => (C.USE_JHOLIDAY && HOL[s]) || "";

  function baseState(s) {
    const w = wday(s), nth = Math.floor((+s.slice(8, 10) - 1) / 7) + 1;
    let st = "open";
    if (C.CLOSED_WDAYS.includes(w)) st = "closed";
    if (w === 6 && C.SAT_CLOSED_NTH.includes(nth)) st = "closed";
    if (w === 6 && C.SAT_ASK_NTH.includes(nth)) st = "unknown";
    if (holidayName(s)) st = "closed";
    return st;
  }
  function dayState(s) {
    const o = S.ov.find(x => x.date === s);
    return o ? (o.closed ? "closed" : "open") : baseState(s);
  }
  const stateJa = st => st === "closed" ? "休診日" : st === "unknown" ? "未設定（第5土曜）" : "診療日";
  // クリックで状態を進める（既定休診：休診→診療→休診…／既定診療：診療→休診→…／第5土曜：未設定→休診→診療→未設定…）
  function toggleDay(ov, s) {
    const def = baseState(s);
    const i = ov.findIndex(x => x.date === s);
    const cur = i < 0 ? null : ov[i].closed;
    const note = i < 0 ? "" : ov[i].note;
    let nxt;
    if (def === "unknown") nxt = cur === null ? true : cur === true ? false : null;
    else if (def === "closed") nxt = cur === null ? false : null;
    else nxt = cur === null ? true : null;
    const out = ov.filter(x => x.date !== s);
    if (nxt !== null) out.push({ date: s, closed: nxt, note });
    return out.sort((a, b) => a.date < b.date ? -1 : 1);
  }

  // =====================================================================
  // 予定データ
  // =====================================================================
  const groupIdx = g => { const i = C.GROUPS.findIndex(x => x.name === g); return i < 0 ? 999 : i; };
  const groupColor = g => (C.GROUPS.find(x => x.name === g) || { color: "#8a939c" }).color;
  const planDate = (d0, i) => addDays(d0, C.VISIT_PLAN[i].week * 7);

  function normalizeData(rows) {
    const out = rows.map(r => {
      const o = { subject_id: String(r.subject_id || "").trim(), group: String(r.group || "").trim() };
      for (const v of VISITS) o[v] = normDate(r[v]);
      o.note = r.note || ""; o.updated_at = r.updated_at || "";
      return o;
    }).filter(o => o.subject_id);
    return sortData(out);
  }
  const sortData = df => df.sort((a, b) => groupIdx(a.group) - groupIdx(b.group) || (a.subject_id < b.subject_id ? -1 : a.subject_id > b.subject_id ? 1 : 0));
  function normalizeClosed(rows) {
    const seen = new Set();
    return rows.map(r => ({
      date: normDate(r.date),
      closed: ["TRUE", "T", "1", "YES", "Y", "休診"].includes(String(r.closed ?? "TRUE").trim().toUpperCase()),
      note: r.note || ""
    })).filter(o => o.date && !seen.has(o.date) && seen.add(o.date)).sort((a, b) => a.date < b.date ? -1 : 1);
  }
  function events(df) {
    const ev = [];
    for (const r of df) C.VISIT_PLAN.forEach((p, i) => {
      if (!r[p.visit]) return;
      const sh = r[VISITS[0]] ? diffDays(r[p.visit], planDate(r[VISITS[0]], i)) : null;
      ev.push({ date: r[p.visit], sid: r.subject_id, group: r.group, visit: p.visit, label: p.label, color: p.color,
                shift: sh, over: sh !== null && Math.abs(sh) > p.tol });
    });
    return ev.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.sid < b.sid ? -1 : 1);
  }
  function suggestId(df) {
    const m = df.map(r => /^([A-Za-z_-]*)(\d+)$/.exec(r.subject_id)).filter(Boolean);
    if (!m.length) return "";
    const pre = m.map(x => x[1]).sort((a, b) => m.filter(x => x[1] === b).length - m.filter(x => x[1] === a).length)[0];
    const xs = m.filter(x => x[1] === pre);
    const w = Math.max(...xs.map(x => x[2].length));
    return pre + String(Math.max(...xs.map(x => +x[2])) + 1).padStart(w, "0");
  }

  // =====================================================================
  // Dropbox（OAuth2 PKCE。App folder 権限なのでアプリ専用フォルダの中しか触れない）
  // =====================================================================
  const REDIRECT = location.origin + location.pathname;
  const LS = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
               set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
               del: k => { try { localStorage.removeItem(k); } catch (e) {} } };
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const randStr = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

  async function login() {
    const verifier = randStr(48), st = randStr(16);
    sessionStorage.setItem("pkce_verifier", verifier); sessionStorage.setItem("pkce_state", st);
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const u = new URL("https://www.dropbox.com/oauth2/authorize");
    Object.entries({ client_id: C.DROPBOX_APP_KEY, response_type: "code", code_challenge: challenge, code_challenge_method: "S256",
                     redirect_uri: REDIRECT, token_access_type: "offline", state: st }).forEach(([k, v]) => u.searchParams.set(k, v));
    location.href = u.toString();
  }
  async function finishLogin() {
    const p = new URLSearchParams(location.search);
    if (!p.has("code")) return false;
    history.replaceState(null, "", REDIRECT);
    if (p.get("state") !== sessionStorage.getItem("pkce_state")) throw new Error("ログインの確認に失敗しました（state 不一致）。もう一度ログインしてください。");
    const body = new URLSearchParams({ code: p.get("code"), grant_type: "authorization_code", code_verifier: sessionStorage.getItem("pkce_verifier"),
                                       client_id: C.DROPBOX_APP_KEY, redirect_uri: REDIRECT });
    const r = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", body });
    if (!r.ok) throw new Error("ログインに失敗しました：" + await r.text());
    saveToken(await r.json());
    sessionStorage.removeItem("pkce_verifier"); sessionStorage.removeItem("pkce_state");
    return true;
  }
  function saveToken(j) {
    LS.set("dbx_access", j.access_token);
    LS.set("dbx_exp", String(Date.now() + (j.expires_in - 60) * 1000));
    if (j.refresh_token) LS.set("dbx_refresh", j.refresh_token);
  }
  const loggedIn = () => !!LS.get("dbx_refresh");
  async function accessToken() {
    if (LS.get("dbx_access") && +LS.get("dbx_exp") > Date.now()) return LS.get("dbx_access");
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: LS.get("dbx_refresh") || "", client_id: C.DROPBOX_APP_KEY });
    const r = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", body });
    if (!r.ok) { logoutLocal(); throw new Error("ログインの有効期限が切れました。もう一度ログインしてください。"); }
    saveToken(await r.json());
    return LS.get("dbx_access");
  }
  function logoutLocal() { ["dbx_access", "dbx_exp", "dbx_refresh"].forEach(LS.del); }
  async function logout() {
    try { await fetch("https://api.dropboxapi.com/2/auth/token/revoke", { method: "POST", headers: { Authorization: "Bearer " + await accessToken() } }); } catch (e) {}
    logoutLocal(); render();
  }
  // Dropbox-API-Arg ヘッダーは ASCII のみなので、日本語などは \uXXXX にする
  const apiArg = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

  const Store = DEMO ? demoStore() : {
    async read(path) {
      const r = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST", headers: { Authorization: "Bearer " + await accessToken(), "Dropbox-API-Arg": apiArg({ path }) } });
      if (r.status === 409) { const t = await r.text(); if (t.includes("not_found")) return { text: "", rev: null }; throw new Error(t); }
      if (!r.ok) throw new Error(`${path} を読めませんでした（${r.status}）`);
      const meta = JSON.parse(r.headers.get("Dropbox-API-Result") || "{}");
      return { text: new TextDecoder("utf-8").decode(await r.arrayBuffer()), rev: meta.rev || null };
    },
    async write(path, text, rev) {
      const mode = rev ? { ".tag": "update", update: rev } : { ".tag": "add" };
      const r = await fetch("https://content.dropboxapi.com/2/files/upload", {
        method: "POST", headers: { Authorization: "Bearer " + await accessToken(), "Content-Type": "application/octet-stream",
                                   "Dropbox-API-Arg": apiArg({ path, mode, autorename: false, mute: true }) },
        body: new TextEncoder().encode(text) });
      if (r.status === 409) { const e = new Error("conflict"); e.conflict = true; throw e; }
      if (!r.ok) throw new Error(`${path} を保存できませんでした（${r.status}）：${await r.text()}`);
      return (await r.json()).rev;
    }
  };

  // 動作確認用（?demo）：架空のデータをメモリ上だけで扱う
  function demoStore() {
    const t = todayStr(), mk = (id, g, d0, w8 = true, w24 = true) => ({ subject_id: id, group: g, W0: d0, W8: w8 ? addDays(d0, 56) : "", W24: w24 ? addDays(d0, 168) : "", note: "", updated_at: "" });
    const files = {
      [C.DATA_FILE]: toCSV(COLS, [mk("D001", "健常", addDays(t, -60)), mk("D002", "AD", addDays(t, -20)), mk("D003", "炎症Ct", addDays(t, 3), true, false), mk("D004", "AD", addDays(t, -170))], VISITS),
      [C.CLOSED_FILE]: toCSV(["date", "closed", "note"], []),
    };
    let n = 1; const revs = {};
    return {
      async read(path) { return { text: files[path] || "", rev: files[path] ? (revs[path] || "r0") : null }; },
      async write(path, text, rev) { if (rev && revs[path] && rev !== revs[path]) { const e = new Error("conflict"); e.conflict = true; throw e; }
                                     files[path] = text; revs[path] = "r" + (n++); return revs[path]; }
    };
  }

  // =====================================================================
  // 状態
  // =====================================================================
  const S = { df: [], ov: [], rev: { data: null, closed: null }, loaded: false, busy: false,
              tab: "plan", month: monthStart(todayStr()), selDay: todayStr(), editSid: null, closedMonth: monthStart(todayStr()) };

  async function loadAll() {
    S.busy = true; render();
    const [d, c, h] = await Promise.all([Store.read(C.DATA_FILE), Store.read(C.CLOSED_FILE), Store.read(C.HOLIDAY_FILE)]);
    S.df = normalizeData(parseCSV(d.text)); S.rev.data = d.rev;
    S.ov = normalizeClosed(parseCSV(c.text)); S.rev.closed = c.rev;
    if (h.text) loadHolidaysCSV(h.text);
    S.loaded = true; S.busy = false; S.loadedAt = new Date();
    render();
  }
  async function commitData(df, msg) {
    try {
      S.busy = true;
      const rows = sortData(df.slice());
      S.rev.data = await Store.write(C.DATA_FILE, toCSV(COLS, rows, VISITS), S.rev.data);
      S.df = rows; S.busy = false; toast(msg); render();
      return true;
    } catch (e) { S.busy = false; await handleWriteError(e); return false; }
  }
  async function commitClosed(ov, msg) {
    try {
      S.busy = true;
      S.rev.closed = await Store.write(C.CLOSED_FILE, toCSV(["date", "closed", "note"], ov.map(o => ({ date: o.date, closed: o.closed ? "TRUE" : "FALSE", note: o.note }))), S.rev.closed);
      S.ov = ov; S.busy = false; toast(msg); render();
      return true;
    } catch (e) { S.busy = false; await handleWriteError(e); return false; }
  }
  async function handleWriteError(e) {
    if (e.conflict) { toast("ほかの端末（Mac など）で更新されていました。最新の内容を読み込んだので、もう一度操作してください。", true); await loadAll(); }
    else { toast(e.message, true); render(); }
  }

  // =====================================================================
  // 画面
  // =====================================================================
  const $ = s => document.querySelector(s);
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;   // CSSOM 経由（CSP で style 属性は禁止しているため）
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "checked" || k === "value" || k === "disabled" || k === "selected") el[k] = v;
      else el.setAttribute(k, v);
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  let toastTimer;
  function toast(msg, err = false) {
    const t = $("#toast"); t.textContent = msg; t.className = err ? "err" : ""; t.classList.remove("hidden");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), err ? 6000 : 2800);
  }
  const gtag = g => h("span", { class: "gtag", style: `background:${groupColor(g)}` }, g || "未設定");
  const vtag = ev => h("span", { class: "vtag", style: `color:${ev.color}` }, ev.visit);
  const shiftTxt = ev => ev.shift === null || ev.visit === VISITS[0] ? "" : ev.shift === 0 ? "規定日" : (ev.shift > 0 ? "+" : "") + ev.shift + "日";

  function render() {
    const app = $("#app");
    $("#demo").classList.toggle("hidden", !DEMO);
    if (!DEMO && !C.DROPBOX_APP_KEY) {
      app.replaceChildren(h("div", { class: "card login" }, h("h2", {}, "まだ Dropbox と接続する設定がありません"),
        h("p", { class: "muted small" }, "config.js に Dropbox の App key を入れてください。"),
        h("a", { href: "?demo" }, "架空のデータで試す（デモ）")));
      $("#tabs").classList.add("hidden"); return;
    }
    if (!DEMO && !loggedIn()) {
      app.replaceChildren(h("div", { class: "card login" }, h("h2", {}, "臨床検体 採取スケジュール"),
        h("p", { class: "muted small" }, "Dropbox のアプリ専用フォルダにある CSV を読み書きします。ほかのフォルダには触れません。"),
        h("button", { class: "btn", onclick: login }, "Dropbox にログイン")));
      $("#tabs").classList.add("hidden"); return;
    }
    $("#tabs").classList.remove("hidden");
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === S.tab));
    $("#sync").textContent = S.busy ? "通信中…" : S.loadedAt ? `読込 ${pad(S.loadedAt.getHours())}:${pad(S.loadedAt.getMinutes())}` : "";
    if (!S.loaded) { app.replaceChildren(h("p", { class: "center muted" }, "読み込み中…")); return; }
    const view = { plan: viewPlan, add: viewAdd, edit: viewEdit, closed: viewClosed }[S.tab]();
    app.replaceChildren(...[holidayWarning(), view].flat().filter(Boolean));
  }

  function holidayWarning() {
    const last = Math.max(...holidayYears());
    const need = new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0);
    if (last >= need) return null;
    return h("div", { class: "card small warn" }, `祝日データが ${last} 年までしかありません。Mac のアプリを一度開くと更新されます。`);
  }

  // ---- 予定（カレンダー＋今後の予定）----
  function viewPlan() {
    const ev = events(S.df), t = todayStr();
    const byDay = {}; ev.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
    const cal = calendar(S.month, d => {
      const list = byDay[d] || [];
      return list.length ? h("div", { class: "dots" }, list.map(e => h("span", { class: "dot" + (dayState(d) === "closed" ? " bad" : ""), style: `background:${groupColor(e.group)}` }))) : null;
    }, d => { S.selDay = d; render(); }, k => { S.month = addMonths(S.month, k); render(); }, S.selDay);
    const sel = byDay[S.selDay] || [];
    const st = dayState(S.selDay);
    const selCard = h("div", { class: "card" },
      h("h2", {}, fmt(S.selDay), " ", h("span", { class: st === "closed" ? "warn" : "muted small" }, stateJa(st), holidayName(S.selDay) ? `（${holidayName(S.selDay)}）` : "")),
      sel.length ? sel.map(evRow) : h("p", { class: "muted small" }, "この日の採取予定はありません"));
    const up = ev.filter(e => e.date >= t && e.date <= addDays(t, 60));
    const upCard = h("div", { class: "card" }, h("h2", {}, "今後60日の採取予定"),
      up.length ? groupByDate(up).map(([d, es]) => [h("div", { class: "dayhead" }, fmtMD(d), dayState(d) === "closed" ? h("span", { class: "warn" }, "  休診日に予定があります") : ""), es.map(evRow)])
                : h("p", { class: "muted small" }, "予定はありません"));
    return [h("div", { class: "card" }, cal, legend()), selCard, upCard];
  }
  const groupByDate = es => { const m = new Map(); es.forEach(e => { if (!m.has(e.date)) m.set(e.date, []); m.get(e.date).push(e); }); return [...m.entries()]; };
  function evRow(e) {
    const bad = dayState(e.date) === "closed";
    return h("div", { class: "ev" + (bad ? " bad" : ""), style: `border-left-color:${groupColor(e.group)}`, onclick: () => { S.editSid = e.sid; S.tab = "edit"; render(); } },
      h("span", { class: "sid" }, e.sid), vtag(e), h("span", { class: "sp small muted" }, e.label),
      h("span", { class: "shift" + (e.over ? " over" : "") }, shiftTxt(e)), bad ? h("span", { class: "warn small" }, "休診") : null);
  }
  function legend() {
    return h("div", { class: "legend" }, C.GROUPS.map(g => h("span", {}, h("i", { style: `background:${g.color}` }), g.name)),
      h("span", {}, h("i", { style: "background:repeating-linear-gradient(45deg,#e6e8eb,#e6e8eb 3px,#fff 3px,#fff 6px)" }), "休診"),
      h("span", {}, h("i", { style: "background:#fff6dd" }), "未設定（第5土曜）"));
  }
  function calendar(month, cellFn, onPick, onNav, selDay) {
    const first = toT(month), d0 = fromT(first - new Date(first).getUTCDay() * 864e5), t = todayStr();
    const rows = [];
    for (let w = 0; w < 6; w++) {
      const tds = [];
      for (let k = 0; k < 7; k++) {
        const d = addDays(d0, w * 7 + k), st = dayState(d);
        tds.push(h("td", { class: [d.slice(0, 7) !== month.slice(0, 7) ? "other" : "", st, d === t ? "today" : "", d === selDay ? "sel" : ""].join(" "), onclick: () => onPick(d) },
          h("span", { class: "n" }, +d.slice(8)), st === "unknown" ? h("span", { class: "q" }, "?") : null, cellFn(d)));
      }
      rows.push(h("tr", {}, tds));
      if (addDays(d0, (w + 1) * 7).slice(0, 7) > month.slice(0, 7)) break;
    }
    return h("div", {},
      h("div", { class: "calnav" }, h("button", { class: "iconbtn", onclick: () => onNav(-1) }, "◀"),
        h("b", {}, `${month.slice(0, 4)}年${+month.slice(5, 7)}月`), h("button", { class: "iconbtn", onclick: () => onNav(1) }, "▶")),
      h("table", { class: "cal" }, h("thead", {}, h("tr", {}, WD.map(x => h("th", {}, x)))), h("tbody", {}, rows)));
  }

  // ---- 予定日のプレビュー（登録・編集で共通）----
  function dateNote(d) {
    if (!d) return null;
    const st = dayState(d), nm = holidayName(d);
    if (st === "closed") return h("span", { class: "warn small" }, ` ← 休診日${nm ? "（" + nm + "）" : ""}`);
    if (st === "unknown") return h("span", { class: "over small" }, " ← 第5土曜（休診か未設定）");
    return null;
  }

  // ---- 新規登録 ----
  function viewAdd() {
    const idI = h("input", { type: "text", placeholder: "例: T012", value: suggestId(S.df), autocapitalize: "characters" });
    const gS = h("select", {}, C.GROUPS.map(g => h("option", { value: g.name }, g.name)));
    const d0I = h("input", { type: "date", value: todayStr() });
    const uses = C.VISIT_PLAN.slice(1).map(p => h("input", { type: "checkbox", checked: true }));
    const prev = h("div", {});
    const upd = () => {
      const d0 = d0I.value;
      prev.replaceChildren(...(!d0 ? [] : [h("table", { class: "shift" }, h("tbody", {}, C.VISIT_PLAN.map((p, i) => {
        const use = i === 0 || uses[i - 1].checked, d = use ? planDate(d0, i) : "";
        return h("tr", {}, h("td", {}, p.label), h("td", { class: "n" }, use ? fmt(d) : "採取なし", dateNote(d)));
      }))), h("p", { class: "muted small" }, "8週・24週の日付は、登録した後に「編集」で変えられます。")]));
    };
    [d0I, ...uses].forEach(x => x.addEventListener("change", upd)); upd();
    const save = async () => {
      const sid = idI.value.trim(), d0 = d0I.value;
      if (!sid) return toast("検体番号を入力してください。", true);
      if (S.df.some(r => r.subject_id === sid)) return toast(`${sid} は登録済みです。`, true);
      if (!validDate(d0)) return toast("初回採取日を選んでください。", true);
      const r = { subject_id: sid, group: gS.value, note: "", updated_at: nowStr() };
      C.VISIT_PLAN.forEach((p, i) => r[p.visit] = (i === 0 || uses[i - 1].checked) ? planDate(d0, i) : "");
      if (await commitData([...S.df, r], `${sid}（${gS.value}）を登録しました。`)) { S.month = monthStart(d0); S.selDay = d0; S.tab = "plan"; render(); }
    };
    return h("div", { class: "card" }, h("h2", {}, "新規登録"),
      h("label", { class: "f" }, "検体番号（被験者ID）"), idI,
      h("label", { class: "f" }, "群"), gS,
      h("label", { class: "f" }, "初回採取日（0週）"), d0I,
      h("label", { class: "f" }, "追跡採取を行う回"),
      C.VISIT_PLAN.slice(1).map((p, i) => h("label", { class: "check" }, uses[i], p.label)),
      prev, h("button", { class: "btn", onclick: save, disabled: S.busy }, "登録する"));
  }

  // ---- 被験者の編集 ----
  function viewEdit() {
    const r = S.df.find(x => x.subject_id === S.editSid);
    if (!r) {
      return h("div", { class: "card" }, h("h2", {}, "被験者を選ぶ"),
        S.df.length ? S.df.map(x => h("div", { class: "subj", onclick: () => { S.editSid = x.subject_id; render(); } },
          h("span", { class: "sid" }, x.subject_id), gtag(x.group),
          h("span", { class: "dates" }, C.VISIT_PLAN.map(p => `${p.visit}:${x[p.visit] ? fmtMD(x[p.visit]) : "なし"}`).join("  "))))
          : h("p", { class: "muted small" }, "まだ登録がありません"));
    }
    const gS = h("select", {}, C.GROUPS.map(g => h("option", { value: g.name, selected: g.name === r.group }, g.name)));
    const inputs = C.VISIT_PLAN.map(p => h("input", { type: "date", value: r[p.visit] || "" }));
    const uses = C.VISIT_PLAN.map((p, i) => i === 0 ? null : h("input", { type: "checkbox", checked: !!r[p.visit] }));
    const notes = C.VISIT_PLAN.map(() => h("span", {}));
    const noteI = h("input", { type: "text", value: r.note || "", placeholder: "名前・カルテ番号など個人が分かる情報は書かない" });
    const shiftBox = h("div", {});
    const upd = () => {
      const d0 = inputs[0].value;
      C.VISIT_PLAN.forEach((p, i) => {
        if (i > 0) { inputs[i].classList.toggle("hidden", !uses[i].checked); if (uses[i].checked && !inputs[i].value && d0) inputs[i].value = planDate(d0, i); }
        notes[i].replaceChildren(dateNote(i === 0 || uses[i].checked ? inputs[i].value : "") || "");
      });
      if (!d0) { shiftBox.replaceChildren(); return; }
      shiftBox.replaceChildren(h("div", { class: "muted small", style: "margin-top:10px" }, "規定日とのずれ"),
        h("table", { class: "shift" }, h("tbody", {}, C.VISIT_PLAN.slice(1).map((p, k) => {
          const i = k + 1, pd = planDate(d0, i);
          if (!uses[i].checked) return h("tr", {}, h("td", {}, p.label), h("td", { class: "n", colspan: 2 }, "採取なし"));
          const d = inputs[i].value; if (!d) return h("tr", {}, h("td", {}, p.label), h("td", {}, fmtMD(pd)), h("td", { class: "n" }, "—"));
          const sh = diffDays(d, pd);
          return h("tr", {}, h("td", {}, p.label), h("td", {}, "規定 " + fmtMD(pd)),
            h("td", { class: "n" + (Math.abs(sh) > p.tol ? " over" : "") }, sh === 0 ? "ちょうど" : (sh > 0 ? "+" : "") + sh + "日"));
        }))));
    };
    [...inputs, ...uses.filter(Boolean)].forEach(x => x.addEventListener("change", upd)); upd();
    const recalc = () => { const d0 = inputs[0].value; if (!d0) return toast("0週の日付を入れてください。", true);
      C.VISIT_PLAN.forEach((p, i) => inputs[i].value = planDate(d0, i)); upd(); toast("0週から計算し直しました。確認して「保存」を押してください。"); };
    const save = async () => {
      if (!validDate(inputs[0].value)) return toast("0週の日付を入れてください。", true);
      const nr = Object.assign({}, r, { group: gS.value, note: noteI.value, updated_at: nowStr() });
      C.VISIT_PLAN.forEach((p, i) => nr[p.visit] = (i === 0 || uses[i].checked) && validDate(inputs[i].value) ? normDate(inputs[i].value) : "");
      await commitData(S.df.map(x => x.subject_id === r.subject_id ? nr : x), `${r.subject_id} の予定を保存しました。`);
    };
    const del = async () => {
      if (!confirm(`${r.subject_id} を削除します。よろしいですか？\n（Dropbox の履歴から元に戻せます）`)) return;
      if (await commitData(S.df.filter(x => x.subject_id !== r.subject_id), `${r.subject_id} を削除しました。`)) { S.editSid = null; render(); }
    };
    return h("div", { class: "card" },
      h("div", { class: "row" }, h("h2", { style: "margin:0" }, r.subject_id), h("button", { class: "iconbtn", style: "flex:0", onclick: () => { S.editSid = null; render(); } }, "一覧へ")),
      h("label", { class: "f" }, "群"), gS,
      C.VISIT_PLAN.map((p, i) => i === 0
        ? [h("label", { class: "f" }, p.label), inputs[i], notes[i]]
        : [h("label", { class: "check" }, uses[i], p.label + " を採取する"), inputs[i], notes[i]]),
      shiftBox,
      h("label", { class: "f" }, "備考"), noteI,
      h("button", { class: "btn sub", onclick: recalc }, "0週から再計算"),
      h("button", { class: "btn", onclick: save, disabled: S.busy }, "保存"),
      h("p", { class: "muted small" }, "チェックを外した回は「採取なし」として保存されます。「保存」を押すまでファイルは変わりません。"),
      h("button", { class: "btn danger", onclick: del, disabled: S.busy }, "この被験者を削除"));
  }

  // ---- 休診日 ----
  function viewClosed() {
    const cal = calendar(S.closedMonth, d => {
      const o = S.ov.find(x => x.date === d);
      return o ? h("div", { class: "small", style: "color:#1f63bf;font-size:10px" }, "手動") : null;
    }, async d => {
      const ov = toggleDay(S.ov, d);
      const st = (() => { const o = ov.find(x => x.date === d); return o ? (o.closed ? "closed" : "open") : baseState(d); })();
      await commitClosed(ov, `${fmt(d)} を ${stateJa(st)} にしました。`);
    }, k => { S.closedMonth = addMonths(S.closedMonth, k); render(); }, null);
    const nc = S.ov.filter(o => o.closed).length;
    const clear = async () => { if (!S.ov.length) return; if (!confirm(`休診日の手動設定 ${S.ov.length} 日をすべて消し、既定のルールに戻します。`)) return;
      await commitClosed([], "手動設定を解除しました。"); };
    return [h("div", { class: "card" }, h("h2", {}, "休診日"),
      h("p", { class: "muted small" }, "日付をタップすると切り替わります（休診 ⇄ 診療。第5土曜は 未設定 → 休診 → 診療）。日曜・第1/第3土曜・祝日は最初から休診です。"),
      cal, legend(),
      h("p", { class: "small", style: "margin-top:10px" }, S.ov.length ? `手動設定 ${S.ov.length} 日（休診 ${nc} ／ 診療 ${S.ov.length - nc}）` : "手動設定はまだありません。"),
      S.ov.length ? h("button", { class: "btn danger", onclick: clear }, "手動設定をすべて解除") : null)];
  }

  // =====================================================================
  // 起動
  // =====================================================================
  document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => { S.tab = b.dataset.tab; if (S.tab !== "edit") S.editSid = null; render(); window.scrollTo(0, 0); }));
  $("#reload").addEventListener("click", () => loadAll().catch(e => toast(e.message, true)));
  $("#logout").addEventListener("click", () => { if (confirm("この iPhone から Dropbox の接続を外します。")) logout(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.loaded && !S.busy) loadAll().catch(() => {}); });

  (async () => {
    try {
      if (!DEMO) await finishLogin();
      render();
      if (DEMO || (C.DROPBOX_APP_KEY && loggedIn())) await loadAll();
    } catch (e) { S.busy = false; toast(e.message, true); render(); }
  })();

  // テスト用に一部の関数を公開
  window.__specimen = { parseCSV, toCSV, baseState, dayState, toggleDay, normalizeData, suggestId, events, S, loadHolidaysCSV };
})();
