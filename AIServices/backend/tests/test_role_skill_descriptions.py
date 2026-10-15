"""09b2 Part 2: role-skill aliases, label maps and the frozen-description exception."""

import importlib.util
import json
from pathlib import Path

import pytest

from app.services.embeddings.normalise import normalise_skill
from app.services.professions.cleaning import clean_esco_label, clean_onet_label

DATA = Path(__file__).resolve().parents[1] / "app" / "data"
SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_skill_descriptions.py"


@pytest.mark.parametrize("alias, canonical", [
    # Another name for an existing skill.
    ("Common Lisp", "Lisp"),
    ("Assembly", "Assembly Language"),
    ("SAS language", "SAS"),
    ("Microsoft Visual C++", "C++"),
    ("Oracle Relational Database", "Oracle Database"),
    ("Cisco", "Cisco Networking"),
    ("Firewall", "Firewalls"),
    ("Agile development", "Agile"),
    ("Waterfall development", "Waterfall"),
    ("Prototyping development", "Prototyping"),
    ("Adobe Photoshop Lightroom", "Adobe Lightroom"),
    # Aliases of new role skills.
    ("Apache Maven", "Maven"),
    ("Apache Tomcat", "Tomcat"),
    ("Microsoft Visual Basic", "Visual Basic"),
    ("Mac OS X", "macOS"),
    ("Microsoft Windows", "Windows"),
    ("DB2", "IBM Db2"),
    ("SSIS", "SQL Server Integration Services"),
    ("Microsoft SharePoint", "SharePoint"),
    ("Ajax Framework", "AJAX"),
    ("SVN", "Subversion"),
    ("IIS", "Internet Information Services"),
])
def test_role_skill_aliases(alias, canonical):
    assert normalise_skill(alias)[1] == canonical


@pytest.mark.parametrize("word", ["Source", "Salt", "RAGE", "Shiva", "MDX", "Epic", "Access"])
def test_ambiguous_words_are_not_global_aliases(word):
    # These map only from their full ESCO / O*NET labels (esco_name_map.json or multi-word aliases).
    assert normalise_skill(word)[1] == word


@pytest.mark.parametrize("label, name", [
    ("MDX", "Multidimensional Expressions"),
    ("Salt (tools for software configuration management)", "SaltStack"),
    ("Source (digital game creation systems)", "Source Engine"),
    ("RAGE (digital game creation systems)", "RAGE Engine"),
    ("Shiva (digital game creation systems)", "ShiVa Engine"),
    ("Assembly (computer programming)", "Assembly Language"),
    ("Smalltalk (computer programming)", "Smalltalk"),
    ("GIMP (graphics editor software)", "GIMP"),
])
def test_esco_label_map(label, name):
    assert clean_esco_label(label) == name


@pytest.mark.parametrize("label, name", [
    ("ESRI ArcGIS ArcPy", "ArcPy"),
    ("ESRI ArcGIS Survey 123", "Survey123"),
    ("RockWare ArcMap", "ArcMap"),
    ("Geographic information system GIS systems", "GIS"),
    ("Apple macOS", "macOS"),
    ("Border Gateway Protocol BGP", "BGP"),
    ("Qualys Cloud Platform", "Qualys"),
])
def test_onet_label_map(label, name):
    assert clean_onet_label(label) == name


def test_every_map_target_is_a_described_skill():
    descriptions = json.loads((DATA / "skill_descriptions.json").read_text(encoding="utf8"))
    esco = json.loads((DATA / "esco_name_map.json").read_text(encoding="utf8"))["map"]
    for target in esco.values():
        assert target in descriptions, target


def test_frozen_exceptions_are_existing_entries():
    spec = importlib.util.spec_from_file_location("check_skill_descriptions", SCRIPT)
    checker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    descriptions = json.loads((DATA / "skill_descriptions.json").read_text(encoding="utf8"))
    assert set(checker.FROZEN_OVER_LIMIT) <= set(descriptions)
    # htmx keeps its original text; only the checker's verdict changed.
    assert descriptions["htmx"] == "JavaScript library that adds AJAX requests and dynamic updates to pages through HTML attributes"
