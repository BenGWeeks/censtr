import WebSocket from 'ws';
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';

useWebSocketImplementation(WebSocket);

const PRIMAL_CACHE = 'wss://cache2.primal.net/v1';

// Focus on the two high-volume users with interleaved patterns
const users = {
  'jb55': '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245',
  'fuckstr': 'd7100f9e3079cb803be226e198269bf9aa8d1e7576d7fbe27a009a3a1780be22',
};

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

function hasMedia(event) {
  return /https?:\/\/\S+\.(jpg|jpeg|png|gif|mp4|webp|mov)/i.test(event.content) ||
         /https?:\/\/(image|blossom|i)\.\S+/i.test(event.content);
}

function hasLink(event) {
  return /https?:\/\/\S+/i.test(event.content);
}

function mentionsPrimal(event) {
  return /primal/i.test(event.content);
}

async function main() {
  for (const [name, hex] of Object.entries(users)) {
    console.log(`\n${'#'.repeat(70)}`);
    console.log(`# ${name} - WHAT DETERMINES KEPT vs MISSING?`);
    console.log(`${'#'.repeat(70)}`);

    const [originalsRaw, repliesRaw] = await Promise.all([
      queryPrimalCache(hex, false, 500),
      queryPrimalCache(hex, true, 500),
    ]);
    const primalNotes = new Map();
    for (const e of [...originalsRaw, ...repliesRaw]) {
      if (e.kind === 1 && e.pubkey === hex) primalNotes.set(e.id, e);
    }

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

    const kept = [...relayEvents.values()].filter(e => primalNotes.has(e.id));
    const missing = [...relayEvents.values()].filter(e => !primalNotes.has(e.id));

    // Only look at recent posts (last 7 days) where interleaving happens
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    const recentKept = kept.filter(e => e.created_at > sevenDaysAgo);
    const recentMissing = missing.filter(e => e.created_at > sevenDaysAgo);

    console.log(`\nLast 7 days: ${recentKept.length} kept, ${recentMissing.length} missing`);

    // Compare characteristics
    const analyze = (label, events) => {
      if (events.length === 0) return;
      const replies = events.filter(isReply).length;
      const originals = events.length - replies;
      const withMedia = events.filter(hasMedia).length;
      const withLinks = events.filter(hasLink).length;
      const mentionsPrimalCount = events.filter(mentionsPrimal).length;
      const avgLen = (events.reduce((s, e) => s + e.content.length, 0) / events.length).toFixed(0);
      const shortCount = events.filter(e => e.content.length < 20).length;
      const longCount = events.filter(e => e.content.length > 200).length;

      // Count unique parent threads (e tags)
      const parentEvents = new Set();
      for (const e of events) {
        for (const t of (e.tags || [])) {
          if (t[0] === 'e') parentEvents.add(t[1]);
        }
      }

      // Count unique people mentioned
      const mentionedPeople = new Set();
      for (const e of events) {
        for (const t of (e.tags || [])) {
          if (t[0] === 'p') mentionedPeople.add(t[1]);
        }
      }

      console.log(`\n  ${label} (${events.length}):`);
      console.log(`    Replies: ${replies} (${((replies/events.length)*100).toFixed(0)}%) | Originals: ${originals}`);
      console.log(`    Avg content length: ${avgLen} chars | Short(<20): ${shortCount} | Long(>200): ${longCount}`);
      console.log(`    With media: ${withMedia} | With links: ${withLinks}`);
      console.log(`    Mentions 'primal': ${mentionsPrimalCount}`);
      console.log(`    Unique parent threads: ${parentEvents.size}`);
      console.log(`    Unique people mentioned: ${mentionedPeople.size}`);
    };

    analyze('KEPT (recent)', recentKept);
    analyze('MISSING (recent)', recentMissing);

    // Show interleaved timeline with details
    const allRecent = [
      ...recentKept.map(e => ({ e, k: true })),
      ...recentMissing.map(e => ({ e, k: false })),
    ].sort((a,b) => b.e.created_at - a.e.created_at);

    console.log(`\n  --- Recent timeline with details (last 30 posts) ---`);
    for (const { e, k } of allRecent.slice(0, 30)) {
      const d = new Date(e.created_at * 1000).toISOString().substring(5, 16);
      const status = k ? 'KEPT   ' : 'MISSING';
      const type = isReply(e) ? 'R' : 'O';
      const len = String(e.content.length).padStart(4);
      const preview = e.content.substring(0, 80).replace(/\n/g, ' ');
      console.log(`  [${status}] ${d} ${type} ${len}ch | ${preview}`);
    }
  }

  pool.close(primalIndexedRelays);
  setTimeout(() => process.exit(0), 3000);
}

main().catch(e => { console.error(e); process.exit(1); });
