import WebSocket from 'ws';
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';

useWebSocketImplementation(WebSocket);

const PRIMAL_CACHE = 'wss://cache2.primal.net/v1';

const users = {
  semisol: '52b4a076bcbbbdc3a1aefa3735816cf74993b1b8db202b01c883c58be7fad8bd',
  fuckstr: 'd7100f9e3079cb803be226e198269bf9aa8d1e7576d7fbe27a009a3a1780be22',
  ralf: 'c89cf36deea286da912d4145f7140c73495d77e2cfedfb652158daa7c771f2f8',
  'jb55 (control)': '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245',
  'fiatjaf (control)': '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
};

const primalIndexedRelays = [
  'wss://relay.damus.io', 'wss://eden.nostr.land', 'wss://nos.lol',
  'wss://relay.snort.social', 'wss://nostr.wine', 'wss://nostr.bitcoiner.social',
  'wss://relay.primal.net', 'wss://nostr-pub.wellorder.net',
  'wss://relay.nostr.com.au', 'wss://nostr.milou.lol',
  'wss://puravida.nostr.land', 'wss://atlas.nostr.land',
];

function queryPrimalCacheAuthored(pubkey, limit = 500) {
  return new Promise((resolve) => {
    const ws = new WebSocket(PRIMAL_CACHE);
    const events = [];
    const subId = 'sub_' + Math.random().toString(36).slice(2, 10);
    const timeout = setTimeout(() => { ws.close(); resolve(events); }, 20000);
    ws.on('open', () => {
      ws.send(JSON.stringify(["REQ", subId, {
        cache: ["feed", { pubkey, notes: "authored", include_replies: true, limit }]
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

async function getRelayEvents(pubkey) {
  // Track which relays have each event
  const eventRelays = new Map(); // eventId -> Set of relays
  const eventData = new Map(); // eventId -> event

  for (const relay of primalIndexedRelays) {
    try {
      const events = await Promise.race([
        pool.querySync([relay], { kinds: [1], authors: [pubkey], limit: 500 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ]);
      for (const e of events) {
        if (!eventRelays.has(e.id)) eventRelays.set(e.id, new Set());
        eventRelays.get(e.id).add(relay.replace('wss://', ''));
        eventData.set(e.id, e);
      }
    } catch {}
  }
  return { eventRelays, eventData };
}

function isReply(event) {
  return event.tags?.some(t => t[0] === 'e' || t[0] === 'q');
}

function hasMention(event) {
  return event.tags?.some(t => t[0] === 'p');
}

async function analyzeUser(name, hex) {
  console.log(`\n${'#'.repeat(70)}`);
  console.log(`# PATTERN ANALYSIS: ${name}`);
  console.log(`${'#'.repeat(70)}`);

  // Get Primal cache
  const primalAll = await queryPrimalCacheAuthored(hex, 500);
  const primalNotes = primalAll.filter(e => e.kind === 1 && e.pubkey === hex);
  const primalIds = new Set(primalNotes.map(e => e.id));

  // Get relay events with relay tracking
  const { eventRelays, eventData } = await getRelayEvents(hex);

  const onPrimal = [];
  const notOnPrimal = [];

  for (const [id, event] of eventData) {
    if (primalIds.has(id)) {
      onPrimal.push({ event, relays: eventRelays.get(id) });
    } else {
      notOnPrimal.push({ event, relays: eventRelays.get(id) });
    }
  }

  // Also include Primal-only events
  const onlyPrimal = primalNotes.filter(e => !eventData.has(e.id));

  console.log(`\nTotal: ${eventData.size} on indexed relays, ${primalNotes.length} on Primal cache`);
  console.log(`On both: ${onPrimal.length} | On relays only: ${notOnPrimal.length} | Only on Primal: ${onlyPrimal.length}`);

  // === PATTERN 1: TIME ===
  console.log(`\n--- PATTERN 1: TIME ---`);
  const onPrimalDates = onPrimal.map(x => x.event.created_at).sort((a,b) => a-b);
  const notOnPrimalDates = notOnPrimal.map(x => x.event.created_at).sort((a,b) => a-b);

  if (onPrimalDates.length > 0) {
    const oldest = new Date(onPrimalDates[0] * 1000).toISOString().split('T')[0];
    const newest = new Date(onPrimalDates[onPrimalDates.length-1] * 1000).toISOString().split('T')[0];
    console.log(`On Primal:     ${oldest} to ${newest} (${onPrimalDates.length} notes)`);
  }
  if (notOnPrimalDates.length > 0) {
    const oldest = new Date(notOnPrimalDates[0] * 1000).toISOString().split('T')[0];
    const newest = new Date(notOnPrimalDates[notOnPrimalDates.length-1] * 1000).toISOString().split('T')[0];
    console.log(`Missing:       ${oldest} to ${newest} (${notOnPrimalDates.length} notes)`);
  }

  // Check if there's a time cutoff
  // Bin by week
  const weekBins = new Map();
  for (const { event } of onPrimal) {
    const week = new Date(event.created_at * 1000).toISOString().substring(0, 10);
    const key = week;
    if (!weekBins.has(key)) weekBins.set(key, { on: 0, off: 0 });
    weekBins.get(key).on++;
  }
  for (const { event } of notOnPrimal) {
    const week = new Date(event.created_at * 1000).toISOString().substring(0, 10);
    const key = week;
    if (!weekBins.has(key)) weekBins.set(key, { on: 0, off: 0 });
    weekBins.get(key).off++;
  }

  const sortedDays = [...weekBins.entries()].sort((a,b) => b[0].localeCompare(a[0]));
  console.log(`\nBy date (recent first):`);
  console.log(`${'Date'.padEnd(14)} ${'On Primal'.padEnd(12)} ${'Missing'.padEnd(12)} Rate`);
  for (const [day, counts] of sortedDays.slice(0, 30)) {
    const total = counts.on + counts.off;
    const rate = total > 0 ? ((counts.off / total) * 100).toFixed(0) : 0;
    console.log(`${day.padEnd(14)} ${String(counts.on).padEnd(12)} ${String(counts.off).padEnd(12)} ${rate}% missing`);
  }

  // === PATTERN 2: REPLIES vs ORIGINAL ===
  console.log(`\n--- PATTERN 2: REPLIES vs ORIGINALS ---`);
  const onPrimalReplies = onPrimal.filter(x => isReply(x.event)).length;
  const onPrimalOriginal = onPrimal.length - onPrimalReplies;
  const offPrimalReplies = notOnPrimal.filter(x => isReply(x.event)).length;
  const offPrimalOriginal = notOnPrimal.length - offPrimalReplies;

  console.log(`On Primal:  ${onPrimalOriginal} originals, ${onPrimalReplies} replies`);
  console.log(`Missing:    ${offPrimalOriginal} originals, ${offPrimalReplies} replies`);
  if (onPrimalReplies + offPrimalReplies > 0) {
    const replyFilterRate = ((offPrimalReplies / (onPrimalReplies + offPrimalReplies)) * 100).toFixed(1);
    const origFilterRate = ((offPrimalOriginal / (onPrimalOriginal + offPrimalOriginal)) * 100).toFixed(1);
    console.log(`Reply filter rate: ${replyFilterRate}% | Original filter rate: ${origFilterRate}%`);
  }

  // === PATTERN 3: RELAY COVERAGE ===
  console.log(`\n--- PATTERN 3: RELAY COVERAGE ---`);
  const onPrimalRelayCount = onPrimal.map(x => x.relays.size);
  const offPrimalRelayCount = notOnPrimal.map(x => x.relays.size);

  if (onPrimalRelayCount.length > 0) {
    const avg = (onPrimalRelayCount.reduce((a,b) => a+b, 0) / onPrimalRelayCount.length).toFixed(1);
    console.log(`On Primal:  avg ${avg} relays per note`);
  }
  if (offPrimalRelayCount.length > 0) {
    const avg = (offPrimalRelayCount.reduce((a,b) => a+b, 0) / offPrimalRelayCount.length).toFixed(1);
    console.log(`Missing:    avg ${avg} relays per note`);
  }

  // Which relays have the missing notes?
  const relayMissingCount = {};
  for (const { relays } of notOnPrimal) {
    for (const r of relays) {
      relayMissingCount[r] = (relayMissingCount[r] || 0) + 1;
    }
  }
  console.log(`\nRelays holding missing notes:`);
  for (const [r, c] of Object.entries(relayMissingCount).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${r.padEnd(30)} ${c} missing notes`);
  }

  // === PATTERN 4: CONTENT LENGTH ===
  console.log(`\n--- PATTERN 4: CONTENT LENGTH ---`);
  const onLens = onPrimal.map(x => x.event.content.length);
  const offLens = notOnPrimal.map(x => x.event.content.length);
  if (onLens.length > 0) {
    const avg = (onLens.reduce((a,b) => a+b, 0) / onLens.length).toFixed(0);
    const short = onLens.filter(l => l < 20).length;
    console.log(`On Primal:  avg length ${avg} chars, ${short} very short (<20 chars)`);
  }
  if (offLens.length > 0) {
    const avg = (offLens.reduce((a,b) => a+b, 0) / offLens.length).toFixed(0);
    const short = offLens.filter(l => l < 20).length;
    console.log(`Missing:    avg length ${avg} chars, ${short} very short (<20 chars)`);
  }

  // === PATTERN 5: INTERLEAVING CHECK ===
  // Are kept/missing posts interleaved by time, or is there a clean cutoff?
  console.log(`\n--- PATTERN 5: INTERLEAVING (are kept/missing interleaved or sequential?) ---`);
  const allSorted = [
    ...onPrimal.map(x => ({ t: x.event.created_at, on: true })),
    ...notOnPrimal.map(x => ({ t: x.event.created_at, on: false })),
  ].sort((a, b) => b.t - a.t);

  // Show first 40 in time order
  console.log('Recent posts (K=kept, M=missing):');
  let line = '';
  for (let i = 0; i < Math.min(80, allSorted.length); i++) {
    line += allSorted[i].on ? 'K' : 'M';
  }
  console.log(line);

  // Count transitions (K->M or M->K)
  let transitions = 0;
  for (let i = 1; i < allSorted.length; i++) {
    if (allSorted[i].on !== allSorted[i-1].on) transitions++;
  }
  console.log(`Transitions between K/M: ${transitions} (high = interleaved, low = sequential blocks)`);
}

async function main() {
  for (const [name, hex] of Object.entries(users)) {
    await analyzeUser(name, hex);
  }

  pool.close(primalIndexedRelays);
  setTimeout(() => process.exit(0), 3000);
}

main().catch(e => { console.error(e); process.exit(1); });
