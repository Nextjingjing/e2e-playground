const path = require("path");
const { capture } = require("../capture.cjs");

const FIXTURE = path.join(__dirname, "fixtures", "orders.py");

// The orders demo: [y/N] prompt, Thai, a carriage-return progress bar, a DB write and the query that proves it.
async function ordersCast(dir) {
  const out = path.join(dir, "orders.cast");
  await capture({ shell: "powershell", cwd: dir, out }, [
    { type: `cd "${dir}"`, hidden: true },
    { type: `python "${FIXTURE}" --db o.db add A-042 น้ำดื่ม`, expect: /Continue\? \[y\/N\]/ },
    { type: "y", expect: /บันทึกแล้ว/ },
    { type: `python "${FIXTURE}" --db o.db list`, mark: "proof" },
  ]);
  return out;
}
module.exports = { ordersCast, FIXTURE };
