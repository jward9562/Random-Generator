// Synchronous SHA-256 keeps verification identical in Node and the browser.
// This detects stale content; it is not a signature proving a manual check occurred.
const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
export function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const data = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  data.set(bytes); data[bytes.length] = 128;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(data.length - 4, bytes.length * 8);
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const r = (x, n) => (x >>> n) | (x << (32 - n));
  const w = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) w[i] = (w[i-16] + (r(w[i-15],7)^r(w[i-15],18)^(w[i-15]>>>3)) + w[i-7] + (r(w[i-2],17)^r(w[i-2],19)^(w[i-2]>>>10))) >>> 0;
    let [a,b,c,d,e,f,g,j] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (j + (r(e,6)^r(e,11)^r(e,25)) + ((e&f)^(~e&g)) + K[i] + w[i]) >>> 0;
      const t2 = ((r(a,2)^r(a,13)^r(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0;
      j=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    [a,b,c,d,e,f,g,j].forEach((value, i) => { h[i] = (h[i] + value) >>> 0; });
  }
  return h.map(value => value.toString(16).padStart(8, '0')).join('');
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(item => canonical(item ?? null)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export function verificationFingerprint(db, operator) {
  const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const { verification, ...record } = operator;
  const { fingerprint, status, ...review } = verification ?? {};
  const ids = [...(Array.isArray(operator.primary) ? operator.primary : []), ...(Array.isArray(operator.secondary) ? operator.secondary : [])];
  const weapons = (db.weapons ?? []).filter(item => item && ids.includes(item.id)).sort(byId);
  const categories = (db.categories ?? []).filter(item => item && weapons.some(weapon => weapon.category === item.id)).sort(byId);
  const attachmentIds = new Set();
  const collect = value => {
    if (Array.isArray(value)) value.forEach(item => { if (typeof item === 'string') attachmentIds.add(item); else collect(item); });
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  categories.forEach(item => collect(item.attachments));
  weapons.forEach(item => collect(item.attachmentOverrides));
  collect(operator.attachmentOverrides);
  const attachments = (db.attachments ?? []).filter(item => item && attachmentIds.has(item.id)).sort(byId);
  const gadgets = (db.gadgets ?? []).filter(item => item && operator.gadgets?.includes(item.id)).sort(byId);
  return `sha256-v1:${sha256(canonical({ record, review, patch: db.dataVersion?.patch, kind: db.dataVersion?.kind, weapons, categories, attachments, gadgets }))}`;
}

export function verificationIsCurrent(db, operator) {
  try { return operator.verification?.status === 'verified' && operator.verification.fingerprint === verificationFingerprint(db, operator); }
  catch { return false; }
}

export function invalidateVerifications(db) {
  for (const operator of db.operators ?? []) {
    if (operator?.verification?.status === 'verified' && !verificationIsCurrent(db, operator)) operator.verification.status = 'needs-review';
  }
  return db;
}
