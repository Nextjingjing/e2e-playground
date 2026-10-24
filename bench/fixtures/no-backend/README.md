# Orders UI

Frontend only. The Orders API belongs to the Atlas team: it runs only in their cloud (https://orders.atlas.example.com), needs the corporate VPN, and there is no local or Docker version. CI has no VPN. The contract is in openapi.yaml.

Orders page: each picked order shows "Waiting N min" and the number keeps counting; "Cancel" calls DELETE /orders/{id} and removes the row.
