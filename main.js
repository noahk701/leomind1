/* main.js - Router, UI bindings */
import {
  storeReady, getProfile, setProfile,
  listMeds, upsertMed, deleteMed,
  listTags, addTag,
  listEntries, addEntry, updateEntry, deleteEntry, importAll
} from './store.js';
import { renderCharts, computeKPIs, computeTriggers } from './charts.js';
import { handleExportJSON, handleExportPDF } from './export.js';

let editingId = null;
let medsCache = [];
let tagsCache = [];

const $ = (sel)=> document.querySelector(sel);
const el = (tag, attrs={}, ...children)=> {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if (k==='class') e.className = v;
    else if (k==='dataset') Object.entries(v).forEach(([dk,dv])=>e.dataset[dk]=dv);
    else if (k.startsWith('on') && typeof v==='function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k,v);
  });
  children.forEach(c=> e.appendChild(typeof c==='string'? document.createTextNode(c) : c));
  return e;
};

/* ---------------------------------------
   NAVIGATION
---------------------------------------- */
function setActive(view) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === 'view-' + view);
  });

  if (view==='dashboard') refreshDashboard();
  if (view==='history') refreshHistory();
  if (view==='settings') refreshSettings();
  if (view==='entry') initEntryForm();
  if (view==='todo') refreshTodo();
}

function bindNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (!view) return;
      setActive(view);
    });
  });
  const bottomNav = document.querySelector('.bottom-nav');
  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-btn');
      if (btn && btn.dataset.view) setActive(btn.dataset.view);
    });
  }
}

/* ---------------------------------------
   HELPERS
---------------------------------------- */
function todayStr() {
  const t = new Date();
  const m = String(t.getMonth()+1).padStart(2,'0');
  const d = String(t.getDate()).padStart(2,'0');
  return `${t.getFullYear()}-${m}-${d}`;
}

/* ---------------------------------------
   ENTRY FORM
---------------------------------------- */
function initEntryForm() {
  const dateEl = $('#e-date');
  if (dateEl) dateEl.value = todayStr();

  const mood = $('#e-mood');
  const anx = $('#e-anxiety');
  if (mood) mood.oninput = (e)=> $('#e-mood-val').textContent = e.target.value;
  if (anx) anx.oninput = (e)=> $('#e-anxiety-val').textContent = e.target.value;

  const input = $('#e-tag-input');
  const sugg = $('#e-tag-suggestions');
  if (input && sugg) {
    input.onkeydown = (e)=>{
      if (e.key==='Enter') { e.preventDefault(); addChip(input.value.trim()); input.value=''; sugg.classList.remove('show'); }
    };
    input.oninput = ()=>{
      const q = input.value.trim().toLowerCase();
      if (!q) { sugg.classList.remove('show'); return; }
      const matches = tagsCache.filter(t=>t.toLowerCase().includes(q)).slice(0,6);
      sugg.innerHTML = '';
      matches.forEach(m=> sugg.appendChild(el('div',{ onclick:()=>{ addChip(m); input.value=''; sugg.classList.remove('show'); }}, m)));
      if (matches.length) sugg.classList.add('show'); else sugg.classList.remove('show');
    };
  }

  const addMedBtn = $('#add-med');
  if (addMedBtn) addMedBtn.onclick = ()=> addMedRow();

  renderPHQ();
  const clearBtn = $('#clear-form');
  if (clearBtn) clearBtn.onclick = clearForm;
  refreshMedOptions();
  renderChips([]);
}

function addChip(tag) {
  const t = (tag||'').trim(); if (!t) return;
  if (!tagsCache.includes(t)) addTag(t).then(()=>refreshTagsCache());
  const chips = Array.from(document.querySelectorAll('#e-tags .chip')).map(c=>c.dataset.tag);
  if (!chips.includes(t)) renderChips(chips.concat([t]));
}

function renderChips(tags) {
  const wrap = $('#e-tags'); if (!wrap) return;
  wrap.innerHTML='';
  tags.forEach(t=> wrap.appendChild(el('span',{class:'chip','data-tag':t}, t, el('button',{onclick:()=>{
    const rest = Array.from(document.querySelectorAll('#e-tags .chip')).map(c=>c.dataset.tag).filter(x=>x!==t);
    renderChips(rest);
  }}, '×'))));
}

function renderPHQ() {
  const wrap = $('#phq-questions'); if (!wrap) return;
  wrap.innerHTML='';
  const labels = [
    'Wenig Interesse oder Freude',
    'Niedergeschlagen, deprimiert',
    'Schlafprobleme',
    'Müdigkeit oder wenig Energie',
    'Appetitstörung',
    'Schlechtes Selbstwertgefühl',
    'Konzentrationsprobleme',
    'Verlangsamung/Unruhe',
    'Suizidgedanken'
  ];
  const valEl = $('#phq-sum');
  const recalc = ()=>{
    const sum = Array.from(wrap.querySelectorAll('input[type=radio]:checked')).reduce((a,r)=>a+Number(r.value),0);
    if (valEl) valEl.textContent = String(sum);
  };
  labels.forEach((lab,i)=>{
    const row = el('div',{},
      el('div',{}, `${i+1}. ${lab}`),
      el('div',{}, ...[0,1,2,3].map(v=> el('label',{},
        el('input',{type:'radio',name:`phq${i}`,value:String(v),onchange:recalc}), ` ${v} `
      )))
    );
    wrap.appendChild(row);
  });
}

function addMedRow(val={ name:'', dose:'' }) {
  const container = $('#med-rows'); if (!container) return;
  const row = el('div', { class:'grid-2 med-row' },
    el('select',{ class:'med-name' }),
    el('input',{ class:'med-dose', placeholder:'Dosis' }),
  );
  row.querySelector('.med-dose').value = val.dose||'';
  container.appendChild(row);
  populateMedSelect(row.querySelector('.med-name'), val.name||'');
}

async function refreshMedOptions() {
  medsCache = await listMeds(true);
  document.querySelectorAll('select.med-name').forEach(sel => populateMedSelect(sel, sel.value));
  const f = $('#f-med');
  if (f) f.innerHTML = '<option value="">Alle</option>' + medsCache.map(m=>`<option value="${m.name}">${m.name}</option>`).join('');
}

function populateMedSelect(select, current='') {
  if (!select) return;
  select.innerHTML = '<option value="">–</option>' + medsCache.map(m=>`<option value="${m.name}">${m.name}</option>`).join('');
  select.value = current || '';
}

async function refreshTagsCache() {
  tagsCache = await listTags();
  const list = $('#tags-list'); if (list) {
    list.innerHTML = ''; tagsCache.forEach(t=> list.appendChild(el('span',{class:'chip'}, t)));
  }
}

function clearForm() {
  editingId = null;
  const form = $('#entry-form');
  if (form) form.reset();
  const dateEl = $('#e-date'); if (dateEl) dateEl.value = todayStr();
  const mv = $('#e-mood-val'); if (mv) mv.textContent = '5';
  const av = $('#e-anxiety-val'); if (av) av.textContent = '5';
  renderChips([]);
  const medRows = $('#med-rows'); if (medRows) medRows.innerHTML='';
  renderPHQ();
}

async function submitEntry(e) {
  e.preventDefault();
  try {
    const chips = Array.from(document.querySelectorAll('#e-tags .chip'));
    const tags = chips.map(c=>c.dataset.tag);
    const medRows = Array.from(document.querySelectorAll('#med-rows .med-row'));
    const meds = medRows.map(r=> ({
      name: r.querySelector('.med-name').value,
      dose: r.querySelector('.med-dose').value
    })).filter(m=>m.name);

    const phq = [];
    for (let i=0;i<9;i++) {
      const sel = document.querySelector(`input[name=phq${i}]:checked`);
      phq.push(sel ? Number(sel.value) : null);
    }

    const payload = {
      id: editingId || undefined,
      date: $('#e-date')?.value,
      mood: Number($('#e-mood')?.value),
      anxiety: Number($('#e-anxiety')?.value),
      sleepHours: $('#e-sleep')?.value ? Number($('#e-sleep')?.value) : null,
      notes: $('#e-notes')?.value || '',
      tags, meds,
      phq: phq.every(v=>v===null) ? undefined : phq
    };

    if (editingId) await updateEntry(payload);
    else await addEntry(payload);

    clearForm();
    setActive('dashboard');
  } catch (err) {
    alert('Fehler beim Speichern: ' + (err?.message || err));
  }
}

/* ---------------------------------------
   DASHBOARD / HISTORY / SETTINGS
---------------------------------------- */
async function refreshDashboard() {
  const entries = await listEntries();
  const k = computeKPIs(entries);
  $('#kpi-avg7').textContent = k.avg7 ?? '–';
  $('#kpi-avg30').textContent = k.avg30 ?? '–';
  $('#kpi-avg90').textContent = k.avg90 ?? '–';
  $('#kpi-trend').textContent = (k.trend!=null ? (k.trend>0?`+${k.trend}`:String(k.trend)) : '–');

  await renderCharts();

  // Trigger als Accordion mit mehr Details
  const triggers = computeTriggers(entries);
  const wrap = $('#trigger-accordion');
  if (wrap) {
    wrap.innerHTML = '';
    triggers.slice(-50).reverse().forEach(t => {
      const delta = +(t.mood - t.baseline).toFixed(2);
      const summary = el('summary', {},
        `${t.date} · Stimmung ${t.mood} (7T-Ø ${t.baseline}) `,
        el('span', { style:`color:${delta<=-1 ? '#ff6b6b' : '#aaa'};margin-left:6px;` }, `${delta}`)
      );

      const medsTxt = (t.meds||[]).map(m=>`${m.name}${m.dose?(' '+m.dose):''}`).join(', ') || '—';
      const detailsBox = el('div', { style:'font-size:14px;line-height:1.5;margin-top:6px;' },
        el('div', {}, `Angst: ${t.anxiety ?? '—'}`),
        el('div', {}, `Schlaf: ${t.sleepHours ?? '—'} h`),
        el('div', {}, `Tags: ${(t.tags||[]).join(', ') || '—'}`),
        el('div', {}, `Medikation: ${medsTxt}`),
        t.notes ? el('div', {}, `Notiz: ${t.notes}`) : el('div', {style:'color:#888'}, 'Keine Notiz')
      );

      const details = el('details', { class:'trigger-item' }, summary, detailsBox);
      wrap.appendChild(details);
    });
  }
}

async function refreshHistory() {
  const entries = await listEntries();
  const tbody = $('#history-table tbody'); if (!tbody) return;
  tbody.innerHTML='';

  const from = $('#f-from')?.value ? new Date($('#f-from').value) : null;
  const to = $('#f-to')?.value ? new Date($('#f-to').value) : null;
  const fTag = $('#f-tag')?.value.trim().toLowerCase() || '';
  const fMed = $('#f-med')?.value || '';

  const filtered = entries.filter(e=>{
    const d = new Date(e.date);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (fTag && !(e.tags||[]).some(t=>t.toLowerCase().includes(fTag))) return false;
    if (fMed && !(e.meds||[]).some(m=>m.name===fMed)) return false;
    return true;
  });

  filtered.slice().reverse().forEach(e=>{
    const phqSum = Array.isArray(e.phq) ? e.phq.reduce((a,b)=>a+(Number(b)||0),0) : (e.phqSum ?? '');
    const meds = (e.meds||[]).map(m=>`${m.name}${m.dose?(' '+m.dose):''}`).join(', ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.date}</td>
      <td>${e.mood??''}</td>
      <td>${e.anxiety??''}</td>
      <td>${phqSum}</td>
      <td>${e.sleepHours??''}</td>
      <td>${(e.tags||[]).join(', ')}</td>
      <td>${meds}</td>
      <td>${(e.notes||'').replace(/</g,'&lt;')}</td>
      <td class="actions">
        <button class="btn full-sm" data-act="edit">Bearbeiten</button>
        <button class="btn full-sm" data-act="del">Löschen</button>
      </td>
    `;
    tr.querySelector('[data-act=edit]').onclick = ()=>{
      setActive('entry');
      editingId = e.id;
      $('#e-date').value = e.date;
      $('#e-mood').value = e.mood; $('#e-mood-val').textContent = e.mood;
      $('#e-anxiety').value = e.anxiety; $('#e-anxiety-val').textContent = e.anxiety;
      $('#e-sleep').value = e.sleepHours ?? '';
      $('#e-notes').value = e.notes || '';
      renderChips(e.tags||[]);
      const container = $('#med-rows'); if (container) container.innerHTML='';
      (e.meds||[]).forEach(m=> addMedRow(m));
      renderPHQ();
      if (Array.isArray(e.phq)) {
        e.phq.forEach((v,i)=>{
          if (v!=null) {
            const inp = document.querySelector(`input[name=phq${i}][value="${v}"]`);
            if (inp) inp.checked = true;
          }
        });
        const sum = e.phq.reduce((a,b)=>a+(Number(b)||0),0);
        $('#phq-sum').textContent = String(sum);
      }
    };
    tr.querySelector('[data-act=del]').onclick = async ()=>{
      if (confirm('Diesen Eintrag löschen?')) { await deleteEntry(e.id); refreshHistory(); refreshDashboard(); }
    };
    tbody.appendChild(tr);
  });
}

async function refreshSettings() {
  const p = await getProfile();
  if ($('#s-name')) $('#s-name').value = p.name || '';
  if ($('#s-phq-day')) $('#s-phq-day').value = (p.phqDay ?? '');
  if ($('#s-phq-time')) $('#s-phq-time').value = (p.phqTime ?? '');

  medsCache = await listMeds(false);
  const list = $('#meds-list'); if (list) {
    list.innerHTML='';
    medsCache.forEach(m=>{
      const row = el('div', { class:'grid-2' },
        el('div',{}, `${m.name} ${m.active? '':'(inaktiv)'} ${m.defaultDose? '· '+m.defaultDose:''}`),
        el('div',{}, 
          el('button',{class:'btn full-sm', onclick:()=>{
            $('#m-name').value = m.name;
            $('#m-dose').value = m.defaultDose||'';
            $('#m-active').checked = !!m.active;
            document.getElementById('m-add').dataset.id = m.id;
          }}, 'Bearbeiten'),
          ' ',
          el('button',{class:'btn full-sm', onclick:async()=>{ await deleteMed(m.id); refreshSettings(); }}, 'Löschen')
        ),
      );
      list.appendChild(row);
    });
  }

  await refreshTagsCache();
}

function bindSettings() {
  const name = $('#s-name');
  if (name) name.addEventListener('change', e=> setProfile({ name: e.target.value }));
  const day = $('#s-phq-day');
  if (day) day.addEventListener('change', e=> setProfile({ phqDay: Number(e.target.value)||null }));
  const time = $('#s-phq-time');
  if (time) time.addEventListener('change', e=> setProfile({ phqTime: e.target.value || null }));

  const mAdd = $('#m-add');
  if (mAdd) mAdd.onclick = async ()=>{
    const id = document.getElementById('m-add').dataset.id ? Number(document.getElementById('m-add').dataset.id) : undefined;
    const med = {
      id, name: $('#m-name').value.trim(), defaultDose: $('#m-dose').value.trim(),
      active: $('#m-active').checked
    };
    if (!med.name) { alert('Medikamentenname fehlt'); return; }
    await upsertMed(med);
    document.getElementById('m-add').dataset.id='';
    $('#m-name').value=''; $('#m-dose').value=''; $('#m-active').checked=true;
    refreshSettings(); refreshMedOptions();
  };

  const tAdd = $('#t-add');
  if (tAdd) tAdd.onclick = async ()=>{
    const t = $('#t-new').value.trim(); if (!t) return;
    await addTag(t); $('#t-new').value=''; refreshTagsCache();
  };

  const btnExport = $('#btn-export'); if (btnExport) btnExport.onclick = handleExportJSON;
  const btnImport = $('#btn-import'); if (btnImport) btnImport.onclick = ()=> document.getElementById('file-import').click();
  const fileImport = $('#file-import');
  if (fileImport) fileImport.onchange = async (e)=>{
    const f = e.target.files[0]; if (!f) return;
    try {
      const text = await f.text();
      await importAll(text);
      alert('Import erfolgreich');
      refreshDashboard(); refreshHistory(); refreshSettings();
    } catch (err) {
      alert('Import-Fehler: ' + (err?.message || err));
    }
  };
  const btnPdf = $('#btn-pdf'); if (btnPdf) btnPdf.onclick = ()=> handleExportPDF('Gefilterter Zeitraum oder Gesamt');
}

/* ---------------------------------------
   TO-DO LISTE (localStorage)
---------------------------------------- */
const TODOS_KEY = 'leomind_todos_v1';

function loadTodos() {
  try {
    return JSON.parse(localStorage.getItem(TODOS_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveTodos(list) {
  localStorage.setItem(TODOS_KEY, JSON.stringify(list));
}
function addTodo(text) {
  const list = loadTodos();
  const todo = {
    id: Date.now(),
    text: text.trim(),
    done: false,
    createdAt: new Date().toISOString()
  };
  list.push(todo);
  saveTodos(list);
  return todo;
}
function toggleTodo(id) {
  const list = loadTodos();
  const i = list.findIndex(t => t.id === id);
  if (i >= 0) { list[i].done = !list[i].done; saveTodos(list); }
}
function deleteTodo(id) {
  const list = loadTodos().filter(t => t.id !== id);
  saveTodos(list);
}
function refreshTodo() {
  const ul = $('#todo-list');
  if (!ul) return;
  const items = loadTodos().slice().sort((a,b)=> a.done - b.done || b.id - a.id);
  ul.innerHTML = '';
  items.forEach(t => {
    const li = el('li', { class: `todo-item${t.done ? ' completed':''}` });
    const left = el('div', { class:'todo-left' },
      el('input', { type:'checkbox', checked: t.done ? 'checked': null, onchange:()=>{
        toggleTodo(t.id);
        refreshTodo();
      }}),
      el('span', { style:'margin-left:8px;' }, t.text)
    );
    const right = el('div', { class:'todo-actions' },
      el('button', { title:'Löschen', onclick:()=>{ deleteTodo(t.id); refreshTodo(); } }, '✕')
    );
    li.append(left, right);
    ul.appendChild(li);
  });
}
function bindTodo() {
  const addBtn = $('#todo-add');
  const input = $('#todo-text');
  if (addBtn) addBtn.addEventListener('click', () => {
    const txt = input?.value.trim();
    if (!txt) return;
    addTodo(txt);
    input.value = '';
    refreshTodo();
  });
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const txt = input.value.trim();
      if (!txt) return;
      addTodo(txt);
      input.value = '';
      refreshTodo();
    }
  });
}

/* ---------------------------------------
   STORAGE WARNING
---------------------------------------- */
async function detectStorageWarning() {
  const info = await storeReady();
  const elWarn = document.getElementById('storage-warning');
  if (!elWarn) return;
  if (!info.idbAvailable) {
    elWarn.hidden = false;
    elWarn.textContent = 'Achtung: IndexedDB ist nicht verfügbar (z. B. Safari Privates Surfen). Die App nutzt einen flüchtigen In-Memory-Speicher. Daten gehen beim Schließen verloren.';
  } else {
    elWarn.hidden = true; elWarn.textContent = '';
  }
}

/* ---------------------------------------
   BOOT
---------------------------------------- */
async function boot() {
  bindNav();
  bindSettings();
  initEntryForm();
  bindTodo();
  detectStorageWarning();

  setActive('dashboard');

  const entryForm = document.getElementById('entry-form');
  if (entryForm) entryForm.addEventListener('submit', submitEntry);

  const apply = document.getElementById('f-apply');
  if (apply) apply.addEventListener('click', refreshHistory);

  await refreshMedOptions();
  await refreshTagsCache();
  await refreshDashboard();
  refreshTodo();
}

window.addEventListener('DOMContentLoaded', boot);
