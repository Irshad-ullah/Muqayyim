# Profession datasets (O*NET and ESCO)

Muqayyim's profession database (`ai_db.professions`) is built only from these
two public datasets, plus any professions an admin adds by hand. The dataset
files are **not committed**: everything in this folder except this README is
git-ignored. Download them as described below, then run the importers.

## Attribution

This product uses the O*NET 31.0 Database by the U.S. Department of Labor,
Employment and Training Administration (USDOL/ETA), used under the CC BY 4.0
licence (https://creativecommons.org/licenses/by/4.0/). The data was modified
for this product.

ESCO v1.2.1 © European Union, https://esco.ec.europa.eu

## O*NET 31.0 → `onet/`

1. Go to https://www.onetcenter.org/database.html and download the
   **O*NET 31.0 Database** in **CSV** format.
2. Copy these three files into `AIServices/data/raw/onet/`:

   | File | Columns used |
   |---|---|
   | `occupation_data.csv` | O*NET-SOC Code, Title, Description |
   | `job_titles.csv` (Alternate Titles) | O*NET-SOC Code, Job Title, Short Title |
   | `software_skills.csv` (Technology Skills) | O*NET-SOC Code, Workplace Example, Element Name, Hot Technology, In Demand |

   If the download uses other names (e.g. `Occupation Data.csv`,
   `Alternate Titles.csv`, `Technology Skills.csv`), rename them to the names above.

## ESCO v1.2.1 → `esco/`

1. Go to https://esco.ec.europa.eu/en/use-esco/download, choose version
   **v1.2.1**, language **English**, format **CSV**, and download the
   classification.
2. Copy these four files into `AIServices/data/raw/esco/` (with or without the `_en` suffix):

   | File | Columns used |
   |---|---|
   | `occupations_en.csv` | conceptUri, iscoGroup, preferredLabel, altLabels, description, code |
   | `skills_en.csv` | conceptUri, skillType, preferredLabel, altLabels, description |
   | `occupationSkillRelations_en.csv` | occupationUri, relationType, skillUri |
   | `digitalSkillsCollection_en.csv` | conceptUri |

Columns are read by header name, so column order does not matter. A UTF-8 BOM
and multi-line fields (ESCO alternative labels) are handled.

## Importing

From the repository root, with the AIServices virtual environment:

```
AIServices/backend/venv/Scripts/python AIServices/scripts/import_onet.py --dry-run
AIServices/backend/venv/Scripts/python AIServices/scripts/import_onet.py
AIServices/backend/venv/Scripts/python AIServices/scripts/import_esco.py --dry-run
AIServices/backend/venv/Scripts/python AIServices/scripts/import_esco.py
```

`--dry-run` validates the files and headers and reports what would be added,
updated and removed, with skill coverage, and writes nothing. A real import
writes the professions, embeds their skills and rebuilds the role-skill FAISS
index in `AIServices/data/index/` (also git-ignored; it can always be rebuilt
from MongoDB).

Selection is configured in `AIServices/backend/.env`: `ONET_SOC_PREFIXES`,
`ONET_SOC_EXCLUDE`, `ONET_SKILLS_CAP`, `ESCO_ISCO_PREFIXES` and
`PROFESSION_SOURCES` (which sources the index uses).
