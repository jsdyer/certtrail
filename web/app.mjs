import {download, element, external, fetchJSON, get, initTheme, setStatus} from './common.mjs';
import {MAX_BYTES, SOURCE, nameCounts, parseDomain, queryURL, summarize, toCSV, validity, yearCounts} from './model.mjs';

initTheme();
const PAGE = 40;
let session;
let controller;
let certLimit = PAGE, nameLimit = PAGE;
let shown = [];

function rowMessage(span, message) {
  const row = element('tr');
  const cell = element('td', message, 'muted');
  cell.colSpan = span;
  row.append(cell);
  return row;
}

function certificateRow(cert) {
  const row = element('tr');
  const issuer = element('td');
  if (cert.id) issuer.append(external(`#${cert.id}`, `${SOURCE}?id=${cert.id}`));
  issuer.append(element('small', cert.issuer || 'Issuer not supplied'));
  if (cert.seen) issuer.append(element('small', `Log entry ${cert.seen.slice(0,10)}`));
  const names = element('td', cert.names.join(', '));
  const dates = element('td', undefined, 'certificate-dates');
  dates.append(element('span', cert.notBefore?.slice(0,10) ?? 'Unknown'), element('small', `to ${cert.notAfter?.slice(0,10) ?? 'unknown'}`));
  row.append(issuer,names,dates);
  return row;
}

function render() {
  if (!session) return;
  const filter = get('filter').value.trim().toLowerCase();
  const state = get('validity').value, year = get('year').value;
  const now = new Date().toISOString();
  shown = session.records.filter(cert => (!state || validity(cert, now) === state)
    && (!year || cert.notBefore?.startsWith(year))
    && (!filter || [cert.issuer, cert.serial, ...cert.names].join(' ').toLowerCase().includes(filter)));
  get('records').replaceChildren(...(shown.length ? shown.slice(0,certLimit).map(certificateRow) : [
    rowMessage(3, 'No certificates match the current filters.'),
  ]));
  get('cert-detail').textContent = `${Math.min(certLimit,shown.length).toLocaleString()} shown of ${shown.length.toLocaleString()} matches`;
  get('more-certs').hidden = shown.length <= certLimit;
  get('export').disabled = !shown.length;
  const names = nameCounts(shown);
  const rows = names.slice(0,nameLimit).map(([name,count]) => {
    const row = element('tr'), cell = element('td');
    cell.append(element('code', name));
    row.append(cell,element('td', String(count)));
    return row;
  });
  get('names').replaceChildren(...(rows.length ? rows : [rowMessage(2,'No matching names.')]));
  get('more-names').hidden = names.length <= nameLimit;
}

function display(payload, domain, label, sourceURL) {
  const records = summarize(payload, domain);
  session = {records, domain};
  get('result-title').textContent = domain;
  get('provenance').textContent = label;
  get('raw').hidden = !sourceURL;
  if (sourceURL) get('raw').href = sourceURL;
  get('source-count').textContent = payload.length.toLocaleString();
  get('cert-count').textContent = records.length.toLocaleString();
  get('name-count').textContent = nameCounts(records).length.toLocaleString();
  get('issuer-count').textContent = new Set(records.map(record => record.issuer).filter(Boolean)).size.toLocaleString();
  get('filter').value = '';
  get('validity').value = '';
  const years = yearCounts(records);
  const yearSelect = get('year');
  yearSelect.replaceChildren(new Option('All years',''),...years.map(([year]) => new Option(year,year)));
  const max = Math.max(...years.map(([, count]) => count), 1);
  get('years').replaceChildren(...(years.length ? years.map(([year,count]) => {
    const row = element('li'), button = element('button', year);
    button.type = 'button';
    button.setAttribute('aria-label', `Filter certificates starting in ${year}`);
    button.addEventListener('click', () => {yearSelect.value = year; applyFilters();});
    const marker = element('progress');
    marker.max = max; marker.value = count;
    marker.setAttribute('aria-label', `${year}: ${count} certificates`);
    row.append(button,marker,element('span',String(count)));
    return row;
  }) : [element('li','No known validity start dates.','muted')]));
  get('report').hidden = false;
  applyFilters();
  setStatus(records.length ? 'Certificate history loaded.' : 'No records in this response match the selected domain.');
}

function applyFilters() {
  certLimit = nameLimit = PAGE;
  render();
}

function begin() {
  controller?.abort();
  const current = controller = new AbortController();
  get('submit').disabled = true;
  get('report').hidden = true;
  session = null; shown = [];
  return current;
}

function domainValue() {
  const domain = parseDomain(get('domain').value);
  if (!domain) {
    setStatus('Enter a hostname without a URL, wildcard, port or path.', true);
    return null;
  }
  get('domain').value = domain;
  get('original').href = queryURL(domain, false);
  return domain;
}

async function search() {
  const domain = domainValue();
  if (!domain) return;
  const current = begin();
  const endpoint = queryURL(domain);
  setStatus(`Searching crt.sh for ${domain}…`);
  try {
    const data = await fetchJSON(endpoint,{timeout:24000,maxBytes:MAX_BYTES,signal:current.signal});
    if (!current.signal.aborted) display(data,domain,`crt.sh · Retrieved ${new Date().toLocaleString()}`,endpoint);
  } catch(error) {
    if (current.signal.aborted) return;
    const reason = error.name === 'TimeoutError' || error instanceof TypeError ? 'crt.sh did not respond in time.' : error.message;
    setStatus(`${reason} Try a narrower domain, open crt.sh, or import its JSON.`,true);
  } finally {
    if (!current.signal.aborted) get('submit').disabled = false;
  }
}

get('lookup').addEventListener('submit', event => {event.preventDefault(); search();});
get('example').addEventListener('click', () => {get('domain').value = 'coolcode.ca'; search();});
get('import').addEventListener('click', () => {if (domainValue()) get('file').click();});
get('file').addEventListener('change', async () => {
  const file = get('file').files[0];
  get('file').value = '';
  if (!file) return;
  const domain = domainValue();
  if (!domain) return;
  const current = begin();
  setStatus('Reading the local JSON file…');
  try {
    if (file.size > MAX_BYTES) throw new Error('This import exceeds the 8 MB size limit.');
    const text = await file.text();
    let data;
    try { data = JSON.parse(text.replace(/^\uFEFF/,'')); } catch { throw new Error('This file does not contain valid JSON.'); }
    if (!current.signal.aborted) display(data,domain,`Local file · ${file.name}`,null);
  } catch (error) {
    if (!current.signal.aborted) setStatus(error.message,true);
  } finally {
    if (!current.signal.aborted) get('submit').disabled = false;
  }
});
for (const [id,event] of [['filter','input'],['validity','change'],['year','change']]) get(id).addEventListener(event,applyFilters);
get('more-certs').addEventListener('click', () => {certLimit += PAGE; render();});
get('more-names').addEventListener('click', () => {nameLimit += PAGE; render();});
get('export').addEventListener('click', () => {
  if (session && shown.length) download(`certificate-trail-${session.domain}.csv`,toCSV(shown),'text/csv;charset=utf-8');
});
