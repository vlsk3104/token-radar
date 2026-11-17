# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/vlsk3104/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/vlsk3104/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar: a static dashboard that ranks pre-token protocols from a sealed DefiLlama snapshot by implied launch value. The value model anchors each category's multiple to what the market actually pays per TVL dollar for live-token peers in the same category, then adjusts for 7-day TVL momentum, protocol age, chain breadth and risk signals (steep TVL decline, single-chain concentration). Every row carries a concrete, sequenced farm plan with costs and durations, plus an exit rule tied to TVL deterioration. The board covers all 40 watchlist protocols and adds early pre-token protocols below the $50M floor.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=tv7w63vg&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
