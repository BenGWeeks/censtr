import WebSocket from 'ws';

const PRIMAL_CACHE = 'wss://cache2.primal.net/v1';

const hex = '52b4a076bcbbbdc3a1aefa3735816cf74993b1b8db202b01c883c58be7fad8bd'; // semisol

function queryPrimalCache(pubkey, notesType, includeReplies, limit = 100) {
  return new Promise((resolve) => {
    const ws = new WebSocket(PRIMAL_CACHE);
    const events = [];
    const subId = 'sub_' + Math.random().toString(36).slice(2, 10);
    const timeout = setTimeout(() => { ws.close(); resolve(events); }, 15000);
    ws.on('open', () => {
      const params = { pubkey, limit };
      if (notesType !== undefined) params.notes = notesType;
      if (includeReplies !== undefined) params.include_replies = includeReplies;
      ws.send(JSON.stringify(["REQ", subId, { cache: ["feed", params] }]));
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

function isReply(event) {
  return event.tags?.some(t => t[0] === 'e' || t[0] === 'q');
}

async function main() {
  const variants = [
    { label: 'notes="authored", include_replies=true', notes: 'authored', replies: true },
    { label: 'notes="authored", include_replies=false', notes: 'authored', replies: false },
    { label: 'notes="authored", no include_replies', notes: 'authored', replies: undefined },
    { label: 'notes="replies", include_replies=true', notes: 'replies', replies: true },
    { label: 'no notes param, include_replies=false', notes: undefined, replies: false },
    { label: 'no notes param, include_replies=true', notes: undefined, replies: true },
  ];

  for (const v of variants) {
    console.log(`\n=== ${v.label} ===`);
    const all = await queryPrimalCache(hex, v.notes, v.replies, 100);
    const k1 = all.filter(e => e.kind === 1 && e.pubkey === hex);
    const replies = k1.filter(isReply);
    const originals = k1.filter(e => !isReply(e));
    console.log(`  Total events: ${all.length}, kind-1 by user: ${k1.length}`);
    console.log(`  Originals: ${originals.length}, Replies: ${replies.length}`);
    if (originals.length > 0) {
      console.log(`  Sample original: ${originals[0].content.substring(0, 80).replace(/\n/g, ' ')}`);
    }
    if (replies.length > 0) {
      console.log(`  Sample reply: ${replies[0].content.substring(0, 80).replace(/\n/g, ' ')}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
