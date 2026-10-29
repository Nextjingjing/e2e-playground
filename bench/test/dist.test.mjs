// dist/<skill>.zip (made by install.ps1 -Zip / ZIP=1 install.sh, not committed) must hold exactly the
// skill folder as it is now. 2026-10-25: brat-e2e.zip had been built before its references existed and
// was missing web-setup.md and patterns.md, which SKILL.md tells the reader to open.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const skills = path.join(repo, "plugins", "e2e-playground", "skills");
const dist = path.join(repo, "dist");

// Minimal reader: end-of-central-directory -> central directory -> each local entry (stored or deflated).
function readZip(file) {
  const b = fs.readFileSync(file);
  let eocd = b.length - 22;
  while (eocd >= 0 && b.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const method = b.readUInt16LE(p + 10), size = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const raw = b.subarray(start, start + size);
    if (!name.endsWith("/")) out.set(name, method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function listSkill(dir, base = skills, out = new Map()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__pycache__") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listSkill(full, base, out);
    else out.set(path.relative(base, full).replace(/\\/g, "/"), fs.readFileSync(full));
  }
  return out;
}

const norm = buf => buf.toString("utf8").replace(/\r\n/g, "\n");

for (const name of fs.existsSync(skills) ? fs.readdirSync(skills) : []) {
  const zip = path.join(dist, `${name}.zip`);
  test(`dist/${name}.zip matches the skill folder`, { skip: !fs.existsSync(zip) && "not built (run install.ps1 -Zip)" }, () => {
    const inZip = readZip(zip), onDisk = listSkill(path.join(skills, name));
    const missing = [...onDisk.keys()].filter(k => !inZip.has(k));
    const extra = [...inZip.keys()].filter(k => !onDisk.has(k));
    const stale = [...onDisk.keys()].filter(k => inZip.has(k) && norm(inZip.get(k)) !== norm(onDisk.get(k)));
    assert.deepEqual({ missing, extra, stale }, { missing: [], extra: [], stale: [] }, "rebuild: .\\install.ps1 -Zip  or  ZIP=1 ./install.sh");
  });
}
