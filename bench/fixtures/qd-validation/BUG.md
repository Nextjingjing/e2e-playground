# BUG-412: creating an order with qty 0 gives a 500
Steps: on /orders/new enter SKU ABC-1234, qty 0, zone A, Save.
Expected: "qty must be at least 1" under the field. Actual: "Something went wrong" (POST /api/orders -> 500, the DB check constraint qty > 0 throws).
Cause found: validate() in api/orders.js has no lower bound for qty. The fix is one line there.
