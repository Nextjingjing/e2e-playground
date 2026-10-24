// Dev data the team clicks through every day. Don't wipe it casually.
const pool = require("./pool");

(async () => {
  for (const code of ["A-001", "A-002", "A-003", "B-101"]) {
    await pool.query("insert into orders (code, status) values ($1, 'WAITING') on conflict (code) do nothing", [code]);
  }
  console.log("seeded");
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
