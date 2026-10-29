# WMS Admin (Next.js + Express + Postgres; Docker works here; Playwright already set up in e2e/)

| page | what it does | history |
|---|---|---|
| /login | login, roles picker / supervisor / admin | role-check bypass bug in March (fixed) |
| /stock/adjust | supervisor changes on-hand quantity, writes stock_adjustments, needs a reason | wrong sign on negative adjustments in May; finance noticed after 2 weeks |
| /orders/:id/ship | marks an order shipped, posts the invoice to the ERP sandbox | double invoices in July after a double click |
| /users | admin creates users and sets roles | - |
| /reports/daily | read-only table + CSV download | - |
| /about | static text and app version | - |
| /settings/theme | light / dark toggle stored in localStorage | - |
| /help | static FAQ | - |

Unit tests exist for the pricing and quantity helpers (src/lib). No API tests yet. e2e/ has one login smoke test.
