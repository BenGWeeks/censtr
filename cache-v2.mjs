import WebSocket from 'ws';

const PRIMAL_CACHE = 'wss://cache2.primal.net/v1';

const users = {
  semisol: '52b4a076bcbbbdc3a1aefa3735816cf74993b1b8db202b01c883c58be7fad8bd',
  fuckstr: 'd7100f9e3079cb803be226e198269bf9aa8d1e7576d7fbe27a009a3a1780be22',
  ralf: 'c89cf36deea286da912d4145f7140c73495d77e2cfedfb652158daa7c771f2f8',
  'jack (control)': '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2',
};

function queryPrimalRaw(request) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(PRIMAL_CACHE);
    const messages = [];
    const subId = 'sub_' + Math.random().toString(36).slice(2, 10);

    // Replace placeholder subId in request
    const req = JSON.parse(JSON.stringify(request));
    req[1] = subId;

    const timeout = setTimeout(() => {
      ws.close();
      resolve(messages);
    }, 15000);

    ws.on('open', () => {
      ws.send(JSON.stringify(req));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT' && msg[1] === subId) {
          messages.push(msg[2]);
        } else if (msg[0] === 'EOSE') {
          clearTimeout(timeout);
          ws.close();
          resolve(messages);
        }
      } catch {}
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main() {
  for (const [name, hex] of Object.entries(users)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${name} (${hex.substring(0, 16)}...)`);
    console.log(`${'='.repeat(60)}`);

    // Try different query methods

    // Method 1: Standard NIP-01 REQ (Primal might support this too)
    console.log(`\n1. Standard NIP-01 REQ (kinds:[1], limit:20):`);
    const nip01 = await queryPrimalRaw(["REQ", "x", { kinds: [1], authors: [hex], limit: 20 }]);
    const nip01Notes = nip01.filter(e => e.kind === 1 && e.pubkey === hex);
    console.log(`   ${nip01Notes.length} notes`);

    // Method 2: Cache feed
    console.log(`2. Cache feed query:`);
    const feed = await queryPrimalRaw(["REQ", "x", { cache: ["feed", { pubkey: hex, limit: 20 }] }]);
    const feedNotes = feed.filter(e => e.kind === 1);
    console.log(`   ${feed.length} total events, ${feedNotes.length} kind-1 notes`);
    // Log the kinds we got back
    const kinds = {};
    feed.forEach(e => { kinds[e.kind] = (kinds[e.kind] || 0) + 1; });
    console.log(`   Event kinds: ${JSON.stringify(kinds)}`);

    // Method 3: Cache authored notes
    console.log(`3. Cache user_feed query (authored):`);
    const authored = await queryPrimalRaw(["REQ", "x", { cache: ["user_feed", { pubkey: hex, limit: 20 }] }]);
    const authoredNotes = authored.filter(e => e.kind === 1 && e.pubkey === hex);
    console.log(`   ${authored.length} total events, ${authoredNotes.length} kind-1 by user`);

    // Show some notes if found
    const allNotes = [...new Map([...nip01Notes, ...feedNotes.filter(e => e.pubkey === hex), ...authoredNotes]
      .map(e => [e.id, e])).values()];
    allNotes.sort((a, b) => b.created_at - a.created_at);

    if (allNotes.length > 0) {
      console.log(`\n   Combined unique notes: ${allNotes.length}`);
      for (const e of allNotes.slice(0, 3)) {
        const date = new Date(e.created_at * 1000).toISOString();
        console.log(`   [${date}] ${e.content.substring(0, 100).replace(/\n/g, ' ')}`);
      }
    } else {
      console.log(`\n   >>> NO NOTES FOUND via any method <<<`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
