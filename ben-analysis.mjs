import WebSocket from 'ws';
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';

useWebSocketImplementation(WebSocket);

const PRIMAL_CACHE = 'wss://cache2.primal.net/v1';
const hex = '971615b70ad9ec896f8d5ba0f2d01652f1dfe5f9ced81ac9469ca7facefad68b';

const primalIndexedRelays = [
  'wss://relay.damus.io', 'wss://eden.nostr.land', 'wss://nos.lol',
  'wss://relay.snort.social', 'wss://nostr.wine', 'wss://nostr.bitcoiner.social',
  'wss://relay.primal.net', 'wss://nostr-pub.wellorder.net',
  'wss://relay.nostr.com.au', 'wss://nostr.milou.lol',
  'wss://puravida.nostr.land', 'wss://atlas.nostr.land',
];

function queryPrimalCache(pubkey, includeReplies, limit = 500) {
  return new Promise((resolve) => {
    const ws = new WebSocket(PRIMAL_CACHE);
    const events = [];
    const subId = 'sub_' + Math.random().toString(36).slice(2, 10);
    const timeout = setTimeout(() => { ws.close(); resolve(events); }, 20000);
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

function isReply(event) {
  return event.tags?.some(t => t[0] === 'e' || t[0] === 'q');
}

async function main() {
  console.log('######################################################################');
  console.log('# BenGWeeks (Ben Weeks)');
  console.log('######################################################################');

  const [originalsRaw, repliesRaw] = await Promise.all([
    queryPrimalCache(hex, false, 500),
    queryPrimalCache(hex, true, 500),
  ]);

  const primalNotes = new Map();
  for (const e of [...originalsRaw, ...repliesRaw]) {
    if (e.kind === 1 && e.pubkey === hex) primalNotes.set(e.id, e);
  }
  console.log(`\nPrimal cache: ${primalNotes.size} unique kind-1 notes`);

  const relayEvents = new Map();
  const perRelay = {};
  for (const relay of primalIndexedRelays) {
    try {
      const events = await Promise.race([
        pool.querySync([relay], { kinds: [1], authors: [hex], limit: 500 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ]);
      perRelay[relay.replace('wss://', '')] = events.length;
      for (const e of events) relayEvents.set(e.id, e);
    } catch {
      perRelay[relay.replace('wss://', '')] = -1;
    }
  }
  console.log(`Indexed relays: ${relayEvents.size} unique kind-1 notes`);
  console.log(`\nPer relay:`);
  for (const [r, c] of Object.entries(perRelay)) {
    console.log(`  ${r.padEnd(30)} ${c === -1 ? 'FAIL' : c}`);
  }

  const missing = [...relayEvents.values()].filter(e => !primalNotes.has(e.id));
  const onlyPrimal = [...primalNotes.values()].filter(e => !relayEvents.has(e.id));
  const keptFromRelays = [...relayEvents.values()].filter(e => primalNotes.has(e.id));

  console.log(`\nOn both: ${keptFromRelays.length}`);
  console.log(`On relays but MISSING from Primal: ${missing.length}`);
  console.log(`Only on Primal: ${onlyPrimal.length}`);

  if (relayEvents.size > 0) {
    const rate = ((missing.length / relayEvents.size) * 100).toFixed(1);
    console.log(`\n>>> FILTERING RATE: ${rate}% <<<`);
  }

  const missingDates = missing.map(e => e.created_at).sort((a,b) => a-b);
  const keptDates = keptFromRelays.map(e => e.created_at).sort((a,b) => a-b);

  if (keptDates.length > 0) {
    console.log(`\nKept: ${new Date(keptDates[0]*1000).toISOString().split('T')[0]} to ${new Date(keptDates[keptDates.length-1]*1000).toISOString().split('T')[0]}`);
  }
  if (missingDates.length > 0) {
    console.log(`Missing: ${new Date(missingDates[0]*1000).toISOString().split('T')[0]} to ${new Date(missingDates[missingDates.length-1]*1000).toISOString().split('T')[0]}`);
  }

  const missingReplies = missing.filter(isReply).length;
  const missingOrig = missing.length - missingReplies;
  const keptReplies = keptFromRelays.filter(isReply).length;
  const keptOrig = keptFromRelays.length - keptReplies;

  console.log(`\nKept: ${keptOrig} originals + ${keptReplies} replies`);
  console.log(`Missing: ${missingOrig} originals + ${missingReplies} replies`);

  // Timeline
  const all = [
    ...keptFromRelays.map(e => ({ t: e.created_at, k: true })),
    ...missing.map(e => ({ t: e.created_at, k: false })),
  ].sort((a,b) => b.t - a.t);

  let line = '';
  for (let i = 0; i < Math.min(60, all.length); i++) {
    line += all[i].k ? 'K' : 'M';
  }
  console.log(`\nRecent timeline: ${line}`);

  // Show recent posts with status
  console.log(`\n--- Recent posts (last 20) ---`);
  for (const item of all.slice(0, 20)) {
    const e = keptFromRelays.find(x => x.created_at === item.t) ||
              missing.find(x => x.created_at === item.t) ||
              [...primalNotes.values()].find(x => x.created_at === item.t);
    if (e) {
      const d = new Date(e.created_at * 1000).toISOString();
      const status = item.k ? 'KEPT' : '>>> MISSING <<<';
      const type = isReply(e) ? 'REPLY' : 'ORIG';
      console.log(`[${status}] [${type}] ${d}`);
      console.log(`  ${e.content.substring(0, 150).replace(/\n/g, ' ')}`);
      console.log('');
    }
  }

  // Show missing posts
  if (missing.length > 0) {
    missing.sort((a,b) => b.created_at - a.created_at);
    console.log(`\n--- ALL MISSING posts (${missing.length}) ---`);
    for (const e of missing) {
      const d = new Date(e.created_at * 1000).toISOString();
      const type = isReply(e) ? 'REPLY' : 'ORIG';
      console.log(`[${type}] ${d}`);
      console.log(`  ${e.content.substring(0, 200).replace(/\n/g, ' ')}`);
      console.log('');
    }
  }

  pool.close(primalIndexedRelays);
  setTimeout(() => process.exit(0), 3000);
}

main().catch(e => { console.error(e); process.exit(1); });
