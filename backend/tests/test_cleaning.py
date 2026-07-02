from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from app.cleaning import check_balance_consistency, find_duplicates, pair_reversals


@dataclass
class T:
    id: str
    account_ref: str = "ACC1"
    document_id: str = "doc1"
    row_index: int = 0
    txn_date: date = date(2025, 2, 1)
    amount_inr: Decimal = Decimal("100.00")
    direction: str = "DEBIT"
    balance_after: Decimal | None = None
    narration_raw: str = ""
    reference_id: str | None = None
    flags: list = field(default_factory=list)


class TestBalance:
    def test_consistent_chain(self):
        rows = [
            T("a", row_index=1, direction="CREDIT", amount_inr=Decimal("500"), balance_after=Decimal("1500")),
            T("b", row_index=2, direction="DEBIT", amount_inr=Decimal("200"), balance_after=Decimal("1300")),
        ]
        breaks, order = check_balance_consistency(rows)
        assert breaks == [] and order == "oldest_first"

    def test_break_detected(self):
        rows = [
            T("a", row_index=1, direction="CREDIT", amount_inr=Decimal("500"), balance_after=Decimal("1500")),
            T("b", row_index=2, direction="DEBIT", amount_inr=Decimal("200"), balance_after=Decimal("9999")),
        ]
        breaks, _ = check_balance_consistency(rows)
        assert len(breaks) == 1
        assert breaks[0].expected == Decimal("1300")

    def test_newest_first_statement(self):
        # Same chain, printed in reverse order (common for netbanking exports).
        rows = [
            T("b", row_index=1, direction="DEBIT", amount_inr=Decimal("200"), balance_after=Decimal("1300")),
            T("a", row_index=2, direction="CREDIT", amount_inr=Decimal("500"), balance_after=Decimal("1500")),
        ]
        breaks, order = check_balance_consistency(rows)
        assert breaks == [] and order == "newest_first"

    def test_missing_balances_skipped(self):
        rows = [T("a", row_index=1), T("b", row_index=2)]
        breaks, _ = check_balance_consistency(rows)
        assert breaks == []


class TestDedup:
    def test_cross_document_exact(self):
        a = T("a", document_id="d1", reference_id="436512345678")
        b = T("b", document_id="d2", reference_id="436512345678")
        assert find_duplicates([a, b]) == [("a", "b", "exact")]

    def test_same_document_not_flagged(self):
        a = T("a", reference_id="436512345678")
        b = T("b", reference_id="436512345678")
        assert find_duplicates([a, b]) == []

    def test_fuzzy_narration(self):
        a = T("a", document_id="d1", narration_raw="UPI/DR/436512345678/RAMESH KUMAR/OKAX")
        b = T("b", document_id="d2", narration_raw="UPI/DR/436512345678/RAMESH KUMA/OKAX")  # OCR chop
        assert find_duplicates([a, b]) == [("a", "b", "fuzzy")]

    def test_different_amounts_not_duplicates(self):
        a = T("a", document_id="d1", amount_inr=Decimal("100"))
        b = T("b", document_id="d2", amount_inr=Decimal("200"))
        assert find_duplicates([a, b]) == []


class TestReversals:
    def test_marker_pairing(self):
        d = T("d", direction="DEBIT", txn_date=date(2025, 2, 1), narration_raw="UPI/DR/pay to shop")
        c = T("c", direction="CREDIT", txn_date=date(2025, 2, 2), narration_raw="UPI REV of failed txn")
        assert pair_reversals([d, c]) == [("d", "c", "reversal_marker")]

    def test_same_reference_pairing(self):
        d = T("d", direction="DEBIT", reference_id="436512345678")
        c = T("c", direction="CREDIT", reference_id="436512345678", narration_raw="credit back")
        assert pair_reversals([d, c]) == [("d", "c", "same_reference")]

    def test_outside_window_not_paired(self):
        d = T("d", direction="DEBIT", txn_date=date(2025, 2, 1))
        c = T("c", direction="CREDIT", txn_date=date(2025, 2, 20), narration_raw="REFUND")
        assert pair_reversals([d, c]) == []

    def test_each_leg_pairs_once(self):
        d1 = T("d1", direction="DEBIT", txn_date=date(2025, 2, 1))
        d2 = T("d2", direction="DEBIT", txn_date=date(2025, 2, 1), row_index=2)
        c = T("c", direction="CREDIT", txn_date=date(2025, 2, 2), narration_raw="REFUND")
        pairs = pair_reversals([d1, d2, c])
        assert len(pairs) == 1
