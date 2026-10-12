// The frontend talks ONLY to the API Gateway; services are never called directly.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
