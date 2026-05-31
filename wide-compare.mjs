import WebSocket from 'ws';
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';

useWebSocketImplementation(WebSocket);

const PRIMAL_CACHE = 'wss://cache2.primal.net/v1';

const users = {
  semisol: '52b4a076bcbbbdc3a1aefa3735816cf74993b1b8db202b01c883c58be7fad8bd',
  fuckstr: 'd7100f9e3079cb803be226e198269bf9aa8d1e7576d7fbe27a009a3a1780be22',
  ralf: 'c89cf36deea286da912d4145f7140c73495d77e2cfedfb652158daa7c771f2f8',
  'jack (control)': '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2',
  'fiatjaf (control)': '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
};

// Wide set of relays - including Primal's indexed relays and popular ones
const relays = [
  // Primal's default-relays.json
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://nostr.wine',
  'wss://relay.primal.net',
  'wss://eden.nostr.land',
  'wss://nostr.bitcoiner.social',
  // Primal's paid relays
  'wss://relay.nostr.com.au',
  'wss://nostr.milou.lol',
  'wss://puravida.nostr.land',
  'wss://atlas.nostr.land',
  // Other popular relays
  'wss://relay.nostr.band',
  'wss://nostr.fmt.wiz.biz',
  'wss://relay.nostr.bg',
  'wss://nostr-pub.wellorder.net',
  'wss://offchain.pub',
  'wss://nostr.mom',
  'wss://relay.mostr.pub',
];

// Query Primal cache authored notes
function queryPrimalCacheAuthored(pubkey, limit = 100) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(PRIMAL_CACHE);
    const events = [];
    const subId = 'sub_' + Math.random().toString(36).slice(2, 10);

    const timeout = setTimeout(() => { ws.close(); resolve(events); }, 15000);

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

async function queryRelaysIndividually(pubkey) {
  const results = {};
  const allEvents = new Map();

  // Query each relay individually with a timeout
  for (const relay of relays) {
    try {
      const events = await Promise.race([
        pool.querySync([relay], { kinds: [1], authors: [pubkey], limit: 100 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ]);
      results[relay] = events.length;
      for (const e of events) allEvents.set(e.id, e);
    } catch {
      results[relay] = -1; // failed/timeout
    }
  }

  return { results, allEvents };
}

async function main() {
  for (const [name, hex] of Object.entries(users)) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`${name}`);
    console.log(`${'='.repeat(70)}`);

    // Primal cache
    const primalAll = await queryPrimalCacheAuthored(hex, 100);
    const primalNotes = primalAll.filter(e => e.kind === 1 && e.pubkey === hex);
    console.log(`\nPrimal cache (authored): ${primalNotes.length} notes`);

    // Other relays
    const { results, allEvents } = await queryRelaysIndividually(hex);
    console.log(`\nRelay breakdown:`);
    for (const [relay, count] of Object.entries(results)) {
      const label = count === -1 ? 'FAILED/TIMEOUT' : `${count} notes`;
      console.log(`  ${relay.padEnd(40)} ${label}`);
    }

    const totalUnique = allEvents.size;
    console.log(`\nTotal unique notes from all relays: ${totalUnique}`);

    // Compare
    const primalIds = new Set(primalNotes.map(e => e.id));
    const missing = [...allEvents.values()].filter(e => !primalIds.has(e.id));
    const onlyOnPrimal = primalNotes.filter(e => !allEvents.has(e.id));

    console.log(`On Primal cache: ${primalNotes.length}`);
    console.log(`Missing from Primal: ${missing.length}`);
    console.log(`Only on Primal (not on any relay): ${onlyOnPrimal.length}`);

    if (totalUnique > 0) {
      const coverage = ((primalNotes.length / (totalUnique + onlyOnPrimal.length)) * 100).toFixed(1);
      console.log(`\n>>> Primal coverage: ${coverage}% <<<`);
    }

    if (missing.length > 0) {
      missing.sort((a, b) => b.created_at - a.created_at);
      console.log(`\nSample MISSING from Primal (3 newest):`);
      for (const e of missing.slice(0, 3)) {
        const date = new Date(e.created_at * 1000).toISOString();
        console.log(`  [${date}] ${e.content.substring(0, 120).replace(/\n/g, ' ')}`);
      }
    }
  }

  pool.close(relays);
  setTimeout(() => process.exit(0), 3000);
}

main().catch(e => { console.error(e); process.exit(1); });
