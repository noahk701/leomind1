
/* charts.js - KPIs and charts */
import { listEntries } from './store.js';

let moodLineChart, sleepScatterChart;

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

  // Trend = last mood - avg of previous 7 days (excluding last day)
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
  // 7-day moving average excluding current day
  const out = [];
  for (let i=0;i<byDate.length;i++) {
    const cur = byDate[i];
    const prev = byDate.slice(Math.max(0,i-7), i);
    if (prev.length < 3) continue; // need enough history
    const ma = prev.reduce((a,e)=>a+(Number(e.mood)||0),0)/prev.length;
    if ((Number(cur.mood)||0) <= ma - 1) {
      out.push({ date: cur.date, mood: Number(cur.mood)||0, baseline: +ma.toFixed(2) });
    }
  }
  return out;
}

export async function renderCharts() {
  const entries = await listEntries();
  const sorted = entries.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
  const labels = sorted.map(e=>e.date);
  const moodData = sorted.map(e=>Number(e.mood)||null);
  const sleepPoints = sorted.filter(e=>e.sleepHours!=null && e.sleepHours!=="")
    .map(e=>({ x: Number(e.sleepHours), y: Number(e.mood)||null }));

  // Mood line
  const ctx1 = document.getElementById('moodLine');
  if (moodLineChart) moodLineChart.destroy();
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
      scales: {
        y: { min:1, max:10, ticks:{ stepSize:1 } }
      }
    }
  });

  // Sleep scatter
  const ctx2 = document.getElementById('sleepScatter');
  if (sleepScatterChart) sleepScatterChart.destroy();
  sleepScatterChart = new Chart(ctx2, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Schlaf ↔ Stimmung',
        data: sleepPoints
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { title: { display:true, text:'Schlaf (h)' }, min:0, max: 12 },
        y: { title: { display:true, text:'Stimmung' }, min:1, max:10, ticks:{ stepSize:1 } }
      }
    }
  });
}
