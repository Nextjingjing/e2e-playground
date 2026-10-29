const express = require("express");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const app = express();
app.use(express.json());

app.get("/api/orders", async (req, res) => res.json(await db.order.findMany({ where: { status: req.query.status } })));

// Send a waiting order to Sorting: status SORTING + one stock movement, in one transaction.
app.post("/api/orders/:id/send-to-sorting", async (req, res) => {
  const id = Number(req.params.id);
  const order = await db.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: "order not found" });
  if (order.status !== "WAITING") return res.status(409).json({ error: `order is ${order.status}, not WAITING` });
  await db.$transaction([
    db.order.update({ where: { id }, data: { status: "SORTING" } }),
    db.stockMovement.create({ data: { orderId: id, from: "FORKLIFT", to: "SORTING" } }),
  ]);
  res.json({ ok: true });
});

app.listen(process.env.PORT || 4000);
