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

function queryPrimalCacheAuthored(pubkey, limit = 50) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(PRIMAL_CACHE);
    const events = [];
    const subId = 'sub_' + Math.random().toString(36).slice(2, 10);

    const timeout = setTimeout(() => {
      ws.close();
      resolve(events);
    }, 15000);

    ws.on('open', () => {
      const req = JSON.stringify(["REQ", subId, {
        cache: ["feed", {
          pubkey,
          notes: "authored",
          include_replies: false,
          limit,
        }]
      }]);
      ws.send(req);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT' && msg[1] === subId) {
          events.push(msg[2]);
        } else if (msg[0] === 'EOSE') {
          clearTimeout(timeout);
          ws.close();
          resolve(events);
        }
      } catch {}
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Query standard relays for comparison
const otherRelays = ['wss://nos.lol', 'wss://relay.damus.io'];
const pool = new SimplePool();

async function queryOtherRelays(pubkey) {
  try {
    return await pool.querySync(otherRelays, { kinds: [1], authors: [pubkey], limit: 50 });
  } catch {
    return [];
  }
}

async function main() {
  for (const [name, hex] of Object.entries(users)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${name}`);
    console.log(`${'='.repeat(60)}`);

    // Query Primal cache with "authored" notes
    const primalAll = await queryPrimalCacheAuthored(hex, 50);
    const primalNotes = primalAll.filter(e => e.kind === 1 && e.pubkey === hex);
    console.log(`Primal cache (authored): ${primalNotes.length} kind-1 notes (${primalAll.length} total events)`);

    // Query other relays
    const otherNotes = await queryOtherRelays(hex);
    console.log(`Other relays (nos.lol, damus): ${otherNotes.length} kind-1 notes`);

    // Compare
    const primalIds = new Set(primalNotes.map(e => e.id));
    const otherIds = new Set(otherNotes.map(e => e.id));
    const missingFromPrimal = otherNotes.filter(e => !primalIds.has(e.id));

    console.log(`\n>>> Missing from Primal: ${missingFromPrimal.length} / ${otherNotes.length} <<<`);

    if (primalNotes.length > 0) {
      primalNotes.sort((a, b) => b.created_at - a.created_at);
      console.log(`\nLatest on Primal:`);
      for (const e of primalNotes.slice(0, 3)) {
        const date = new Date(e.created_at * 1000).toISOString();
        console.log(`  [${date}] ${e.content.substring(0, 100).replace(/\n/g, ' ')}`);
      }
    }

    if (missingFromPrimal.length > 0) {
      missingFromPrimal.sort((a, b) => b.created_at - a.created_at);
      console.log(`\nMissing from Primal (first 5):`);
      for (const e of missingFromPrimal.slice(0, 5)) {
        const date = new Date(e.created_at * 1000).toISOString();
        console.log(`  [${date}] ${e.content.substring(0, 100).replace(/\n/g, ' ')}`);
      }
    }
  }

  pool.close(otherRelays);
  setTimeout(() => process.exit(0), 2000);
}

main().catch(e => { console.error(e); process.exit(1); });
