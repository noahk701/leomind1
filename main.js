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

/* ---- Navigation ---- */
function setActive(view) {
  // Active-State nur noch für neue Bottom-Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  // Views umschalten
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === 'view-' + view);
  });

  // Lazy refresh je nach View
  if (view==='dashboard') refreshDashboard();
  if (view==='history') refreshHistory();
  if (view==='settings') refreshSettings();
  if (view==='entry') initEntryForm();
}

function bindNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (!view) return;
      setActive(view);
    });
  });

  // Event Delegation für dynamische Buttons
  const bottomNav = document.querySelector('.bottom-nav');
  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-btn');
      if (btn && btn.dataset.view) setActive(btn.dataset.view);
    });
  }
}

/* ---- Helpers ---- */
function todayStr() {
  const t = new Date();
  const m = String(t.getMonth()+1).padStart(2,'0');
  const d = String(t.getDate()).padStart(2,'0');
  return `${t.getFullYear()}-${m}-${d}`;
}

/* ---- Entry Form ---- */
function initEntryForm() {
  $('#e-date').value = todayStr();
  $('#e-mood').oninput = (e)=> $('#e-mood-val').textContent = e.target.value;
  $('#e-anxiety').oninput = (e)=> $('#e-anxiety-val').textContent = e.target.value;

  const input = $('#e-tag-input');
  const sugg = $('#e-tag-suggestions');
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

  $('#add-med').onclick = ()=> addMedRow();
  renderPHQ();
  $('#clear-form').onclick = clearForm;
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
  const wrap = $('#e-tags'); wrap.innerHTML='';
  tags.forEach(t=> wrap.appendChild(el('span',{class:'chip','data-tag':t}, t, el('button',{onclick:()=>{
    const rest = Array.from(document.querySelectorAll('#e-tags .chip')).map(c=>c.dataset.tag).filter(x=>x!==t);
    renderChips(rest);
  }}, '×'))));
}

function renderPHQ() {
  const wrap = $('#phq-questions'); wrap.innerHTML='';
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
    valEl.textContent = String(sum);
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
  const row = el('div', { class:'grid-2 med-row' },
    el('select',{ class:'med-name' }),
    el('input',{ class:'med-dose', placeholder:'Dosis' }),
  );
  row.querySelector('.med-dose').value = val.dose||'';
  $('#med-rows').appendChild(row);
  populateMedSelect(row.querySelector('.med-name'), val.name||'');
}

async function refreshMedOptions() {
  medsCache = await listMeds(true);
  document.querySelectorAll('select.med-name').forEach(sel => populateMedSelect(sel, sel.value));
  const f = $('#f-med');
  f.innerHTML = '<option value="">Alle</option>' + medsCache.map(m=>`<option value="${m.name}">${m.name}</option>`).join('');
}

function populateMedSelect(select, current='') {
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
  $('#entry-form').reset();
  $('#e-date').value = todayStr();
  $('#e-mood-val').textContent = '5';
  $('#e-anxiety-val').textContent = '5';
  renderChips([]);
  $('#med-rows').innerHTML='';
  renderPHQ();
}

async function submitEntry(e) {
  e.preventDefault();
  try {
    const tags = Array.from(document.querySelectorAll('#e-tags .chip')).map(c=>c.dataset.tag);
    const meds = Array.from(document.querySelectorAll('#med-rows .med-row')).map(r=> ({
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
      date: $('#e-date').value,
      mood: Number($('#e-mood').value),
      anxiety: Number($('#e-anxiety').value),
      sleepHours: $('#e-sleep').value ? Number($('#e-sleep').value) : null,
      notes: $('#e-notes').value || '',
      tags, meds,
      phq: phq.every(v=>v===null) ? undefined : phq
    };

    if (editingId) await updateEntry(payload);
    else await addEntry(payload);

    clearForm();
    setActive('dashboard');
  } catch (err) {
    alert('Fehler beim Speichern: ' + err.message);
  }
}

/* ---- Dashboard / History / Settings ---- */
async function refreshDashboard() {
  const entries = await listEntries();
  const k = computeKPIs(entries);
  $('#kpi-avg7').textContent = k.avg7 ?? '–';
  $('#kpi-avg30').textContent = k.avg30 ?? '–';
  $('#kpi-avg90').textContent = k.avg90 ?? '–';
  $('#kpi-trend').textContent = (k.trend!=null ? (k.trend>0?`+${k.trend}`:String(k.trend)) : '–');

  await renderCharts();

  const triggers = computeTriggers(entries);
  const ul = $('#trigger-list'); ul.innerHTML='';
  triggers.slice(-50).reverse().forEach(t=>{
    const li = document.createElement('li');
    li.textContent = `${t.date}: Stimmung ${t.mood} (7T-Ø ${t.baseline})`;
    ul.appendChild(li);
  });
}

async function refreshHistory() {
  const entries = await listEntries();
  const tbody = $('#history-table tbody'); tbody.innerHTML='';

  const from = $('#f-from').value ? new Date($('#f-from').value) : null;
  const to = $('#f-to').value ? new Date($('#f-to').value) : null;
  const fTag = $('#f-tag').value.trim().toLowerCase();
  const fMed = $('#f-med').value;

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
      $('#med-rows').innerHTML='';
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
  $('#s-name').value = p.name || '';
  $('#s-phq-day').value = (p.phqDay ?? '');
  $('#s-phq-time').value = (p.phqTime ?? '');

  medsCache = await listMeds(false);
  const list = $('#meds-list'); list.innerHTML='';
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

  await refreshTagsCache();
}

function bindSettings() {
  $('#s-name').addEventListener('change', e=> setProfile({ name: e.target.value }));
  $('#s-phq-day').addEventListener('change', e=> setProfile({ phqDay: Number(e.target.value)||null }));
  $('#s-phq-time').addEventListener('change', e=> setProfile({ phqTime: e.target.value || null }));

  $('#m-add').onclick = async ()=>{
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

  $('#t-add').onclick = async ()=>{
    const t = $('#t-new').value.trim(); if (!t) return;
    await addTag(t); $('#t-new').value=''; refreshTagsCache();
  };

  $('#btn-export').onclick = handleExportJSON;
  $('#btn-import').onclick = ()=> document.getElementById('file-import').click();
  $('#file-import').onchange = async (e)=>{
    const f = e.target.files[0]; if (!f) return;
    try {
      const text = await f.text();
      await importAll(text);
      alert('Import erfolgreich');
      refreshDashboard(); refreshHistory(); refreshSettings();
    } catch (err) {
      alert('Import-Fehler: ' + err.message);
    }
  };
  $('#btn-pdf').onclick = ()=> handleExportPDF('Gefilterter Zeitraum oder Gesamt');
}

/* ---- Storage Check ---- */
async function detectStorageWarning() {
  const info = await storeReady();
  const el = document.getElementById('storage-warning');
  if (!info.idbAvailable) {
    el.hidden = false;
    el.textContent = 'Achtung: IndexedDB ist nicht verfügbar (z. B. Safari Privates Surfen). Die App nutzt einen flüchtigen In-Memory-Speicher. Daten gehen beim Schließen verloren.';
  } else {
    el.hidden = true; el.textContent = '';
  }
}

/* ---- Boot ---- */
async function boot() {
  bindNav();
  bindSettings();
  initEntryForm();
  detectStorageWarning();
  setActive('dashboard');
  document.getElementById('entry-form').addEventListener('submit', submitEntry);
  document.getElementById('f-apply').addEventListener('click', refreshHistory);
  await refreshMedOptions();
  await refreshTagsCache();
  await refreshDashboard();
}

window.addEventListener('DOMContentLoaded', boot);
