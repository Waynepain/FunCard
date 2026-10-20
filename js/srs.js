// Spaced Repetition nach dem Anki-Prinzip (SM-2 mit Lernstufen).
// Status: new → learning → review; bei „Nochmal“ in review → relearning.
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
export const LEARN_STEPS = [1 * MIN, 10 * MIN];
export const RELEARN_STEPS = [10 * MIN];
const GRAD_INTERVAL = 1;      // Tage nach „Gut“ am Ende der Lernstufen
const EASY_INTERVAL = 4;      // Tage nach „Einfach“ bei neuer Karte
const START_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_INTERVAL = 365;

export function newState(id) {
  return { id, status: "new", due: 0, interval: 0, ease: START_EASE, step: 0, reps: 0, lapses: 0, last: 0 };
}

// Tagesgrenze: neuer Lerntag beginnt um 4 Uhr morgens (wie Anki)
export function dayStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(4, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}
export function dayKey(t) {
  const d = new Date(dayStart(t));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function fuzz(days) {
  if (days < 3) return days;
  const f = Math.max(1, Math.round(days * 0.05));
  return days + Math.round((Math.random() * 2 - 1) * f);
}
function reviewDue(now, days) {
  return dayStart(now) + days * DAY; // fällig ab Tagesbeginn (4 Uhr) in „days“ Tagen
}

// Liefert den neuen Zustand (rein, ohne Zufall wenn preview=true)
export function schedule(prev, grade, now = Date.now(), preview = false) {
  const s = { ...prev, reps: prev.reps + 1, last: now };
  const fz = preview ? d => d : fuzz;
  const learning = s.status === "new" || s.status === "learning";
  const relearning = s.status === "relearning";

  if (learning || relearning) {
    const steps = relearning ? RELEARN_STEPS : LEARN_STEPS;
    if (s.status === "new") s.step = 0;
    if (grade === 1) {
      s.status = relearning ? "relearning" : "learning";
      s.step = 0;
      s.due = now + steps[0];
    } else if (grade === 2) {
      s.status = relearning ? "relearning" : "learning";
      const cur = steps[s.step] ?? steps[steps.length - 1];
      const next = steps[s.step + 1] ?? cur * 1.5;
      s.due = now + Math.round((cur + next) / 2);
    } else if (grade === 3) {
      if (s.step + 1 < steps.length) {
        s.status = relearning ? "relearning" : "learning";
        s.step += 1;
        s.due = now + steps[s.step];
      } else {
        s.status = "review";
        s.step = 0;
        s.interval = relearning ? Math.max(1, s.interval) : GRAD_INTERVAL;
        s.due = reviewDue(now, s.interval);
      }
    } else {
      s.status = "review";
      s.step = 0;
      s.interval = relearning ? Math.max(1, s.interval) + 1 : EASY_INTERVAL;
      s.due = reviewDue(now, s.interval);
    }
    return s;
  }

  // review
  const overdue = Math.max(0, Math.floor((dayStart(now) - dayStart(s.due)) / DAY));
  if (grade === 1) {
    s.lapses += 1;
    s.ease = Math.max(MIN_EASE, s.ease - 0.2);
    s.interval = Math.max(1, Math.round(s.interval * 0.5));
    s.status = "relearning";
    s.step = 0;
    s.due = now + RELEARN_STEPS[0];
    return s;
  }
  let iv;
  if (grade === 2) {
    s.ease = Math.max(MIN_EASE, s.ease - 0.15);
    iv = Math.max(s.interval + 1, s.interval * 1.2);
  } else if (grade === 3) {
    iv = Math.max(s.interval + 1, (s.interval + overdue / 2) * s.ease);
  } else {
    s.ease += 0.15;
    iv = Math.max(s.interval + 2, (s.interval + overdue) * s.ease * 1.3);
  }
  s.interval = Math.min(MAX_INTERVAL, fz(Math.round(iv)));
  s.due = reviewDue(now, s.interval);
  return s;
}

export function fmtInterval(ms) {
  const m = ms / MIN;
  if (m < 60) return Math.max(1, Math.round(m)) + " min";
  const h = m / 60;
  if (h < 20) return Math.round(h) + " h";
  const d = ms / DAY;
  if (d < 31) return Math.round(d) + " T";
  if (d < 365) return (d / 30).toFixed(1).replace(".", ",") + " M";
  return (d / 365).toFixed(1).replace(".", ",") + " J";
}

export function previewLabels(state, now = Date.now()) {
  return [1, 2, 3, 4].map(g => {
    const n = schedule(state, g, now, true);
    return n.status === "review" ? (n.interval < 31 ? n.interval + " T" : fmtInterval(n.interval * DAY)) : fmtInterval(n.due - now);
  });
}

// „Gelernt“ = mindestens einmal in review mit Intervall ≥ 21 Tage gilt als gefestigt
export function maturity(state) {
  if (!state || state.status === "new") return "new";
  if (state.status === "review" && state.interval >= 21) return "mature";
  if (state.status === "review") return "young";
  return "learning";
}
