// Module 4 — AI writing assistance for CV text fields (NOT YET AVAILABLE).
//
// Planned flow once an LLM provider is configured:
//   React → API Gateway → AIServices (FastAPI) → LLM provider
// The API key will live only in AIServices; nothing here talks to an LLM.
//
// The AI must only reword facts the user already has in their CV. Anything it
// receives is built by `buildAssistFacts` from the user's own data, and the
// server-side prompt must forbid inventing companies, dates, technologies,
// metrics or achievements.

export const CV_ASSIST_AVAILABLE = false;

// target: { field: 'summary' } | { field: 'experience', id } | { field: 'projects', id }
export const buildAssistFacts = (target, data) => {
  const skills = (data.skills || []).flatMap((g) => g.items);
  if (target.field === 'summary') {
    return {
      headline: data.personal?.headline || '',
      currentSummary: data.summary || '',
      skills,
      experience: (data.experience || []).map(({ title, company, startDate, endDate, current }) => ({
        title, company, startDate, endDate, current,
      })),
      education: (data.education || []).map(({ degree, field, institution }) => ({ degree, field, institution })),
      projects: (data.projects || []).map(({ name, technologies }) => ({ name, technologies })),
    };
  }
  const item = (data[target.field] || []).find((x) => x.id === target.id);
  if (!item) return null;
  if (target.field === 'experience') {
    const { title, company, location, startDate, endDate, current, description } = item;
    return { title, company, location, startDate, endDate, current, currentDescription: description, skills };
  }
  if (target.field === 'projects') {
    const { name, technologies, url, description } = item;
    return { name, technologies, url, currentDescription: description };
  }
  return null;
};

// Placeholder: intentionally not implemented until the AIServices endpoint exists.
export const requestCvAssist = async () => {
  throw new Error('AI writing assistance is not available yet.');
};
