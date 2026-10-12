"""
NLP Text Extraction and Entity Recognition
Using spaCy and NLTK for NLP processing
"""

import re
import spacy

from app.services.extractors import certifications, entries, projects
from typing import List, Dict, Optional, Tuple
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class NLPExtractor:
    """
    NLP Extractor for CV text
    Extracts skills, education, and experience using spaCy
    """
    
    def __init__(self):
        """Initialize NLP models"""
        self.nlp = None
        try:
            self.nlp = spacy.load("en_core_web_sm")
            logger.info("✓ spaCy model loaded successfully")
        except OSError:
            logger.warning("⚠ spaCy model 'en_core_web_sm' not found")
            logger.warning("To install the model manually, run:")
            logger.warning("  python -m spacy download en_core_web_sm")
            logger.warning("Continuing without spaCy NER features (basic extraction will still work)")
            self.nlp = None
        
        # Common technical skills database
        self.technical_skills = {
            # Programming Languages
            "python", "javascript", "java", "c++", "c#", "ruby", "go", "rust",
            "typescript", "kotlin", "swift", "php", "perl", "scala", "r", "matlab",
            "groovy", "dart", "elixir", "haskell", "clojure", "lua", "sh", "bash",
            
            # Web Development
            "react", "reactjs", "react native", "vue", "angular", "svelte", "nextjs", "gatsby", "webpack",
            "html", "css", "sass", "tailwind", "bootstrap", "jquery", "express",
            "nodejs", "nestjs", "fastapi", "django", "flask", "spring", "asp.net",
            "redux", "firebase", "flutter", "expo", "cloudinary", "postman", "multer", "android studio",
            
            # Databases
            "mongodb", "mysql", "postgresql", "postgres", "sqlite", "redis", "elasticsearch",
            "cassandra", "dynamodb", "firestore", "oracle", "sql", "sql server",
            
            # Cloud & DevOps
            "aws", "azure", "gcp", "google cloud", "docker", "kubernetes",
            "terraform", "jenkins", "gitlab", "github", "circleci", "heroku",
            
            # Data & AI
            "tensorflow", "pytorch", "scikit-learn", "pandas", "numpy", "spark",
            "hadoop", "kafka", "airflow", "nlp", "machine learning", "deep learning",
            
            # Tools & Other
            "git", "jira", "slack", "figma", "photoshop", "illustrator", "blender",
        }
        
        # Soft skills
        self.soft_skills = {
            "leadership", "communication", "teamwork", "problem solving",
            "project management", "critical thinking", "creativity", "time management",
            "adaptability", "collaboration", "presentation", "negotiation",
        }
        
        # Degree keywords
        self.degree_keywords = {
            "bachelor", "b.s.", "b.a.", "b.sc.", "b.tech.",
            "master", "m.s.", "m.a.", "m.sc.", "m.tech.", "mba",
            "doctorate", "phd", "ph.d.", "diploma",
        }
    
    def _normalize_skill_name(self, skill_name: str) -> str:
        """Normalize skill text for matching and deduplication."""
        normalized = re.sub(r"[^a-z0-9]+", "", skill_name.lower())
        return normalized

    # Section headings recognised by the splitter (SDS Algorithm 1).
    SECTION_HEADERS = [
        "professional summary", "summary", "objective", "profile",
        "education", "educational background", "academic background", "academic qualifications", "qualifications",
        "skills", "technical skills", "core skills",
        "projects", "personal projects", "academic projects", "key projects", "side projects", "project experience",
        "experience", "work experience", "professional experience", "employment", "employment history", "work history",
        "certifications", "certificates", "certification", "licenses & certifications", "licences & certifications",
        "licenses and certifications", "licenses", "licences", "courses & certifications", "courses and certifications",
        "achievements & certifications", "achievements and certifications", "awards & certifications",
        "awards", "achievements", "courses", "contact", "references", "languages", "interests", "hobbies",
    ]
    CERTIFICATION_HEADERS = [
        "certifications", "certificates", "certification", "licenses & certifications", "licences & certifications",
        "licenses and certifications", "licenses", "licences", "courses & certifications", "courses and certifications",
        "achievements & certifications", "achievements and certifications", "awards & certifications",
    ]

    def _split_sections(self, text: str) -> Dict[str, str]:
        """Split resume text into named sections using common headings."""
        headers = sorted(self.SECTION_HEADERS, key=len, reverse=True)
        header_regex = re.compile(
            r"^\s*(?P<header>" + "|".join(re.escape(h) for h in headers) + r")\s*(?:[:\-\–]|$)",
            flags=re.IGNORECASE | re.MULTILINE,
        )
        matches = [match for match in header_regex.finditer(text)]
        sections = {}
        for index, match in enumerate(matches):
            header = re.sub(r"\s+", " ", match.group("header").strip().lower())
            start = match.end()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            section_text = text[start:end].strip()
            if section_text:
                sections[header] = (sections[header] + "\n" + section_text) if header in sections else section_text
        return sections

    def _get_section(self, text: str, keywords: List[str]) -> Optional[str]:
        """First section whose heading equals one of `keywords` (in order)."""
        sections = self._split_sections(text)
        for keyword in keywords:
            if keyword in sections:
                return sections[keyword]
        return None

    def _first_org(self, text: str) -> Optional[str]:
        """spaCy ORG entity, used when no company/institution was found by pattern."""
        if not self.nlp or not text:
            return None
        for ent in self.nlp(text).ents:
            if ent.label_ == "ORG":
                return ent.text.strip()
        return None

    def extract_skills(self, text: str, confidence_threshold: float = 0.7) -> List[Dict]:
        """
        Extract skills from text
        Returns list of skills with confidence scores
        """
        skills = []
        normalized_known = {
            self._normalize_skill_name(skill): skill
            for skill in self.technical_skills | self.soft_skills
        }

        skills_section = self._get_section(text, ["skills", "technical skills"])
        if skills_section:
            # Fix missing spaces between camel case/adjacent terms from PDF extraction.
            # Known skills written in camel case ("JavaScript", "ReactNative")
            # become their canonical phrase; otherwise "Java Script" would also
            # match "Java". Other glued words are split ("PythonDjango").
            skills_section = re.sub(
                r"[A-Za-z0-9.#+]+",
                lambda m: normalized_known.get(
                    self._normalize_skill_name(m.group(0)),
                    re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", m.group(0)),
                ),
                skills_section,
            )
            search_section = re.sub(r"[^a-z0-9]+", " ", skills_section.lower())

            for skill_name in sorted(normalized_known.values(), key=len, reverse=True):
                phrase = re.sub(r"[^a-z0-9]+", " ", skill_name.lower()).strip()
                if phrase and re.search(r"\b" + re.escape(phrase) + r"\b", search_section):
                    skills.append({
                        "name": skill_name.title().replace("Js", "JS").replace("Sql", "SQL"),
                        "confidence": 0.95 if skill_name in self.technical_skills else 0.85
                    })

            # Also preserve broader descriptive skills if they appear in the skills section.
            for phrase in [
                "mobile development", "web development", "backend", "frontend",
                "data analysis", "software development", "cloud computing"
            ]:
                if re.search(r"\b" + re.escape(phrase) + r"\b", search_section, flags=re.IGNORECASE):
                    skills.append({
                        "name": phrase.title(),
                        "confidence": 0.75
                    })
        else:
            search_text = re.sub(r"[^a-z0-9]+", " ", text.lower())
            for skill_name in sorted(normalized_known.values(), key=len, reverse=True):
                phrase = re.sub(r"[^a-z0-9]+", " ", skill_name.lower()).strip()
                if phrase and re.search(r"\b" + re.escape(phrase) + r"\b", search_text):
                    skills.append({
                        "name": skill_name.title().replace("Js", "JS").replace("Sql", "SQL"),
                        "confidence": 0.95 if skill_name in self.technical_skills else 0.85
                    })

        # Deduplicate and sort by confidence
        unique_skills = {}
        for skill in skills:
            key = skill["name"].lower()
            if key not in unique_skills or skill["confidence"] > unique_skills[key]["confidence"]:
                unique_skills[key] = skill

        final_skills = list(unique_skills.values())
        final_skills.sort(key=lambda x: x["confidence"], reverse=True)
        return [{"name": s["name"], "confidence": s["confidence"]} for s in final_skills]

    def extract_education(self, text: str) -> List[Dict]:
        """Education entries with degree, field, institution, dates (Stage 4)."""
        section = self._get_section(
            text, ["education", "educational background", "academic background", "academic qualifications", "qualifications"]
        )
        if not section:
            # No heading: only lines that name a degree (keeps precision).
            section = "\n".join(l for l in text.splitlines() if entries.has_degree(l) and len(l) <= 200)
        return entries.extract_education(section, self._first_org) if section else []

    def extract_experience(self, text: str) -> List[Dict]:
        """Experience entries with title, company, dates, description (Stage 4)."""
        section = self._get_section(
            text,
            ["work experience", "professional experience", "experience", "employment history", "employment", "work history"],
        )
        return entries.extract_experience(section, self._first_org) if section else []

    def extract_certifications(self, text: str) -> List[Dict]:
        """Certifications with name, issuer, date (FR4.6)."""
        return certifications.extract_certifications(self._get_section(text, self.CERTIFICATION_HEADERS), text)

    def extract_projects(self, text: str) -> List[Dict]:
        """Projects (Algorithm 3): name, description, technologies, links."""
        section = self._get_section(
            text,
            ["projects", "personal projects", "academic projects", "key projects", "side projects", "project experience"],
        )
        return projects.extract_projects(section, self._extract_technologies_from_text)

    def _extract_technologies_from_text(self, text: str) -> List[str]:
        found: set = set()
        search = re.sub(r'[^a-z0-9]+', ' ', text.lower())
        for skill in self.technical_skills:
            phrase = re.sub(r'[^a-z0-9]+', ' ', skill.lower()).strip()
            if phrase and re.search(r'\b' + re.escape(phrase) + r'\b', search):
                found.add(
                    skill.title()
                    .replace('Js', 'JS')
                    .replace('Sql', 'SQL')
                    .replace('Css', 'CSS')
                    .replace('Html', 'HTML')
                )
        return sorted(found)


# Global extractor instance
_extractor = None


def get_nlp_extractor() -> NLPExtractor:
    """Get or create NLP extractor instance"""
    global _extractor
    if _extractor is None:
        _extractor = NLPExtractor()
    return _extractor
