"""Brokers → Price vs ADR (dashboard/js/31-brokers-price.js): the daily ADR series
each basis builds from the engine's sb_daily_revenue rows, run in Node."""

import unittest

from helpers import NODE, js_eval


def row(day, seg, cr, regime="actual"):
    return {"trade_date": day, "segment": seg, "revenue_cr": cr, "regime": regime}


# Commodities start before F&O / cash (Angel One), MTF stops two days early,
# and the last F&O day is projected
DAILY = (
    [row("2024-09-30", "comm", 1.0)]
    + [row(d, s, v) for d in ("2024-10-01", "2024-10-03", "2024-10-04")
       for s, v in (("fo", 10.0), ("cash", 2.0), ("comm", 1.0), ("mtf_gross", 3.0))]
    + [row(d, s, v) for d in ("2024-10-07", "2024-10-08")
       for s, v in (("fo", 11.0), ("cash", 2.0), ("comm", 1.0))]
)
DAILY[-3]["regime"] = "projected"   # F&O on 2024-10-08


def series(daily, basis):
    return js_eval(["brkAdrSeries"], f"brkAdrSeries(DATA, '{basis}')", daily)


@unittest.skipUnless(NODE, "node not installed")
class AdrSeries(unittest.TestCase):
    def test_consolidated_needs_every_segment(self):
        s = series(DAILY, "cons")
        # Starts with F&O / cash / MTF, not with the earlier commodities; stops with MTF
        self.assertEqual([r["date"] for r in s["rows"]], ["2024-10-01", "2024-10-03", "2024-10-04"])
        self.assertEqual(s["rows"][0]["revenue_cr"], 16.0)
        self.assertEqual(s["segs"], ["fo", "cash", "comm", "mtf_gross"])

    def test_broking_runs_past_mtf_and_flags_projected_days(self):
        rows = series(DAILY, "broking")["rows"]
        self.assertEqual([r["date"] for r in rows][-2:], ["2024-10-07", "2024-10-08"])
        self.assertEqual(rows[-1]["revenue_cr"], 14.0)
        self.assertEqual([r["modelled"] for r in rows][-2:], [False, True])

    def test_commodities_count_as_zero_before_they_start(self):
        late_comm = [r for r in DAILY if not (r["segment"] == "comm" and r["trade_date"] < "2024-10-04")]
        rows = series(late_comm, "broking")["rows"]
        self.assertEqual(rows[0], {"date": "2024-10-01", "revenue_cr": 12.0, "modelled": False})
        # From its first day on, a day without commodities is incomplete and left out
        no_comm_day = [r for r in late_comm if not (r["segment"] == "comm" and r["trade_date"] == "2024-10-07")]
        self.assertNotIn("2024-10-07", [r["date"] for r in series(no_comm_day, "broking")["rows"]])

    def test_mtf_uses_net_interest_income_when_published(self):
        nii = [dict(r, segment="mtf_nii") if r["segment"] == "mtf_gross" else r for r in DAILY]
        s = series(nii, "mtf")
        self.assertEqual(s["segs"], ["mtf_nii"])
        self.assertEqual([r["revenue_cr"] for r in s["rows"]], [3.0, 3.0, 3.0])


def period(first_pair, months):
    """brkPriceModel with a stand-in regression whose paired series starts on `first_pair`
    (prices end 2026-10-20, so a 24-month window starts 2024-10-20)."""
    days = [f"{y}-{m:02d}-{d:02d}" for y in (2024, 2025, 2026) for m in range(1, 13) for d in (5, 20)]
    days = [d for d in days if d <= "2026-10-20"] + ["2026-10-20"]
    data = {"adr": {"rows": [{"date": d, "revenue_cr": 1.0} for d in days[:-1]]},
            "prices": [{"date": d, "price": 10.0} for d in days], "first": first_pair}
    stub = ("globalThis.computeShareModel = (d) => ({ series: d.series.filter(p => p.date >= DATA.first)"
            ".map(p => ({ date: p.date })) })")
    return js_eval(["BRK_PRICE_SLACK_DAYS", "BRK_PRICE_MIN_COVER", "brkMonthsBack", "brkPriceModel"],
                   f"({stub}, brkPriceModel(DATA.adr, DATA.prices, 45, {months}))", data)


@unittest.skipUnless(NODE, "node not installed")
class PeriodCoverage(unittest.TestCase):
    def test_a_period_the_paired_data_cover_is_ok(self):
        r = period("2024-10-20", 24)
        self.assertEqual(r["status"], "ok")
        self.assertNotIn("partial", r)
        self.assertEqual(r["start"], "2024-10-20")

    def test_most_of_a_period_shows_from_the_first_paired_day(self):
        # ADR from Oct 2024 with a 45-day DMA: pairs from early December, about 22.5 of 24 months
        r = period("2024-12-05", 24)
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["start"], "2024-12-05")
        self.assertEqual(r["partial"]["from"], "2024-12-05")
        self.assertGreater(r["partial"]["cover"], 0.85)

    def test_too_little_of_a_period_stays_insufficient(self):
        r = period("2024-12-05", 36)          # 3 Y: about 22.5 of 36 months
        self.assertEqual(r["status"], "short")
        self.assertEqual(r["from"], "2024-12-05")


if __name__ == "__main__":
    unittest.main()
