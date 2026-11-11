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
   alfresco reference) are described in this file when they are committed, before they are read
   (sections Sheet A to Sheet D below). Suggested order: A, B, C, D, since sheet C shows the sites
   an AI reading cited.

Already seen. `rima/STUDENT-READING.md` (5 Nov) lists AI verdicts in four tiers: tier 1, 41
head-to-head pairs on five corpus applications, which the author re-read with the verdict visible
(`rima/head2head/results-v3/author-check.json`); tier 2, the first comparison's 5 misses and 11
pairs judged spurious; tier 3, the 40 mifos pairs of the head-to-head sample; tier 4, the 12
head-to-head pairs on Rima et al.'s subjects not judged real. The record shows the author's reading
of tier 1, his causes for the 11 spurious pairs (`rima/spurious-causes.json`) and his three
corrections (`rima/corrections.json`); it does not say whether he read tiers 2 to 4. Before the
first answer on sheet A or B the author adds one line here saying whether he did. The thesis text
(Section 5, first comparison) also describes the five misses and the causes of the spurious pairs.

Author's statement, 11 Nov 2026, before any answer on sheet A or B: I never read tiers 2 to 4 of
`rima/STUDENT-READING.md`.

Shared code: `sheet-lib.mjs` (ids, excerpts, the application directories of
`rima/head2head/apps.txt`, the reading rule shown at the top of sheets A and B). Every sheet orders
its items by id, a hash of the item.

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

## Sheet A: first comparison with Rima et al. (`rima-sheet.json`, 54 items)

Built by `make-rima-sheet.mjs` from `rima/adjudication.json` (final verdicts),
`rima/adjudication-input.json` (what the AI readers were given), `rima/corrections.json` and the
graphs at 2aac284 (`rima/graphs`). Sources: the subject checkouts at the commits of
`rima/subjects.txt`.

Items:
- the 5 reference pairs the graph missed (\RimaMissed);
- 30 of the extra pairs judged real, drawn per subject, the stratum of the original reading (which
  sampled per subject), in proportion to each subject's real pairs by largest remainder:
  posts-users-ui-ng 6, heroes-angular 2, airbus-inventory 3, spring-petclinic-angular 6,
  ever-traduora 6, angular-jumpstart 5, event-booking-mean 2. Within a subject the draw is
  `sample()` of `rima/adjudication-input.mjs` with seed 20261111. The pool is the 170 real pairs
  less the one the author re-cited (`corrections.json`), so 169;
- the 11 extra pairs judged spurious;
- 8 constructed decoys.

Decoys and why. Without decoys every extra pair on the sheet would be one judged real. The 11
spurious pairs are the comparison's only pairs with the other verdict, so they are included,
although the author assigned their causes with the verdict visible and the thesis describes them:
their answers are reported apart and are not a blind check. Because the author may recognise them,
8 decoys that no reading has judged are added: per subject (one each; two for
spring-petclinic-angular and ever-traduora, the largest; none for heroes-angular, whose graph joins
every pair of its screens), a pair (s, t) of screens with no graph edge at 2aac284 once scopes are
expanded, not among the pairs either comparison read, shown with one witness of an edge entering t
from another screen, picked in hash order. Neither tool holds these pairs, so the expected answer
is spurious; a decoy read as real is a transition both tools may miss, listed but not counted
against any reading. The misses are on the sheet because no person has re-read them; the thesis
text describes all five, so they are not blind either and are reported as their own kind.

Shown per item: the pair, the subject's directory, the reading rule (sheet intro) and the source
around the sites a tool relates to the pair: for an extra pair the witnesses of its graph edges
(as given to the AI reader, without event or modality), for a miss the trigger lines of the
reference entries (the two entries that name only a component say so), for a decoy the one witness.

Question: can a user on s trigger a navigation that lands on t, the trigger shown while the user
stays on s? real / spurious / unclear.

Scoring (`score-rima.mjs`, test `score-rima.test.mjs`). Expected answer: a miss of class e (the
reference entry is wrong) spurious; a miss of any other class real, since those classes say the
source holds the transition and the graph lost it (the class, not the recorded reason, sets it); an
extra pair its final verdict; a decoy spurious. Per kind (misses, real, spurious, decoys): items,
agree, disagree, undecided (unclear). Macros `\AuthorRima<Kind><Items|Agree|Disagree|Undecided>`
and `\AuthorRimaItems`; disagreements with the reasons in `rima-comparison.json`. The scorer
refuses while any item is unanswered. The blind result is the real kind and the decoys.

## Sheet B: head-to-head samples (`h2h-sheet.json`, 50 items)

Built by `make-h2h-sheet.mjs` from `rima/head2head/results-v3/score.json` (final verdicts and
strata) and `results-v3/reading.json` (the sites the AI readers were given). Sources: the
checkouts of `rima/head2head/apps.txt`.

Items:
- all 40 pairs of the mifos sample (the samples behind the mifos figures);
- one pair per stratum (application and which tool found the pair) on Rima et al.'s subjects,
  drawn by `sample()` of `rima/adjudication-input.mjs` with seed 20261111 among the pairs the
  first comparison did not also read: 10 strata. Five strata (heroes-angular both,
  airbus-inventory theirs, ever-traduora theirs, angular-jumpstart ours, event-booking-mean ours)
  hold only pairs the first comparison read; those pairs belong to sheet A's pool and are not drawn
  again, so no pair is asked on both sheets.

The 41 pairs the author re-read with the verdict visible (`author-check.json`) are on the five
other corpus applications and are not on this sheet.

Decoys: none are added. The readings on the sheet carry both verdicts (on mifos most are
spurious, on Rima et al.'s subjects most real), so the selection does not give an item's verdict.
All 40 mifos pairs and the tier 4 pairs drawn here were listed with their verdict in
`STUDENT-READING.md` (see above); the comparison output marks nothing as seen, and the thesis
states whatever the author records about those tiers.

Shown per item: the pair, the application directory, the reading rule (sheet intro) and the source
around each site the AI reader was given for the pair, which joins both tools' sites without naming
either. The AI's own cited site and reason are not shown.

Question: as for sheet A (real / spurious / unclear).

Scoring (`score-h2h.mjs`, test `score-h2h.test.mjs`). An answer agrees when it equals the final
AI verdict; disagrees when both are real or spurious and differ; undecided when either is unclear
(one mifos reading is unclear). Per group (mifos, Rima et al.'s subjects), in all and split by AI
verdict: macros `\AuthorHH<Mifos|Rima>[Real|Spurious]<Items|Agree|Disagree|Undecided>` and
`\AuthorHHItems`; disagreements in `h2h-comparison.json`. It refuses while any item is unanswered.

## Sheet C: cited sites without a navigation token (`notoken-sheet.json`, 25 items)

Built by `make-notoken-sheet.mjs` from `rima/head2head/results-v3/score.json`, with the token rule
of `rima/head2head/check-sites.mjs` (a link, router call, event binding, redirect, dispatch, emit
or location within two lines of the cited line). The builder stops unless it finds as many real
pairs without a token as `\HHSitesNoToken` in `thesis/generated-h2h-sites.tex`.

Items: the 19 pairs judged real whose cited site has no token (\HHSitesNoToken), and 6 decoys.
Several items share a cited line with different start screens (one configuration entry on
alfresco is cited for seven pairs); each pair is its own item.

Decoys and why. Every one of the 19 was judged real, and every one lacks a token, so without
decoys the sheet would give the verdict, and decoys with a token would be told apart by the look of
the line. The decoys are all the head-to-head pairs not judged real whose cited line exists and has
no token either (6); the cited line is the one the AI reading gave for its verdict. Nine pairs
not judged real cite no line (8) or a file outside the checkout (1); they cannot be shown and are
left out.

Seen before: 4 of the 19 and 1 decoy are among the 41 tier 1 pairs the author re-read with the
verdict visible; the scorer counts them (`Seen`, `SeenAgree`) so the thesis can report the rest apart.
Sheet C shows the line an AI reading cited, which is part of that reading; it is the claim under
test (Table 4.5: the token check does not test that the construct leads to the target or renders
on the start screen). Read it after sheets A and B.

Shown per item: the pair, the application directory and the source around the cited line.

Questions: (1) does triggering what the highlighted line belongs to land on t? (2) is that
trigger shown to a user who stays on s? yes / no / unsure each. The reader's verdict is real when
both are yes, spurious when either is no, undecided otherwise.

Scoring (`score-notoken.mjs`, test `score-notoken.test.mjs`). Expected: real for the 19, spurious
for the decoys. Per kind: items, agree, disagree, undecided, seen, seen and agree. Macros
`\AuthorNoToken<Real|Decoy><Items|Agree|Disagree|Undecided|Seen|SeenAgree>` and
`\AuthorNoTokenItems`; disagreements in `notoken-comparison.json`. It refuses while any item is
unanswered.

## Sheet D: alfresco structural reference (`alfresco-sheet.json`, 16 items)

Built by `make-alfresco-sheet.mjs` from `route-oracle/ground-truth/alfresco.json`. Source: the
corpus checkout of alfresco at b88d47f, `projects/aca-content`.

Items: the 16 sites the reference lists with a screen set (\GTAlfSites; 5 of them placed on
every screen, 11 on a list). The 17 sites it left undetermined and the 5 it excluded are not on
the sheet.

Design and why no decoys. The question is each site's screen set, not a yes/no verdict, so the
selection of sites gives nothing away, provided the candidates do not. A candidate list made of the
reference set and the screens the other levels place the site on would nearly equal the reference
set, since the levels place only one site each (at full and at class) on a screen the reference
lacks (\GTAlfFullExcessSites, \GTAlfClassExcessSites); ticking every candidate would reproduce it
for the other sites. Every item instead offers all 26 screens of the application (the screens of the independent
route parser, which the reference uses), in route order, a box each, so the list is the same for
every site and says nothing of the reference set. The sheet intro states rules R1 to R3 of
`ALFRESCO-PROTOCOL.txt`; it leaves out the reference's own notes on which components are shell
content, which are part of its reading. The reference's target and reason per site are not shown.

Questions: (1) the screens the site can fire from, a box per screen (none ticked is an answer);
(2) does the source settle the ticked set? sure / unsure. `serve.mjs` gained the box question
(`"multi": true`, recorded as a list) for this sheet; sheets without it render as before.

Scoring (`score-alfresco.mjs`, test `score-alfresco.test.mjs`). Per (site, screen) pair against
the reference (ALL is the 26 screens, 174 pairs in all): in both, only in the reference (the
reader's set is smaller), only ticked by the reader (larger); per site, identical sets and sites
marked unsure. All sites and the 11 non-shell sites (44 pairs) are counted apart. Macros
`\AuthorAlf[NonShell]<Sites|RefPairs|Agree|RefOnly|ReaderOnly|Exact|Unsure>`; differing sites
with the reasons in `alfresco-comparison.json`. It refuses while any item lacks the sure/unsure
answer. The reference is not edited in response.
