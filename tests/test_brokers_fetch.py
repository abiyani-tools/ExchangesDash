"""brkFetchPatient (dashboard/js/30-brokers.js): a Brokers tab's data that one stuck
response can't hold up. Run in Node with fetchDataFile and fetch stubbed and
BRK_SLOW_MS shortened to 30 ms."""

import json
import subprocess
import unittest

from helpers import NODE, js_source

HARNESS = """
const FETCH_TIMEOUT_MS = 45000;
let BRK_BROKER = { id: 'ANGELONE' };
const calls = [];
// SCENARIO sets how each request answers: [delay ms, 'ok' | 'fail'], first the
// shared request (fetchDataFile), then the fresh one (fetch)
const answer = (i, url, body) => new Promise((resolve, reject) => {
  const [ms, how] = SCENARIO[i] || [1e6, 'ok'];
  setTimeout(() => how === 'ok' ? resolve(body) : reject(new Error(`request ${i} failed`)), ms);
});
function fetchDataFile(url) { calls.push(['shared', url]); return answer(0, url, { json: { from: 'shared' } }); }
globalThis.fetch = (url, init) => {
  calls.push(['fresh', url, init.cache, !!init.signal]);
  return answer(1, url, { ok: true, json: async () => ({ from: 'fresh' }) });
};
let slowCalls = 0;
brkFetchPatient('pat', 'live', () => slowCalls++)
  .then(v => ({ value: v }), e => ({ error: e.message }))
  .then(out => { process.stdout.write(JSON.stringify({ ...out, calls, slowCalls })); process.exit(0); });
"""


def run(scenario):
    code = "\n".join(js_source(n) for n in ["brkFetch", "BRK_SLOW_MS", "brkFetchPatient"])
    code = code.replace("const BRK_SLOW_MS = 8000;", "const BRK_SLOW_MS = 30;")
    script = f"const SCENARIO = {json.dumps(scenario)};\n{code}\n{HARNESS}"
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=20)
    if out.returncode:
        raise RuntimeError(out.stderr)
    return json.loads(out.stdout)


URL = "/api/brokers?broker=ANGELONE&mode=live&view=pat"


@unittest.skipUnless(NODE, "node not installed")
class PatientFetch(unittest.TestCase):
    def test_fast_answer_asks_once(self):
        out = run([[5, "ok"]])
        self.assertEqual(out["value"], {"from": "shared"})
        self.assertEqual(out["calls"], [["shared", URL]])
        self.assertEqual(out["slowCalls"], 0)

    def test_stuck_answer_is_asked_again_at_the_same_url(self):
        out = run([[1e6, "ok"], [5, "ok"]])
        self.assertEqual(out["value"], {"from": "fresh"})
        # same URL (no cache-busting parameter), past the browser's HTTP cache, with a time limit
        self.assertEqual(out["calls"], [["shared", URL], ["fresh", URL, "no-store", True]])
        self.assertEqual(out["slowCalls"], 1)

    def test_slow_first_answer_still_wins_if_it_comes_first(self):
        out = run([[60, "ok"], [1e6, "ok"]])
        self.assertEqual(out["value"], {"from": "shared"})
        self.assertEqual(len(out["calls"]), 2)

    def test_quick_failure_is_reported_without_a_retry(self):
        out = run([[5, "fail"]])
        self.assertEqual(out["error"], "request 0 failed")
        self.assertEqual(out["calls"], [["shared", URL]])

    def test_one_failure_waits_for_the_other_request(self):
        out = run([[80, "fail"], [120, "ok"]])   # the shared one fails after the retry has gone out
        self.assertEqual(out["value"], {"from": "fresh"})

    def test_fails_only_when_both_fail(self):
        out = run([[60, "fail"], [10, "fail"]])
        self.assertIn("failed", out["error"])
        self.assertEqual(len(out["calls"]), 2)


if __name__ == "__main__":
    unittest.main()
