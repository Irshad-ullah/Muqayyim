# How to label `category_calibration_to_label.csv` (Module 5.1, variant 2)

About 100 pairs of an ESCO ability phrase and an O*NET technology category. They are shuffled, and no scores are
shown, so the scores cannot steer your labels.

Each row gives:
- the **phrase**;
- the **category**;
- **tools_that_would_count**: the category's tools that our system recognises as skills.

If you label a pair 1, a user holding **any** of those tools would be counted as holding the phrase.

## The rule

> **1 = using software in this category clearly demonstrates the ability.**

- **`label` = 1:** someone who uses software of this kind (any of the listed tools) clearly shows the ability. The
  software is a direct way of doing what the phrase says. Examples: *execute software tests* ← Program testing software
  (Selenium, JUnit); *design graphics* ← Graphics or photo imaging software.
- **`label` = 0:** it does not clearly show the ability. Use 0 when any of these applies:
  - the category is for a different job;
  - it is only loosely related;
  - the phrase is broader than the software (a method, a regulation, a soft skill, or a whole profession);
  - some of the listed tools would wrongly count. For example, a category that mixes GitHub, Docker and WebLogic
    is not proof of every phrase that fits only one of them.
- **Unsure:** put **0** and a word in `notes`. The cut-off aims at ≥ 95 % precision, so doubtful pairs should count
  as negatives.

Judge the category as a whole, together with the listed tools. Do not judge just one tool you happen to know.

`category_calibration_key.csv` has the scores, the score band and the sample type for the same `pair_id`s. Please do
not look at it while labelling. The earlier file `calibration_to_label.csv` (variant 1, phrase → skill) is kept and
does not need labelling for now.
