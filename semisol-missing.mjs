import WebSocket from 'ws';
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';

useWebSocketImplementation(WebSocket);

const PRIMAL_CACHE = 'wss://cache2.primal.net/v1';
const HEX = '52b4a076bcbbbdc3a1aefa3735816cf74993b1b8db202b01c883c58be7fad8bd';

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

async function main() {
  // Get Primal cache notes
  const primalAll = await queryPrimalCacheAuthored(HEX, 500);
  const primalNotes = primalAll.filter(e => e.kind === 1 && e.pubkey === HEX);
  const primalIds = new Set(primalNotes.map(e => e.id));
  console.log(`Primal cache: ${primalNotes.length} notes\n`);

  // Get indexed relay notes
  const allIndexed = new Map();
  for (const relay of primalIndexedRelays) {
    try {
      const events = await Promise.race([
        pool.querySync([relay], { kinds: [1], authors: [HEX], limit: 500 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ]);
      for (const e of events) allIndexed.set(e.id, e);
    } catch {}
  }
  console.log(`Indexed relays: ${allIndexed.size} unique notes\n`);

  // Find missing
  const missing = [...allIndexed.values()].filter(e => !primalIds.has(e.id));
  missing.sort((a, b) => b.created_at - a.created_at);

  console.log(`=== ${missing.length} NOTES MISSING FROM PRIMAL CACHE ===\n`);

  for (let i = 0; i < missing.length; i++) {
    const e = missing[i];
    const date = new Date(e.created_at * 1000).toISOString();
    console.log(`${i + 1}. [${date}]`);
    console.log(`   ID: ${e.id}`);
    console.log(`   Content: ${e.content.replace(/\n/g, '\n            ')}`);
    console.log('');
  }

  pool.close(primalIndexedRelays);
  setTimeout(() => process.exit(0), 3000);
}

main().catch(e => { console.error(e); process.exit(1); });
