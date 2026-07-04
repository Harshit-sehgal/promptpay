import axios from 'axios';

/**
 * Axios instance for same-origin API calls via Next.js Route Handlers.
 *
 * The browser calls `/api/...` endpoints (same origin). The catch-all proxy
 * at `app/api/[...proxy]/route.ts` forwards requests to the upstream
 * NestJS API, carrying the httpOnly `access_token` cookie in a Bearer
 * Authorization header. Auth-only routes (`/api/auth/login`, etc.) are
 * explicit Route Handlers that set/clear httpOnly cookies and strip tokens
 * from response bodies.
 *
 * `withCredentials: true` ensures the httpOnly cookies are sent on every
 * request (SameSite=Lax, same-origin — no cross-origin transport issue).
 */
const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// ── Token refresh interceptor ──
// If a 401 is received, call the same-origin `/api/auth/refresh` Route
// Handler. The handler reads the httpOnly `refresh_token` cookie server-side,
// calls the upstream API, and sets new httpOnly `access_token` +
// `refresh_token` cookies. The interceptor then retries the original request.
// No tokens in localStorage — XSS can't steal them.
let isRefreshing = false;
let pendingRequests: Array<{
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}> = [];

function onRefreshed() {
  pendingRequests.forEach(({ resolve }) => resolve(undefined));
  pendingRequests = [];
}

function onRefreshFailed(err: unknown) {
  pendingRequests.forEach(({ reject }) => reject(err));
  pendingRequests = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Skip if not a 401 or already retried
    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Don't try to refresh auth endpoints themselves
    if (
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/signup') ||
      originalRequest.url?.includes('/auth/google') ||
      originalRequest.url?.includes('/auth/refresh')
    ) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      // Another request is already refreshing — queue this one
      return new Promise((resolve, reject) => {
        pendingRequests.push({ resolve, reject });
      }).then(() => {
        // The cookies are already rotated server-side; just retry
        return api(originalRequest);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      // Call same-origin Route Handler — the proxy injects the refresh token
      // from the httpOnly cookie automatically
      await api.post('/auth/refresh');
      onRefreshed();
      return api(originalRequest);
    } catch (refreshErr) {
      onRefreshFailed(refreshErr);
      // Refresh failed — the Route Handler cleared auth cookies already;
      // just reject so callers can redirect to login.
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  },
);

export default api;