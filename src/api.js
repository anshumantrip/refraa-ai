let csrfRequest;
function getCsrf() {
  csrfRequest ||= fetchCsrf().catch(error => { csrfRequest = undefined; throw error; });
  return csrfRequest;
}
async function fetchCsrf() {
  const response = await fetch('/api/auth/csrf');
  if (!response.ok) throw new Error('The service is unavailable. Please try again.');
  return (await response.json()).csrf;
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = await getCsrf();
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

export async function uploadFile(path, file, signal, onProgress) {
  const csrf = await getCsrf();
  if (signal.aborted) throw new Error('Upload cancelled.');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal.addEventListener('abort', abort, { once: true });
    xhr.onloadend = () => signal.removeEventListener('abort', abort);
    xhr.upload.onprogress = event => onProgress(Math.min(file.size, event.loaded));
    xhr.onerror = () => reject(new Error('Connection interrupted. Retry this file.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out. Retry this file.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.onload = () => {
      const data = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      if (data?.code === 'CSRF') csrfRequest = undefined;
      const error = new Error(data?.message || 'Upload failed. Retry this file.');
      error.code = data?.code;
      reject(error);
    };
    xhr.open('POST', '/api' + path);
    xhr.responseType = 'json';
    xhr.timeout = 115_000;
    xhr.setRequestHeader('X-CSRF-Token', csrf);
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
