import axios from 'axios';

// Internal client for AIServices. CoreServices never touches AI collections
// directly; it asks AIServices over HTTP and degrades gracefully if it is down.
const client = axios.create({ timeout: 5000 });

// Latest parsed CV for a user, shaped as { parsed_data, parsing_status, upload_date },
// or null when there is none or AIServices is unavailable.
export const getLatestParsedCv = async (userId) => {
  const baseURL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
  try {
    const { data } = await client.get(
      `${baseURL}/internal/cv/${encodeURIComponent(userId)}/latest`,
      { headers: { 'X-Internal-Key': process.env.INTERNAL_API_KEY || '' } },
    );
    return data?.cv || null;
  } catch (error) {
    if (error.response?.status === 404) return null;
    console.warn(
      `AIServices unavailable for latest CV (user ${userId}): ${error.response?.status || error.code || error.message}`,
    );
    return null;
  }
};
