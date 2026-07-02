"""Legal clause mapping — each detection rule tagged with the provisions an
IO typically cites in the charge sheet. Informational aid, not legal advice;
final classification always rests with the IO and legal counsel."""

LEGAL_MAP: dict[str, list[str]] = {
    "FD-02-RAPID-IN-OUT": [
        "BNS S.317(2) (dishonestly receiving stolen property)",
        "IT Act S.66D (cheating by personation using computer resource)",
    ],
    "FD-04-SMURFING": [
        "PMLA S.3 (money laundering — layering/structuring)",
        "BNS S.318 (cheating)",
    ],
    "ROUND-TRIP": [
        "PMLA S.3 (money laundering — placement/round-tripping)",
        "BNS S.316 (criminal breach of trust)",
    ],
    "FD-08-COUNTERPARTY-DOMINANCE": ["PMLA S.3 (channelling to controlled account)"],
    "FD-07-BALANCE-BREAK": ["BSA S.61-63 (electronic evidence integrity — verify source)"],
    "FD-03-ODD-HOUR": ["IT Act S.66C/66D (unauthorised access indicators)"],
    "FD-01-ROUND-FIGURE": ["PMLA S.3 (structuring indicator)"],
}


def clauses_for(rules: set[str]) -> list[str]:
    out: list[str] = []
    for rule in sorted(rules):
        out.extend(LEGAL_MAP.get(rule, []))
    return sorted(set(out))
