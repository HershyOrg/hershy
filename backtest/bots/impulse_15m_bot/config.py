from __future__ import annotations

from dataclasses import dataclass


@dataclass
class BotConfig:
    # Beta / lag
    W_BETA_SEC: int = 60
    DELTA_MS: int = 300
    LAG_MS_INIT: int = 500
    BETA_SMOOTH: float = 0.10
    BETA_MIN: float = 0.0
    BETA_MAX: float = 1.0
    BETA_X_MIN: float = 1.0

    # Impulse / book
    PRICE_MOVE_USD_MIN_5S: float = 20.0
    SWEEP_USD_MIN: float = 1_500_000
    BOOK_CONSUME_USD_MIN: float = 800_000
    BOOK_TOP_N: int = 10

    # Confirmation / exit
    CONFIRM_WIN_MS: int = 800
    CONFIRM_EPS_USD: float = 5.0
    PTB_CROSS_EPS_USD: float = 2.0
    SCALP_TP_PCTPT: float = 3.0
    TIME_STOP_MS: int = 3500
    COOLDOWN_MS: int = 1500

    # Spoof filter
    SPOOF_SCORE_MAX: float = 1.0
    SPOOF_K: float = 200_000

    # Trade sizing
    SHARES: float = 100.0
    ORDER_USDC: float = 100.0
