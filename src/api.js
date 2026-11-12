let csrfRequest;
async function fetchCsrf() {
  const response = await fetch('/api/auth/csrf');
  if (!response.ok) throw new Error('The service is unavailable. Please try again.');
  return (await response.json()).csrf;
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    csrfRequest ||= fetchCsrf().catch(error => { csrfRequest = undefined; throw error; });
    headers['X-CSRF-Token'] = await csrfRequest;
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch('/api' + path, {
    method, headers, signal, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin'
  });
  if (response.status === 204) return;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (data.code === 'CSRF') csrfRequest = undefined;
    const error = new Error(data.message || 'The service is unavailable. Please try again.');
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}
