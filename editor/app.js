const params = new URLSearchParams(location.search);
const token = params.get('token');
const source = document.querySelector('#source');
const issues = document.querySelector('#issues');
const state = document.querySelector('#state');
const fileName = document.querySelector('#file-name');
const validateButton = document.querySelector('#validate');
const formatButton = document.querySelector('#format');
const saveButton = document.querySelector('#save');
let dirty = false;

await load();

source.addEventListener('input', () => {
  dirty = true;
  setState('Unsaved changes', 'warn');
});

validateButton.addEventListener('click', () => runValidation(false));
formatButton.addEventListener('click', async () => {
  const result = await runValidation(false);
  if (result?.formatted) {
    source.value = result.formatted;
    dirty = true;
    setState('Formatted, not saved', 'warn');
  }
});
saveButton.addEventListener('click', save);
window.addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault();
});

async function load() {
  try {
    const response = await fetch(`/api/document?token=${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to load');
    fileName.textContent = data.fileName;
    source.value = data.source;
    dirty = false;
    renderIssues(data.warnings || []);
    setState(data.recoveredFrom ? 'Recovered from backup' : 'Ready', data.recoveredFrom ? 'warn' : 'ok');
  } catch (error) {
    renderError(error);
  }
}

async function runValidation(showSuccess = true) {
  setState('Validating…');
  try {
    const response = await fetch(`/api/validate?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: source.value }),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'Validation failed'), { issues: data.issues });
    renderIssues(data.issues || []);
    const errors = (data.issues || []).filter((item) => item.severity === 'error');
    setState(errors.length ? `${errors.length} error(s)` : showSuccess ? 'Valid' : 'Ready', errors.length ? 'bad' : 'ok');
    return data;
  } catch (error) {
    renderError(error);
    return null;
  }
}

async function save() {
  setState('Saving…');
  try {
    const response = await fetch(`/api/save?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: source.value }),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'Save failed'), { issues: data.issues });
    source.value = data.source;
    dirty = false;
    renderIssues(data.issues || []);
    setState('Saved', 'ok');
  } catch (error) {
    renderError(error);
  }
}

function renderIssues(list) {
  if (!list.length) {
    issues.innerHTML = '<p class="success">No issues found.</p>';
    return;
  }
  issues.replaceChildren(...list.map((item) => {
    const box = document.createElement('article');
    box.className = `issue ${item.severity}`;
    const title = document.createElement('strong');
    title.textContent = `${item.code} · ${item.severity}`;
    const path = document.createElement('code');
    path.textContent = item.path;
    const message = document.createElement('p');
    message.textContent = item.message;
    box.append(title, path, message);
    return box;
  }));
}

function renderError(error) {
  renderIssues(error.issues || [{ code: 'EDITOR', severity: 'error', path: '$', message: error.message }]);
  setState('Error', 'bad');
}

function setState(text, style = '') {
  state.textContent = text;
  state.className = `state ${style}`;
}
