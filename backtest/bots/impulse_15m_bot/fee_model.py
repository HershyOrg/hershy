from __future__ import annotations

def taker_fee_rate(price: float) -> float:
    """Approximate 15m market taker fee rate (max ~1.56% at p=0.5)."""
    p = max(0.0, min(1.0, price))
    peak = 0.0156
    return peak * max(0.0, 1.0 - 2.0 * abs(p - 0.5))


def fee_usdc(price: float, shares: float) -> float:
    return taker_fee_rate(price) * price * shares
