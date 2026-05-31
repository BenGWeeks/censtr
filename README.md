<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/logo.svg">
  <img alt="censtr" src="assets/logo.svg" width="800">
</picture>

Tools for analysing whether Nostr clients are censoring users by comparing posts available on relays against what their caching layers return.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-18%2B-blue.svg)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey.svg)

Currently focused on [Primal](https://primal.net), which uses a caching server (`wss://cache2.primal.net/v1`) rather than connecting directly to relays. The Primal app queries this cache exclusively — users cannot add additional relays to work around any gaps.

## Findings

We queried Primal's cache API and compared the results against the relays Primal itself claims to index (from their [open-source config](https://github.com/PrimalHQ/primal-server/blob/main/default-relays.json)), for 7 users: the 4 named in censorship claims (semisol, fuckstr, ralf, onyx), 3 controls (jack, fiatjaf, jb55/Will Casarin), and the author (BenGWeeks).

**The posts missing from Primal's cache are not content-targeted.** For the allegedly censored users, the missing posts include mundane "gm" messages, emoji replies, and technical discussions — mixed in with the critical ones. Meanwhile, jb55's harshest anti-Primal posts (calling Primal "the biggest existential risk to nostr", accusing them of being "an op") are all **kept** on Primal's cache. If Primal were censoring by content, these would be the first to go.

**The pattern is structural, not political.** Missing posts correlate with: (1) age — older posts are evicted first, (2) volume — high-frequency posters like fuckstr and jb55 have higher drop rates, and (3) reply status — replies are deprioritised over original posts. These same patterns affect all users equally, including the controls.

**However, Primal's architecture remains a legitimate concern.** Their caching server sits between users and the Nostr network, applying Web of Trust scoring (PageRank-style, refreshed every 3 hours), content moderation rules, and filterlists — all at read time. The [source code](https://github.com/PrimalHQ/primal-server/blob/main/src/filterlist.jl) confirms infrastructure exists for blocking pubkeys from ingestion (`import_pubkey_blocked`) or retrieval (`access_pubkey_blocked`). While we found no evidence this is being used for political censorship today, the capability is there and users cannot opt out of it.

**fuckstr is the outlier worth watching.** With a 71% filtering rate vs 12-33% for most users, fuckstr's missing posts skew toward aggressive/vulgar content — consistent with content moderation rules rather than political censorship, but notably higher than controls.

## Chart

Open `chart.html` in a browser to see the interactive chart of missing posts over time, with annotations marking when Primal's moderation algorithms changed (from their git history).

## Scripts

All scripts query Nostr relays directly using `nostr-tools` over WebSocket. Run `npm install` first.

| Script | Purpose |
|--------|---------|
| `chart.mjs` | Generates the monthly missing-posts chart (`chart.html`) |
| `final-analysis.mjs` | Definitive comparison: Primal cache vs Primal-indexed relays for all users |
| `pattern-analysis.mjs` | Analyses what distinguishes kept vs missing posts (time, type, relay coverage) |
| `volume-pattern.mjs` | Deep dive into jb55 and fuckstr's interleaved kept/missing patterns |
| `jb55-posts.mjs` | Lists jb55's recent posts with kept/missing status |
| `search-users.mjs` | Searches Nostr for user profiles by name |

## Setup

```bash
npm install
node chart.mjs        # generates chart.html
node final-analysis.mjs  # runs the full comparison
```

## Methodology

1. Query Primal's cache API (`wss://cache2.primal.net/v1`) using their custom `feed` endpoint with `notes: "authored"`, fetching both originals (`include_replies: false`) and replies (`include_replies: true`)
2. Query each of Primal's indexed relays individually using standard NIP-01 `REQ` filters
3. Compare event IDs to find posts present on indexed relays but absent from the cache
4. Analyse patterns in the missing posts (time, content type, relay distribution)

## Key data

| User | Primal Cache | Indexed Relays | Missing | Filtering Rate |
|------|---|---|---|---|
| BenGWeeks | 1559 | 594 | 19 | 3.2% |
| fiatjaf (control) | 1702 | 658 | 78 | 11.9% |
| ralf | 1292 | 1323 | 179 | 21.7% |
| jack (control) | 1413 | 506 | 129 | 25.5% |
| semisol | 1818 | 1099 | 291 | 32.7% |
| jb55 (control) | 1874 | 1826 | 757 | 57.0% |
| fuckstr | 1150 | 1547 | 1105 | 71.4% |

## License

MIT
