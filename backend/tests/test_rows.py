from datetime import date
from decimal import Decimal

from app.ingest.rows import grid_to_txns

HEADER = ["TRAN_DATE", "CHQNO", "PARTICULARS", "DR", "CR", "BAL", "SOL"]


def make_grid():
    return [
        ["Some Bank Ltd", None, None, None, None, None, None],
        HEADER,
        ["01-02-2025", None, "UPI/CR/436512345678/RAVI/YBL/ravi@ybl/pay", None, "50,000.00", "55,000.00", "1234"],
        ["02-02-2025", None, "ATM WDL 02:14 MG ROAD", "40,000.00", None, "15,000.00", "1234"],
        [None, None, "continuation of narration", None, None, None, None],
        ["TOTAL", None, None, "40,000.00", "50,000.00", None, None],
    ]


def test_header_detection_and_rows():
    txns, info = grid_to_txns(make_grid())
    assert info["header_row"] == 1
    assert len(txns) == 2

    credit, debit = txns
    assert credit.direction == "CREDIT"
    assert credit.amount == Decimal("50000.00")
    assert credit.txn_date == date(2025, 2, 1)
    assert credit.channel == "UPI"
    assert credit.reference_id == "436512345678"
    assert credit.counterparty_id == "ravi@ybl"
    assert credit.balance == Decimal("55000.00")

    assert debit.direction == "DEBIT"
    assert debit.channel == "ATM"
    assert debit.txn_time == "02:14:00"
    assert "continuation of narration" in debit.narration  # dateless line merged


def test_single_amount_column_with_flag():
    grid = [
        ["Tran_Date", "Narration", "Amount", "CR/DR", "Balance"],
        ["01-02-2025", "NEFT-UTIBN12345678901-X", "10,000.00", "DR", "5,000.00"],
    ]
    txns, _ = grid_to_txns(grid)
    assert len(txns) == 1
    assert txns[0].direction == "DEBIT"
    assert txns[0].amount == Decimal("10000.00")


def test_no_header_grid():
    txns, info = grid_to_txns([["random", "junk"], ["more", "junk"]])
    assert txns == []
    assert info["header_row"] is None


def test_dash_separated_headers():
    """Real Finacle export: TRAN-DATE | WITHDRAWAL | DEPOSIT headers."""
    grid = [
        ["TRAN-DATE", "TRAN_PARTICULAR", "CHQ-NUM", "WITHDRAWAL", "DEPOSIT", "BALANCE"],
        ["16-09-2024", "SGST FOR DT:13-09-2024", "", "17.91", "", "2765.18"],
    ]
    txns, info = grid_to_txns(grid)
    assert len(txns) == 1
    assert txns[0].direction == "DEBIT"
    assert txns[0].amount == Decimal("17.91")


def test_multiline_cell_explosion():
    """HDFC-style PDFs pack many txns per cell, newline-separated."""
    from app.ingest.pdf_digital import explode_multiline_rows

    grid = [
        ["Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
        ["27/09/23\n28/09/23", "UPI-ONE\nUPI-TWO", "19.00\n0.00", "0.00\n500.00", "217.22\n717.22"],
    ]
    exploded = explode_multiline_rows(grid)
    assert len(exploded) == 3  # header + 2 txn rows
    txns, _ = grid_to_txns(exploded)
    assert len(txns) == 2
    assert txns[0].direction == "DEBIT"
    assert txns[1].direction == "CREDIT"
    assert txns[1].amount == Decimal("500.00")
