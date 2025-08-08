
/* store.js - IndexedDB wrapper with in-memory fallback */
const DB_NAME = 'leomind-db';
const DB_VERSION = 1;
const DEFAULT_TAGS = ['Stress', 'Arbeit', 'Sport', 'Soziales', 'Krankheit'];

let idbAvailable = true;
let dbPromise = null;

// In-memory fallback store
const mem = {
  profile: { id:'singleton', name:'', phqDay:null, phqTime:null },
  meds: [],
  tags: new Set(DEFAULT_TAGS),
  entries: [],
};

function openDB() {
  if (!('indexedDB' in window)) {
    idbAvailable = false;
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meds')) {
        db.createObjectStore('meds', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('tags')) {
        db.createObjectStore('tags', { keyPath: 'tag' });
      }
      if (!db.objectStoreNames.contains('entries')) {
        db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { idbAvailable = false; resolve(null); };
    req.onblocked = () => { idbAvailable = false; resolve(null); };
  });
}

async function initStore() {
  if (!dbPromise) dbPromise = openDB();
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = db.transaction(['profile','tags'],'readwrite');
    // defaults
    const getReq = tx.objectStore('profile').get('singleton');
    await new Promise((res)=>{ getReq.onsuccess = res; getReq.onerror = res; });
    if (!getReq.result) tx.objectStore('profile').put({ id:'singleton', name:'', phqDay:null, phqTime:null });
    DEFAULT_TAGS.forEach(t=> tx.objectStore('tags').put({ tag:t }));
  } else {
    DEFAULT_TAGS.forEach(t=>mem.tags.add(t));
  }
}

export async function storeReady() { await initStore(); return { idbAvailable }; }

export async function getProfile() {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = db.transaction(['profile'], 'readonly');
    const req = tx.objectStore('profile').get('singleton');
    return await new Promise((res)=>{ req.onsuccess=()=>res(req.result||{id:'singleton',name:'',phqDay:null,phqTime:null}); req.onerror=()=>res({id:'singleton',name:'',phqDay:null,phqTime:null}); });
  }
  return mem.profile;
}

export async function setProfile(upd) {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = db.transaction(['profile'], 'readwrite');
    const cur = await new Promise((res)=>{ const r=tx.objectStore('profile').get('singleton'); r.onsuccess=()=>res(r.result||{id:'singleton'}); r.onerror=()=>res({id:'singleton'}); });
    const next = { ...cur, ...upd };
    tx.objectStore('profile').put(next);
    return next;
  }
  Object.assign(mem.profile, upd); return mem.profile;
}

export async function listMeds(activeOnly=false) {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = db.transaction(['meds'],'readonly');
    const req = tx.objectStore('meds').getAll();
    const all = await new Promise((res)=>{ req.onsuccess=()=>res(req.result||[]); req.onerror=()=>res([]); });
    return activeOnly ? all.filter(m=>m.active) : all;
  }
  const all = mem.meds.slice(); return activeOnly ? all.filter(m=>m.active) : all;
}

export async function upsertMed(med) {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = db.transaction(['meds'],'readwrite');
    tx.objectStore('meds').put(med);
    return med;
  }
  if (!med.id) med.id = Date.now();
  const i = mem.meds.findIndex(x=>x.id===med.id);
  if (i>=0) mem.meds[i]=med; else mem.meds.push(med);
  return med;
}

export async function deleteMed(id) {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = db.transaction(['meds'],'readwrite');
    tx.objectStore('meds').delete(id);
    return;
  }
  mem.meds = mem.meds.filter(m=>m.id!==id);
}

export async function listTags() {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = db.transaction(['tags'],'readonly');
    const req = tx.objectStore('tags').getAll();
    const all = await new Promise((res)=>{ req.onsuccess=()=>res(req.result||[]); req.onerror=()=>res([]); });
    return all.map(t=>t.tag);
  }
  return Array.from(mem.tags);
}

export async function addTag(tag) {
  const t = (tag||'').trim(); if (!t) return;
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = db.transaction(['tags'],'readwrite');
    tx.objectStore('tags').put({ tag:t });
  } else { mem.tags.add(t); }
}

export async function listEntries() {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = db.transaction(['entries'],'readonly');
    const req = tx.objectStore('entries').getAll();
    const all = await new Promise((res)=>{ req.onsuccess=()=>res(req.result||[]); req.onerror=()=>res([]); });
    return all.sort((a,b)=>new Date(a.date)-new Date(b.date));
  }
  return mem.entries.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
}

export async function addEntry(entry) {
  const now = new Date().toISOString();
  const e = { ...entry, createdAt: now, updatedAt: now };
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = db.transaction(['entries'],'readwrite');
    const r = tx.objectStore('entries').put(e);
    await new Promise((res)=>{ r.onsuccess=res; r.onerror=res; });
    return e;
  }
  e.id = e.id || Date.now(); mem.entries.push(e); return e;
}

export async function updateEntry(entry) {
  entry.updatedAt = new Date().toISOString();
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = db.transaction(['entries'],'readwrite');
    tx.objectStore('entries').put(entry); return entry;
  }
  const idx = mem.entries.findIndex(x=>x.id===entry.id); if (idx>=0) mem.entries[idx]=entry; return entry;
}

export async function deleteEntry(id) {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = db.transaction(['entries'],'readwrite');
    tx.objectStore('entries').delete(id); return;
  }
  mem.entries = mem.entries.filter(e=>e.id!==id);
}

export async function exportAll() {
  const profile = await getProfile();
  const meds = await listMeds(false);
  const tags = await listTags();
  const entries = await listEntries();
  return { version: 1, exportedAt: new Date().toISOString(), profile, meds, tags, entries };
}

export async function importAll(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || typeof data !== 'object') throw new Error('Ungültiges JSON');
  const db = await dbPromise;
  data.tags = data.tags || DEFAULT_TAGS; data.meds = data.meds || []; data.entries = data.entries || [];
  data.profile = data.profile || { id:'singleton', name:'', phqDay:null, phqTime:null };
  if (idbAvailable && db) {
    const tx = db.transaction(['profile','meds','tags','entries'],'readwrite');
    tx.objectStore('profile').put({ id:'singleton', ...data.profile });
    ['meds','tags','entries'].forEach(s=> tx.objectStore(s).clear());
    data.meds.forEach(m=> tx.objectStore('meds').put(m));
    data.tags.forEach(t=> tx.objectStore('tags').put({ tag:t }));
    data.entries.forEach(e=> tx.objectStore('entries').put(e));
  } else {
    mem.profile = { id:'singleton', ...data.profile };
    mem.meds = data.meds.slice();
    mem.tags = new Set(data.tags);
    mem.entries = data.entries.slice();
  }
  return true;
}
