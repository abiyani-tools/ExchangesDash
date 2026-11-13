"""/api/brokers-inputs (dashboard/api/brokers-inputs.js): the PAT Predictor's saved inputs. GET reads them through the
brokers-dashboard project's sb_pat_saved_inputs, POST saves through sb_save_pat_inputs (no password: the last Save
wins); the ranges and the guard of 30 saves a minute live in the database. Run in Node with fetch stubbed: the requests the handler makes and the
status / body it answers with."""

import json
import subprocess
import unittest

from helpers import DASHBOARD, NODE

API = DASHBOARD / "api" / "brokers-inputs.js"

SAVED = {"broker": "GROWW", "g": 0.04, "gm": 0.127, "gm_own": True, "pe": [44.3, 50, 55.7], "disc": 0.2, "today": 0.1,
         "saved_at": "2026-11-13T09:30:00+00:00"}


def call(method, query=None, body=None, rpc=None, status=200):
    """Run the handler once: rpc is the JSON the stubbed Supabase RPC answers (with HTTP `status`).
    Returns (status, body, [{url, body}] of the RPC calls)."""
    script = f"""
process.env.BROKERS_SUPABASE_KEY = 'pk_test';
const calls = [];
global.fetch = async (url, opts) => {{
  calls.push({{ url, body: opts && opts.body ? JSON.parse(opts.body) : null }});
  return {{ ok: {json.dumps(status)} < 400, status: {json.dumps(status)}, json: async () => ({json.dumps(rpc)}) }};
}};
const handler = require({json.dumps(str(API))});
const res = {{ code: 0, headers: {{}}, body: null,
  setHeader(k, v) {{ this.headers[k] = v; }}, status(c) {{ this.code = c; return this; }}, json(b) {{ this.body = b; return this; }} }};
handler({{ method: {json.dumps(method)}, query: {json.dumps(query or {})}, body: {json.dumps(body)} }}, res).then(() =>
  process.stdout.write(JSON.stringify([res.code, res.body, calls, res.headers['Cache-Control']])));
"""
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr)
    code, b, calls, cache = json.loads(out.stdout)
    assert cache == "no-store"
    return code, b, calls


@unittest.skipUnless(NODE, "node not installed")
class BrokersInputs(unittest.TestCase):
    def test_get_reads_the_saved_inputs(self):
        code, body, calls = call("GET", {"broker": "groww"}, rpc=SAVED)
        self.assertEqual(code, 200)
        self.assertEqual(body["inputs"]["gm"], 0.127)
        self.assertEqual(body["inputs"]["pe"], [44.3, 50, 55.7])
        self.assertTrue(calls[0]["url"].endswith("/rest/v1/rpc/sb_pat_saved_inputs"))
        self.assertEqual(calls[0]["body"], {"p_broker": "GROWW"})

    def test_get_before_the_migration_answers_no_inputs(self):
        code, body, _ = call("GET", {"broker": "GROWW"}, rpc={"message": "not found"}, status=404)
        self.assertEqual((code, body["inputs"]), (200, None))

    def test_post_saves_and_returns_the_inputs(self):
        inputs = {"g": 0.04, "gm": 0.127, "pe": [44.3, 50, 55.7], "disc": 0.2, "today": 0.1}
        code, body, calls = call("POST", body={"broker": "GROWW", "inputs": inputs}, rpc={"ok": True, "saved": SAVED})
        self.assertEqual(code, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["inputs"]["saved_at"], SAVED["saved_at"])
        self.assertTrue(calls[0]["url"].endswith("/rest/v1/rpc/sb_save_pat_inputs"))
        self.assertEqual(calls[0]["body"], {"p_broker": "GROWW", "p_inputs": inputs})

    def test_post_errors_from_the_database(self):
        for error, want in (("Too many saves in the last minute: try again shortly", 429),
                            ("Values out of range: …", 400), ("unknown broker", 400)):
            code, body, _ = call("POST", body={"broker": "GROWW", "inputs": {"g": 0, "gm": 0, "pe": [1, 2, 3], "disc": 0,
                                                                             "today": 0}},
                                 rpc={"ok": False, "error": error})
            self.assertEqual((code, body["ok"], body["error"]), (want, False, error))

    def test_post_checks_before_calling_the_database(self):
        code, body, calls = call("POST", body={"broker": "GROWW", "inputs": {"g": 0.04}}, rpc={})
        self.assertEqual((code, body["error"], calls), (400, "Every input needs a number", []))
        code, body, calls = call("POST", body={"broker": "no such!", "inputs": {}}, rpc={})
        self.assertEqual((code, calls), (400, []))

    def test_other_methods(self):
        code, _, calls = call("DELETE", rpc={})
        self.assertEqual((code, calls), (405, []))


if __name__ == "__main__":
    unittest.main()
