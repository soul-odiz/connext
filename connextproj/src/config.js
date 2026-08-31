// Central API configuration
// In production, REACT_APP_API_BASE_URL is set at build time via CI/CD or .env
// In development, it defaults to localhost:5000
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '';

export default API_BASE_URL;