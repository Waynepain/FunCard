// Kleiner IndexedDB-Wrapper. Stores:
//  progress  – Lernstand je Karte (keyPath id)
//  log       – jede Bewertung / jede Quizantwort (autoIncrement)
//  usercards – selbst angelegte oder importierte Karten (keyPath id)
//  kv        – Einstellungen und Sonstiges (keyPath k)
const DB_NAME = "funcard";
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("progress")) db.createObjectStore("progress", { keyPath: "id" });
      if (!db.objectStoreNames.contains("log")) {
        const s = db.createObjectStore("log", { keyPath: "n", autoIncrement: true });
        s.createIndex("t", "t");
      }
      if (!db.objectStoreNames.contains("usercards")) db.createObjectStore("usercards", { keyPath: "id" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  all: store => tx(store, "readonly", s => reqP(s.getAll())),
  get: (store, key) => tx(store, "readonly", s => reqP(s.get(key))),
  put: (store, val) => tx(store, "readwrite", s => { s.put(val); }),
  putMany: (store, vals) => tx(store, "readwrite", s => { vals.forEach(v => s.put(v)); }),
  del: (store, key) => tx(store, "readwrite", s => { s.delete(key); }),
  clear: store => tx(store, "readwrite", s => { s.clear(); }),
  add: (store, val) => tx(store, "readwrite", s => { s.add(val); }),
  async getKV(k, fallback) { const r = await this.get("kv", k); return r ? r.v : fallback; },
  setKV(k, v) { return this.put("kv", { k, v }); },
};
