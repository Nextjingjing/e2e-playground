# WMS

Forklift page (/forklift) lists WAITING orders. "Send to Sorting" calls POST /api/orders/:id/send-to-sorting, which sets the order to SORTING and inserts one stock_movements row (FORKLIFT -> SORTING) in a transaction. On failure the page shows the error.

Local dev normally uses `docker compose up -d db`, but Docker is NOT installed on this machine and can't be (locked-down company laptop). No other database is installed locally either.
