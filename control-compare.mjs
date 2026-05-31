import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';

useWebSocketImplementation(WebSocket);

// Control users: well-known, not controversial
const users = {
  'jack (jack dorsey)': '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2',
  'fiatjaf': '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
};

const primalRelay = 'wss://relay.primal.net';
const otherRelays = ['wss://nos.lol', 'wss://relay.damus.io'];

const pool = new SimplePool();

async function queryRelay(relays, pubkey, limit = 50) {
  try {
    return await pool.querySync(relays, { kinds: [1], authors: [pubkey], limit });
  } catch (e) {
    console.error(`Error:`, e.message);
    return [];
  }
}

async function main() {
  for (const [name, hex] of Object.entries(users)) {
    console.log(`\n=== ${name} ===`);

    const primalEvents = await queryRelay([primalRelay], hex, 50);
    console.log(`Primal: ${primalEvents.length} events`);

    const allOther = new Map();
    for (const relay of otherRelays) {
      const events = await queryRelay([relay], hex, 50);
      console.log(`${relay}: ${events.length} events`);
      for (const e of events) allOther.set(e.id, e);
    }

    const primalIds = new Set(primalEvents.map(e => e.id));
    const missing = [...allOther.values()].filter(e => !primalIds.has(e.id));
    console.log(`Other relays unique: ${allOther.size}, Missing from Primal: ${missing.length}`);
  }

  pool.close([primalRelay, ...otherRelays]);
  setTimeout(() => process.exit(0), 2000);
}

main().catch(e => { console.error(e); process.exit(1); });
