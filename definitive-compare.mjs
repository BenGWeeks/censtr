import WebSocket from 'ws';
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';

useWebSocketImplementation(WebSocket);

const PRIMAL_CACHE = 'wss://cache2.primal.net/v1';

const users = {
  semisol: '52b4a076bcbbbdc3a1aefa3735816cf74993b1b8db202b01c883c58be7fad8bd',
  fuckstr: 'd7100f9e3079cb803be226e198269bf9aa8d1e7576d7fbe27a009a3a1780be22',
  ralf: 'c89cf36deea286da912d4145f7140c73495d77e2cfedfb652158daa7c771f2f8',
  'jb55 (control)': '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245',
  'jack (control)': '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2',
  'fiatjaf (control)': '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
};

// ONLY relays Primal claims to index (from their GitHub config)
const primalIndexedRelays = [
  // default-relays.json
  'wss://relay.damus.io',
  'wss://eden.nostr.land',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://nostr.wine',
  'wss://nostr.bitcoiner.social',
  'wss://relay.primal.net',
  'wss://nostr-pub.wellorder.net',
  // relays-paid.txt
  'wss://relay.nostr.com.au',
  'wss://nostr.milou.lol',
  'wss://puravida.nostr.land',
  'wss://atlas.nostr.land',
];

// Additional relays NOT indexed by Primal (for context)
const nonPrimalRelays = [
  'wss://offchain.pub',
  'wss://nostr.mom',
  'wss://relay.mostr.pub',
];

function queryPrimalCacheAuthored(pubkey, limit = 200) {
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

async function queryRelayGroup(relayList, pubkey) {
  const perRelay = {};
  const allEvents = new Map();

  for (const relay of relayList) {
    try {
      const events = await Promise.race([
        pool.querySync([relay], { kinds: [1], authors: [pubkey], limit: 200 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ]);
      perRelay[relay] = events.length;
      for (const e of events) allEvents.set(e.id, e);
    } catch {
      perRelay[relay] = -1;
    }
  }

  return { perRelay, allEvents };
}

async function main() {
  console.log('============================================================');
  console.log('DEFINITIVE COMPARISON: Primal Cache vs Primal-Indexed Relays');
  console.log('If notes exist on relays Primal indexes but NOT in the cache,');
  console.log('that indicates deliberate filtering by Primal.');
  console.log('============================================================');

  for (const [name, hex] of Object.entries(users)) {
    console.log(`\n${'#'.repeat(70)}`);
    console.log(`# ${name}`);
    console.log(`${'#'.repeat(70)}`);

    // Primal cache
    const primalAll = await queryPrimalCacheAuthored(hex, 200);
    const primalNotes = primalAll.filter(e => e.kind === 1 && e.pubkey === hex);
    const primalIds = new Set(primalNotes.map(e => e.id));
    console.log(`\nPrimal cache: ${primalNotes.length} authored notes`);

    // Primal-indexed relays
    console.log(`\nPrimal-indexed relays:`);
    const { perRelay: indexedPer, allEvents: indexedEvents } = await queryRelayGroup(primalIndexedRelays, hex);
    for (const [r, c] of Object.entries(indexedPer)) {
      const short = r.replace('wss://', '');
      console.log(`  ${short.padEnd(30)} ${c === -1 ? 'FAIL' : c}`);
    }

    // Non-Primal relays
    console.log(`\nNon-Primal relays:`);
    const { perRelay: otherPer, allEvents: otherEvents } = await queryRelayGroup(nonPrimalRelays, hex);
    for (const [r, c] of Object.entries(otherPer)) {
      const short = r.replace('wss://', '');
      console.log(`  ${short.padEnd(30)} ${c === -1 ? 'FAIL' : c}`);
    }

    // THE KEY METRIC: notes on Primal-indexed relays but missing from cache
    const missingFromCache = [...indexedEvents.values()].filter(e => !primalIds.has(e.id));
    const onlyOnCache = primalNotes.filter(e => !indexedEvents.has(e.id));

    console.log(`\n--- KEY RESULTS ---`);
    console.log(`Notes on Primal-INDEXED relays: ${indexedEvents.size}`);
    console.log(`Notes in Primal CACHE:          ${primalNotes.length}`);
    console.log(`>>> ON INDEXED RELAYS but MISSING from cache: ${missingFromCache.length} <<<`);
    console.log(`Only on cache (not found on indexed relays):  ${onlyOnCache.length}`);

    if (indexedEvents.size > 0) {
      const filtered = ((missingFromCache.length / indexedEvents.size) * 100).toFixed(1);
      console.log(`\n>>> FILTERING RATE: ${filtered}% of indexed-relay notes are absent from Primal cache <<<`);
    }

    if (missingFromCache.length > 0) {
      missingFromCache.sort((a, b) => b.created_at - a.created_at);
      console.log(`\nFiltered notes (5 newest):`);
      for (const e of missingFromCache.slice(0, 5)) {
        const date = new Date(e.created_at * 1000).toISOString();
        console.log(`  [${date}] ${e.content.substring(0, 130).replace(/\n/g, ' ')}`);
      }
    }
  }

  pool.close([...primalIndexedRelays, ...nonPrimalRelays]);
  setTimeout(() => process.exit(0), 3000);
}

main().catch(e => { console.error(e); process.exit(1); });
