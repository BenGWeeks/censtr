import WebSocket from 'ws';

const PRIMAL_CACHE = 'wss://cache2.primal.net/v1';

const users = {
  semisol: '52b4a076bcbbbdc3a1aefa3735816cf74993b1b8db202b01c883c58be7fad8bd',
  fuckstr: 'd7100f9e3079cb803be226e198269bf9aa8d1e7576d7fbe27a009a3a1780be22',
  ralf: 'c89cf36deea286da912d4145f7140c73495d77e2cfedfb652158daa7c771f2f8',
};

function queryPrimalCache(pubkey) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(PRIMAL_CACHE);
    const events = [];
    const subId = 'sub_' + Math.random().toString(36).slice(2, 10);

    const timeout = setTimeout(() => {
      ws.close();
      resolve(events);
    }, 10000);

    ws.on('open', () => {
      // Use Primal's custom cache API to get a user's feed/notes
      const req = JSON.stringify(["REQ", subId, { "cache": ["feed", { "pubkey": pubkey, "limit": 50 }] }]);
      ws.send(req);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT' && msg[1] === subId) {
          const event = msg[2];
          // Only kind 1 (text notes) from the target user
          if (event.kind === 1 && event.pubkey === pubkey) {
            events.push(event);
          }
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

// Also query the cache for user_profile to see if the user exists at all
function queryPrimalProfile(pubkey) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(PRIMAL_CACHE);
    const events = [];
    const subId = 'prof_' + Math.random().toString(36).slice(2, 10);

    const timeout = setTimeout(() => {
      ws.close();
      resolve(events);
    }, 10000);

    ws.on('open', () => {
      const req = JSON.stringify(["REQ", subId, { "cache": ["user_profile", { "pubkey": pubkey }] }]);
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

async function main() {
  for (const [name, hex] of Object.entries(users)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`User: ${name} (${hex})`);
    console.log(`${'='.repeat(60)}`);

    // Query profile
    console.log(`\nQuerying Primal cache for profile...`);
    const profile = await queryPrimalProfile(hex);
    const meta = profile.find(e => e.kind === 0);
    if (meta) {
      try {
        const m = JSON.parse(meta.content);
        console.log(`  Profile found: ${m.display_name || m.name} (@${m.name})`);
      } catch {
        console.log(`  Profile event found but couldn't parse`);
      }
    } else {
      console.log(`  NO PROFILE FOUND on Primal cache`);
    }

    // Query feed
    console.log(`\nQuerying Primal cache for feed (notes)...`);
    const feedEvents = await queryPrimalCache(hex);
    console.log(`  Primal cache returned ${feedEvents.length} text notes from this user`);

    if (feedEvents.length > 0) {
      feedEvents.sort((a, b) => b.created_at - a.created_at);
      console.log(`\n  Latest notes on Primal cache:`);
      for (const e of feedEvents.slice(0, 3)) {
        const date = new Date(e.created_at * 1000).toISOString();
        const content = e.content.substring(0, 120).replace(/\n/g, ' ');
        console.log(`  [${date}] ${content}`);
      }
    }
  }

  // Control: query for jack
  const jackHex = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`CONTROL - jack dorsey (${jackHex})`);
  console.log(`${'='.repeat(60)}`);
  const jackFeed = await queryPrimalCache(jackHex);
  console.log(`  Primal cache returned ${jackFeed.length} text notes`);
  if (jackFeed.length > 0) {
    jackFeed.sort((a, b) => b.created_at - a.created_at);
    for (const e of jackFeed.slice(0, 2)) {
      const date = new Date(e.created_at * 1000).toISOString();
      const content = e.content.substring(0, 100).replace(/\n/g, ' ');
      console.log(`  [${date}] ${content}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
