const GITHUB_API = "https://api.github.com";

const parseGitHubUsername = (input) => {
  if (!input) return "";
  const trimmed = input.trim();
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/\s]+)\/?.*$/i,
  );
  if (urlMatch) return urlMatch[1];
  return trimmed.replace(/^@/, "").trim();
};

export const fetchUserRepos = async (username) => {
  const normalizedUsername = parseGitHubUsername(username);
  if (!normalizedUsername) {
    throw new Error("GitHub username is required");
  }

  const headers = {
    Accept:
      "application/vnd.github.mercy-preview+json, application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(
    `${GITHUB_API}/users/${encodeURIComponent(normalizedUsername)}/repos?per_page=100&sort=updated`,
    { headers },
  );

  if (res.status === 404) throw new Error("GitHub user not found");
  if (res.status === 403)
    throw new Error("GitHub API rate limit exceeded. Try again later.");
  if (!res.ok) throw new Error("Failed to fetch GitHub repositories");

  const data = await res.json();
  return data.map((r) => ({
    repoId: r.id,
    name: r.name,
    description: r.description || "",
    url: r.html_url,
    language: r.language || null,
    topics: r.topics || [],
    stars: r.stargazers_count || 0,
    fork: r.fork,
    updatedAt: r.updated_at,
  }));
};

export const extractSkillsFromRepos = (repos) => {
  const skills = new Set();
  for (const repo of repos) {
    if (repo.language) skills.add(repo.language);
    repo.topics?.forEach((t) => skills.add(t));
  }
  return Array.from(skills).filter(Boolean).sort();
};
