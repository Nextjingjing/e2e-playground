require("dotenv").config();
const express = require("express");
const path = require("path");
const pool = require("./db/pool");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/orders", async (req, res) => {
  const { rows } = await pool.query(
    "select id, code, status from orders where ($1::text is null or status = $1) order by code",
    [req.query.status || null]);
  res.json(rows);
});

app.post("/api/orders", async (req, res) => {
  const { code, status = "WAITING" } = req.body;
  if (!code) return res.status(400).json({ error: "code is required" });
  try {
    const { rows } = await pool.query("insert into orders (code, status) values ($1, $2) returning id, code, status", [code, status]);
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  const { rows } = await pool.query("select id, code, status from orders where id = $1", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

app.get("/api/orders/:id/movements", async (req, res) => {
  const { rows } = await pool.query(
    "select id, from_area, to_area from stock_movements where order_id = $1 order by id", [req.params.id]);
  res.json(rows);
});

// Send a waiting order to the Sorting area: one status change + one stock movement, atomically.
app.post("/api/orders/:id/send-to-sorting", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query("select status from orders where id = $1 for update", [req.params.id]);
    if (!rows.length) { await client.query("rollback"); return res.status(404).json({ error: "order not found" }); }
    if (rows[0].status !== "WAITING") {
      await client.query("rollback");
      return res.status(409).json({ error: `order is ${rows[0].status}, not WAITING` });
    }
    await client.query("update orders set status = 'SORTING' where id = $1", [req.params.id]);
    await client.query("insert into stock_movements (order_id, from_area, to_area) values ($1, 'FORKLIFT', 'SORTING')", [req.params.id]);
    await client.query("commit");
    res.json({ ok: true });
  } catch (e) {
    await client.query("rollback").catch(() => {});
    res.status(500).json({ error: "could not send to sorting" });
  } finally {
    client.release();
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`mini-wms on http://localhost:${port}`));
