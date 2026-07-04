"""Round-trip (temporal cycle) detection — plan.md §4.3, Research §3.

Static cycle detection produces false positives: money must travel around
the loop IN TIME ORDER. We run a bounded DFS over the transfer edges with
non-decreasing timestamps (statement granularity is often date-only, so
strict inequality would miss same-day loops), hop bound 6, seeded from
accounts that both receive and send (2SCENT-style source filtering).

Cycles that exist statically but fail the time ordering are reported
separately as "linked clusters" — related accounts, not confirmed loops.
"""

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal

from .flowgraph import Edge

MAX_HOPS = 6

# Same-money chain: a cycle is only round-tripping if each hop carries a
# comparable amount to the previous hop (mules take cuts — money can shrink,
# not multiply) and the closing hop genuinely returns a meaningful share of
# what left. Without this, time-ordered chains of unrelated transfers
# (₹5 → ₹10,000 → ₹500 → …) get reported as loops.
HOP_RATIO_MIN = 0.2
HOP_RATIO_MAX = 1.2
RETURN_MIN = 0.1
RETURN_MAX = 1.5


@dataclass
class Loop:
    path: list[str]  # node ids, first == last
    edges: list[Edge]
    amount_out: Decimal  # first hop
    amount_back: Decimal  # closing hop
    hops: int
    elapsed_hours: float
    pct_returned: float
    score: float


def _seed_nodes(edges: list[Edge]) -> set[str]:
    outs = defaultdict(int)
    ins = defaultdict(int)
    for e in edges:
        outs[e.source] += 1
        ins[e.target] += 1
    return {n for n in outs if ins.get(n, 0) > 0}


def find_round_trips(edges: list[Edge], max_hops: int = MAX_HOPS) -> list[Loop]:
    adjacency: dict[str, list[Edge]] = defaultdict(list)
    for e in edges:
        adjacency[e.source].append(e)
    for lst in adjacency.values():
        lst.sort(key=lambda e: e.when)

    loops: list[Loop] = []
    seen_signatures: set[tuple] = set()

    def dfs(origin: str, node: str, path_edges: list[Edge], visited: set[str]):
        if len(path_edges) >= max_hops:
            return
        last = path_edges[-1]
        for e in adjacency.get(node, []):
            if e.when < last.when:  # time must not run backwards
                continue
            # same-money chain: this hop must carry a comparable amount
            if last.amount <= 0 or e.amount <= 0:
                continue
            ratio = float(e.amount / last.amount)
            if ratio < HOP_RATIO_MIN or ratio > HOP_RATIO_MAX:
                continue
            if e.target == origin and len(path_edges) >= 2:
                first = path_edges[0]
                returned = float(e.amount / first.amount) if first.amount else 0.0
                if returned < RETURN_MIN or returned > RETURN_MAX:
                    continue
                cycle = [*path_edges, e]
                sig = tuple(sorted(id(x) for x in cycle))
                if sig in seen_signatures:
                    continue
                seen_signatures.add(sig)
                loops.append(_score([*path_edges, e]))
                continue
            if e.target in visited or e.target == origin:
                continue
            dfs(origin, e.target, [*path_edges, e], visited | {e.target})

    for origin in _seed_nodes(edges):
        for first in adjacency.get(origin, []):
            if first.target == origin:
                continue
            dfs(origin, first.target, [first], {origin, first.target})

    # canonical dedup: same node set + same closing time = same loop
    unique: dict[tuple, Loop] = {}
    for lp in loops:
        key = (frozenset(lp.path), lp.edges[-1].when)
        if key not in unique or lp.score > unique[key].score:
            unique[key] = lp
    return sorted(unique.values(), key=lambda x: -x.score)


def _score(cycle: list[Edge]) -> Loop:
    first, last = cycle[0], cycle[-1]
    elapsed = (last.when - first.when).total_seconds() / 3600
    pct = float(last.amount / first.amount * 100) if first.amount else 0.0
    # bigger, tighter, more complete loops score higher
    amount_factor = min(float(first.amount) / 100000, 5.0)
    speed_factor = 3.0 if elapsed <= 48 else (1.5 if elapsed <= 24 * 7 else 0.5)
    return_factor = pct / 100 if pct <= 100 else 1.0
    confirm_factor = sum(1 for e in cycle if e.tier == "confirmed") / len(cycle)
    return Loop(
        path=[cycle[0].source, *[e.target for e in cycle]],
        edges=cycle,
        amount_out=first.amount,
        amount_back=last.amount,
        hops=len(cycle),
        elapsed_hours=round(elapsed, 1),
        pct_returned=round(pct, 1),
        score=round(amount_factor * speed_factor * (0.5 + return_factor) * (0.5 + confirm_factor), 2),
    )
