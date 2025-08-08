/* export.js - JSON & PDF export (robust, offscreen, multipage) */
import { exportAll, listEntries, getProfile } from './store.js';

async function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function handleExportJSON() {
  const data = await exportAll();
  await download(
    `leomind-export-${new Date().toISOString().slice(0,19)}.json`,
    JSON.stringify(data, null, 2)
  );
}

/** HiDPI-sicherer Chart-Klon (falls Canvas nur per CSS skaliert) */
function cloneCanvasHiDPI(id) {
  const orig = document.getElementById(id);
  if (!orig) return null;
  // Versuche echte Pixelgröße zu nutzen
  let w = orig.width;
  let h = orig.height;
  const rect = orig.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (!w || !h) {
    w = Math.max(1, Math.round(rect.width * dpr));
    h = Math.max(1, Math.round(rect.height * dpr));
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (rect.width && rect.height) {
    ctx.scale(w / rect.width, h / rect.height);
  }
  ctx.drawImage(orig, 0, 0);
  return c;
}

/** Robustes Speichern für Safari/PWA */
function savePdfRobust(pdf, filename) {
  try { pdf.save(filename); return true; } catch (_) {}
  try {
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
    return true;
  } catch (_) {}
  try {
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    // Fallback: neuen Tab/Viewer öffnen
    window.open(url, '_blank') || (window.location.href = url);
    setTimeout(()=>URL.revokeObjectURL(url), 15000);
    return true;
  } catch (e) {
    console.error('PDF speichern fehlgeschlagen:', e);
    return false;
  }
}

export async function handleExportPDF(rangeText = 'Gesamt') {
  let tmp = null;
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('jsPDF nicht geladen – prüfe CDN <script> für jspdf.umd.min.js');
    }
    if (!window.html2canvas) {
      throw new Error('html2canvas nicht geladen – prüfe CDN <script> für html2canvas.min.js');
    }
    const { jsPDF } = window.jspdf;

    const entries = await listEntries();
    const profile = await getProfile();

    // Offscreen-Container (kein Einfluss aufs sichtbare Layout)
    tmp = document.createElement('div');
    tmp.style.position = 'fixed';
    tmp.style.left = '-10000px';
    tmp.style.top = '-10000px';
    tmp.style.width = '800px';
    tmp.style.padding = '16px';
    tmp.style.fontFamily = getComputedStyle(document.body).fontFamily;
    tmp.style.color = '#111';
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

    // KPIs aus dem Dashboard übernehmen
    const addKpi = (label, value) => {
      const div = document.createElement('div');
      div.style.border = '1px solid #eee';
      div.style.borderRadius = '10px';
      div.style.padding = '8px 10px';
      div.style.background = '#fafafa';
      div.innerHTML = `<div style="color:#666;font-size:11px">${label}</div><div style="font-size:16px;font-weight:600">${value ?? '–'}</div>`;
      tmp.querySelector('#pdf-kpis').appendChild(div);
    };
    addKpi('Ø 7 Tage', document.getElementById('kpi-avg7')?.textContent || '–');
    addKpi('Ø 30 Tage', document.getElementById('kpi-avg30')?.textContent || '–');
    addKpi('Ø 90 Tage', document.getElementById('kpi-avg90')?.textContent || '–');
    addKpi('Trend', document.getElementById('kpi-trend')?.textContent || '–');

    // Charts einbetten
    const c1 = cloneCanvasHiDPI('moodLine'); if (c1) tmp.querySelector('#pdf-chart1').appendChild(c1);
    const c2 = cloneCanvasHiDPI('sleepScatter'); if (c2) tmp.querySelector('#pdf-chart2').appendChild(c2);

    // Tabelle füllen
    const rows = tmp.querySelector('#pdf-rows');
    for (const e of entries) {
      const meds = (e.meds||[]).map(m=>`${m.name}${m.dose?(' '+m.dose):''}`).join(', ');
      const phqSum = Array.isArray(e.phq) ? e.phq.reduce((a,b)=>a+(Number(b)||0),0) : (e.phqSum ?? '');
      const tr = document.createElement('tr');
      [ e.date, e.mood??'', e.anxiety??'', phqSum, e.sleepHours??'', (e.tags||[]).join(', '), meds, (e.notes||'') ]
        .forEach(t=>{
          const td = document.createElement('td');
          td.style.borderBottom = '1px solid #f0f0f0';
          td.style.padding = '6px';
          td.textContent = String(t);
          tr.appendChild(td);
        });
      rows.appendChild(tr);
    }

    // DOM -> Canvas
    const canvas = await window.html2canvas(tmp, { backgroundColor:'#fff', scale: 2 });

    // Multi-Page PDF
    const pdf = new jsPDF({ unit:'pt', format:'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 20;

    const ratio = canvas.height / canvas.width;
    const imgW = pageW - margin*2;
    const imgH = imgW * ratio;

    let remaining = imgH;
    let srcY = 0;
    const srcW = canvas.width;

    while (remaining > 0) {
      const availableH = pageH - margin*2;                 // Platz auf Seite
      const srcH = Math.floor(canvas.height * (availableH / imgH)); // Quellslice
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = srcH;
      slice.getContext('2d').drawImage(canvas, 0, srcY, srcW, srcH, 0, 0, slice.width, slice.height);
      const sliceUrl = slice.toDataURL('image/png');
      const drawH = Math.min(availableH, remaining);
      pdf.addImage(sliceUrl, 'PNG', margin, margin, imgW, drawH);
      remaining -= availableH;
      srcY += srcH;
      if (remaining > 0) pdf.addPage();
    }

    const filename = `LeoMind-Report-${rangeText.replaceAll(' ','_')}.pdf`;
    const ok = savePdfRobust(pdf, filename);
    if (!ok) throw new Error('PDF konnte nicht gespeichert/geöffnet werden.');
  } catch (err) {
    console.error('PDF-Export Fehler:', err);
    alert('PDF-Export fehlgeschlagen: ' + (err?.message || err));
  } finally {
    // Offscreen-Knoten IMMER entfernen
    if (tmp && tmp.remove) tmp.remove();
  }
}
