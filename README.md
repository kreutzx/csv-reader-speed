# Broken-CSV reader, sped up

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/kreutzx/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/kreutzx/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A drop-in replacement for csv-reader 1.0.0 that returns **exactly** the same
`{columns, rows, errors}` for every input — every `stray_cr`, `quote_junk`,
`unterminated_quote`, `short_row` and `long_row` in the same order — in about
a third of the CPU.

How:

- **One-line fast path.** A record that lives on a single line with no quote
  and no stray CR is cut with one native `split(",")` — no per-character work.
- **indexOf hops.** Off the fast path, unquoted fields are scanned by hopping
  between the next comma / LF / CR with `indexOf` and slicing whole runs.
- **Quoted-field hop.** A quoted field with no doubled quote and no CR is one
  `indexOf('"')` plus a slice; fields with escapes or CRs take a splicing
  loop that converts CR/CRLF inside quotes to LF, and a quote that never
  closes falls back to the reference's unquoted re-read.

Verified against the kit's practice set (6 cases, ~10 MB of broken CSV,
byte-identical answers) and a 6,000-case adversarial fuzz against the
reference implementation (0 differences).

## Run it

```sh
MAKEFUN_INPUT_DIR= practice_in MAKEFUN_OUTPUT_DIR=out node main.ts
# reads $MAKEFUN_INPUT_DIR/cases.json, writes $MAKEFUN_OUTPUT_DIR/answers.json
```

MIT licensed — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=24q484pk&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
