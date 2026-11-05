# regen: one script per generated file, one command for all

Every number, table and plot in the thesis lives in a `thesis/generated-<name>.tex` file. Nothing in
the chapters is pasted: they `\input` those files and cite their macros, so a regenerated file
changes the PDF at the next build. `regen/<name>.sh` writes `generated-<name>.tex`.

```bash
bash regen/all.sh                 # every script into a scratch dir, compared with thesis/, then the PDF
bash regen/all.sh --write         # the same, and take the regenerated values into thesis/
bash regen/all.sh h2h rima        # only these scripts
bash regen/h2h.sh                 # one script, written straight into thesis/
bash regen/build.sh               # only the PDF (after editing prose)
```

`all.sh` prints one line per file:

| Status | Meaning |
| --- | --- |
| `same` | regenerated file equals the committed one (the `%` provenance lines aside) |
| `DIFF` | the data or the generator changed; read the diff it names, then rerun with `--write` |
| `WROTE` | with `--write`: the new file replaced the committed one |
| `skip` | an input outside the repository is missing (see "work dir" below); not an error |
| `FAIL` | the generator refused or crashed; its log path is printed |

It also fails if a `generated-*.tex` in `thesis/` has no script here, and exits non-zero on any
`DIFF` or `FAIL`.

## Where each file comes from

Data: **repo** = committed results; **archive** = `route-oracle/results-round2/final16.tgz` (two
`run-all.mjs` runs at `a9d29df`) or `route-oracle/results-ablation/ablation.tgz` (realworld level
graphs at `a9d29df`); **work dir** = `UIGRAPH_WORK` (default `~/personal/uigraph-work`), written by
REPRODUCE.md section 2, or holding files that cannot be committed (Rima et al.'s reference and their
tool's output have no licence).

| Script | Used in | Data |
| --- | --- | --- |
| `tables` | tab:coverage, tab:loss, tab:conversion, tab:oracles; ch3, ch5 | archive (run without attribution) |
| `before-after` | tab:before-after, tab:recovery-source, tab:remaining, tab:earlier; abstract, ch5–7 | archive (both runs) |
| `round2` | tab:corpus, tab:round2acct; ch4–7 | archive (round2/) |
| `plots` | Figure fig-plots | archive + `results-rq4/` |
| `plots-rq4` | Figure fig-plots | repo `results-rq4/` |
| `rq4` | tab:mutsummary; ch4–7 | repo `results-rq4/` |
| `ablation` | tab:scopebaseline, tab:ablation, tab:earlier; abstract, ch1, ch5, ch7 | archive (ablation.json) |
| `groundtruth` | tab:groundtruth; ch5–7 | archive (realworld level graphs) |
| `groundtruth-alfresco` | tab:groundtruth; abstract, ch5–7 | work dir `alfresco-levels/` |
| `ceiling` | tab:ceiling; ch5, ch6 | archive + work dir `alfresco-levels/` + repo `e2e-nav/results` |
| `e2e` | tab:e2e, tab:earlier; ch4–7 | repo `e2e-nav/results/` |
| `earlier-work` | ch5, ch7 | archive (run with attribution) |
| `earlier` | ch4, appendix | git history (f17a302, 7d109c7) |
| `sweep` | appendix | repo `results-must/mutation-sweep.json` |
| `must-witness` | tab:oracles, tab:before-after; ch5–7 | repo `results-must/witness/` |
| `probe` | tab:scope; ch5–7 | repo `route-probe/results*/` |
| `rima` | tab:rima, tab:earlier; ch5, ch7 | repo `rima/graphs/` + work dir (their reference) |
| `rimarep` | tab:rima; ch5, ch7 | repo `rima/graphs-repaired/` + work dir (their reference) |
| `rima-verdicts` | tab:rima; ch5, ch6 | repo `rima/` readings + work dir (their reference) |
| `h2h` | tab:h2h; abstract, ch5–7 | repo `rima/head2head/results*/` (blind readings) |
| `h2h-author` | ch5–7 | repo `rima/head2head/results-v3/author-check.json` |
| `h2h-routes` | ch5 | work dir `rima/theirs/` (their tool's output) |
| `census` | tab:census; abstract, ch3, ch5–7 | work dir `corpus/` graphs |
| `census-base` | ch5 | work dir `noattr/` graphs |
| `expansion` | tab:expansion; ch5 | work dir `corpus/` graphs |
| `must` | appendix | work dir `corpus/` + repo `round-two-graphs/` |
| `guard-only` | abstract, ch6, ch7 | work dir `corpus/` graphs |
| `route-order` | abstract, ch3, ch7 | work dir `corpus/` graphs |
| `callgraph` | appendix | work dir `corpus/` graphs |
| `may-reasons` | tab:mayreasons; abstract, ch5, ch7 | work dir `may-reasons/` + `corpus/` graphs |
| `approx` | supplementary only (dropped appendix) | work dir `corpus/` sources |
| `node-audit` | appendix | none: historical (extractor 4505fd2a is not in the repository), always `skip` |

Diagrams (`thesis/figures/*.tex`) are TikZ drawn by hand and hold no measured number; the plot in
`fig-plots.tex` reads its coordinates from `generated-plots*.tex`.

To change what a table shows, edit its generator (the `.mjs` the script calls), run its script,
check the diff, and build. To change the data, re-measure (REPRODUCE.md section 2), then run
`all.sh --write`.

## Tóm tắt (tiếng Việt)

- Không cần dán ảnh: bảng và số liệu nằm trong `thesis/generated-*.tex`, chương chỉ `\input` và gọi macro, nên build lại là PDF tự cập nhật.
- Kiểm tra mọi thứ còn khớp: `bash regen/all.sh`. Tất cả `same` và PDF build xong là ổn.
- Có `DIFF`: dữ liệu hoặc script đã đổi. Xem diff, đúng ý thì chạy `bash regen/all.sh --write`.
- Chỉ sửa chữ: `bash regen/build.sh`.
- Muốn biết một bảng lấy từ đâu: tìm `tab:...` trong bảng trên.
