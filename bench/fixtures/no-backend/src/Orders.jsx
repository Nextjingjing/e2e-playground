import { useEffect, useState } from "react";
const API = import.meta.env.VITE_API_URL;

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { fetch(`${API}/orders`).then(r => r.json()).then(setOrders); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  const cancel = async o => { await fetch(`${API}/orders/${o.id}`, { method: "DELETE" }); setOrders(orders.filter(x => x.id !== o.id)); };
  return <table><tbody>{orders.map(o => (
    <tr key={o.id}><td>{o.code}</td><td>Waiting {Math.floor((now - Date.parse(o.pickedAt)) / 60000)} min</td><td><button onClick={() => cancel(o)}>Cancel</button></td></tr>
  ))}</tbody></table>;
}
