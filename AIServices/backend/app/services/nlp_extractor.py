"""
NLP Text Extraction and Entity Recognition
Using spaCy and NLTK for NLP processing
"""

import re
import spacy
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

    def _split_sections(self, text: str) -> Dict[str, str]:
        """Split resume text into named sections using common headings."""
        headers = [
            "professional summary", "summary", "objective", "profile",
            "education", "educational background", "academic background",
            "skills", "technical skills", "projects", "personal projects", "academic projects", "side projects", "project experience",
            "experience", "work experience", "professional experience", "employment",
            "certifications", "awards", "contact"
        ]
        header_regex = re.compile(
            r"^(?P<header>" + "|".join(re.escape(h) for h in headers) + r")\s*(?:[:\-\–]|$)",
            flags=re.IGNORECASE | re.MULTILINE,
        )
        matches = [match for match in header_regex.finditer(text)]
        sections = {}
        for index, match in enumerate(matches):
            header = match.group("header").strip().lower()
            start = match.end()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            section_text = text[start:end].strip()
            if section_text:
                sections[header] = section_text
        return sections

    def _get_section(self, text: str, keywords: List[str]) -> Optional[str]:
        sections = self._split_sections(text)
        for keyword in keywords:
            for header, section_text in sections.items():
                if keyword in header:
                    return section_text
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
            skills_section = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", skills_section)
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
        """
        Extract education information from text
        Returns list of education entries
        """
        education = []
        education_section = self._get_section(text, ["education", "educational background", "academic background"])

        if not education_section:
            # Fallback only when no explicit education section exists
            if any(keyword in text.lower() for keyword in ["bachelor", "master", "phd", "degree", "university", "college"]):
                education_section = text
            else:
                return []

        # Split by obvious delimiters and retain candidate education entries.
        entries = re.split(r"\n|\b(?:education|skills|projects|experience|employment|certifications|awards|contact)\b", education_section, flags=re.IGNORECASE)
        for entry in entries:
            entry_text = entry.strip(" .,-\t")
            if len(entry_text) < 10:
                continue

            has_degree = any(
                re.search(r"\b" + re.escape(keyword) + r"\b", entry_text, flags=re.IGNORECASE)
                for keyword in self.degree_keywords
            )
            if not has_degree:
                continue

            degree = self._extract_degree(entry_text)
            institution = self._extract_institution(entry_text)
            year = self._extract_year(entry_text)
            if degree or institution:
                education.append({
                    "degree": degree or "Unknown Degree",
                    "institution": institution or "Unknown Institution",
                    "year": year,
                    "confidence": 0.85 if (degree and institution) else 0.65
                })

        unique_edu = {
            (e["degree"].lower(), e["institution"].lower()): e
            for e in education
        }
        return list(unique_edu.values())

    def extract_experience(self, text: str) -> List[Dict]:
        """
        Extract work experience from text
        Returns list of experience entries
        """
        experience = []
        experience_section = self._get_section(text, ["experience", "work experience", "professional experience", "employment"])

        if not experience_section:
            return []

        lines = [line.strip() for line in re.split(r"\n|\r", experience_section) if line.strip()]
        current_entry = {}

        for line in lines:
            title = self._extract_job_title(line)
            company = self._extract_company(line)
            duration = self._extract_duration(line)

            if title and current_entry and ("title" in current_entry or "company" in current_entry):
                experience.append(current_entry)
                current_entry = {}

            if title:
                current_entry["title"] = title
                current_entry["confidence"] = 0.8
            if company and not current_entry.get("company"):
                current_entry["company"] = company
            if duration:
                current_entry["duration"] = duration

        if current_entry and ("title" in current_entry or "company" in current_entry):
            experience.append(current_entry)

        unique_exp = {}
        for exp in experience:
            key = (exp.get("title", "").lower(), exp.get("company", "").lower())
            if key not in unique_exp:
                unique_exp[key] = exp

        return list(unique_exp.values())
    
    def _extract_degree(self, text: str) -> Optional[str]:
        """Extract degree from text"""
        # Look for common degree patterns
        patterns = [
            r"(?i)(bachelor(?:'s)?|b\.?s\.?|b\.?a\.?|b\.?sc\.?|b\.?tech\.?|bachelor of science|bachelor of arts).*?(?:in|of)?\s+([^\n,]+)",
            r"(?i)(master(?:'s)?|m\.?s\.?|m\.?a\.?|m\.?sc\.?|m\.?tech\.?|mba).*?(?:in|of)?\s+([^\n,]+)",
            r"(?i)(doctorate|phd|ph\.?d\.?).*?(?:in|of)?\s+([^\n,]+)",
        ]

        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                return match.group(0).strip()

        # Return first line if it contains degree keyword
        for keyword in self.degree_keywords:
            if keyword in text.lower():
                return text.split(",")[0].strip()

        return None

    def _extract_institution(self, text: str) -> Optional[str]:
        """Extract institution from text"""
        university_patterns = [
            r"(?i)(?:[A-Z][A-Za-z&'.]+(?:\s+[A-Z][A-Za-z&'.]+)*)\s+(?:University|College|Institute|School|Academy|Center|Centre)(?:\s+[A-Z][A-Za-z&'.]+)*",
            r"(?i)(?:University|College|Institute|School|Academy|Center|Centre)[^,\n]*",
        ]

        for pattern in university_patterns:
            match = re.search(pattern, text)
            if match:
                return match.group(0).strip().rstrip(',')

        if self.nlp:
            doc = self.nlp(text)
            for ent in doc.ents:
                if ent.label_ == "ORG":
                    return ent.text.strip()

        return None

    def _extract_year(self, text: str) -> Optional[str]:
        """Extract year from text"""
        year_pattern = r"(?:19|20)\d{2}"
        matches = re.findall(year_pattern, text)

        if matches:
            if len(matches) >= 2:
                return f"{matches[0]} - {matches[-1]}"
            elif len(matches) == 1:
                return matches[0]

        return None
    
    def _extract_job_title(self, text: str) -> Optional[str]:
        """Extract job title from text"""
        job_title_patterns = [
            r"(?i)(manager|director|engineer|analyst|developer|architect|specialist|consultant|coordinator|officer|executive|administrator)",
        ]
        
        for pattern in job_title_patterns:
            match = re.search(pattern, text)
            if match:
                # Get the full title containing the pattern
                words = text.split()
                for i, word in enumerate(words):
                    if re.search(pattern, word, re.IGNORECASE):
                        # Return context around the job title
                        start = max(0, i - 2)
                        end = min(len(words), i + 3)
                        return " ".join(words[start:end]).strip()
        
        return None
    
    def _extract_company(self, text: str) -> Optional[str]:
        """Extract company name from text"""
        if not self.nlp:
            return None
        
        doc = self.nlp(text)
        
        for ent in doc.ents:
            if ent.label_ == "ORG":
                return ent.text.strip()
        
        return None
    
    def _extract_duration(self, text: str) -> Optional[str]:
        """Extract job duration from text"""
        # Look for date patterns like "Jan 2020 - Dec 2023" or "2020-2023"
        date_patterns = [
            r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\.?\s*\d{1,4}\s*-\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\.?\s*\d{1,4})",
            r"(\d{1,2}/\d{1,2}/\d{4}\s*-\s*\d{1,2}/\d{1,2}/\d{4})",
            r"(\d{4}\s*-\s*\d{4})",
        ]
        
        for pattern in date_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(0).strip()
        
        return None

    # ── Project extraction (Task 2 extension) ─────────────────────────────────

    def extract_projects(self, text: str) -> List[Dict]:
        """
        Extract projects from CV text.
        Returns a list of {name, description, technologies}.
        Existing skill/education/experience logic is untouched.
        """
        projects: List[Dict] = []

        section = self._get_section(
            text,
            ["projects", "personal projects", "academic projects",
             "side projects", "project experience"]
        )
        if not section:
            return projects

        lines = [l.strip() for l in section.split('\n') if l.strip()]

        current_name: Optional[str] = None
        desc_lines:   List[str]     = []

        CONTINUATION_PREFIXES = re.compile(
            r'^(using|with|developed|built|created|technologies|tech stack|tools|'
            r'responsibilities|description|role|•|-|·|\*|\d+\.)',
            re.IGNORECASE,
        )

        def flush():
            if current_name:
                desc = ' '.join(desc_lines).strip()
                techs = self._extract_technologies_from_text(current_name + ' ' + desc)
                projects.append({
                    'name':         current_name.strip(),
                    'description':  desc,
                    'technologies': techs,
                })

        for line in lines:
            line = re.sub(r'^[\-\*\u2022\u2023\u25E6\u2043\u2219\d\.\)\s]+', '', line)
            is_name_candidate = (
                len(line) < 100
                and not CONTINUATION_PREFIXES.match(line)
                and len(line.split()) >= 2
                and not re.match(r'^\d{4}', line)   # not a year line
            )

            if is_name_candidate and current_name is None:
                current_name = line
            elif is_name_candidate and len(desc_lines) >= 1:
                flush()
                current_name = line
                desc_lines   = []
            else:
                if current_name is not None:
                    desc_lines.append(line)

        flush()
        return projects[:10]

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
