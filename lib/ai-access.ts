import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from './api';

// Cleanup only for older app installs. AI setup now uses the wallet session;
// no development token is read, written, or required by the app.
const key = `mandate.ai-access.${API_BASE_URL.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
export const clearAIAccess = () => SecureStore.deleteItemAsync(key);
