"use client";
import { useEffect, useState } from "react";

export default function Forklift() {
  const [orders, setOrders] = useState([]);
  const [msg, setMsg] = useState("");
  useEffect(() => { fetch("/api/orders?status=WAITING").then(r => r.json()).then(setOrders); }, []);
  async function send(o) {
    const res = await fetch(`/api/orders/${o.id}/send-to-sorting`, { method: "POST" });
    if (res.ok) { setOrders(orders.filter(x => x.id !== o.id)); setMsg(`Done: ${o.code} sent to Sorting`); }
    else setMsg(`Could not send ${o.code}: ${(await res.json()).error}`);
  }
  return (
    <main>
      <h1>Forklift — waiting orders</h1>
      <p role="status">{msg}</p>
      <table><tbody>{orders.map(o => (
        <tr key={o.id}><td>{o.code}</td><td>{o.status}</td><td><button onClick={() => send(o)}>Send to Sorting</button></td></tr>
      ))}</tbody></table>
    </main>
  );
}
