# Module 5.1 — ESCO phrase → tool mapping: steps A–C (sandbox, nothing adopted)

Run 2026-10-16 on the real data (130 active roles, 1,093 described skills), read-only. Step D waits for the labels.

## A. Diagnosis of option (b) (Module 5: phrases → nearest tool at bi-encoder cosine ≥ 0.80)

- ESCO essential phrases (distinct, no curated description, essential for ≥ 1 active ESCO role): **749** (2,160 role
  occurrences): 502 ability phrases ("skill/competence"), 242 knowledge labels, 5 without a type.
- With at least one described skill at cosine ≥ 0.80: **247 (33.0 %)**, covering 795 occurrences (36.8 %) —
  137 ability phrases, 107 knowledge labels. (Module 5's option (b) mapped ability phrases only: 178 role skills.)
- **The nearest tool is often a poor stand-in for a generic phrase:** computer programming → Pascal (0.81, 19 roles),
  web programming → CoffeeScript (0.84), tools for software configuration management → Puppet (0.87), develop with cloud
  services → Codenvy (0.81).
- **Why the DevOps and mobile ranks did not move:** option (b) as measured in Module 5 *replaced* each mapped phrase by
  the tool. A phrase that earned 0.5 (related, through a mixed pair) became **missing** whenever the profile did not hold
  that exact tool. ESCO *cloud DevOps engineer* fell 37.5 % → 29.2 % (rank 7 → 16): of 8 mapped phrases only one helped
  (deploy cloud resource → Terraform, held: related → matched); six lost their related credit (design cloud architecture →
  Cloud Architecture, design cloud networks → Cloud Networking, …). *cloud engineer* 25.8 → 18.2 %. For mobile none of
  the mapped tools are held (software developer: Database Migrations, Design Patterns, Debugging, …), so nothing moved;
  *mobile application developer* stays at 5.6 % (rank 28).
- **Consequence for the Module 5 options table:** the (b) row understates an *additive* mapping (the tool as an extra
  way to hold the phrase, keeping the phrase's own credit). Step D measures the additive form, as briefed ("mapped tool
  held → phrase counts as held, 1.0"). Details: `diagnosis.md`.

## B. Reranker (BAAI/bge-reranker-base, CPU)

For each of the 749 phrases the top 20 described skills by bi-encoder cosine were scored with the cross-encoder;
query "Does using {skill} demonstrate the ability to {phrase}?", passage "{skill}: {curated description}"; score =
sigmoid of the logit (`reranker_pairs.csv`, 14,980 pairs).

| | |
|---|---|
| Throughput | **7.7 pairs / s** (4 CPU threads, batch 32; 7.9 in the separate RAM run) |
| Time | bi-encoder + candidates 61 s; reranker load 330 s (incl. the one-time ~1.1 GB download); scoring **1,933 s (~32 min)** |
| RAM | bi-encoder loaded 574 MB → **with the reranker 1,958 MB (+~1.4 GB)**; peak 2,063 MB (`reranker_ram.json`; the main run's RAM reading failed — a ctypes bug, fixed, re-measured separately) |
| Pairs ≥ 0.5 / 0.7 / 0.8 / 0.9 / 0.95 | 349 / 158 / 99 / 41 / 15 |
| Phrases with a candidate ≥ 0.5 / 0.7 / 0.8 / 0.9 / 0.95 | 210 / 110 / 77 / 33 / 14 (of 749) |

Observations (no labels yet): the reranker reorders strongly (for 609 of 749 phrases its best pick is not the
bi-encoder's #1). Generic phrases stay low (computer programming: best Python 0.41; web programming: best Elm 0.32),
specific ones go high (design user interface → Adobe XD 0.91, UI/UX Design 0.88; tools for software configuration
management → Ansible 0.98; integrated development environment software → PyCharm 0.97). Some high scores look wrong
(digital systems → Electronic Health Records 0.82) and some expected tools rank low (deploy cloud resource: Railway
0.39, Render 0.34, Pulumi 0.33 above Terraform). Running it inside the service would cost ~1.4 GB RAM; as an offline
mapping step (run once per taxonomy change) the ~30 minutes would be acceptable.

## C. Calibration set (waiting for labels)

`calibration_to_label.csv`: **147 pairs** from 125 phrases, shuffled, without scores — 14 from each reranker-score band
of 0.1 (at most 2 pairs per phrase, seed 51) plus 7 planted pairs: likely negatives React → design user interface,
Pascal → computer programming, CoffeeScript → web programming, Codenvy → develop with cloud services, Windows
Administration → manage system security; likely positives Figma → design user interface, Terraform → deploy cloud
resource. Scores are in `calibration_key.csv`. Instructions: `../README.md`.
