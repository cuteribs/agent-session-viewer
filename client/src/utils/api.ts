const API_BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || 'Request failed');
  }

  return response.json();
}

// Sessions API
export async function fetchSessions(source?: 'claude' | 'copilot' | 'all') {
  const query = source ? `?source=${source}` : '';
  return fetchJSON<import('shared/types').SessionSummary[]>(`/sessions${query}`);
}

export async function fetchSession(source: 'claude' | 'copilot', sessionId: string) {
  return fetchJSON<import('shared/types').SessionDetail>(`/sessions/${source}/${sessionId}`);
}

export async function fetchSessionMessages(
  source: 'claude' | 'copilot',
  sessionId: string,
  offset = 0,
  limit = 50
) {
  return fetchJSON<import('shared/types').Message[]>(
    `/sessions/${source}/${sessionId}/messages?offset=${offset}&limit=${limit}`
  );
}

export async function fetchSessionStats(source: 'claude' | 'copilot', sessionId: string) {
  return fetchJSON<import('shared/types').SessionStats>(`/sessions/${source}/${sessionId}/stats`);
}

// Config API
export async function fetchConfig() {
  return fetchJSON<import('shared/types').AppConfig>('/config');
}

export async function updateConfig(config: Partial<import('shared/types').AppConfig>) {
  return fetchJSON<import('shared/types').AppConfig>('/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function fetchPaths() {
  return fetchJSON<import('shared/types').PathsResponse>('/config/paths');
}

export async function scanPaths() {
  return fetchJSON<import('shared/types').PathsResponse>('/config/paths/scan', {
    method: 'POST',
  });
}

// Export API
export function getExportURL(
  source: 'claude' | 'copilot',
  sessionId: string,
  format: 'csv' | 'json' | 'summary'
) {
  return `${API_BASE}/export/${source}/${sessionId}?format=${format}`;
}

// Session deletion
export async function deleteSession(source: 'claude' | 'copilot', sessionId: string) {
  return fetchJSON<{ success: boolean; message: string }>(
    `/sessions/${source}/${sessionId}`,
    { method: 'DELETE' }
  );
}
