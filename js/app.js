import { db } from "./db.js";
import { newState, schedule, previewLabels, dayStart, dayKey, maturity, fmtInterval } from "./srs.js";
import { $, $$, esc, md, renderCloze, clozeGaps, clozePlain, shuffle, compareAnswer, toast, download, parseCSV } from "./util.js";

const DAY = 864e5;
const TYPE_LABEL = { basic: "Frage", type: "Eintippen", mc: "Auswahl", cloze: "Lückentext" };
const MODES = {
  srs: { name: "Karteikarten", hint: "Fällige und neue Karten mit Wiederholungsplan" },
  drill: { name: "Durchblättern", hint: "Alle Karten ohne Plan, z. B. kurz vor der Klausur" },
  quiz: { name: "Quiz", hint: "Multiple Choice aus deinen Karten" },
  type: { name: "Eintippen", hint: "Kurze Antworten selbst schreiben" },
  cloze: { name: "Lückentext", hint: "Lücken in Definitionen und Formeln füllen" },
};

const S = {
  decks: [],          // {id,name,short,color,exam,cards:[]}
  byId: new Map(),    // cardId -> card (mit .deck)
  progress: new Map(),// cardId -> state
  settings: { newPerDay: 20, maxReviews: 200, theme: "auto", exams: {} },
  log: [],
};
const view = () => $("#view");

// ---------- Laden ----------
async function loadDecks() {
  const idx = await fetch("decks/index.json", { cache: "no-cache" }).then(r => r.json());
  const decks = await Promise.all(idx.decks.map(f => fetch("decks/" + f, { cache: "no-cache" }).then(r => r.json())));
  const user = await db.all("usercards");
  for (const d of decks) d.cards.forEach(c => { c.deck = d.id; c.builtin = true; });
  for (const uc of user) {
    let d = decks.find(x => x.id === uc.deck);
    if (!d) { d = { id: uc.deck, name: uc.deckName || uc.deck, short: (uc.deck || "?").toUpperCase().slice(0, 4), color: "#64748b", cards: [] }; decks.push(d); }
    d.cards.push({ ...uc, builtin: false });
  }
  S.decks = decks;
  S.byId = new Map();
  decks.forEach(d => d.cards.forEach(c => S.byId.set(c.id, c)));
}
async function loadState() {
  const [prog, log, settings] = await Promise.all([db.all("progress"), db.all("log"), db.getKV("settings", null)]);
  S.progress = new Map(prog.map(p => [p.id, p]));
  S.log = log;
  if (settings) S.settings = { ...S.settings, ...settings };
  applyTheme();
}
function applyTheme() {
  const t = S.settings.theme;
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
const saveSettings = () => db.setKV("settings", S.settings);

// ---------- Abfragen ----------
const deckOf = id => S.decks.find(d => d.id === id);
const stateOf = id => S.progress.get(id) || newState(id);
function pool(scope, tag) {
  const decks = scope === "all" ? S.decks : S.decks.filter(d => d.id === scope);
  return decks.flatMap(d => d.cards).filter(c => !stateOf(c.id).suspended && (!tag || (c.tags || []).includes(tag)));
}
function newDoneToday(deckId) {
  const t0 = dayStart();
  return S.log.filter(l => l.t >= t0 && l.mode === "srs" && l.wasNew && (!deckId || l.deck === deckId)).length;
}
function counts(scope, tag) {
  const now = Date.now(), end = dayStart() + DAY;
  let n = 0, l = 0, r = 0;
  const newLeft = {};
  for (const c of pool(scope, tag)) {
    const s = stateOf(c.id);
    if (s.status === "new") {
      newLeft[c.deck] ??= Math.max(0, S.settings.newPerDay - newDoneToday(c.deck));
      if (newLeft[c.deck] > 0) { n++; newLeft[c.deck]--; }
    } else if (s.status === "review") { if (s.due < end) r++; }
    else if (s.due <= now + 20 * 60e3 || s.due < end) l++;
  }
  return { n, l, r: Math.min(r, S.settings.maxReviews) };
}
function streak() {
  const days = new Set(S.log.map(l => dayKey(l.t)));
  let k = 0, t = Date.now();
  if (!days.has(dayKey(t))) t -= DAY;
  while (days.has(dayKey(t))) { k++; t -= DAY; }
  return k;
}
function examDays(deckId) {
  const d = S.settings.exams?.[deckId];
  if (!d) return null;
  return Math.ceil((new Date(d + "T08:00").getTime() - Date.now()) / DAY);
}
function allTags(scope) {
  const m = new Map();
  pool(scope).forEach(c => (c.tags || []).forEach(t => { if (t !== "ungeprüft") m.set(t, (m.get(t) || 0) + 1); }));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

async function logEntry(e) {
  const entry = { t: Date.now(), ...e };
  S.log.push(entry);
  await db.add("log", entry);
}

// ---------- Router ----------
function parseHash() {
  const [path, q] = location.hash.slice(1).split("?");
  const parts = (path || "/").split("/").filter(Boolean);
  return { parts, q: new URLSearchParams(q || "") };
}
async function route() {
  const { parts, q } = parseHash();
  document.body.classList.remove("studying");
  window.onkeydown = null;
  const [a, b] = parts;
  setNav(a || "home");
  if (!a) return home();
  if (a === "fach") return subject(b, q.get("tag"));
  if (a === "lernen") return study(b, q.get("modus") || "srs", q.get("tag"));
  if (a === "karten") return browse(q.get("fach"), q.get("q"));
  if (a === "karte") return edit(b, q.get("fach"));
  if (a === "statistik") return stats();
  if (a === "einstellungen") return settings();
  return home();
}
function setNav(key) {
  const map = { home: "home", fach: "home", lernen: "home", karten: "karten", karte: "karten", statistik: "statistik", einstellungen: "einstellungen" };
  $$("nav.bottom a").forEach(a => {
    if (a.dataset.nav === map[key]) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}
const go = h => { location.hash = h; };

// ---------- Startseite: der Karteikasten ----------
function home() {
  const total = counts("all");
  const due = total.n + total.l + total.r;
  const st = streak();
  const regs = S.decks.map((d, i) => {
    const c = counts(d.id);
    const cards = d.cards.length;
    const learned = d.cards.filter(x => ["young", "mature"].includes(maturity(S.progress.get(x.id)))).length;
    const ex = examDays(d.id);
    const exTxt = ex == null ? (d.exam || "") : ex >= 0 ? `Prüfung in ${ex} ${ex === 1 ? "Tag" : "Tagen"}` : "Prüfung vorbei";
    return `<a class="register" href="#/fach/${d.id}" style="--c:${d.color};--i:${i % 6}">
      <span class="tab">${esc(d.short)}</span>
      <div class="face">
        <div class="name">${esc(d.name)}</div>
        <div class="due"><b>${c.n + c.l + c.r}</b><span>heute</span></div>
        <div class="sub">${cards} Karten · ${esc(exTxt)}</div>
        <div class="bar" aria-label="${learned} von ${cards} gelernt"><i style="width:${cards ? (learned / cards) * 100 : 0}%"></i></div>
      </div></a>`;
  }).join("");
  view().innerHTML = `
    <header class="top"><h1>FunCard</h1>${st ? `<span class="streak" title="Lerntage in Folge">${st} ${st === 1 ? "Tag" : "Tage"} am Stück</span>` : ""}</header>
    <p class="box-intro">${due ? `<strong>${due} Karten warten heute.</strong><br><span class="muted">${[total.r && total.r + " wiederholen", total.l && total.l + " in Lernstufen", total.n && total.n + " neu"].filter(Boolean).join(", ")}</span>` : `<strong>Für heute ist alles gelernt.</strong> <span class="muted">Mit Durchblättern oder Quiz kannst du trotzdem üben.</span>`}</p>
    <div class="box">${regs}</div>
    <div class="stack" style="margin-top:20px">
      <a class="btn wide" href="#/lernen/all?modus=srs" ${due ? "" : 'aria-disabled="true"'}>Alle Fächer lernen</a>
      <a class="btn ghost wide" href="#/lernen/all?modus=quiz">Gemischtes Quiz</a>
    </div>`;
}

// ---------- Fachseite ----------
function subject(id, tag) {
  const d = deckOf(id);
  if (!d) return go("/");
  const c = counts(id, tag);
  const tags = allTags(id);
  const p = pool(id, tag);
  const nCloze = p.filter(x => x.type === "cloze").length;
  const nType = p.filter(isTypeable).length;
  const nQuiz = p.filter(isQuizzable).length;
  const qs = tag ? "&tag=" + encodeURIComponent(tag) : "";
  const ex = examDays(id);
  view().innerHTML = `
    <header class="top"><button class="back" aria-label="Zurück" onclick="history.back()">‹</button><h1 style="font-size:1.3rem">${esc(d.name)}</h1></header>
    <p class="muted" style="margin:0">${esc(d.exam || "")}${ex != null && ex >= 0 ? ` · noch ${ex} Tage` : ""}</p>
    <div class="chips" role="group" aria-label="Thema filtern">
      <button class="chip" aria-pressed="${!tag}" data-tag="">Alle Themen</button>
      ${tags.map(t => `<button class="chip" aria-pressed="${t === tag}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}
    </div>
    <div class="modes" style="--c:${d.color}">
      <a class="mode primary" href="#/lernen/${id}?modus=srs${qs}"><b>Karteikarten</b><small>${c.r} wiederholen, ${c.l} in Lernstufen, ${c.n} neu</small></a>
      <a class="mode" href="#/lernen/${id}?modus=quiz${qs}"><b>Quiz</b><small>${nQuiz} Fragen möglich</small></a>
      <a class="mode" href="#/lernen/${id}?modus=type${qs}"><b>Eintippen</b><small>${nType} kurze Antworten</small></a>
      <a class="mode" href="#/lernen/${id}?modus=cloze${qs}"><b>Lückentext</b><small>${nCloze} Lückentexte</small></a>
      <a class="mode" href="#/lernen/${id}?modus=drill${qs}"><b>Durchblättern</b><small>alle ${p.length} Karten</small></a>
    </div>
    <div class="row"><a class="btn ghost" href="#/karten?fach=${id}">Karten ansehen</a><a class="btn ghost" href="#/karte/neu?fach=${id}">Karte anlegen</a></div>`;
  $$(".chip").forEach(b => b.onclick = () => go(`/fach/${id}${b.dataset.tag ? "?tag=" + encodeURIComponent(b.dataset.tag) : ""}`));
}
const isTypeable = c => c.type === "type" || ((c.type === "basic") && String(c.back).length <= 40);
const isQuizzable = c => ["basic", "type", "mc"].includes(c.type) && String(c.back).length <= 180;

// ---------- Kartenvorderseite / -rückseite ----------
function cardFace(c, revealed) {
  const d = deckOf(c.deck);
  const unchecked = (c.tags || []).includes("ungeprüft");
  let q, a = "";
  if (c.type === "cloze") {
    q = `<div class="q" style="font-weight:400">${renderCloze(c.text, revealed ? "shown" : "blank")}</div>`;
  } else {
    q = `<div class="q">${md(c.front)}</div>`;
    if (revealed) a = `<div class="a"><div class="a-label">Antwort</div>${md(c.back)}</div>`;
  }
  return `<article class="kk" style="--c:${d.color}" aria-live="polite">
    <div class="kk-head"><span><span class="dot"></span>${esc(d.short)}</span><span>${TYPE_LABEL[c.type] || ""}</span></div>
    ${q}${a}
    ${revealed ? `<div class="tagline">${(c.tags || []).map(t => `<span class="${t === "ungeprüft" ? "warn" : ""}">${t === "ungeprüft" ? "nicht von Folie/Mitschrift – prüfen" : esc(t)}</span>`).join("")}</div>
      ${c.src ? `<div class="src">Quelle: ${esc(c.src)}</div>` : ""}` : `<div class="flip-hint">Tippen zum Umdrehen</div>`}
  </article>`;
}

// ---------- Lernen ----------
function study(scope, mode, tag) {
  document.body.classList.add("studying");
  if (mode === "quiz") return quiz(scope, tag);
  if (mode === "type") return typing(scope, tag);
  if (mode === "cloze") return clozeMode(scope, tag);
  if (mode === "drill") return drill(scope, tag);
  return srsSession(scope, tag);
}
function sessionHeader(scope, title, pct, extra = "") {
  const d = scope === "all" ? null : deckOf(scope);
  return `<header class="top"><button class="back" aria-label="Lernen beenden" onclick="history.back()">✕</button>
    <h1 style="font-size:1.15rem">${esc(title)}${d ? " · " + esc(d.short) : ""}</h1></header>
    <div class="progress" style="--c:${d ? d.color : "var(--ink)"}"><i style="width:${Math.round(pct * 100)}%"></i></div>${extra}`;
}
function doneScreen(scope, msg, sub = "") {
  view().innerHTML = `${sessionHeader(scope, "Fertig", 1)}
    <div class="empty"><h2>${esc(msg)}</h2><p class="muted">${esc(sub)}</p>
    <div class="stack"><a class="btn" href="#/${scope === "all" ? "" : "fach/" + scope}">Zurück</a>
    <a class="btn ghost" href="#/lernen/${scope}?modus=quiz">Noch ein Quiz</a></div></div>`;
}

function srsSession(scope, tag) {
  const now = Date.now(), end = dayStart() + DAY;
  const learn = [], rev = [], neu = [];
  const newLeft = {};
  for (const c of pool(scope, tag)) {
    const s = stateOf(c.id);
    if (s.status === "new") {
      newLeft[c.deck] ??= Math.max(0, S.settings.newPerDay - newDoneToday(c.deck));
      if (newLeft[c.deck] > 0) { neu.push(c); newLeft[c.deck]--; }
    } else if (s.status === "review") { if (s.due < end) rev.push(c); }
    else if (s.due < end) learn.push(c);
  }
  const revQ = shuffle(rev).slice(0, S.settings.maxReviews);
  const newQ = neu; // Reihenfolge wie im Deck – vom Einfachen zum Komplexen
  const total0 = revQ.length + newQ.length + learn.length;
  let shown = 0, current = null, revealed = false;

  function next() {
    const t = Date.now();
    learn.sort((a, b) => stateOf(a.id).due - stateOf(b.id).due);
    if (learn[0] && stateOf(learn[0].id).due <= t) return learn.shift();
    if (revQ.length && (!newQ.length || shown % 3 !== 2)) return revQ.shift();
    if (newQ.length) return newQ.shift();
    if (revQ.length) return revQ.shift();
    if (learn[0] && stateOf(learn[0].id).due - t < 20 * 60e3) return learn.shift();
    return null;
  }
  function render() {
    if (!current) {
      if (learn.length) {
        const wait = stateOf(learn[0].id).due - Date.now();
        return doneScreen(scope, "Pause", `Noch ${learn.length} Karte(n) in Lernstufen – wieder fällig in ${fmtInterval(wait)}.`);
      }
      return doneScreen(scope, total0 ? "Für heute geschafft." : "Gerade nichts fällig.", total0 ? `${shown} Karten gelernt.` : "Neue Karten kommen morgen dazu. Durchblättern oder Quiz gehen immer.");
    }
    const s = stateOf(current.id);
    const left = revQ.length + newQ.length + learn.length + 1;
    const labels = previewLabels(s);
    const cnt = `<div class="counts"><span class="n">${newQ.length + (s.status === "new" ? 1 : 0)} neu</span><span class="l">${learn.length + (["learning", "relearning"].includes(s.status) ? 1 : 0)} lernen</span><span class="r">${revQ.length + (s.status === "review" ? 1 : 0)} wiederholen</span></div>`;
    view().innerHTML = `${sessionHeader(scope, "Karteikarten", total0 ? 1 - left / Math.max(total0, left) : 0, cnt)}
      <div class="stage" id="stage">${cardFace(current, revealed)}</div>
      ${revealed ? `<div class="rate" role="group" aria-label="Wie gut wusstest du es?">
        <button class="r1" data-g="1">Nochmal<small>${labels[0]}</small></button>
        <button class="r2" data-g="2">Schwer<small>${labels[1]}</small></button>
        <button class="r3" data-g="3">Gut<small>${labels[2]}</small></button>
        <button class="r4" data-g="4">Einfach<small>${labels[3]}</small></button></div>
        <p class="muted" style="font-size:.8rem;text-align:center;margin:10px 0 0">Wischen: links Nochmal, rechts Gut</p>`
      : `<button class="btn wide" id="show">Antwort zeigen</button>`}
      <div class="row" style="margin-top:14px"><button class="btn ghost" id="susp" style="font-size:.85rem">Karte aussetzen</button></div>`;
    $("#show")?.addEventListener("click", reveal);
    $(".kk").addEventListener("click", () => { if (!revealed) reveal(); });
    $$(".rate button").forEach(b => b.onclick = () => rate(+b.dataset.g));
    $("#susp").onclick = async () => {
      const st = { ...stateOf(current.id), suspended: true };
      S.progress.set(current.id, st); await db.put("progress", st);
      toast("Karte ausgesetzt – unter Karten wieder aktivieren");
      current = next(); revealed = false; render();
    };
    swipe($("#stage"), dir => { if (!revealed) return reveal(); rate(dir < 0 ? 1 : 3); });
  }
  function reveal() { revealed = true; render(); }
  async function rate(g) {
    const prev = stateOf(current.id);
    const st = schedule(prev, g);
    S.progress.set(current.id, st);
    await db.put("progress", st);
    await logEntry({ mode: "srs", card: current.id, deck: current.deck, g, wasNew: prev.status === "new", prevStatus: prev.status });
    if (["learning", "relearning"].includes(st.status) && st.due < dayStart() + DAY) learn.push(current);
    shown++;
    current = next(); revealed = false; render();
  }
  window.onkeydown = e => {
    if (e.target.matches("input,textarea")) return;
    if (!revealed && (e.key === " " || e.key === "Enter")) { e.preventDefault(); reveal(); }
    else if (revealed && ["1", "2", "3", "4"].includes(e.key)) rate(+e.key);
  };
  current = next();
  render();
}

function swipe(el, cb) {
  let x0 = null, y0 = null;
  el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener("touchmove", e => {
    if (x0 == null) return;
    const dx = e.touches[0].clientX - x0;
    const kk = $(".kk", el);
    kk?.classList.toggle("swipe-l", dx < -40); kk?.classList.toggle("swipe-r", dx > 40);
  }, { passive: true });
  el.addEventListener("touchend", e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) cb(Math.sign(dx));
    else $$(".kk", el).forEach(k => k.classList.remove("swipe-l", "swipe-r"));
  });
}

// Durchblättern: alle Karten, ohne Plan; Zähler „gewusst / nicht gewusst“
function drill(scope, tag) {
  const cards = shuffle(pool(scope, tag));
  let i = 0, revealed = false, know = 0;
  const missed = [];
  function render() {
    if (i >= cards.length) {
      if (!cards.length) return doneScreen(scope, "Keine Karten", "Für diesen Filter gibt es keine Karten.");
      return doneScreen(scope, `${know} von ${cards.length} gewusst.`, missed.length ? `Nicht gewusst: ${missed.length}. Die landen nicht im Plan – lerne sie mit Karteikarten.` : "Stark.");
    }
    view().innerHTML = `${sessionHeader(scope, "Durchblättern", i / cards.length, `<div class="counts"><span>${i + 1} / ${cards.length}</span><span class="r">${know} gewusst</span></div>`)}
      <div class="stage" id="stage">${cardFace(cards[i], revealed)}</div>
      ${revealed ? `<div class="row"><button class="btn" style="background:var(--bad)" data-k="0">Nicht gewusst</button><button class="btn" style="background:var(--ok)" data-k="1">Gewusst</button></div>`
      : `<button class="btn wide" id="show">Antwort zeigen</button>`}`;
    $("#show")?.addEventListener("click", () => { revealed = true; render(); });
    $(".kk").addEventListener("click", () => { if (!revealed) { revealed = true; render(); } });
    $$("[data-k]").forEach(b => b.onclick = () => answer(+b.dataset.k));
    swipe($("#stage"), dir => { if (!revealed) { revealed = true; return render(); } answer(dir > 0 ? 1 : 0); });
  }
  function answer(k) {
    if (k) know++; else missed.push(cards[i]);
    logEntry({ mode: "drill", card: cards[i].id, deck: cards[i].deck, ok: !!k });
    i++; revealed = false; render();
  }
  window.onkeydown = e => {
    if (!revealed && (e.key === " " || e.key === "Enter")) { e.preventDefault(); revealed = true; render(); }
    else if (revealed && (e.key === "1" || e.key === "ArrowLeft")) answer(0);
    else if (revealed && (e.key === "2" || e.key === "ArrowRight")) answer(1);
  };
  render();
}

// Quiz: Multiple Choice
function distractors(card, n) {
  const same = pool(card.deck).filter(c => c.id !== card.id && ["basic", "type", "mc"].includes(c.type) && c.back !== card.back && String(c.back).length <= 180);
  const tagged = same.filter(c => (c.tags || []).some(t => t !== "ungeprüft" && (card.tags || []).includes(t)));
  const pick = shuffle(tagged).concat(shuffle(same));
  const out = [];
  for (const c of pick) { if (!out.includes(c.back)) out.push(c.back); if (out.length >= n) break; }
  return out;
}
function quiz(scope, tag) {
  const qs = shuffle(pool(scope, tag).filter(isQuizzable)).slice(0, 10).map(c => {
    const opts = c.type === "mc" && c.choices?.length ? shuffle(c.choices) : shuffle([c.back, ...distractors(c, 3)]);
    return { c, opts };
  }).filter(q => q.opts.length >= 2);
  let i = 0, score = 0, picked = null;
  const wrong = [];
  function render() {
    if (i >= qs.length) {
      if (!qs.length) return doneScreen(scope, "Kein Quiz möglich", "Für diesen Filter gibt es zu wenige passende Karten.");
      view().innerHTML = `${sessionHeader(scope, "Quiz", 1)}
        <div class="empty"><h2>${score} von ${qs.length} richtig</h2>
        ${wrong.length ? `<p class="muted">Diese solltest du dir nochmal ansehen:</p>` : `<p class="muted">Alles richtig.</p>`}</div>
        <div class="list">${wrong.map(c => itemHTML(c)).join("")}</div>
        <div class="stack"><a class="btn" href="#/lernen/${scope}?modus=quiz${tag ? "&tag=" + encodeURIComponent(tag) : ""}&r=${Date.now()}">Neues Quiz</a>
        <a class="btn ghost" href="#/${scope === "all" ? "" : "fach/" + scope}">Zurück</a></div>`;
      return;
    }
    const { c, opts } = qs[i];
    const d = deckOf(c.deck);
    view().innerHTML = `${sessionHeader(scope, "Quiz", i / qs.length, `<div class="counts"><span>Frage ${i + 1} von ${qs.length}</span><span class="r">${score} richtig</span></div>`)}
      <article class="kk" style="--c:${d.color};min-height:auto;padding-bottom:28px"><div class="kk-head"><span><span class="dot"></span>${esc(d.short)}</span><span>Quiz</span></div><div class="q">${md(c.front)}</div></article>
      <div class="choices" style="margin-top:14px">${opts.map((o, k) => `<button class="choice ${picked != null ? (o === c.back ? "right" : k === picked ? "wrong" : "") : ""}" data-k="${k}" ${picked != null ? "disabled" : ""}>${md(o)}</button>`).join("")}</div>
      ${picked != null ? `<p class="verdict ${opts[picked] === c.back ? "ok" : "no"}">${opts[picked] === c.back ? "Richtig." : "Leider falsch."}</p><button class="btn wide" id="nx">Weiter</button>` : ""}`;
    $$(".choice").forEach(b => b.onclick = () => {
      picked = +b.dataset.k;
      const ok = opts[picked] === c.back;
      if (ok) score++; else wrong.push(c);
      logEntry({ mode: "quiz", card: c.id, deck: c.deck, ok });
      render();
    });
    $("#nx")?.addEventListener("click", () => { i++; picked = null; render(); });
  }
  window.onkeydown = e => {
    if (picked == null && /^[1-4]$/.test(e.key)) $$(".choice")[+e.key - 1]?.click();
    else if (picked != null && e.key === "Enter") $("#nx")?.click();
  };
  render();
}

// Eintippen
function typing(scope, tag) {
  const cards = shuffle(pool(scope, tag).filter(isTypeable)).slice(0, 15);
  let i = 0, score = 0, result = null, given = "";
  function render() {
    if (i >= cards.length) {
      if (!cards.length) return doneScreen(scope, "Keine passenden Karten", "Eintippen nutzt Karten mit kurzer Antwort.");
      return doneScreen(scope, `${score} von ${cards.length} richtig.`, "");
    }
    const c = cards[i], d = deckOf(c.deck);
    view().innerHTML = `${sessionHeader(scope, "Eintippen", i / cards.length, `<div class="counts"><span>${i + 1} / ${cards.length}</span><span class="r">${score} richtig</span></div>`)}
      <article class="kk" style="--c:${d.color};min-height:auto;padding-bottom:28px"><div class="kk-head"><span><span class="dot"></span>${esc(d.short)}</span><span>Eintippen</span></div><div class="q">${md(c.front)}</div>
      ${result != null ? `<div class="a"><div class="a-label">Lösung</div>${md(c.back)}</div>` : ""}</article>
      <form id="f" class="stack" style="margin-top:14px">
        <input class="field" id="in" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Deine Antwort" value="${esc(given)}" ${result != null ? "readonly" : ""} aria-label="Deine Antwort">
        ${result == null ? `<button class="btn wide">Prüfen</button>` :
        `<p class="verdict ${result === true ? "ok" : "no"}">${result === true ? "Richtig." : result === "close" ? "Fast – prüf die Schreibweise." : "Nicht ganz."}</p>
         <div class="row">${result !== true ? `<button type="button" class="btn ghost" id="override">Ich lag richtig</button>` : ""}<button type="button" class="btn" id="nx">Weiter</button></div>`}
      </form>`;
    const inp = $("#in");
    if (result == null) inp.focus();
    $("#f").onsubmit = e => {
      e.preventDefault();
      if (result != null) return $("#nx").click();
      given = inp.value;
      result = compareAnswer(given, c.back);
      if (result === true) score++;
      logEntry({ mode: "type", card: c.id, deck: c.deck, ok: result === true });
      render();
      $("#nx")?.focus();
    };
    $("#override")?.addEventListener("click", () => { score++; result = true; render(); });
    $("#nx")?.addEventListener("click", () => { i++; result = null; given = ""; render(); });
  }
  render();
}

// Lückentext
function clozeMode(scope, tag) {
  const cards = shuffle(pool(scope, tag).filter(c => c.type === "cloze"));
  let i = 0, checked = false, gapsOk = 0, gapsAll = 0;
  function render() {
    if (i >= cards.length) {
      if (!cards.length) return doneScreen(scope, "Keine Lückentexte", "Für diesen Filter gibt es keine Lückentext-Karten.");
      return doneScreen(scope, `${gapsOk} von ${gapsAll} Lücken richtig.`, "");
    }
    const c = cards[i], d = deckOf(c.deck);
    view().innerHTML = `${sessionHeader(scope, "Lückentext", i / cards.length, `<div class="counts"><span>${i + 1} / ${cards.length}</span><span class="r">${gapsOk} Lücken richtig</span></div>`)}
      <form id="f">
      <article class="kk" style="--c:${d.color};min-height:auto;padding-bottom:28px"><div class="kk-head"><span><span class="dot"></span>${esc(d.short)}</span><span>Lückentext</span></div>
        <div class="q" style="font-weight:400">${renderCloze(c.text, "inputs")}</div>
        <div id="sol"></div></article>
      <div class="stack" style="margin-top:14px"><button class="btn wide" id="go">Prüfen</button></div></form>`;
    const ins = $$(".gapin");
    ins[0]?.focus();
    $("#f").onsubmit = e => {
      e.preventDefault();
      if (checked) { i++; checked = false; return render(); }
      const gaps = clozeGaps(c.text);
      let ok = 0;
      ins.forEach((inp, k) => {
        const r = compareAnswer(inp.value, gaps[k]) === true;
        inp.classList.add(r ? "ok" : "no"); inp.readOnly = true;
        if (r) ok++;
      });
      gapsOk += ok; gapsAll += gaps.length; checked = true;
      logEntry({ mode: "cloze", card: c.id, deck: c.deck, ok: ok === gaps.length });
      $("#sol").innerHTML = `<div class="a"><div class="a-label">Lösung</div>${renderCloze(c.text, "shown")}</div>${c.src ? `<div class="src">Quelle: ${esc(c.src)}</div>` : ""}`;
      $("#go").textContent = "Weiter";
      $("#go").focus();
    };
  }
  render();
}

// ---------- Karten durchsuchen ----------
function itemHTML(c, withActions = false) {
  const d = deckOf(c.deck), s = stateOf(c.id);
  const q = c.type === "cloze" ? renderCloze(c.text, "shown") : md(c.front);
  const a = c.type === "cloze" ? "" : `<div class="a">${md(c.back)}</div>`;
  const status = s.suspended ? "ausgesetzt" : { new: "neu", learning: "lernend", relearning: "wiederholt", review: s.interval >= 21 ? "gefestigt" : "jung" }[s.status];
  return `<div class="item" style="--c:${d.color}"><div class="q">${q}</div>${a}
    <div class="meta"><span>${esc(d.short)} · ${status}${s.status === "review" ? " · in " + fmtInterval(Math.max(0, s.due - Date.now())) : ""}</span>
    ${withActions ? `<span>${s.suspended ? `<button data-unsusp="${c.id}">Aktivieren</button>` : ""} ${!c.builtin ? `<button data-edit="${c.id}">Bearbeiten</button>` : ""}</span>` : ""}</div></div>`;
}
function browse(fach, query) {
  const q = (query || "").toLowerCase();
  const cards = S.decks.filter(d => !fach || d.id === fach).flatMap(d => d.cards).filter(c => {
    if (!q) return true;
    const hay = [c.front, c.back, c.text, ...(c.tags || [])].join(" ").toLowerCase();
    return hay.includes(q);
  });
  view().innerHTML = `
    <header class="top"><h1>Karten</h1><a class="btn" href="#/karte/neu${fach ? "?fach=" + fach : ""}" style="padding:8px 14px">Neu</a></header>
    <input class="field" id="search" type="search" placeholder="Begriff, Definition oder Thema suchen" value="${esc(query || "")}" aria-label="Suchen">
    <div class="chips" role="group" aria-label="Fach filtern">
      <button class="chip" aria-pressed="${!fach}" data-f="">Alle</button>
      ${S.decks.map(d => `<button class="chip" aria-pressed="${d.id === fach}" data-f="${d.id}">${esc(d.short)}</button>`).join("")}
    </div>
    <p class="muted" style="margin:0">${cards.length} Karten</p>
    <div class="list">${cards.slice(0, 300).map(c => itemHTML(c, true)).join("")}</div>`;
  const s = $("#search");
  let tmo;
  s.oninput = () => { clearTimeout(tmo); tmo = setTimeout(() => history.replaceState(null, "", `#/karten?${new URLSearchParams({ ...(fach ? { fach } : {}), q: s.value })}`) || browse(fach, s.value), 200); };
  if (query) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  $$(".chip").forEach(b => b.onclick = () => go(`/karten?${new URLSearchParams({ ...(b.dataset.f ? { fach: b.dataset.f } : {}), ...(s.value ? { q: s.value } : {}) })}`));
  $$("[data-edit]").forEach(b => b.onclick = () => go("/karte/" + b.dataset.edit));
  $$("[data-unsusp]").forEach(b => b.onclick = async () => {
    const st = { ...stateOf(b.dataset.unsusp) }; delete st.suspended;
    S.progress.set(st.id, st); await db.put("progress", st); browse(fach, s.value);
  });
}

// ---------- Karte anlegen / bearbeiten ----------
function edit(id, fach) {
  const existing = id && id !== "neu" ? S.byId.get(id) : null;
  if (existing?.builtin) return go("/karten");
  const c = existing || { type: "basic", deck: fach || S.decks[0].id, front: "", back: "", text: "", tags: [] };
  view().innerHTML = `
    <header class="top"><button class="back" aria-label="Zurück" onclick="history.back()">‹</button><h1 style="font-size:1.3rem">${existing ? "Karte bearbeiten" : "Neue Karte"}</h1></header>
    <form class="panel stack" id="f">
      <label class="f">Fach<select class="field" name="deck">${S.decks.map(d => `<option value="${d.id}" ${d.id === c.deck ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
      <label class="f">Kartentyp<select class="field" name="type">
        ${Object.entries(TYPE_LABEL).filter(([k]) => k !== "mc").map(([k, v]) => `<option value="${k}" ${k === c.type ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <div id="fb"><label class="f">Frage / Begriff<textarea class="field" name="front">${esc(c.front)}</textarea></label>
        <label class="f">Antwort / Definition<textarea class="field" name="back">${esc(c.back)}</textarea></label></div>
      <div id="fc"><label class="f">Text mit Lücken<textarea class="field" name="text" placeholder="Spannung σ = {{F / A}}">${esc(c.text)}</textarea></label>
        <p class="muted" style="margin:0;font-size:.85rem">Lücken in doppelte geschweifte Klammern setzen: {{Lösung}}</p></div>
      <label class="f">Themen (mit Komma getrennt)<input class="field" name="tags" value="${esc((c.tags || []).join(", "))}"></label>
      <div class="row"><button class="btn">Speichern</button>${existing ? `<button type="button" class="btn ghost" id="del">Löschen</button>` : ""}</div>
    </form>`;
  const f = $("#f");
  const sync = () => { const cl = f.type.value === "cloze"; $("#fb").hidden = cl; $("#fc").hidden = !cl; };
  f.type.onchange = sync; sync();
  f.onsubmit = async e => {
    e.preventDefault();
    const card = {
      id: existing?.id || "u-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      deck: f.deck.value, type: f.type.value,
      tags: f.tags.value.split(",").map(t => t.trim()).filter(Boolean), src: "eigene Karte",
    };
    if (card.type === "cloze") {
      card.text = f.text.value.trim();
      if (!clozeGaps(card.text).length) return toast("Mindestens eine Lücke mit {{…}} setzen");
    } else {
      card.front = f.front.value.trim(); card.back = f.back.value.trim();
      if (!card.front || !card.back) return toast("Frage und Antwort ausfüllen");
    }
    await db.put("usercards", card);
    await loadDecks();
    toast(existing ? "Karte gespeichert" : "Karte angelegt");
    if (existing) history.back(); else edit("neu", card.deck);
  };
  $("#del")?.addEventListener("click", async () => {
    if (!confirm("Karte endgültig löschen?")) return;
    await db.del("usercards", existing.id); await db.del("progress", existing.id);
    S.progress.delete(existing.id); await loadDecks(); toast("Karte gelöscht"); history.back();
  });
}

// ---------- Statistik ----------
function stats() {
  const days = 14, t0 = dayStart() - (days - 1) * DAY;
  const per = Array(days).fill(0);
  S.log.filter(l => l.t >= t0).forEach(l => { per[Math.floor((l.t - t0) / DAY)]++; });
  const max = Math.max(1, ...per);
  const today = per[days - 1];
  const recent = S.log.filter(l => l.mode === "srs" && l.prevStatus === "review" && l.t > Date.now() - 30 * DAY);
  const ret = recent.length ? Math.round(recent.filter(l => l.g > 1).length / recent.length * 100) + " %" : "–";
  const quizL = S.log.filter(l => ["quiz", "type", "cloze", "drill"].includes(l.mode) && l.t > Date.now() - 30 * DAY);
  const quizR = quizL.length ? Math.round(quizL.filter(l => l.ok).length / quizL.length * 100) + " %" : "–";
  // Prognose: fällige Wiederholungen der nächsten 7 Tage
  const fc = Array(7).fill(0);
  S.progress.forEach(s => { if (s.status === "review" && !s.suspended) { const k = Math.max(0, Math.floor((s.due - dayStart()) / DAY)); if (k < 7) fc[k]++; } });
  const fmax = Math.max(1, ...fc);
  const rows = S.decks.map(d => {
    const m = { new: 0, learning: 0, young: 0, mature: 0 };
    d.cards.forEach(c => m[maturity(S.progress.get(c.id))]++);
    return `<tr><td>${esc(d.short)}</td><td>${d.cards.length}</td><td>${m.new}</td><td>${m.learning}</td><td>${m.young}</td><td>${m.mature}</td></tr>`;
  }).join("");
  const wd = t => new Date(t).toLocaleDateString("de-DE", { weekday: "short" });
  view().innerHTML = `
    <header class="top"><h1>Statistik</h1></header>
    <div class="statgrid">
      <div class="stat"><b>${today}</b><small>Antworten heute</small></div>
      <div class="stat"><b>${streak()}</b><small>Tage am Stück</small></div>
      <div class="stat"><b>${ret}</b><small>behalten (30 T)</small></div>
    </div>
    <h2 class="sec">Letzte 14 Tage</h2>
    <div class="chart" role="img" aria-label="Antworten pro Tag">${per.map((v, k) => `<div class="${k === days - 1 ? "today" : ""}" style="height:${v / max * 100}%" title="${v}"></div>`).join("")}</div>
    <div class="chart-x muted"><span>${wd(t0)}</span><span>heute</span></div>
    <h2 class="sec">Fällig in den nächsten 7 Tagen</h2>
    <div class="chart" role="img" aria-label="Fällige Wiederholungen">${fc.map((v, k) => `<div style="height:${v / fmax * 100}%;background:var(--ok)" title="${v}"></div>`).join("")}</div>
    <div class="chart-x muted"><span>heute</span><span>${fc.join(" · ")}</span><span>+6</span></div>
    <h2 class="sec">Stand je Fach</h2>
    <table class="t"><thead><tr><th>Fach</th><th>Karten</th><th>neu</th><th>lernend</th><th>jung</th><th>gefestigt</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted" style="font-size:.85rem">Gefestigt heißt: nächste Wiederholung erst in 21 Tagen oder später. Trefferquote in Quiz, Eintippen und Lückentext (30 Tage): ${quizR}.</p>`;
}

// ---------- Einstellungen ----------
function settings() {
  const st = S.settings;
  view().innerHTML = `
    <header class="top"><h1>Einstellungen</h1></header>
    <form class="panel stack" id="f"><h2>Lernen</h2>
      <label class="f">Neue Karten pro Tag und Fach<input class="field" type="number" min="0" max="200" name="newPerDay" value="${st.newPerDay}"></label>
      <label class="f">Höchstens Wiederholungen pro Sitzung<input class="field" type="number" min="10" max="2000" name="maxReviews" value="${st.maxReviews}"></label>
      <label class="f">Darstellung<select class="field" name="theme">
        ${[["auto", "wie das Gerät"], ["light", "hell"], ["dark", "dunkel"]].map(([v, l]) => `<option value="${v}" ${v === st.theme ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <h2 style="margin-top:8px">Prüfungstermine</h2>
      ${S.decks.map(d => `<label class="f">${esc(d.name)}<input class="field" type="date" name="exam-${d.id}" value="${st.exams?.[d.id] || ""}"></label>`).join("")}
      <button class="btn">Speichern</button>
    </form>
    <div class="panel stack"><h2>Sichern und importieren</h2>
      <p class="muted" style="margin:0">Dein Lernstand liegt nur auf diesem Gerät. Sichere ihn regelmäßig.</p>
      <button class="btn ghost" id="exp">Sicherung herunterladen</button>
      <label class="btn ghost" for="imp">Sicherung oder Karten importieren</label>
      <input type="file" id="imp" accept=".json,.csv,.tsv,.txt" hidden>
      <p class="muted" style="margin:0;font-size:.85rem">Importiert werden FunCard-Sicherungen (.json), Decks im FunCard-Format (.json) und Tabellen (.csv/.tsv) mit den Spalten Frage; Antwort; Themen.</p>
    </div>
    <div class="panel stack"><h2>Zurücksetzen</h2>
      <button class="btn ghost" id="reset" style="color:var(--bad)">Lernstand löschen</button>
    </div>
    <p class="muted" style="font-size:.8rem;text-align:center">FunCard ${window.FUNCARD_VERSION || ""}</p>`;
  const f = $("#f");
  f.onsubmit = async e => {
    e.preventDefault();
    st.newPerDay = Math.max(0, +f.newPerDay.value || 0);
    st.maxReviews = Math.max(10, +f.maxReviews.value || 200);
    st.theme = f.theme.value;
    st.exams = {};
    S.decks.forEach(d => { const v = f["exam-" + d.id].value; if (v) st.exams[d.id] = v; });
    await saveSettings(); applyTheme(); toast("Einstellungen gespeichert");
  };
  $("#exp").onclick = async () => {
    const data = { app: "funcard", version: 1, exported: new Date().toISOString(), settings: S.settings,
      progress: [...S.progress.values()], usercards: await db.all("usercards"), log: S.log };
    download(`funcard-sicherung-${dayKey(Date.now())}.json`, JSON.stringify(data));
  };
  $("#imp").onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    try { await importText(file.name, text); } catch (err) { toast("Import fehlgeschlagen: " + err.message); }
    e.target.value = "";
  };
  $("#reset").onclick = async () => {
    if (!confirm("Gesamten Lernstand und Verlauf löschen? Eigene Karten bleiben erhalten.")) return;
    await db.clear("progress"); await db.clear("log"); S.progress.clear(); S.log = [];
    toast("Lernstand gelöscht");
  };
}
async function importText(name, text) {
  if (/\.json$/i.test(name)) {
    const data = JSON.parse(text);
    if (data.app === "funcard") {
      if (!confirm(`Sicherung vom ${new Date(data.exported).toLocaleString("de-DE")} einspielen? Der aktuelle Lernstand wird überschrieben.`)) return;
      await db.clear("progress"); await db.clear("log");
      await db.putMany("progress", data.progress || []);
      await db.putMany("usercards", data.usercards || []);
      for (const l of data.log || []) { const { n, ...rest } = l; await db.add("log", rest); }
      if (data.settings) { S.settings = { ...S.settings, ...data.settings }; await saveSettings(); }
      await loadDecks(); await loadState(); toast("Sicherung eingespielt"); return;
    }
    if (Array.isArray(data.cards)) {
      const deck = data.id || "import";
      const cards = data.cards.map((c, k) => ({ ...c, id: "u-" + deck + "-" + (c.id || k), deck, deckName: data.name }));
      await db.putMany("usercards", cards); await loadDecks();
      toast(`${cards.length} Karten importiert`); return;
    }
    throw new Error("unbekanntes JSON-Format");
  }
  const rows = parseCSV(text);
  if (!rows.length) throw new Error("keine Zeilen erkannt");
  const choice = prompt(`${rows.length} Karten gefunden. In welches Fach? (${S.decks.map(d => d.short).join(", ")})`, S.decks[0].short);
  const d = S.decks.find(x => x.short.toLowerCase() === (choice || "").trim().toLowerCase());
  if (!d) throw new Error("Fach nicht gefunden");
  const base = Date.now().toString(36);
  await db.putMany("usercards", rows.map((r, k) => ({ id: `u-${base}-${k}`, deck: d.id, type: "basic", ...r, src: "Import " + name })));
  await loadDecks(); toast(`${rows.length} Karten in ${d.short} importiert`);
}

// ---------- Start ----------
async function init() {
  try {
    await loadState();
    await loadDecks();
  } catch (e) {
    view().innerHTML = `<div class="empty"><h2>Karten konnten nicht geladen werden</h2><p class="muted">${esc(e.message)}. Prüfe die Verbindung zum Server und lade neu.</p><button class="btn" onclick="location.reload()">Neu laden</button></div>`;
    return;
  }
  window.addEventListener("hashchange", route);
  route();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
init();
