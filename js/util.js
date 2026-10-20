// Hilfsfunktionen: Escaping, Mini-Markdown, Lückentext, Antwortvergleich
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// **fett**, `code`, Zeilenumbrüche
export function md(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

const GAP_RE = /\{\{(.+?)\}\}/g;
export function clozeGaps(text) {
  return [...String(text).matchAll(GAP_RE)].map(m => m[1]);
}
// mode: "blank" | "shown" | "inputs"
export function renderCloze(text, mode) {
  let i = 0;
  const parts = String(text).split(GAP_RE);
  return parts.map((p, idx) => {
    if (idx % 2 === 0) return md(p);
    const n = i++;
    if (mode === "shown") return `<span class="gap shown">${esc(p)}</span>`;
    if (mode === "inputs") return `<input class="gapin" data-gap="${n}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Lücke ${n + 1}" style="width:${Math.min(14, Math.max(4, p.length + 2))}ch">`;
    return `<span class="gap">${esc(p)}</span>`;
  }).join("");
}
export function clozePlain(text) { return String(text).replace(GAP_RE, "$1"); }

export function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

function norm(s) {
  return String(s).toLowerCase()
    .replace(/[„“"'´`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()]+$/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .trim();
}
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// true = richtig, "close" = Tippfehler-nah, false = falsch
export function compareAnswer(given, expected) {
  const g = norm(given), e = norm(expected);
  if (!g) return false;
  if (g === e) return true;
  const gn = parseFloat(g.replace(/[^\d.\-]/g, "")), en = parseFloat(e.replace(/[^\d.\-]/g, ""));
  if (/^[-\d.\s]+[a-zµ°%/²³]*$/i.test(e) && !isNaN(gn) && !isNaN(en)) return Math.abs(gn - en) < 1e-9;
  const d = lev(g, e);
  const ratio = 1 - d / Math.max(g.length, e.length);
  if (ratio >= 0.9 || (e.length > 4 && d <= 1)) return true;
  if (ratio >= 0.75) return "close";
  return false;
}

export function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

export function download(name, text, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function parseCSV(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim() && !l.startsWith("#"));
  if (!lines.length) return [];
  const delim = lines[0].includes("\t") ? "\t" : ";";
  return lines.map(l => {
    const cols = l.split(delim).map(c => c.trim().replace(/^"(.*)"$/, "$1").replace(/""/g, '"'));
    return { front: cols[0] || "", back: cols[1] || "", tags: (cols[2] || "").split(/[,\s]+/).filter(Boolean) };
  }).filter(r => r.front);
}
