import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';

useWebSocketImplementation(WebSocket);

const users = {
  semisol: '52b4a076bcbbbdc3a1aefa3735816cf74993b1b8db202b01c883c58be7fad8bd',
  fuckstr: 'd7100f9e3079cb803be226e198269bf9aa8d1e7576d7fbe27a009a3a1780be22',
  'ralf (ralf@nostrfreaks.com)': 'c89cf36deea286da912d4145f7140c73495d77e2cfedfb652158daa7c771f2f8',
};

const primalRelay = 'wss://relay.primal.net';
const otherRelays = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
];

const pool = new SimplePool();

async function queryRelay(relays, pubkey, limit = 50) {
  try {
    const events = await pool.querySync(relays, {
      kinds: [1],
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
  for (const [name, hex] of Object.entries(users)) {
    const npub = nip19.npubEncode(hex);
    console.log(`\n${'='.repeat(70)}`);
    console.log(`User: ${name}`);
    console.log(`npub: ${npub}`);
    console.log(`hex:  ${hex}`);
    console.log(`${'='.repeat(70)}`);

    // Query Primal
    console.log(`\nQuerying Primal (${primalRelay})...`);
    const primalEvents = await queryRelay([primalRelay], hex, 50);
    console.log(`  -> ${primalEvents.length} events`);

    // Query each other relay individually for detail
    const allOtherEvents = new Map();
    for (const relay of otherRelays) {
      const events = await queryRelay([relay], hex, 50);
      console.log(`  ${relay}: ${events.length} events`);
      for (const e of events) {
        if (!allOtherEvents.has(e.id)) {
          allOtherEvents.set(e.id, e);
        }
      }
    }

    const primalIds = new Set(primalEvents.map(e => e.id));
    const missingFromPrimal = [...allOtherEvents.values()].filter(e => !primalIds.has(e.id));

    console.log(`\n  TOTAL unique events from other relays: ${allOtherEvents.size}`);
    console.log(`  Events on Primal: ${primalEvents.length}`);
    console.log(`  >>> MISSING from Primal: ${missingFromPrimal.length} <<<`);

    if (missingFromPrimal.length > 0) {
      // Sort by date descending
      missingFromPrimal.sort((a, b) => b.created_at - a.created_at);
      console.log(`\n  --- Missing notes (first 5) ---`);
      for (const e of missingFromPrimal.slice(0, 5)) {
        const date = new Date(e.created_at * 1000).toISOString();
        const content = e.content.substring(0, 120).replace(/\n/g, ' ');
        console.log(`  [${date}] ${content}`);
      }
    }

    if (primalEvents.length > 0) {
      primalEvents.sort((a, b) => b.created_at - a.created_at);
      console.log(`\n  --- Latest on Primal (first 3) ---`);
      for (const e of primalEvents.slice(0, 3)) {
        const date = new Date(e.created_at * 1000).toISOString();
        const content = e.content.substring(0, 120).replace(/\n/g, ' ');
        console.log(`  [${date}] ${content}`);
      }
    }
  }

  pool.close([primalRelay, ...otherRelays]);
  setTimeout(() => process.exit(0), 2000);
}

main().catch(e => { console.error(e); process.exit(1); });
