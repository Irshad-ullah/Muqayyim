"""
Alias changes made with the curated skill descriptions (09a2, Stage 1):
previous canonical names still resolve, now to the benchmark's names, and
the three un-merged pairs stay separate skills.
"""

import pytest

from app.services.embeddings.normalise import normalise_skill


@pytest.mark.parametrize(
    "old_name, key, canonical",
    [
        # Renamed: the previous canonical name is now an alias of the new one.
        ("Apache Kafka", "kafka", "Kafka"),
        ("Microsoft Excel", "excel", "Excel"),
        ("MS Excel", "excel", "Excel"),
        ("ASP.NET", "asp.net core", "ASP.NET Core"),
        ("aspnet", "asp.net core", "ASP.NET Core"),
        ("Apache Airflow", "airflow", "Airflow"),
        ("Networking", "computer networking", "Computer Networking"),
        ("computer networks", "computer networking", "Computer Networking"),
        # Newly aliased parser-vocabulary names.
        ("circleci", "circleci", "CircleCI"),
        ("sh", "shell scripting", "Shell Scripting"),
        ("oracle", "oracle database", "Oracle Database"),
        ("presentation", "presentation skills", "Presentation Skills"),
        ("docker-compose", "docker compose", "Docker Compose"),
    ],
)
def test_previous_and_new_aliases_resolve(old_name, key, canonical):
    assert normalise_skill(old_name) == (key, canonical)


@pytest.mark.parametrize(
    "a, b",
    [
        ("Spring", "Spring Boot"),
        ("Shell Scripting", "Bash"),
        ("Information Security", "Cybersecurity"),
        ("Docker Compose", "Docker"),
    ],
)
def test_unmerged_pairs_are_separate_skills(a, b):
    assert normalise_skill(a)[1] == a
    assert normalise_skill(b)[1] == b
    assert normalise_skill(a)[0] != normalise_skill(b)[0]


@pytest.mark.parametrize(
    "alias, canonical",
    [("spring framework", "Spring"), ("springboot", "Spring Boot"), ("shell script", "Shell Scripting"),
     ("infosec", "Information Security"), ("cyber security", "Cybersecurity")],
)
def test_unmerged_pairs_keep_their_own_aliases(alias, canonical):
    assert normalise_skill(alias)[1] == canonical
