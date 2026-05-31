import WebSocket from 'ws';
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';

useWebSocketImplementation(WebSocket);

const PRIMAL_CACHE = 'wss://cache2.primal.net/v1';
const hex = '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245';

const primalIndexedRelays = [
  'wss://relay.damus.io', 'wss://eden.nostr.land', 'wss://nos.lol',
  'wss://relay.snort.social', 'wss://nostr.bitcoiner.social',
  'wss://relay.primal.net', 'wss://nostr-pub.wellorder.net',
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
  // Get Primal cache (both originals and replies)
  const [originalsRaw, repliesRaw] = await Promise.all([
    queryPrimalCache(hex, false, 500),
    queryPrimalCache(hex, true, 500),
  ]);
  const primalNotes = new Map();
  for (const e of [...originalsRaw, ...repliesRaw]) {
    if (e.kind === 1 && e.pubkey === hex) primalNotes.set(e.id, e);
  }

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

  // Get all notes from the last 3 days
  const threeDaysAgo = Math.floor(Date.now() / 1000) - (3 * 24 * 60 * 60);

  // Merge all notes
  const allNotes = new Map();
  for (const [id, e] of relayEvents) allNotes.set(id, e);
  for (const [id, e] of primalNotes) { if (!allNotes.has(id)) allNotes.set(id, e); }

  const recentNotes = [...allNotes.values()]
    .filter(e => e.created_at > threeDaysAgo)
    .sort((a, b) => b.created_at - a.created_at);

  console.log(`jb55's posts from the last 3 days (${recentNotes.length} total):\n`);

  for (const e of recentNotes) {
    const onPrimal = primalNotes.has(e.id);
    const onRelays = relayEvents.has(e.id);
    const date = new Date(e.created_at * 1000).toISOString();
    const type = isReply(e) ? 'REPLY' : 'ORIG';
    const status = onPrimal && onRelays ? 'KEPT' :
                   onPrimal && !onRelays ? 'PRIMAL-ONLY' :
                   !onPrimal && onRelays ? '>>> MISSING <<<' : '???';

    console.log(`[${status}] [${type}] ${date}`);
    console.log(`  ${e.content.replace(/\n/g, '\n  ')}`);
    console.log('');
  }

  pool.close(primalIndexedRelays);
  setTimeout(() => process.exit(0), 3000);
}

main().catch(e => { console.error(e); process.exit(1); });
