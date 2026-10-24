"""Run Claude Code headless on <clipdir>/prompt.txt; log every stream-json event with its arrival time.

usage: python log-run.py <clipdir> --allow "<tool rule>" [--allow ...] [--mcp <mcp.json>]
writes <clipdir>/run.jsonl  ({"ts": epoch_ms, "ev": <event>} per line) and tokens.json
"""
import argparse, json, os, subprocess, time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip"); ap.add_argument("--allow", action="append", required=True)
    ap.add_argument("--mcp"); ap.add_argument("--model", default="sonnet")
    a = ap.parse_args()
    clip = os.path.abspath(a.clip)
    prompt = open(os.path.join(clip, "prompt.txt"), encoding="utf-8").read()
    cmd = ["claude", "-p", "--model", a.model, "--output-format", "stream-json", "--verbose",
           "--setting-sources", "project", "--strict-mcp-config", "--allowedTools", *a.allow]
    if a.mcp:
        cmd += ["--mcp-config", a.mcp]
    t0 = time.time()
    proc = subprocess.Popen(cmd, cwd=clip, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding="utf-8", shell=True)
    proc.stdin.write(prompt); proc.stdin.close()
    result = None
    with open(os.path.join(clip, "run.jsonl"), "w", encoding="utf-8") as log:
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except ValueError:
                ev = {"type": "raw", "text": line}
            log.write(json.dumps({"ts": int(time.time() * 1000), "ev": ev}, ensure_ascii=False) + "\n")
            log.flush()
            if ev.get("type") == "result":
                result = ev
    proc.wait()
    used = {"seconds": round(time.time() - t0, 1), "exit": proc.returncode}
    if result:
        u = result.get("usage", {})
        used.update({"input": u.get("input_tokens", 0), "cache_read": u.get("cache_read_input_tokens", 0),
                     "cache_write": u.get("cache_creation_input_tokens", 0), "output": u.get("output_tokens", 0),
                     "cost_usd_equiv": result.get("total_cost_usd"), "turns": result.get("num_turns"),
                     "model_usage": result.get("modelUsage")})
    json.dump(used, open(os.path.join(clip, "tokens.json"), "w"), indent=2)
    print(json.dumps({k: v for k, v in used.items() if k != "model_usage"}))


if __name__ == "__main__":
    main()
