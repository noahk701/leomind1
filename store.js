
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
        const s = db.createObjectStore('profile', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meds')) {
        const s = db.createObjectStore('meds', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('tags')) {
        const s = db.createObjectStore('tags', { keyPath: 'tag' });
      }
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = (err) => {
      idbAvailable = false;
      resolve(null); // fallback
    };
    req.onblocked = () => {
      idbAvailable = false;
      resolve(null);
    };
  });
}

async function initStore() {
  if (!dbPromise) dbPromise = openDB();
  const db = await dbPromise;

  // initialize defaults
  if (idbAvailable && db) {
    const tx = db.transaction(['profile','tags','meds'], 'readwrite');
    const profile = await getIDB(tx, 'profile', 'singleton');
    if (!profile) await putIDB(tx, 'profile', { id:'singleton', name:'', phqDay:null, phqTime:null });
    // default tags
    for (const t of DEFAULT_TAGS) await putIDB(tx, 'tags', { tag:t });
    await tx.done?.catch?.(()=>{});
  } else {
    // memory defaults
    DEFAULT_TAGS.forEach(t=>mem.tags.add(t));
  }
}

function txWrap(db, stores, mode='readonly') {
  const tx = db.transaction(stores, mode);
  tx.done = new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
  return tx;
}

function getIDB(tx, store, key) {
  return new Promise((res, rej) => {
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function putIDB(tx, store, val) {
  return new Promise((res, rej) => {
    const req = tx.objectStore(store).put(val);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function delIDB(tx, store, key) {
  return new Promise((res, rej) => {
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}
function getAllIDB(tx, store) {
  return new Promise((res, rej) => {
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}

export async function storeReady() {
  await initStore();
  return { idbAvailable };
}

export async function getProfile() {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = txWrap(db, ['profile']);
    const p = await getIDB(tx, 'profile', 'singleton');
    await tx.done.catch(()=>{});
    return p || { id:'singleton', name:'', phqDay:null, phqTime:null };
  }
  return mem.profile;
}

export async function setProfile(upd) {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = txWrap(db, ['profile'],'readwrite');
    const cur = await getIDB(tx,'profile','singleton') || { id:'singleton' };
    const next = { ...cur, ...upd };
    await putIDB(tx,'profile', next);
    await tx.done.catch(()=>{});
    return next;
  }
  Object.assign(mem.profile, upd);
  return mem.profile;
}

export async function listMeds(activeOnly=false) {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = txWrap(db, ['meds']);
    const all = await getAllIDB(tx,'meds');
    await tx.done.catch(()=>{});
    return activeOnly ? all.filter(m=>m.active) : all;
  }
  const all = mem.meds.slice();
  return activeOnly ? all.filter(m=>m.active) : all;
}

export async function upsertMed(med) {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = txWrap(db, ['meds'],'readwrite');
    // if med has id, update else add
    await putIDB(tx,'meds', med);
    await tx.done.catch(()=>{});
    return med;
  }
  if (!med.id) med.id = Date.now();
  const idx = mem.meds.findIndex(m=>m.id===med.id);
  if (idx>=0) mem.meds[idx]=med; else mem.meds.push(med);
  return med;
}

export async function deleteMed(id) {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = txWrap(db, ['meds'],'readwrite');
    await delIDB(tx,'meds', id);
    await tx.done.catch(()=>{});
    return;
  }
  mem.meds = mem.meds.filter(m=>m.id!==id);
}

export async function listTags() {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = txWrap(db, ['tags']);
    const all = await getAllIDB(tx,'tags');
    await tx.done.catch(()=>{});
    return all.map(t=>t.tag);
  }
  return Array.from(mem.tags);
}

export async function addTag(tag) {
  const t = (tag||'').trim();
  if (!t) return;
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = txWrap(db, ['tags'],'readwrite');
    await putIDB(tx,'tags',{ tag:t });
    await tx.done.catch(()=>{});
  } else {
    mem.tags.add(t);
  }
}

export async function listEntries() {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = txWrap(db, ['entries']);
    const all = await getAllIDB(tx,'entries');
    await tx.done.catch(()=>{});
    return all.sort((a,b)=>new Date(a.date)-new Date(b.date));
  }
  return mem.entries.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
}

export async function addEntry(entry) {
  const now = new Date().toISOString();
  const e = { ...entry, createdAt: now, updatedAt: now };
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = txWrap(db,['entries'],'readwrite');
    const id = await putIDB(tx,'entries', e);
    await tx.done.catch(()=>{});
    e.id = id || e.id;
    return e;
  }
  e.id = e.id || Date.now();
  mem.entries.push(e);
  return e;
}

export async function updateEntry(entry) {
  entry.updatedAt = new Date().toISOString();
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = txWrap(db,['entries'],'readwrite');
    await putIDB(tx,'entries', entry);
    await tx.done.catch(()=>{});
    return entry;
  }
  const idx = mem.entries.findIndex(x=>x.id===entry.id);
  if (idx>=0) mem.entries[idx]=entry;
  return entry;
}

export async function deleteEntry(id) {
  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = txWrap(db,['entries'],'readwrite');
    await delIDB(tx,'entries', id);
    await tx.done.catch(()=>{});
    return;
  }
  mem.entries = mem.entries.filter(e=>e.id!==id);
}

export async function exportAll() {
  const profile = await getProfile();
  const meds = await listMeds(false);
  const tags = await listTags();
  const entries = await listEntries();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    profile, meds, tags, entries
  };
}

export async function importAll(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || typeof data !== 'object') throw new Error('Ungültiges JSON');
  const version = data.version ?? 1;
  // defensive defaulting
  data.tags = data.tags || DEFAULT_TAGS;
  data.meds = data.meds || [];
  data.entries = data.entries || [];
  data.profile = data.profile || { id:'singleton', name:'', phqDay:null, phqTime:null };

  const db = await dbPromise;
  if (idbAvailable && db) {
    const tx = txWrap(db, ['profile','meds','tags','entries'],'readwrite');
    await putIDB(tx,'profile', { id:'singleton', ...data.profile });
    // clear & put: we keep it simple
    // clearing stores
    const stores = ['meds','tags','entries'];
    for (const s of stores) await new Promise((res,rej)=>{
      const r = tx.objectStore(s).clear(); r.onsuccess=res; r.onerror=()=>rej(r.error);
    });
    for (const m of data.meds) await putIDB(tx,'meds', m);
    for (const t of data.tags) await putIDB(tx,'tags', { tag:t });
    for (const e of data.entries) await putIDB(tx,'entries', e);
    await tx.done.catch(()=>{});
  } else {
    mem.profile = { id:'singleton', ...data.profile };
    mem.meds = data.meds.slice();
    mem.tags = new Set(data.tags);
    mem.entries = data.entries.slice();
  }
  return true;
}
