"""Algorithm 4 — date-range parser, table-driven."""

from datetime import datetime, timezone

import pytest

from app.services.date_parser import find_date_range, normalize_stored_date, parse_date_range

YEAR = datetime.now(timezone.utc).year


def r(start="", end="", current=False, flags=None):
    return {"startDate": start, "endDate": end, "current": current, "flags": flags or []}


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Jan 2020 – Present", r("2020-01", current=True)),
        ("Jan 2020 - Present", r("2020-01", current=True)),
        ("January 2020 - March 2022", r("2020-01", "2022-03")),
        ("January 2020 — March 2022", r("2020-01", "2022-03")),
        ("01/2020 - 03/2022", r("2020-01", "2022-03")),
        ("1/2020 – 3/2022", r("2020-01", "2022-03")),
        ("2020/01 – 2022/03", r("2020-01", "2022-03")),
        ("2019 - 2021", r("2019", "2021")),
        ("2019-2021", r("2019", "2021")),
        ("2019 – Current", r("2019", current=True)),
        ("Mar'21 – Jun'22", r("2021-03", "2022-06")),
        ("Mar ’21 – Jun ’22", r("2021-03", "2022-06")),
        ("Since 2021", r("2021", current=True)),
        ("since March 2021", r("2021-03", current=True)),
        ("2021 – Now", r("2021", current=True)),
        ("2020 till date", r("2020", current=True)),
        ("2018 to 2020", r("2018", "2020")),
        ("Feb 2019 till Aug 2020", r("2019-02", "2020-08")),
        ("Sept. 2020 – Dec 2020", r("2020-09", "2020-12")),
        ("2022", r("2022")),
        ("Ongoing since 2023", r("2023", current=True)),
        ("Software Engineer, Acme (Jun 2019 — Aug 2021)", r("2019-06", "2021-08")),
        ("BS Computer Science 2016 – 2020 CGPA 3.5", r("2016", "2020")),
    ],
)
def test_formats(text, expected):
    assert parse_date_range(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "13/2020 - 2021",        # month > 12
        "1940 - 1945",           # before 1950
        f"{YEAR + 2} - {YEAR + 3}",  # start too far in the future
        "Call 0300-1234567",     # phone number, not a date
        "no dates here",
        "",
    ],
)
def test_impossible_or_missing_values_give_no_dates(text):
    assert parse_date_range(text) == r()


def test_end_before_start_keeps_start_and_flags_end():
    assert parse_date_range("2022 - 2019") == r("2022", flags=["endDate"])
    assert parse_date_range("Mar 2021 – Jan 2021") == r("2021-03", flags=["endDate"])


def test_invalid_end_is_dropped_and_flagged():
    assert parse_date_range("2020 - 13/2021") == r("2020", flags=["endDate"])


def test_span_and_text_allow_removing_the_date():
    line = "Junior Developer | Arbisoft | Mar'20 – Dec'21"
    found = find_date_range(line)
    assert found["text"] == "Mar'20 – Dec'21"
    assert line[: found["span"][0]].rstrip(" |") == "Junior Developer | Arbisoft"


def test_future_graduation_year_allowed_when_asked():
    assert find_date_range(str(YEAR + 3)) is None
    assert find_date_range(str(YEAR + 3), start_years_ahead=10)["startDate"] == str(YEAR + 3)


@pytest.mark.parametrize(
    "value, expected",
    [("2022-01", "2022-01"), ("Jan 2022", "2022-01"), ("2022", "2022"), ("2022-01-15T00:00:00Z", "2022-01"),
     ("", ""), (None, ""), ("soon", None), ("2022-13", None), (5, None)],
)
def test_normalize_stored_date(value, expected):
    assert normalize_stored_date(value) == expected
