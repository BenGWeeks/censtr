import WebSocket from 'ws';
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';
import { writeFileSync } from 'fs';

useWebSocketImplementation(WebSocket);

const PRIMAL_CACHE = 'wss://cache2.primal.net/v1';

const users = {
  BenGWeeks: '971615b70ad9ec896f8d5ba0f2d01652f1dfe5f9ced81ac9469ca7facefad68b',
  semisol: '52b4a076bcbbbdc3a1aefa3735816cf74993b1b8db202b01c883c58be7fad8bd',
  fuckstr: 'd7100f9e3079cb803be226e198269bf9aa8d1e7576d7fbe27a009a3a1780be22',
  ralf: 'c89cf36deea286da912d4145f7140c73495d77e2cfedfb652158daa7c771f2f8',
  jb55: '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245',
  jack: '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2',
  fiatjaf: '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
};

const colors = {
  BenGWeeks: '#2196F3',
  semisol: '#FF9800',
  fuckstr: '#f44336',
  ralf: '#9C27B0',
  jb55: '#4CAF50',
  jack: '#00BCD4',
  fiatjaf: '#795548',
};

const primalIndexedRelays = [
  'wss://relay.damus.io', 'wss://eden.nostr.land', 'wss://nos.lol',
  'wss://relay.snort.social', 'wss://nostr.bitcoiner.social',
  'wss://relay.primal.net', 'wss://nostr-pub.wellorder.net',
  'wss://puravida.nostr.land', 'wss://atlas.nostr.land',
];

function queryPrimalCache(pubkey, includeReplies, limit = 1000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(PRIMAL_CACHE);
    const events = [];
    const subId = 'sub_' + Math.random().toString(36).slice(2, 10);
    const timeout = setTimeout(() => { ws.close(); resolve(events); }, 30000);
    ws.on('open', () => {
      ws.send(JSON.stringify(["REQ", subId, {
        cache: ["feed", { pubkey, notes: "authored", include_replies: includeReplies, limit }]
      }]));
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT' && msg[1] === subId) events.push(msg[2]);
        else if (msg[0] === 'EOSE') { clearTimeout(timeout); ws.close(); resolve(events); }
      } catch {}
    });
    ws.on('error', () => { clearTimeout(timeout); resolve(events); });
  });
}

const pool = new SimplePool();

async function main() {
  const allData = {};

  for (const [name, hex] of Object.entries(users)) {
    console.log(`Processing ${name}...`);

    const [originalsRaw, repliesRaw] = await Promise.all([
      queryPrimalCache(hex, false, 1000),
      queryPrimalCache(hex, true, 1000),
    ]);
    const primalNotes = new Map();
    for (const e of [...originalsRaw, ...repliesRaw]) {
      if (e.kind === 1 && e.pubkey === hex) primalNotes.set(e.id, e);
    }

    const relayEvents = new Map();
    for (const relay of primalIndexedRelays) {
      try {
        const events = await Promise.race([
          pool.querySync([relay], { kinds: [1], authors: [hex], limit: 1000 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
        ]);
        for (const e of events) relayEvents.set(e.id, e);
      } catch {}
    }

    // Bin by month
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const cutoff = Math.floor(twoYearsAgo.getTime() / 1000);

    const monthBins = {};

    for (const [id, e] of relayEvents) {
      if (e.created_at < cutoff) continue;
      const d = new Date(e.created_at * 1000);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthBins[month]) monthBins[month] = { kept: 0, missing: 0, total: 0 };
      monthBins[month].total++;
      if (primalNotes.has(id)) {
        monthBins[month].kept++;
      } else {
        monthBins[month].missing++;
      }
    }

    allData[name] = monthBins;
    console.log(`  ${name}: ${primalNotes.size} on Primal, ${relayEvents.size} on relays`);
  }

  // Generate HTML chart
  const months = new Set();
  for (const data of Object.values(allData)) {
    for (const m of Object.keys(data)) months.add(m);
  }
  const sortedMonths = [...months].sort();

  const datasets = Object.entries(allData).map(([name, data]) => {
    const values = sortedMonths.map(m => {
      const bin = data[m];
      if (!bin) return null;
      return bin.missing;
    });
    return { name, values, color: colors[name] };
  });

  const html = `<!DOCTYPE html>
<html>
<head>
<title>Primal Missing Posts by Month</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation"></script>
<style>
  body { font-family: sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
  h1 { text-align: center; }
  .chart-container { max-width: 1200px; margin: 0 auto; background: #16213e; padding: 20px; border-radius: 12px; height: 500px; }
  table { margin: 30px auto; border-collapse: collapse; }
  th, td { padding: 6px 14px; border: 1px solid #333; text-align: right; }
  th { background: #0f3460; }
  td:first-child, th:first-child { text-align: left; }
</style>
</head>
<body>
<h1>Posts Missing from Primal Cache (by month)</h1>
<p style="text-align:center;color:#aaa;">Number of posts that exist on Primal-indexed relays but are absent from Primal's cache API.<br>
Based on kind-1 text notes.</p>
<div class="chart-container">
<canvas id="chart"></canvas>
</div>

<div style="max-width:900px;margin:30px auto;padding:16px;background:#0f3460;border-radius:8px;font-size:14px;line-height:1.6;">
<strong>Prior to chart range (2023):</strong>
Jul 2023 — Filterlists + automatic spam detection added &bull;
Aug 2023 — "Shadowban" controversy, can't-trend list exposed &bull;
Sep 2023 — New moderation system launched (user controls, WoT trending, can't-trend list removed) &bull;
Nov 2023 — TrustRank (PageRank-style Web of Trust) module added
</div>

<h2 style="text-align:center;margin-top:40px;">Raw Data (posts missing)</h2>
<table>
<tr><th>Month</th>${datasets.map(d => `<th style="color:${d.color}">${d.name}</th>`).join('')}</tr>
${sortedMonths.map(m => `<tr><td>${m}</td>${datasets.map(d => {
  const idx = sortedMonths.indexOf(m);
  const v = d.values[idx];
  return `<td>${v !== null ? v : '-'}</td>`;
}).join('')}</tr>`).join('\n')}
</table>

<script>
const ctx = document.getElementById('chart').getContext('2d');
new Chart(ctx, {
  type: 'line',
  data: {
    labels: ${JSON.stringify(sortedMonths)},
    datasets: ${JSON.stringify(datasets.map(d => ({
      label: d.name,
      data: d.values.map(v => v === null ? null : parseFloat(v)),
      borderColor: d.color,
      backgroundColor: d.color + '33',
      tension: 0.3,
      pointRadius: 3,
      borderWidth: 2,
      spanGaps: true,
    })))}
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#eee', font: { size: 14 } } },
      tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y + ' posts missing' } },
      annotation: {
        annotations: {
          cm_postgres: {
            type: 'line',
            xMin: '2024-09',
            xMax: '2024-09',
            borderColor: 'rgba(255,255,255,0.4)',
            borderWidth: 1,
            borderDash: [4, 4],
            label: { display: true, content: 'Moderation to Postgres', position: 'end', color: '#aaa', font: { size: 10 }, backgroundColor: 'transparent', padding: 2 }
          },
          trustrank_maker: {
            type: 'line',
            xMin: '2024-11',
            xMax: '2024-11',
            borderColor: 'rgba(255,255,255,0.4)',
            borderWidth: 1,
            borderDash: [4, 4],
            label: { display: true, content: 'TrustRank maker', position: 'end', color: '#aaa', font: { size: 10 }, backgroundColor: 'transparent', padding: 2, yAdjust: -15 }
          },
          cm_upgrade: {
            type: 'line',
            xMin: '2026-03',
            xMax: '2026-03',
            borderColor: 'rgba(255,255,255,0.4)',
            borderWidth: 1,
            borderDash: [4, 4],
            label: { display: true, content: 'Major moderation upgrade', position: 'end', color: '#aaa', font: { size: 10 }, backgroundColor: 'transparent', padding: 2 }
          }
        }
      }
    },
    scales: {
      x: { ticks: { color: '#aaa' }, grid: { color: '#333' } },
      y: {
        ticks: { color: '#aaa' },
        grid: { color: '#333' },
        title: { display: true, text: 'Posts Missing from Primal', color: '#aaa' },
        min: 0
      }
    }
  }
});
</script>
</body>
</html>`;

  writeFileSync('/tmp/nostr-test/chart.html', html);
  console.log('\nChart written to /tmp/nostr-test/chart.html');

  pool.close(primalIndexedRelays);
  setTimeout(() => process.exit(0), 3000);
}

main().catch(e => { console.error(e); process.exit(1); });
