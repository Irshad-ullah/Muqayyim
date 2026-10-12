// Copy of CoreServices/backend/validation/profileLimits.json (the source of
// truth). tests/profileLimits.parity.test.js fails if the two differ.
export const PROFILE_LIMITS = Object.freeze({
  "version": 1,
  "name": {
    "min": 2,
    "max": 100
  },
  "summaryMax": 500,
  "titleMax": 100,
  "orgMax": 150,
  "descriptionMax": 1000,
  "locationMax": 100,
  "gpaMax": 20,
  "urlMax": 300,
  "emailMax": 254,
  "skill": {
    "min": 1,
    "max": 50,
    "maxTotal": 100
  },
  "technologiesMax": 30,
  "phone": {
    "min": 7,
    "max": 20,
    "minDigits": 7,
    "pattern": "^[0-9+()\\- ]+$"
  },
  "githubUsername": {
    "min": 1,
    "max": 39,
    "pattern": "^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$"
  },
  "githubRepoUrlPattern": "^https://github\\.com/[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}/[A-Za-z0-9._-]{1,100}/?$",
  "httpUrlPattern": "^https?://[A-Za-z0-9.-]+\\.[A-Za-z]{2,}(?::\\d{1,5})?(?:[/?#]\\S*)?$",
  "maxEntries": {
    "experience": 30,
    "education": 15,
    "certifications": 30,
    "projects": 50,
    "githubRepos": 100
  },
  "dates": {
    "minYear": 1950,
    "educationEndFutureYears": 10,
    "presentWords": [
      "present",
      "current",
      "now",
      "ongoing"
    ]
  },
  "bodyMaxBytes": 1048576,
  "cv": {
    "titleMax": 100,
    "headlineMax": 100,
    "snapshotMaxBytes": 204800,
    "skillGroupsMax": 20,
    "skillCategoryMax": 50,
    "templates": [
      "classic",
      "modern",
      "compact"
    ],
    "accentColors": [
      "slate",
      "black",
      "navy",
      "teal",
      "burgundy"
    ],
    "legacyAccents": {
      "blue": "navy",
      "indigo": "navy",
      "green": "teal"
    },
    "fontFamilies": [
      "sans",
      "serif"
    ],
    "fontSizes": [
      "small",
      "medium",
      "large"
    ],
    "sectionKeys": [
      "summary",
      "skills",
      "experience",
      "projects",
      "education",
      "certifications"
    ]
  }
});

export default PROFILE_LIMITS;
