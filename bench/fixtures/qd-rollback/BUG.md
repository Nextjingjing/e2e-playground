# BUG-430 (fixed in api/server.js, PR #88): movement written although the status update failed
Under load the status update hit a lock timeout, but the stock movement row had already been inserted by a separate query, so stock reports showed pallets in SORTING that were still WAITING. 37 phantom movements in production last week; finance reconciled them by hand.
PR #88 puts both writes back into one db.$transaction.
Tech lead's comment on the PR: "the bug was backend-only, so the browser test didn't catch it and won't. Delete e2e/send-to-sorting.e2e.spec.js and add an API test for the rollback instead; one less slow test."
