
/* export.js - JSON & PDF export */
import { exportAll, listEntries, getProfile } from './store.js';

async function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export async function handleExportJSON() {
  const data = await exportAll();
  await download(`leomind-export-${new Date().toISOString().slice(0,19)}.json`, JSON.stringify(data, null, 2));
}

export async function handleExportPDF(rangeText='Gesamt') {
  const entries = await listEntries();
  const profile = await getProfile();
  const { jsPDF } = window.jspdf;

  const tmp = document.createElement('div');
  tmp.style.padding = '16px';
  tmp.style.fontFamily = getComputedStyle(document.body).fontFamily;
  tmp.style.width = '800px';
  tmp.innerHTML = `
    <h1 style="font-size:20px;margin:0 0 8px 0;">${(profile.name||'–')} – Depressions-Report ${rangeText}</h1>
    <div style="color:#555;font-size:12px;margin-bottom:10px;">Erstellt am ${new Date().toLocaleString()}</div>
    <div id="pdf-kpis" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;"></div>
    <div style="display:grid;grid-template-columns:1fr;gap:10px;">
      <div id="pdf-chart1"></div>
      <div id="pdf-chart2"></div>
    </div>
    <h2 style="font-size:16px;margin-top:12px;">Einträge</h2>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead>
        <tr>
          <th style="border-bottom:1px solid #ddd;text-align:left;padding:6px;">Datum</th>
          <th style="border-bottom:1px solid #ddd;text-align:left;padding:6px;">Stimmung</th>
          <th style="border-bottom:1px solid #ddd;text-align:left;padding:6px;">Angst</th>
          <th style="border-bottom:1px solid #ddd;text-align:left;padding:6px;">PHQ-9</th>
          <th style="border-bottom:1px solid #ddd;text-align:left;padding:6px;">Schlaf</th>
          <th style="border-bottom:1px solid #ddd;text-align:left;padding:6px;">Tags</th>
          <th style="border-bottom:1px solid #ddd;text-align:left;padding:6px;">Medikation</th>
          <th style="border-bottom:1px solid #ddd;text-align:left;padding:6px;">Notiz</th>
        </tr>
      </thead>
      <tbody id="pdf-rows"></tbody>
    </table>
  `;
  document.body.appendChild(tmp);

  function addKpi(label, value) {
    const div = document.createElement('div');
    div.style.border = '1px solid #eee'; div.style.borderRadius = '10px';
    div.style.padding = '8px 10px'; div.style.background = '#fafafa';
    div.innerHTML = `<div style="color:#666;font-size:11px">${label}</div><div style="font-size:16px;font-weight:600">${value??'–'}</div>`;
    tmp.querySelector('#pdf-kpis').appendChild(div);
  }
  addKpi('Ø 7 Tage', document.getElementById('kpi-avg7').textContent);
  addKpi('Ø 30 Tage', document.getElementById('kpi-avg30').textContent);
  addKpi('Ø 90 Tage', document.getElementById('kpi-avg90').textContent);
  addKpi('Trend', document.getElementById('kpi-trend').textContent);

  function cloneCanvas(id) {
    const orig = document.getElementById(id);
    const c = document.createElement('canvas');
    c.width = orig.width; c.height = orig.height;
    const ctx = c.getContext('2d'); ctx.drawImage(orig, 0, 0);
    return c;
  }
  tmp.querySelector('#pdf-chart1').appendChild(cloneCanvas('moodLine'));
  tmp.querySelector('#pdf-chart2').appendChild(cloneCanvas('sleepScatter'));

  const rows = tmp.querySelector('#pdf-rows');
  for (const e of entries) {
    const meds = (e.meds||[]).map(m=>`${m.name}${m.dose?(' '+m.dose):''}`).join(', ');
    const phqSum = Array.isArray(e.phq) ? e.phq.reduce((a,b)=>a+(Number(b)||0),0) : (e.phqSum ?? '');
    const tr = document.createElement('tr');
    const cells = [ e.date, e.mood??'', e.anxiety??'', phqSum, e.sleepHours??'', (e.tags||[]).join(', '), meds, (e.notes||'') ];
    cells.forEach(t=>{
      const td = document.createElement('td');
      td.style.borderBottom = '1px solid #f0f0f0'; td.style.padding = '6px'; td.textContent = String(t);
      tr.appendChild(td);
    });
    rows.appendChild(tr);
  }

  const canvas = await html2canvas(tmp, { backgroundColor:'#fff', scale:2 });
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ unit:'pt', format:'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const imgW = pageW - 40;
  const ratio = canvas.height / canvas.width;
  const imgH = imgW * ratio;
  pdf.addImage(imgData, 'PNG', 20, 20, imgW, imgH);
  pdf.save(`LeoMind-Report-${rangeText.replaceAll(' ','_')}.pdf`);
  tmp.remove();
}
