import axios from 'axios';
import API_BASE_URL from '../config';

const apiClient = axios.create({
  baseURL: API_BASE_URL
});

const login = async (username, password) => {
  return apiClient.post('/login', { username, password });
};

// Verify a Firebase ID token on the backend and get our app JWT + user.
const oauthLogin = async (idToken, provider) => {
  return apiClient.post('/oauth_login', { id_token: idToken, provider });
};

const register = async (formData) => {
  return apiClient.post('/register', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

const fetchMatches = async (token) => {
  try {
    const response = await apiClient.get('/match', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
  } catch (error) {
    handleError(error);
    throw error;
  }
};

// Backend endpoint is /start_phone_call and expects receiver_id (snake_case)
const initiatePhoneCall = async (receiverId, token) => {
  return apiClient.post('/start_phone_call', { receiver_id: receiverId }, {
    headers: { Authorization: `Bearer ${token}` }
  });
};

// partner_id is required by the backend /start_video_chat endpoint
const startVideoChat = async (partnerId, token) => {
  return apiClient.post('/start_video_chat', { partner_id: partnerId }, {
    headers: { Authorization: `Bearer ${token}` }
  });
};

const updateProfile = async (profileData, token) => {
  return apiClient.post('/update_profile', profileData, {
    headers: { Authorization: `Bearer ${token}` }
  });
};

// NOTE: The backend does not expose an /end_phone_call REST endpoint.
// Call termination is handled entirely via WebRTC / socket events.
// This stub is kept for API surface compatibility but will log a warning.
const endPhoneCall = async (callId, token) => {
  console.warn('endPhoneCall: no backend REST endpoint exists for ending a phone call. Use socket events instead.');
  return Promise.resolve({ data: { message: 'Call ended locally' } });
};

const sendMessage = async (messageData, token) => {
  return apiClient.post('/send_message', messageData, {
    headers: { Authorization: `Bearer ${token}` }
  });
};

// NOTE: The backend does not expose a /user/:id REST endpoint.
// Profile image URL can be fetched via /api/get_profile_image_url/:id instead.
const fetchUserProfile = async (userId, token) => {
  return apiClient.get(`/api/get_profile_image_url/${userId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
};

const getMessages = async (partnerId, token) => {
  return apiClient.get(`/get_messages?partner_id=${partnerId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
};

const uploadImage = async (formData, token) => {
  return apiClient.post('/upload_image', formData, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
  });
};

const getMatches = async (token) => {
  return apiClient.get('/get_matches', {
    headers: { Authorization: `Bearer ${token}` }
  });
};

const handleError = (error) => {
  if (error.response) {
    console.error("Error data:", error.response.data);
    console.error("Error status:", error.response.status);
  } else if (error.request) {
    console.error("Error: No response received");
  } else {
    console.error("Error message:", error.message);
  }
};

export const ApiService = {
  login,
  oauthLogin,
  register,
  fetchMatches,
  initiatePhoneCall,
  startVideoChat,
  updateProfile,
  endPhoneCall,
  sendMessage,
  fetchUserProfile,
  getMessages,
  uploadImage,
  getMatches
};
