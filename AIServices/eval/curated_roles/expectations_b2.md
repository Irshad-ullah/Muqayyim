# Module 5.2 — variant B2 (no related credit): expectations (committed before any B / B2 run)

**Written:** 2026-10-17, before running B or B2 in this experiment. Sandbox only: no production change and no integration.

## Setups
- **B:** as in `expectations.md`: O\*NET + the 19 curated roles, ESCO off, production scoring with any-of groups.
  Credit is 1.0 for an exact or alias key or an any-of alternative, plus **0.5 related credit** (frozen 0.73 / mutual-NN
  rule).
- **B2:** the same data. Credit is **1.0** for an exact key, an alias (aliases resolve to the same key) or an any-of
  alternative, and **no 0.5 related credit**.
  - Related pairs are still computed with the same model and the same FAISS index (0.73 / mutual-NN). They are
    returned per role as `related_hints`: display only, never counted in the score.
  - Required set, top-up to 10 and match % = credits ÷ required: unchanged.

## Pass marks (the same as before)

| Set | Mark |
|---|---|
| Old 8 | top-3 **7/7**, top-5 **7/7** |
| Chef control | best match **< 20 %** |
| New 6 (not blind) | top-5 **≥ 5/6** |
| 10 test CVs (**not blind**) | top-3 **≥ 8/10**, top-5 **≥ 9/10** |
| Background check | chef **≤ 5 %** and **≤ 0.5 × web** |
| Vague skills | **0** vague skills in any required set |

Acceptable titles: the setup-B lists fixed in `expectations.md` (old 8, new 6) and `acceptable_b` in
`../career_matching/profiles_testcvs.json` (test CVs).

## Background check, defined for each variant (fixed now)

The rows are the same as in `eval/background_credit_rate.py`: every stored skill of every active role, minus the rows
whose key equals a profile skill (exact matches).

- **B:** the existing metric. Rate = rows with related credit ÷ non-exact rows, for its chef and web profiles.
- **B2:** related credit does not exist, so the existing metric would be 0 % by definition. The B2 metric therefore counts
  the credit B2 does give beyond an exact key: **rate = non-exact rows credited in the score (through an any-of
  alternative) ÷ non-exact rows**, for the same chef and web profiles.
  - Pass = chef ≤ 5 % and chef ≤ 0.5 × web.
  - If the web rate is also 0, the ratio cannot be computed. It is then reported as "not applicable", and the absolute
    criterion (chef ≤ 5 %) decides.
- **Reported alongside, for information:**
  - for B2, the related-hint rate (what the old metric would have credited);
  - for both, each profile's share of all rows credited in the score, including exact matches.
- **Real / false split:** credited rows are labelled with `background_labels.json` (Inventory Management → Excel is now a
  false match).

## Also reported
- Each profile's top 5 with match %.
- The number of profiles whose first acceptable rank changed between B and B2, and how many of the top-5 positions
  changed.
- The match-% spread for test CV 02 (Java backend): the issue was 55 % for unrelated curated roles in B.
- 3 example `related_hints` from B2 for the web profile (old 8) and 3 for test CV 05 (Android).
