# desk-tracker-rail

Chart-first XAUUSD desk. A tape and a 280px rail. Nothing else.

- Chart: Dukascopy D1 through Fri 14 Aug 2026, then a live tick sparkline
- Live last: [gold-api XAU](https://api.gold-api.com/price/XAU) every 20s (indicative mid — not Coinexx, not OANDA)
- Desk: `events.json` + `book.json` every 3s
- STALE marks a failed poll. Book bid is the only spot fallback.

https://jonschwadron.github.io/desk-tracker-rail/
