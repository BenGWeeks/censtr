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
  console.log('================================================================');
  console.log('FINAL ANALYSIS: Primal Cache vs Primal-Indexed Relays');
  console.log('Now querying both originals AND replies from Primal cache');
  console.log('================================================================');

  for (const [name, hex] of Object.entries(users)) {
    console.log(`\n${'#'.repeat(70)}`);
    console.log(`# ${name}`);
    console.log(`${'#'.repeat(70)}`);

    // Get BOTH originals and replies from Primal cache
    const [originalsRaw, repliesRaw] = await Promise.all([
      queryPrimalCache(hex, false, 500),
      queryPrimalCache(hex, true, 500),
    ]);

    const primalNotes = new Map();
    for (const e of [...originalsRaw, ...repliesRaw]) {
      if (e.kind === 1 && e.pubkey === hex) primalNotes.set(e.id, e);
    }
    console.log(`\nPrimal cache: ${primalNotes.size} unique kind-1 notes`);

    // Get relay events
    const relayEvents = new Map();
    for (const relay of primalIndexedRelays) {
      try {
        const events = await Promise.race([
          pool.querySync([relay], { kinds: [1], authors: [hex], limit: 500 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
        ]);
        for (const e of events) relayEvents.set(e.id, e);
      } catch {}
    }
    console.log(`Indexed relays: ${relayEvents.size} unique kind-1 notes`);

    // Compare
    const missing = [...relayEvents.values()].filter(e => !primalNotes.has(e.id));
    const onlyPrimal = [...primalNotes.values()].filter(e => !relayEvents.has(e.id));

    console.log(`\nOn both: ${relayEvents.size - missing.length}`);
    console.log(`On relays but MISSING from Primal: ${missing.length}`);
    console.log(`Only on Primal: ${onlyPrimal.length}`);

    if (relayEvents.size > 0) {
      const rate = ((missing.length / relayEvents.size) * 100).toFixed(1);
      console.log(`\n>>> FILTERING RATE: ${rate}% <<<`);
    }

    // Time analysis
    const missingDates = missing.map(e => e.created_at).sort((a,b) => a-b);
    const keptFromRelays = [...relayEvents.values()].filter(e => primalNotes.has(e.id));
    const keptDates = keptFromRelays.map(e => e.created_at).sort((a,b) => a-b);

    if (keptDates.length > 0) {
      console.log(`\nKept: ${new Date(keptDates[0]*1000).toISOString().split('T')[0]} to ${new Date(keptDates[keptDates.length-1]*1000).toISOString().split('T')[0]}`);
    }
    if (missingDates.length > 0) {
      console.log(`Missing: ${new Date(missingDates[0]*1000).toISOString().split('T')[0]} to ${new Date(missingDates[missingDates.length-1]*1000).toISOString().split('T')[0]}`);
    }

    // Reply breakdown
    const missingReplies = missing.filter(isReply).length;
    const missingOrig = missing.length - missingReplies;
    const keptReplies = keptFromRelays.filter(isReply).length;
    const keptOrig = keptFromRelays.length - keptReplies;

    console.log(`\nKept: ${keptOrig} originals + ${keptReplies} replies`);
    console.log(`Missing: ${missingOrig} originals + ${missingReplies} replies`);

    // Interleaving
    const all = [
      ...keptFromRelays.map(e => ({ t: e.created_at, k: true })),
      ...missing.map(e => ({ t: e.created_at, k: false })),
    ].sort((a,b) => b.t - a.t);

    let line = '';
    for (let i = 0; i < Math.min(60, all.length); i++) {
      line += all[i].k ? 'K' : 'M';
    }
    console.log(`\nRecent timeline: ${line}`);

    // Sample missing
    if (missing.length > 0) {
      missing.sort((a,b) => b.created_at - a.created_at);
      console.log(`\nNewest missing notes:`);
      for (const e of missing.slice(0, 5)) {
        const d = new Date(e.created_at * 1000).toISOString();
        const r = isReply(e) ? '[REPLY]' : '[ORIG]';
        console.log(`  ${r} [${d}] ${e.content.substring(0, 100).replace(/\n/g, ' ')}`);
      }
    }
  }

  pool.close(primalIndexedRelays);
  setTimeout(() => process.exit(0), 3000);
}

main().catch(e => { console.error(e); process.exit(1); });
