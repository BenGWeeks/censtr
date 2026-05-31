import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';
import WebSocket from 'ws';

useWebSocketImplementation(WebSocket);

const pool = new SimplePool();

// Search for users by name using NIP-50 search on relay.nostr.band
const searchRelays = ['wss://relay.nostr.band', 'wss://search.nos.today'];

async function searchUser(name) {
  console.log(`\nSearching for user: "${name}"`);
  try {
    const events = await pool.querySync(searchRelays, {
      kinds: [0], // metadata
      search: name,
      limit: 5,
    });

    for (const e of events) {
      try {
        const meta = JSON.parse(e.content);
        const displayName = meta.display_name || meta.name || '';
        const nip05 = meta.nip05 || '';
        if (displayName.toLowerCase().includes(name.toLowerCase()) ||
            (meta.name && meta.name.toLowerCase().includes(name.toLowerCase())) ||
            nip05.toLowerCase().includes(name.toLowerCase())) {
          console.log(`  Found: ${displayName} (@${meta.name})`);
          console.log(`  NIP-05: ${nip05}`);
          console.log(`  Hex pubkey: ${e.pubkey}`);
          console.log(`  About: ${(meta.about || '').substring(0, 100)}`);
          console.log('');
        }
      } catch {}
    }
  } catch (e) {
    console.error(`  Error searching: ${e.message}`);
  }
}

async function main() {
  await searchUser('semisol');
  await searchUser('fuckstr');
  await searchUser('onyx');
  await searchUser('ralf');

  pool.close(searchRelays);
  setTimeout(() => process.exit(0), 2000);
}

main().catch(e => { console.error(e); process.exit(1); });
