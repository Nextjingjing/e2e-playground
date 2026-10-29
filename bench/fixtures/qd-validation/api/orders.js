// POST /api/orders validation (used by api/server.js)
const ZONES = ["A", "B", "C", "COLD"];
function validate(o) {
  const e = [];
  if (!/^[A-Z]{3}-\d{4}$/.test(o.sku || "")) e.push("sku must look like ABC-1234");
  if (!Number.isInteger(o.qty)) e.push("qty must be an integer");
  else if (o.qty > 999) e.push("qty must be at most 999");
  if (!ZONES.includes(o.zone)) e.push("zone must be A, B, C or COLD");
  if (o.zone === "COLD" && !o.coldChainOk) e.push("COLD orders need coldChainOk");
  if (o.priority != null && ![1, 2, 3].includes(o.priority)) e.push("priority must be 1, 2 or 3");
  if (o.dueDate && Number.isNaN(Date.parse(o.dueDate))) e.push("dueDate must be a date");
  if (o.dueDate && Date.parse(o.dueDate) < Date.now()) e.push("dueDate can't be in the past");
  if ((o.note || "").length > 200) e.push("note is at most 200 characters");
  if (o.customerRef && !/^C\d{6}$/.test(o.customerRef)) e.push("customerRef must look like C123456");
  if (o.hazmat && o.zone !== "C") e.push("hazmat goes to zone C only");
  return e;
}
module.exports = { validate, ZONES };
