# SPY Three-Down Close Dry Run

This folder contains a standalone Python dry run for the current Hershy canvas strategy:

1. Pull daily SPY OHLCV candles.
2. Detect three consecutive close-to-close down days.
3. Run pre-trade kill switches.
4. Emit a paper action log.
5. Replay historical signals by entering at the signal close and exiting at the next session open.

No third-party Python packages are required.

## Run With Built-In Fixture

The fixture forces a valid three-down signal so the workflow and action log can be tested without network access.

```bash
python3 dryruns/spy_three_down/spy_three_down_dryrun.py --data-source fixture --shares 10
```

## Run With Yahoo Finance

```bash
python3 dryruns/spy_three_down/spy_three_down_dryrun.py --data-source yahoo --symbol SPY --range 6mo --interval 1d --shares 10
```

Yahoo can rate-limit this endpoint. To keep the dry run executable while still trying live data first:

```bash
python3 dryruns/spy_three_down/spy_three_down_dryrun.py --data-source yahoo --fallback-fixture
```

## JSON Output

```bash
python3 dryruns/spy_three_down/spy_three_down_dryrun.py --data-source fixture --json
```

## Strategy Rules

- Signal: latest close is lower than the previous close for three consecutive sessions.
- Entry: buy SPY at the third down close.
- Exit: sell SPY at the next session open.
- Pre-trade kill switches:
  - stale data
  - malformed/missing candle data
  - ATR percentage above threshold
  - optional trend regime kill if the latest close is below SMA

