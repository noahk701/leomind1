/* charts.js - KPIs and charts */
import { listEntries } from './store.js';

let moodLineChart, positiveTagsChart;

function average(arr) {
  if (!arr.length) return null;
  return +(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(2);
}

export function computeKPIs(entries) {
  const byDate = entries.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
  const today = new Date();
  function withinDays(d, n) {
    const diff = (today - new Date(d))/(1000*60*60*24);
    return diff >= 0 && diff < n;
  }
  const moods = byDate.map(e=>({ date:e.date, mood: Number(e.mood)||0 }));
  const avg7 = average(moods.filter(m=>withinDays(m.date,7)).map(m=>m.mood));
  const avg30 = average(moods.filter(m=>withinDays(m.date,30)).map(m=>m.mood));
  const avg90 = average(moods.filter(m=>withinDays(m.date,90)).map(m=>m.mood));

  let trend = null;
  if (moods.length >= 2) {
    const last = moods[moods.length-1];
    const prev7 = moods.slice(0,-1).slice(-7).map(m=>m.mood);
    const prevAvg = average(prev7);
    if (prevAvg != null) trend = +(last.mood - prevAvg).toFixed(2);
  }
  return { avg7, avg30, avg90, trend };
}

export function computeTriggers(entries) {
  const byDate = entries.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
  const out = [];
  for (let i=0;i<byDate.length;i++) {
    const cur = byDate[i];
    const prev = byDate.slice(Math.max(0,i-7), i);
    if (prev.length < 3) continue;
    const ma = prev.reduce((a,e)=>a+(Number(e.mood)||0),0)/prev.length;
    if ((Number(cur.mood)||0) <= ma - 1) {
      out.push({
        date: cur.date,
        mood: Number(cur.mood)||0,
        baseline: +ma.toFixed(2),
        anxiety: Number(cur.anxiety) || null,
        sleepHours: cur.sleepHours ?? null,
        tags: Array.isArray(cur.tags) ? cur.tags : [],
        notes: cur.notes || '',
        meds: Array.isArray(cur.meds) ? cur.meds : []
      });
    }
  }
  return out;
}

function computePositiveTagCounts(entries) {
  const moods = entries.map(e => Number(e.mood)).filter(n => !isNaN(n));
  if (!moods.length) return { labels: [], counts: [] };
  const avg = moods.reduce((a,b)=>a+b,0) / moods.length;

  const counts = {};
  entries.forEach(e => {
    const mood = Number(e.mood);
    if (!isNaN(mood) && mood > avg && Array.isArray(e.tags)) {
      e.tags.forEach(tag => {
        const t = String(tag).trim();
        if (!t) return;
        counts[t] = (counts[t] || 0) + 1;
      });
    }
  });

  const pairs = Object.entries(counts).sort((a,b)=> b[1]-a[1]).slice(0,12);
  return {
    labels: pairs.map(p=>p[0]),
    counts: pairs.map(p=>p[1])
  };
}

export async function renderCharts() {
  const entries = await listEntries();
  const sorted = entries.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
  const labels = sorted.map(e=>e.date);
  const moodData = sorted.map(e=>Number(e.mood)||null);

  // --- Mood line ---
  const ctx1 = document.getElementById('moodLine');
  if (ctx1) {
    if (moodLineChart) moodLineChart.destroy();
    const g = ctx1.getContext('2d');
    g.clearRect(0, 0, ctx1.width, ctx1.height);
    moodLineChart = new Chart(ctx1, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Stimmung',
          data: moodData,
          tension: 0.35,
          spanGaps: true,
          pointRadius: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          y: { min:1, max:10, ticks:{ stepSize:1 } }
        }
      }
    });
  }

  // --- Positive Tags Ranking (Bar) ---
  const ctxTags = document.getElementById('positiveTags');
  if (ctxTags) {
    if (positiveTagsChart) positiveTagsChart.destroy();
    const { labels: tagLabels, counts } = computePositiveTagCounts(entries);
    const g2 = ctxTags.getContext('2d');
    g2.clearRect(0, 0, ctxTags.width, ctxTags.height);

    positiveTagsChart = new Chart(ctxTags, {
      type: 'bar',
      data: {
        labels: tagLabels,
        datasets: [{
          label: 'Häufigkeit auf >Ø-Tagen',
          data: counts
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx)=> ` ${ctx.raw}x`
            }
          }
        }
      }
    });
  }
}
