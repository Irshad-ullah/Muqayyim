"""
Data minimisation for LLM requests (12). Nothing that identifies or contacts the user leaves the
service: no name, email, phone, address, links (LinkedIn / GitHub / portfolio / any URL) or photo.

Three layers, applied to every data block by the prompt builder (features also send only the text
fields their action needs):
  1. by field name — whole personal / contact objects and keys such as fullName / email / phone /
     address / linkedin / github / url / photo are dropped at any depth. A plain "name" key is NOT
     blocked: it is how projects and skills are named;
  2. by pattern — e-mail addresses, URLs (incl. bare www. / linkedin.com/… / github.com/…) and
     phone numbers are replaced inside any remaining text;
  3. by value — `redact` terms (the user's own name, passed by the caller and never sent on) are
     replaced inside any remaining text.
"""

import re
from typing import Any, Sequence

BLOCKED_KEYS = {
    "personal", "contact", "contacts", "personalinfo", "personal_info",
    "fullname", "full_name", "firstname", "first_name", "lastname", "last_name", "username", "displayname",
    "email", "mail", "phone", "mobile", "telephone", "tel", "address", "street", "city", "postcode", "zip",
    "location", "links", "link", "url", "urls", "website", "portfolio", "linkedin", "github", "githuburl",
    "github_url", "githubusername", "twitter", "photo", "picture", "avatar", "image", "liveurl", "live_url",
}

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# Full URLs in any case; bare domains only in lower case with common endings, so tech names such as
# ASP.NET, Node.js or socket.io are not mistaken for links.
URL = re.compile(r"(?i:https?://|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|pk|uk|edu)\b(?:/\S*)?")
# A run of digits with separators; it counts as a phone number only with >= 10 digits (so date
# ranges such as 2019-2023 are kept).
PHONE_CANDIDATE = re.compile(r"(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)")


def _key(name: str) -> str:
    return re.sub(r"[^a-z]", "", str(name).lower()) if name else ""


_BLOCKED = {_key(b) for b in BLOCKED_KEYS}


def scrub_text(text: str, redact: Sequence[str] = ()) -> str:
    text = EMAIL.sub("[email removed]", text)
    text = URL.sub("[link removed]", text)
    text = PHONE_CANDIDATE.sub(
        lambda m: "[phone removed]" if sum(c.isdigit() for c in m.group()) >= 10 else m.group(), text)
    for term in sorted({t.strip() for t in redact if t and len(t.strip()) >= 2}, key=len, reverse=True):
        text = re.sub(rf"(?<!\w){re.escape(term)}(?!\w)", "[name removed]", text, flags=re.I)
    return text


def minimise(value: Any, redact: Sequence[str] = ()) -> Any:
    """A copy of `value` without contact fields and with contact details (and `redact` terms)
    scrubbed from text."""
    if isinstance(value, dict):
        return {k: minimise(v, redact) for k, v in value.items() if _key(k) not in _BLOCKED}
    if isinstance(value, (list, tuple)):
        return [minimise(v, redact) for v in value]
    if isinstance(value, str):
        return scrub_text(value, redact)
    return value
