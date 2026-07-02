"""Optional LLM assist (Claude API) — feature-flagged, OFF by default.

Two narrowly-scoped uses (plan.md product decisions):
1. column-mapping suggestion for unrecognized statement layouts
2. plain-language investigation narrative for the report

Privacy contract: prompts are built exclusively from masked samples
(`masking.py`) or aggregate analysis numbers — never raw transactions,
account numbers, or names. Every call is audit-logged. LLM_ENABLED must
remain false when working with the confidential police dataset.
"""

import json

from ..config import get_settings

CANONICAL_FIELDS = ["txn_date", "narration", "reference_id", "debit", "credit",
                    "amount_signed", "balance", "ignore"]


class LlmDisabled(Exception):
    pass


def _client():
    settings = get_settings()
    if not settings.llm_enabled or not settings.anthropic_api_key:
        raise LlmDisabled("LLM assist is disabled (set LLM_ENABLED=true and ANTHROPIC_API_KEY)")
    import anthropic

    return anthropic.Anthropic(api_key=settings.anthropic_api_key), settings.anthropic_model


def suggest_column_mapping(masked_grid: list[list[str]]) -> dict[int, str]:
    """Masked header+samples → {column_index: canonical_field} suggestion.

    Output feeds the mapping UI as a PRE-FILL; the officer confirms every
    assignment before anything is parsed with it.
    """
    client, model = _client()
    prompt = (
        "You map bank statement columns to canonical fields. "
        f"Fields: {', '.join(CANONICAL_FIELDS)}.\n"
        "First row is the header; remaining rows are masked samples.\n"
        f"Table:\n{json.dumps(masked_grid, ensure_ascii=False)}\n\n"
        'Reply ONLY with JSON: {"<column_index>": "<field>"} for every column.'
    )
    msg = client.messages.create(model=model, max_tokens=500,
                                 messages=[{"role": "user", "content": prompt}])
    text = msg.content[0].text.strip()
    text = text[text.find("{"): text.rfind("}") + 1]
    raw = json.loads(text)
    return {int(k): v for k, v in raw.items() if v in CANONICAL_FIELDS}


def report_narrative(summary: dict, round_trips: list, disposition: dict) -> str:
    """Aggregate analysis numbers → plain-language narrative paragraph(s).

    Only aggregates cross the wire: counts, percentages, loop shapes with
    node ids already reduced to last-4 digits.
    """
    client, model = _client()
    safe_loops = [{"hops": lp["hops"], "pct_returned": lp["pct_returned"],
                   "elapsed_hours": lp["elapsed_hours"],
                   "path": [p[-4:] for p in lp["path"]]} for lp in round_trips[:5]]
    prompt = (
        "Write a factual, court-appropriate 2-paragraph summary of a bank "
        "statement analysis for a police investigation report. No speculation; "
        "describe only what the numbers show. Data:\n"
        f"summary={json.dumps(summary)}\n"
        f"round_trips={json.dumps(safe_loops)}\n"
        f"disposition={json.dumps(disposition)}"
    )
    msg = client.messages.create(model=model, max_tokens=700,
                                 messages=[{"role": "user", "content": prompt}])
    return msg.content[0].text.strip()
