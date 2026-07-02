from dataclasses import dataclass, field
from datetime import date, time
from decimal import Decimal

from app.detection.correlation import common_identifiers
from app.detection.disposition import disposition
from app.detection.fifo_trail import fifo_trail
from app.detection.flowgraph import build_edges, graph_summary
from app.detection.roundtrip import find_round_trips
from app.detection.rules import run_rules


@dataclass
class T:
    id: str
    account_ref: str = "ACC1"
    row_index: int = 0
    txn_date: date = date(2026, 5, 4)
    txn_time: time | None = None
    amount_inr: Decimal = Decimal("100.00")
    direction: str = "DEBIT"
    balance_after: Decimal | None = None
    channel: str = "UPI"
    narration_raw: str = ""
    reference_id: str | None = None
    counterparty_id: str | None = None
    counterparty_name: str | None = None
    flags: list = field(default_factory=list)
    excluded: bool = False


def transfer(i, src, dst, amount, d, ref=None, t=None):
    """Both legs of one transfer, reference-matched when ref given."""
    return [
        T(f"d{i}", account_ref=src, row_index=i, txn_date=d, txn_time=t,
          amount_inr=Decimal(amount), direction="DEBIT", reference_id=ref),
        T(f"c{i}", account_ref=dst, row_index=i, txn_date=d, txn_time=t,
          amount_inr=Decimal(amount), direction="CREDIT", reference_id=ref),
    ]


class TestFlowGraph:
    def test_confirmed_edge_from_reference(self):
        txns = transfer(1, "A", "B", "50000", date(2026, 5, 4), ref="436512345678")
        edges = build_edges(txns)
        assert len(edges) == 1
        assert edges[0].tier == "confirmed"
        assert (edges[0].source, edges[0].target) == ("A", "B")

    def test_probable_edge_same_day_amount(self):
        txns = transfer(1, "A", "B", "50000", date(2026, 5, 4))  # no reference
        edges = build_edges(txns)
        assert len(edges) == 1 and edges[0].tier == "probable"

    def test_external_counterparty_edge(self):
        t = T("d1", account_ref="A", direction="DEBIT", amount_inr=Decimal("9000"),
              counterparty_id="shop@okaxis")
        edges = build_edges([t])
        assert edges[0].target == "ext:shop@okaxis" and edges[0].tier == "external"

    def test_accumulator_badge(self):
        txns = []
        for i, src in enumerate(("A", "B", "C")):
            txns += transfer(i, src, "SINK", "60000", date(2026, 5, 4 + i), ref=f"43651234567{i}")
        edges = build_edges(txns)
        nodes = graph_summary(txns, edges)
        assert nodes["SINK"]["accumulator"] is True


class TestRoundTrip:
    def test_time_ordered_loop_found(self):
        txns = (
            transfer(1, "A", "B", "60000", date(2026, 5, 5), ref="100000000001")
            + transfer(2, "B", "C", "58000", date(2026, 5, 6), ref="100000000002")
            + transfer(3, "C", "A", "56000", date(2026, 5, 7), ref="100000000003")
        )
        loops = find_round_trips(build_edges(txns))
        assert len(loops) == 1
        assert loops[0].path[0] == loops[0].path[-1]
        assert set(loops[0].path) == {"A", "B", "C"}
        assert loops[0].pct_returned > 90

    def test_time_violation_rejected(self):
        # times strictly DECREASE around the cycle — no rotation of this
        # loop is time-ordered, so money cannot have travelled it
        txns = (
            transfer(1, "A", "B", "60000", date(2026, 5, 6), ref="100000000001")
            + transfer(2, "B", "C", "58000", date(2026, 5, 4), ref="100000000002")
            + transfer(3, "C", "A", "56000", date(2026, 5, 2), ref="100000000003")
        )
        assert find_round_trips(build_edges(txns)) == []

    def test_rotated_start_still_detected(self):
        # loop looks unordered from A but is valid starting at C — the
        # detector must find the rotation (times: C→A May2, A→B May6, B→C May7)
        txns = (
            transfer(1, "A", "B", "60000", date(2026, 5, 6), ref="100000000001")
            + transfer(2, "B", "C", "58000", date(2026, 5, 7), ref="100000000002")
            + transfer(3, "C", "A", "56000", date(2026, 5, 2), ref="100000000003")
        )
        loops = find_round_trips(build_edges(txns))
        assert len(loops) == 1 and loops[0].path[0] == "C"


class TestFifoTrail:
    def test_attribution_and_split(self):
        rows = [
            T("c1", direction="CREDIT", amount_inr=Decimal("1000"), row_index=1),
            T("c2", direction="CREDIT", amount_inr=Decimal("500"), row_index=2),
            T("d1", direction="DEBIT", amount_inr=Decimal("1200"), row_index=3,
              narration_raw="ATM WDL", channel="ATM"),
            T("d2", direction="DEBIT", amount_inr=Decimal("300"), row_index=4,
              narration_raw="UPI out", counterparty_id="x@ybl"),
        ]
        trail = fifo_trail(rows, "c2")
        # d1 takes all of c1 (1000) + 200 of c2; d2 takes remaining 300 of c2
        assert [str(h.attributed) for h in trail.hops] == ["200", "300"]
        assert trail.resting == Decimal("0")

    def test_resting_amount(self):
        rows = [
            T("c1", direction="CREDIT", amount_inr=Decimal("1000"), row_index=1),
            T("d1", direction="DEBIT", amount_inr=Decimal("400"), row_index=2),
        ]
        trail = fifo_trail(rows, "c1")
        assert trail.spent == Decimal("400")
        assert trail.resting == Decimal("600")


class TestRules:
    def test_smurfing_and_rapid_inout(self):
        d = date(2026, 5, 4)
        rows = [T(f"c{i}", direction="CREDIT", amount_inr=Decimal("45000"),
                  row_index=i, txn_date=d) for i in range(4)]
        rows.append(T("d1", direction="DEBIT", amount_inr=Decimal("170000"),
                      row_index=9, txn_date=d))
        flags = run_rules(rows)
        assert any(f["rule"] == "FD-04-SMURFING" for f in flags["c0"])
        assert any(f["rule"] == "FD-02-RAPID-IN-OUT" for f in flags["c0"])

    def test_odd_hour_and_round_figure(self):
        rows = [T("a1", direction="DEBIT", amount_inr=Decimal("40000"),
                  txn_time=time(2, 14), channel="ATM")]
        flags = run_rules(rows)
        rules = {f["rule"] for f in flags["a1"]}
        assert {"FD-01-ROUND-FIGURE", "FD-03-ODD-HOUR"} <= rules

    def test_counterparty_dominance(self):
        rows = [T(f"d{i}", direction="DEBIT", amount_inr=Decimal("30000"),
                  row_index=i, counterparty_id="sink@ybl") for i in range(3)]
        rows.append(T("d9", direction="DEBIT", amount_inr=Decimal("5000"),
                      row_index=9, counterparty_id="other@ybl"))
        flags = run_rules(rows)
        assert any(f["rule"] == "FD-08-COUNTERPARTY-DOMINANCE" for f in flags["d0"])


class TestCorrelationDisposition:
    def test_common_identifier_across_accounts(self):
        rows = [
            T("a", account_ref="A", counterparty_id="mule@ybl", direction="DEBIT"),
            T("b", account_ref="B", counterparty_id="mule@ybl", direction="DEBIT"),
        ]
        common = common_identifiers(rows)
        assert common and common[0]["identifier"] == "mule@ybl"

    def test_disposition_percentages(self):
        rows = [
            T("a", direction="DEBIT", amount_inr=Decimal("400"), channel="ATM"),
            T("b", direction="DEBIT", amount_inr=Decimal("400"), channel="UPI"),
            T("c", direction="DEBIT", amount_inr=Decimal("200"), channel="CHEQUE"),
            T("z", direction="CREDIT", amount_inr=Decimal("9999"), channel="UPI"),
        ]
        d = disposition(rows)
        assert d["buckets"]["cash"]["pct"] == 40.0
        assert d["buckets"]["redirected"]["pct"] == 40.0
        assert d["buckets"]["cheque"]["pct"] == 20.0
