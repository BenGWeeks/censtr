import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';

useWebSocketImplementation(WebSocket);

// Known users to check
const users = {
  semisol: 'npub12262qa4uhw7u8gdwlgmntqtv7aye8vdcmvszkqwgs0zchel6mz7s6cgrkj',
};

// Convert npubs to hex
const hexKeys = {};
for (const [name, npub] of Object.entries(users)) {
  const decoded = nip19.decode(npub);
  hexKeys[name] = decoded.data;
  console.log(`${name}: ${npub} -> ${decoded.data}`);
}

const primalRelay = 'wss://relay.primal.net';
const otherRelays = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

const pool = new SimplePool();

async function queryRelay(relays, pubkey, limit = 50) {
  try {
    const events = await pool.querySync(relays, {
      kinds: [1], // text notes
      authors: [pubkey],
      limit,
    });
    return events;
  } catch (e) {
    console.error(`Error querying ${relays}:`, e.message);
    return [];
  }
}

async function main() {
  for (const [name, hex] of Object.entries(hexKeys)) {
    console.log(`\n=== Comparing notes for ${name} ===`);
    console.log(`Hex pubkey: ${hex}`);

    // Query Primal
    console.log(`\nQuerying ${primalRelay}...`);
    const primalEvents = await queryRelay([primalRelay], hex, 50);
    console.log(`Primal returned ${primalEvents.length} events`);

    // Query other relays
    console.log(`\nQuerying other relays: ${otherRelays.join(', ')}...`);
    const otherEvents = await queryRelay(otherRelays, hex, 50);
    console.log(`Other relays returned ${otherEvents.length} events`);

    // Find events present in other relays but missing from Primal
    const primalIds = new Set(primalEvents.map(e => e.id));
    const otherIds = new Set(otherEvents.map(e => e.id));

    const missingFromPrimal = otherEvents.filter(e => !primalIds.has(e.id));
    const missingFromOthers = primalEvents.filter(e => !otherIds.has(e.id));

    console.log(`\n--- Results ---`);
    console.log(`Events on other relays but MISSING from Primal: ${missingFromPrimal.length}`);
    console.log(`Events on Primal but missing from others: ${missingFromOthers.length}`);

    if (missingFromPrimal.length > 0) {
      console.log(`\n--- Notes MISSING from Primal (first 5) ---`);
      for (const e of missingFromPrimal.slice(0, 5)) {
        const date = new Date(e.created_at * 1000).toISOString();
        const content = e.content.substring(0, 150);
        console.log(`  ID: ${e.id}`);
        console.log(`  Date: ${date}`);
        console.log(`  Content: ${content}`);
        console.log('');
      }
    }

    if (primalEvents.length > 0) {
      console.log(`\n--- Sample Primal events (first 3) ---`);
      for (const e of primalEvents.slice(0, 3)) {
        const date = new Date(e.created_at * 1000).toISOString();
        const content = e.content.substring(0, 150);
        console.log(`  ID: ${e.id}`);
        console.log(`  Date: ${date}`);
        console.log(`  Content: ${content}`);
        console.log('');
      }
    }
  }

  pool.close([primalRelay, ...otherRelays]);
  setTimeout(() => process.exit(0), 1000);
}

main().catch(e => { console.error(e); process.exit(1); });
