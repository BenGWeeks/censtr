import WebSocket from 'ws';
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';

useWebSocketImplementation(WebSocket);

const searchRelays = ['wss://relay.nostr.band', 'wss://search.nos.today'];
const pool = new SimplePool();

async function main() {
  console.log('Searching for BenGWeeks on Nostr...\n');
  try {
    const events = await Promise.race([
      pool.querySync(searchRelays, { kinds: [0], search: 'BenGWeeks', limit: 10 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
    ]);

    for (const e of events) {
      try {
        const meta = JSON.parse(e.content);
        const name = meta.display_name || meta.name || '';
        if (name.toLowerCase().includes('ben') || (meta.name && meta.name.toLowerCase().includes('ben')) ||
            (meta.nip05 && meta.nip05.toLowerCase().includes('ben'))) {
          console.log(`Found: ${name} (@${meta.name})`);
          console.log(`NIP-05: ${meta.nip05 || 'none'}`);
          console.log(`Hex pubkey: ${e.pubkey}`);
          console.log(`About: ${(meta.about || '').substring(0, 150)}`);
          console.log('');
        }
      } catch {}
    }
  } catch (e) {
    console.error('Search error:', e.message);
  }

  pool.close(searchRelays);
  setTimeout(() => process.exit(0), 2000);
}

main();
