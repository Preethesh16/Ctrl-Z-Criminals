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


def test_repair_directions_from_balance():
    """Regex fallback guesses directions; balance deltas correct them."""
    from app.ingest.rows import RawTxn, repair_directions

    def t(i, amount, direction, balance, problems=None):
        return RawTxn(
            row_index=i, txn_date=date(2025, 2, i + 1), narration="x",
            amount=Decimal(amount), direction=direction,
            balance=Decimal(balance), channel="UNKNOWN", reference_id=None,
            counterparty_id=None, counterparty_name=None,
            confidence=0.85, problems=problems or [],
        )

    txns = [
        t(0, "1000", "CREDIT", "1000"),                        # seed balance
        t(1, "500", "DEBIT", "1500", ["direction_assumed"]),   # actually CREDIT
        t(2, "200", "DEBIT", "1300"),                          # correct
        t(3, "300", "DEBIT", "1600", ["direction_assumed"]),   # actually CREDIT
    ]
    fixed = repair_directions(txns)
    assert fixed == 2
    assert txns[1].direction == "CREDIT"
    assert txns[2].direction == "DEBIT"
    assert txns[3].direction == "CREDIT"
    assert "direction_assumed" not in txns[1].problems


def test_packed_unexplodable_tables_detected():
    """717-page HDFC exports: pdfplumber collapses a page into one row where
    the date cell packs N dates but narration packs MORE lines (wrapped
    fragments) — unalignable, must trigger whole-doc text fallback."""
    from app.ingest.pdf_digital import _tables_packed_unexplodable

    packed = [[  # one table, one row: 3 dates vs 5 narration lines
        "03/05/14\n04/05/14\n05/05/14",
        "POS FOO\nPOSDEBIT\nATW BAR\nMOHALI\nATW BAZ",
        "0.00\n1.00\n2.00",
    ]]
    assert _tables_packed_unexplodable([packed])

    aligned = [[  # cleanly explodable (all cells agree on 3 lines) — NOT packed
        "27/09/23\n28/09/23\n29/09/23",
        "UPI-ONE\nUPI-TWO\nUPI-THREE",
        "19.00\n0.00\n5.00",
    ]]
    assert not _tables_packed_unexplodable([aligned])


def test_overdraft_dr_balance_stored_negative():
    """A 'Dr' suffix on the BALANCE column (not the txn amount) means the
    account is overdrawn — must be stored as a negative decimal, not
    silently discarded. Uniform-sign errors are invisible until the
    account crosses zero, which is exactly what broke on real data."""
    grid = [
        ["Tran_Date", "Narration", "Debit", "Credit", "Balance"],
        ["11-03-2025", "UPI out", "27.25", "", "27.25 CR"],
        ["11-03-2025", "SELF withdrawal", "135000.00", "", "134972.75 DR"],
    ]
    txns, _ = grid_to_txns(grid)
    assert txns[0].balance == Decimal("27.25")
    assert txns[1].balance == Decimal("-134972.75")


def test_uco_bank_balance_delta_extraction():
    """UCO Bank: overlapping letterhead corrupts the debit/credit columns,
    amount wraps onto its own bare line, but balance is reliable on every
    date line. Amount must be derived from the balance delta, and a page
    break must NOT reset the running balance (that used to silently drop
    the first transaction after every page)."""
    from app.ingest.pdf_digital import is_uco_style, read_uco_style_lines

    fingerprint_text = "DATE PARTICULARS CHQ.NO. WITHDRAW DEPOSITS BALANCE\nALS\n"
    assert is_uco_style(fingerprint_text)
    assert not is_uco_style("DATE PARTICULARS DEBIT CREDIT BALANCE")

    page1 = (
        "Opening Balance as of 19-05-2025 0.00 CR\n"
        "19-05-2025 BY CASH 5500.00 CR\n"
        "5500.00\n"
        "19-05-2025 APY:052025 5410.00 CR\n"
        "90.00\n"
    )
    page2 = (  # simulates a page break — must continue the SAME balance chain
        "19-05-2025 CGST For CHG 5320.00 CR\n"
        "90.00\n"
    )
    grid = read_uco_style_lines(page1 + page2)
    assert len(grid) == 3
    assert grid[0][3] == "5500.00" and grid[0][2] is None  # credit (deposit)
    assert grid[1][2] == "90.00" and grid[1][3] is None  # debit (withdrawal)
    assert grid[2][2] == "90.00"  # page-break row still derived correctly
    assert [row[4] for row in grid] == ["5500.00", "5410.00", "5320.00"]


def test_fake_table_fragment_detection_narrow():
    """A lone-cell 'table' is only treated as a broken-page artifact when
    the cell looks like a wrapped bank-narration fragment (UPI/IMPS/'/'
    markers). Legitimate single-value cells — a customer email, a plain
    account number, a footer balance, a split name — must NOT trigger
    the whole-page fallback (regression: this over-broad check silently
    dropped rows on unrelated real files)."""
    from app.ingest.pdf_digital import _FRAGMENT_MARKERS, _HAS_AMOUNT

    def is_fragment(cell):
        s = str(cell).strip()
        return bool(s) and bool(_FRAGMENT_MARKERS.search(s)) and not _HAS_AMOUNT.search(s)

    # real wrapped narration fragments — must be flagged
    assert is_fragment("SentIMPS407719023087PRA")
    assert is_fragment("GHOSH/412279502997/UP")
    assert is_fragment("YASH/BARBX0825/KKBKTrans")

    # legitimate customer-info / footer cells — must NOT be flagged
    assert not is_fragment("neha@sbi.co.in")
    assert not is_fragment("7368575721")
    assert not is_fragment("0042344919442 OF Mr. SUMIT")
    assert not is_fragment("YADAV")
    assert not is_fragment("5,416.38")  # bare footer balance


def test_credit_column_shift_recovery():
    """Some real statements insert a phantom extra cell before credit
    values (pdfplumber splitting a wrapped/spaced amount) — debit rows
    stay aligned, only credit rows drift one column right. Signature:
    mapped debit+credit both empty, but a valid amount+balance sit one
    column further right than mapped."""
    grid = [
        ["Date", "Effective Date", "Cheque Number", "Description", "Withdrawal Amt.", "Deposit Amt.", "Balance"],
        # normal debit row: aligned exactly to the header
        ["04/01/2025", "04/01/2025", "", "WTHDRL,UPI/DR/123", "2,000.00", "", "0.00"],
        # shifted credit row: extra phantom cell before the real amount
        ["24/01/2025", "24/01/2025", "", "DEPOSIT,UPI/CR/456", None, "", "180.00", "186.00"],
    ]
    txns, info = grid_to_txns(grid)
    assert info["skipped"] == 0
    assert len(txns) == 2
    debit, credit = txns
    assert debit.direction == "DEBIT" and debit.amount == Decimal("2000.00")
    assert credit.direction == "CREDIT" and credit.amount == Decimal("180.00")
    assert credit.balance == Decimal("186.00")


def test_orphan_amount_recovery_requires_withdrawal_context():
    """A long branch-address narration can push the amount out of its
    mapped column into an unmapped trailing cell (fixed-width TXT).
    Recovery must ONLY fire when the row's own text unambiguously signals
    a withdrawal (ATM/WDR/CASH) — a broader 'default direction to debit'
    version was tried and reverted: it silently corrupted an unrelated
    file's already-ambiguous rows. A row with an orphan amount but no
    withdrawal context must still be skipped, not guessed."""
    grid = [
        ["Date", "Value Date", "Debit", "Credit"],
        # ATM withdrawal: address text shifted the amount to an unmapped cell
        ["23-05-2025", "23-05-2025", "ATM WDR 12345", "BRANCH ADDR", "200.00", "315.00Cr"],
        # unrelated ambiguous row: orphan amount present but NO withdrawal
        # context anywhere — must be skipped, never guessed
        ["24-05-2025", "24-05-2025", "SOME NOTE", "OTHER TEXT", "99.00", "50.00Cr"],
    ]
    txns, info = grid_to_txns(grid)
    assert len(txns) == 1
    assert txns[0].direction == "DEBIT"
    assert txns[0].amount == Decimal("200.00")
    assert info["skipped"] == 1
