from datetime import date
from decimal import Decimal

from app.normalize.amounts import parse_amount
from app.normalize.channel import classify_channel
from app.normalize.dates import parse_date, parse_time
from app.normalize.reference import extract_counterparty, extract_reference


class TestDates:
    def test_indian_formats(self):
        assert parse_date("01-02-2025") == date(2025, 2, 1)
        assert parse_date("01/02/25") == date(2025, 2, 1)
        assert parse_date("2025-02-01") == date(2025, 2, 1)
        assert parse_date("01-Feb-2025") == date(2025, 2, 1)
        assert parse_date("01 FEB 25") == date(2025, 2, 1)
        assert parse_date("20250201") == date(2025, 2, 1)
        assert parse_date("Feb 01, 2025") == date(2025, 2, 1)

    def test_datetime_cell_with_time(self):
        assert parse_date("01-02-2025 14:32:11") == date(2025, 2, 1)

    def test_impossible_month_swaps(self):
        assert parse_date("03/25/2024") == date(2024, 3, 25)  # 25 can't be a month

    def test_garbage(self):
        assert parse_date("TOTAL") is None
        assert parse_date("") is None
        assert parse_date(None) is None
        assert parse_date("nan") is None

    def test_time_extraction(self):
        assert parse_time("ATM WDL 02:14") == "02:14:00"
        assert parse_time("no time here") is None


class TestAmounts:
    def test_indian_grouping(self):
        assert parse_amount("1,00,000.50") == (Decimal("100000.50"), None)
        assert parse_amount("₹ 5,000") == (Decimal("5000.00"), None)
        assert parse_amount("Rs. 250.75") == (Decimal("250.75"), None)

    def test_drcr_suffix(self):
        assert parse_amount("5,000.00 Dr") == (Decimal("5000.00"), "DEBIT")
        assert parse_amount("5,000.00 CR") == (Decimal("5000.00"), "CREDIT")

    def test_negatives(self):
        assert parse_amount("(1,500.00)") == (Decimal("1500.00"), "DEBIT")
        assert parse_amount("-1500") == (Decimal("1500.00"), "DEBIT")
        assert parse_amount(-1500.0) == (Decimal("1500.00"), "DEBIT")

    def test_garbage(self):
        assert parse_amount("TOTAL") == (None, None)
        assert parse_amount("-") == (None, None)
        assert parse_amount(float("nan")) == (None, None)


class TestChannel:
    def test_channels(self):
        assert classify_channel("UPI/DR/436512345678/JOHN/OKAX/john@okaxis") == "UPI"
        assert classify_channel("NEFT-HDFCN52022063012345678-ACME CORP") == "NEFT"
        assert classify_channel("IMPS/P2A/436512345678/9876543210") == "IMPS"
        assert classify_channel("RTGS UTIBR52026070212345678") == "RTGS"
        assert classify_channel("ATM WDL 02:14 MG ROAD BLR") == "ATM"
        assert classify_channel("CHQ DEP 123456 CLEARING") == "CHEQUE"
        assert classify_channel("CASH DEPOSIT BY SELF") == "CASH"
        assert classify_channel("POS 411111XXXXXX1111 AMAZON") == "POS"
        assert classify_channel("SB INT PD UPTO 30-06") == "INTERNAL"
        assert classify_channel("something opaque") == "UNKNOWN"


class TestReference:
    def test_upi_rrn(self):
        assert extract_reference("UPI/DR/436512345678/JOHN/OKAX/john@okaxis", "UPI") == "436512345678"

    def test_neft_utr(self):
        assert extract_reference("NEFT-HDFCN52022063012345-ACME", "NEFT") == "HDFCN52022063012345"

    def test_cheque(self):
        assert extract_reference("CHQ NO 123456 CLEARING", "CHEQUE") == "123456"

    def test_counterparty(self):
        cp_id, cp_name = extract_counterparty("UPI/DR/436512345678/RAMESH KUMAR/OKAX/ramesh.k@okaxis/pay")
        assert cp_id == "ramesh.k@okaxis"
        assert cp_name == "Ramesh Kumar"


def test_glued_drcr_suffix():
    """No \\b exists between digit and letter — '0.06Cr' must still parse."""
    assert parse_amount("11,000.00Cr") == (Decimal("11000.00"), "CREDIT")
    assert parse_amount("1,50,391.44Dr") == (Decimal("150391.44"), "DEBIT")
    assert parse_amount("0.0000CR") == (Decimal("0.00"), "CREDIT")


def test_stray_letter_prefix_bleed():
    """Table-extraction artifact: a wrapped narration fragment ('N' from
    'NEFT...') bleeds into the adjacent amount cell. Real amount digits
    must still parse; genuine non-numeric text must still be rejected."""
    assert parse_amount("N 1.00") == (Decimal("1.00"), None)
    assert parse_amount("N 9173.00") == (Decimal("9173.00"), None)
    assert parse_amount("TOTAL") == (None, None)  # not a bare-letter-prefix case
