export const SOURCE = 'https://crt.sh/';
export const MAX_BYTES = 8_000_000;
const MAX_RECORDS = 20000;

export function parseDomain(raw) {
  const input = String(raw ?? '').trim().replace(/\.$/, '');
  if (input.length < 3 || input.length > 253 || /[\s*%/#?@:()[\]\\]/.test(input)) return null;
  try {
    const name = new URL(`https://${input}/`).hostname;
    const labels = name.split('.');
    if (name.length > 253 || labels.length < 2 || !/^[a-z]/.test(labels.at(-1)) ||
        labels.some(label => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return null;
    return name;
  } catch { return null; }
}

export function queryURL(domain, json = true) {
  const url = new URL(SOURCE);
  url.searchParams.set('q', `%.${domain}`);
  if (json) url.searchParams.set('output', 'json');
  return url.href;
}

function certificateName(raw) {
  const name = String(raw ?? '').trim();
  const wildcard = name.startsWith('*.');
  const value = parseDomain(wildcard ? name.slice(2) : name);
  return value ? (wildcard ? `*.${value}` : value) : null;
}

function belongsTo(name, domain) {
  const base = name.replace(/^\*\./, '');
  return base === domain || base.endsWith(`.${domain}`);
}

function dateString(raw) {
  if (typeof raw !== 'string') return null;
  const datePart = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(raw)?.[0];
  if (!datePart) return null;
  const utc = /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(datePart) ? `${datePart}Z` : datePart;
  const value = new Date(utc);
  if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1800 || value.getUTCFullYear() > 9999) return null;
  return value.toISOString();
}

export function certID(raw) {
  const candidate = String(raw ?? '');
  return /^\d{1,20}$/.test(candidate) ? candidate : null;
}

export function summarize(payload, domain) {
  if (!Array.isArray(payload)) throw new Error('Expected a crt.sh JSON array.');
  if (payload.length > MAX_RECORDS) throw new Error(`This tool accepts up to ${MAX_RECORDS.toLocaleString()} source rows. Try a narrower subdomain.`);
  const merged = new Map();
  for (const [index, row] of payload.entries()) {
    if (!row || typeof row !== 'object') continue;
    const nameValue = typeof row.name_value === 'string' ? row.name_value.slice(0, 24000) : '';
    const candidates = [row.common_name, ...nameValue.split('\n')];
    const names = candidates.map(certificateName).filter(name => name && belongsTo(name, domain));
    if (!names.length) continue;
    const id = certID(row.id);
    const issuer = typeof row.issuer_name === 'string' ? row.issuer_name.trim().slice(0, 500) : '';
    const ca = certID(row.issuer_ca_id) ?? issuer;
    const sn = String(row.serial_number ?? '').trim().toLowerCase();
    const serial = /^[a-f\d]{1,160}$/.test(sn) ? sn : null;
    const key = ca && serial ? JSON.stringify([ca, serial]) : id ? `id-${id}` : `row-${index}`;
    const seen = dateString(row.entry_timestamp);
    if (!merged.has(key)) {
      merged.set(key, {id, issuer, serial, names: new Set(), seen, notBefore: dateString(row.not_before), notAfter: dateString(row.not_after)});
    }
    const cert = merged.get(key);
    if (!cert.id && id) cert.id = id;
    if (seen && (!cert.seen || seen < cert.seen)) cert.seen = seen;
    names.forEach(name => cert.names.add(name));
  }
  return [...merged.values()].map(cert => ({...cert, names: [...cert.names].sort()}))
    .sort((a,b) => (b.notBefore ?? '').localeCompare(a.notBefore ?? ''));
}

export function validity(cert, now = new Date().toISOString()) {
  if (!cert.notBefore || !cert.notAfter) return 'unknown';
  if (now < cert.notBefore) return 'future';
  if (now > cert.notAfter) return 'expired';
  return 'valid';
}

export function nameCounts(records) {
  const counts = new Map();
  for (const {names} of records) {
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a,an],[b,bn]) => bn - an || a.localeCompare(b));
}

export function yearCounts(records) {
  const counts = new Map();
  for (const {notBefore} of records) {
    if (!notBefore) continue;
    const year = notBefore.slice(0,4);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a],[b]) => b.localeCompare(a));
}

export function toCSV(records) {
  const csv = value => {
    let text = String(value ?? '');
    if (/^\s*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"','""')}"`;
  };
  const rows = records.map(cert => [cert.id,cert.issuer,cert.serial,cert.names.join(' '),cert.notBefore,cert.notAfter,
    cert.seen, cert.id ? `${SOURCE}?id=${cert.id}` : '']);
  return ['crt_sh_id,issuer,serial,in_scope_names,valid_from_utc,valid_until_utc,first_log_entry_utc,source',
    ...rows.map(row => row.map(csv).join(','))].join('\r\n');
}
