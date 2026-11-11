# The author's blind re-reading of the AI-only readings

Written 11 Nov 2026, before the reading proper. One must-sheet answer already exists (item
087acf8d1a, recorded 2026-11-11T19:07:10Z, one of its two questions answered); it was given after
the sheet was committed (663c717, 19:06:10Z) and before this protocol.

## Purpose

Table 4.5 of the thesis lists readings that only the AI assistant made. This is the author's
re-reading of them, item by item, with the AI's verdict and the extractor's decision hidden.

## Reader, and what cannot be hidden

One reader: the author, who built the extractor, directed the AI readings and has seen earlier
results and the thesis text. Some items may be remembered. The sheets hide what a sheet can hide;
they do not make the reader independent of the tool. The thesis reports this as a check of the AI
readings by the tool's author, not as independent validation.

## Sheets

Each set gets its own sheet, built by a committed script from the sources and the result files,
committed before any of its items is answered. A sheet shows the item's source lines and the claim
under test; it never shows the AI's verdict or reading, the extractor's modality or decision, or
which items are decoys. Sheets that would otherwise reveal the verdict by their selection mix in
decoys (items with the other verdict), in an order fixed by a hash of the item id.

1. `must-sheet.json`: the 25 constructs of the final must tier and 14 constructs the final graphs
   hold at may only. Questions: does triggering it go to the stated target; on every listed source
   screen, is it always shown and never stopped. The reader's tier is must when both answers are
   yes, may when either is no, undecided otherwise.
2. Further sheets (Rima et al. comparison, head-to-head samples, cited sites without a token,
   alfresco reference) are described in this file when they are committed, before they are read.

## Recording and order of events

`serve.mjs` records each answer with its time and a one-line reason (what was read). For each set:
sheet committed, then answers given, then the verdict file committed unchanged, then the comparison
script run and its output committed. The comparison scripts are committed before the verdict files.
Answers are not edited after the comparison has been run.

## Scoring

Per set, raw counts: items read, reader agrees with the AI or extractor, disagrees, undecided.
Disagreements are listed with the reader's reason. No agreement coefficient is reported. Counts
reach the thesis only through generated macros. The extractor, the graphs and the must tier are not
changed in response to the reading.
