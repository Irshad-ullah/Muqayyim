"""Stage 4 extraction: experience/education dates, certifications, projects."""

import pytest

from app.constants.profile_limits import PROFILE_LIMITS
from app.services.extractors.certifications import extract_certifications, parse_certification_line
from app.services.extractors.projects import extract_projects, is_project_name
from app.services.nlp_extractor import get_nlp_extractor
from tests.cv_fixtures import SAMPLE_CV_TEXT


@pytest.fixture(scope="module")
def extractor():
    return get_nlp_extractor()


# ── Experience / education ───────────────────────────────────────────────────
def test_experience_dates_titles_and_companies(extractor):
    exp = extractor.extract_experience(SAMPLE_CV_TEXT)
    got = [(e["title"], e["company"], e["startDate"], e["endDate"], e["current"]) for e in exp]
    assert got == [
        ("Software Engineer", "Systems Ltd", "2022-01", "", True),
        ("Junior Developer", "Arbisoft", "2020-03", "2021-12", False),
        ("Web Development Intern", "TechCorp", "", "", False),
    ]
    assert exp[0]["location"] == "Lahore"
    assert exp[0]["description"] == "Built REST APIs with Node.js and Express\nLed migration from MySQL to PostgreSQL"
    assert exp[0]["needsReview"] == [] and exp[1]["needsReview"] == []
    # No dates in the CV → flagged, never invented.
    assert exp[2]["needsReview"] == ["startDate", "endDate"]


@pytest.mark.parametrize(
    "section, expected",
    [
        ("Backend Developer – Netsol\n01/2020 - 03/2022", ("Backend Developer", "Netsol", "2020-01", "2022-03", False)),
        ("Data Analyst @ Careem (2019 – Current)", ("Data Analyst", "Careem", "2019", "", True)),
        ("Acme Corp — QA Engineer\nSince 2021", ("QA Engineer", "Acme Corp", "2021", "", True)),
        ("Teaching Assistant\nFAST NUCES, Lahore\n2020/01 – 2020/06", ("Teaching Assistant", "FAST NUCES", "2020-01", "2020-06", False)),
    ],
)
def test_experience_header_forms(extractor, section, expected):
    e = extractor.extract_experience("Experience\n" + section)[0]
    assert (e["title"], e["company"], e["startDate"], e["endDate"], e["current"]) == expected


def test_experience_missing_company_is_flagged(extractor):
    e = extractor.extract_experience("Experience\nSoftware Developer\nJan 2021 – Present")[0]
    assert e["company"] == "" and "company" in e["needsReview"]


def test_education_degree_field_institution_dates(extractor):
    edu = extractor.extract_education(SAMPLE_CV_TEXT)
    assert [(e["degree"], e["field"], e["institution"], e["startDate"], e["endDate"]) for e in edu] == [
        ("BS", "Computer Science", "FAST NUCES", "2016", "2020"),
        ("FSc", "Pre-Engineering", "Punjab College", "2014", "2016"),
    ]
    assert edu[0]["gpa"] == "3.4/4.0"
    assert edu[0]["needsReview"] == []


def test_single_education_year_is_the_graduation_year(extractor):
    e = extractor.extract_education("Education\nBachelor of Science in Software Engineering\nNUST, 2027")[0]
    assert (e["degree"], e["field"], e["institution"]) == ("Bachelor of Science", "Software Engineering", "NUST")
    assert (e["startDate"], e["endDate"]) == ("", "2027")


# ── Certifications ───────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "line, name, issuer, date",
    [
        ("AWS Certified Cloud Practitioner – Amazon Web Services (2023)", "AWS Certified Cloud Practitioner", "Amazon Web Services", "2023"),
        ("Google Data Analytics Certificate | Coursera | 2022", "Google Data Analytics Certificate", "Coursera", "2022"),
        ("Meta Front-End Developer, Coursera, Jan 2023", "Meta Front-End Developer", "Coursera", "2023-01"),
        ("Azure AI Fundamentals — Issued by Microsoft", "Azure AI Fundamentals", "Microsoft", ""),
        ("Responsive Web Design - freeCodeCamp - 2021", "Responsive Web Design", "freeCodeCamp", "2021"),
        ("Deep Learning Specialization by DeepLearning.AI (Mar 2022)", "Deep Learning Specialization", "DeepLearning.AI", "2022-03"),
        ("Python for Everybody from Coursera", "Python for Everybody", "Coursera", ""),
    ],
)
def test_certification_forms(line, name, issuer, date):
    c = parse_certification_line(line)
    assert (c["name"], c["issuer"], c["date"]) == (name, issuer, date)
    assert c["needsReview"] == []


def test_issued_by_on_the_next_line_continues_the_certification(extractor):
    certs = extractor.extract_certifications(SAMPLE_CV_TEXT)
    azure = next(c for c in certs if c["name"] == "Azure AI Fundamentals")
    assert azure["issuer"] == "Microsoft" and azure["needsReview"] == []


def test_missing_issuer_is_flagged(extractor):
    certs = extractor.extract_certifications(SAMPLE_CV_TEXT)
    ml = next(c for c in certs if c["name"] == "Machine Learning Specialization")
    assert ml["issuer"] == "" and ml["needsReview"] == ["issuer"]


@pytest.mark.parametrize(
    "heading",
    ["Certifications", "Certificates", "Licenses & Certifications", "Licences", "Courses & Certifications", "Achievements & Certifications"],
)
def test_certification_section_headings(extractor, heading):
    certs = extractor.extract_certifications(f"Skills\nPython\n{heading}\nScrum Master Certification | Scrum.org | 2024")
    assert [(c["name"], c["issuer"]) for c in certs] == [("Scrum Master Certification", "Scrum.org")]


def test_outside_the_section_only_known_issuer_plus_certification_word():
    text = "\n".join([
        "Experience",
        "- Worked with Google Cloud to deploy microservices",       # issuer, no cert word
        "- Earned a certificate of appreciation from the dean",       # cert word, no known issuer
        "- Built a certificate generator using Google APIs",          # verb-led
        "Google IT Support Professional Certificate - Coursera",      # both → picked up
    ])
    certs = extract_certifications(None, text)
    assert [(c["name"], c["issuer"]) for c in certs] == [("Google IT Support Professional Certificate", "Coursera")]


# ── Projects ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "line",
    [
        "Developed a complete e-commerce system with payment integration and admin dashboard.",
        "A web application that lets students track their assignments and deadlines.",
        "Built using React and Firebase",
        "- Muqayyim | React",
        "Implemented JWT authentication",
        "x" * (PROFILE_LIMITS["titleMax"] + 1),
        "One two three four five six seven eight nine ten eleven twelve thirteen",
        "https://github.com/ayesha-k/muqayyim",
        "Jan 2022 – Mar 2022",
        "Technologies: React, Node",
        "and a REST API for mobile clients",
    ],
)
def test_lines_that_are_never_project_names(line):
    assert not is_project_name(line)


@pytest.mark.parametrize("line", ["Muqayyim", "Weather Now – real-time weather dashboard", "Muqayyim | React, Node.js", "Chat App (React, Socket.io)"])
def test_lines_that_can_be_project_names(line):
    assert is_project_name(line)


def test_project_header_forms_and_links(extractor):
    projects = extractor.extract_projects(SAMPLE_CV_TEXT)
    assert [p["name"] for p in projects] == ["Muqayyim", "Weather Now"]
    muqayyim, weather = projects
    assert muqayyim["technologies"][:3] == ["React", "Node.js", "MongoDB"]
    assert muqayyim["githubUrl"] == "https://github.com/ayesha-k/muqayyim"
    assert "e-commerce" in muqayyim["description"]  # a sentence line stays description
    assert weather["description"].startswith("real-time weather dashboard")
    assert weather["liveUrl"] == "https://weather-now.example.com"


def test_name_pipe_tech_form():
    known = lambda text: []  # noqa: E731
    [p] = extract_projects("Inventory Tracker | React, Node\n- Tracks stock for small shops", known)
    assert (p["name"], p["technologies"], p["description"]) == ("Inventory Tracker", ["React", "Node"], "Tracks stock for small shops")


def test_long_description_lines_never_become_projects():
    section = "\n".join([
        "Smart Attendance",
        "A face-recognition attendance system for classrooms using OpenCV and a Flask backend with reporting",
        "Implemented the recognition pipeline and the teacher dashboard.",
        "Used PostgreSQL for storage",
    ])
    projects = extract_projects(section, lambda text: [])
    assert [p["name"] for p in projects] == ["Smart Attendance"]
    assert all(len(p["name"]) <= PROFILE_LIMITS["titleMax"] for p in projects)


def test_at_most_ten_projects():
    section = "\n".join(f"Project {i} | React\n- Something useful" for i in range(15))
    assert len(extract_projects(section, lambda text: [])) == 10
