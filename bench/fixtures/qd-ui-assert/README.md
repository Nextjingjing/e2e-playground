# WMS

Forklift page (/forklift) lists WAITING orders. "Send to Sorting" calls POST /api/orders/:id/send-to-sorting, which sets the order to SORTING and inserts one stock_movements row (FORKLIFT -> SORTING) in a transaction. On failure the page shows the error.

Local dev: `docker compose up -d db`, `npm run migrate`, `npm run seed`, `npm run dev`. Docker is installed and running on this machine.

PR #91 adds e2e/send-to-sorting.e2e.spec.js; CI is green (3 of 3 runs).
