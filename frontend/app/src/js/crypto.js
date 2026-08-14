// crypto.js — local secret hashing for the app PIN and cached offline password.
//
// WHY THIS EXISTS
// These hashes were produced by a hand-written SHA-256 run 100,000 times in a
// JS loop on the main thread. Measured, that is ~760 ms on a fast desktop and
// roughly 4–8 s in a mobile WebView, which is why unlocking with the PIN took
// longer than unlocking the phone itself. The same work through the platform's
// PBKDF2 takes ~17 ms — about 45x faster — and PBKDF2-HMAC-SHA256 is a
// stronger construction than iterated plain SHA-256 besides.
//
// Native crypto is not assumed: the Android build serves over androidScheme
// "http", and while http://localhost is a secure context in practice, a device
// where crypto.subtle is missing must still be able to unlock. So the JS
// implementation stays as a fallback, hashes record which algorithm produced
// them, and a hash written by the slow path is rewritten to the fast one the
// next time it is successfully verified.

const PBKDF2_ITERATIONS = 100_000;
const LEGACY_ITERATIONS = 100_000;   // what untagged stored hashes used

/** True when the platform can do PBKDF2 for us. */
function hasSubtle() {
  return typeof crypto !== 'undefined'
    && crypto.subtle
    && typeof crypto.subtle.deriveBits === 'function';
}

export function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Pure-JS SHA-256 (fallback only) ─────────────────────────────────────────
// Retained so devices without crypto.subtle keep working, and so hashes written
// by the previous version can still be verified.
function sha256(msg) {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  const rr = (v,n) => (v>>>n)|(v<<(32-n));
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const bytes = typeof msg==='string' ? new TextEncoder().encode(msg) : msg;
  const bl = bytes.length*8;
  const pad = new Uint8Array(((bytes.length+9+63)&~63));
  pad.set(bytes); pad[bytes.length]=0x80;
  new DataView(pad.buffer).setUint32(pad.length-4, bl, false);
  for (let off=0; off<pad.length; off+=64) {
    const w = new Int32Array(64);
    for (let i=0;i<16;i++) w[i]=new DataView(pad.buffer).getInt32(off+i*4,false);
    for (let i=16;i<64;i++){const s0=rr(w[i-15],7)^rr(w[i-15],18)^(w[i-15]>>>3);const s1=rr(w[i-2],17)^rr(w[i-2],19)^(w[i-2]>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)|0;}
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for (let i=0;i<64;i++){const S1=rr(e,6)^rr(e,11)^rr(e,25);const ch=(e&f)^(~e&g);const t1=(h+S1+ch+K[i]+w[i])|0;const S0=rr(a,2)^rr(a,13)^rr(a,22);const mj=(a&b)^(a&c)^(b&c);const t2=(S0+mj)|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}
    h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;h4=(h4+e)|0;h5=(h5+f)|0;h6=(h6+g)|0;h7=(h7+h)|0;
  }
  return [h0,h1,h2,h3,h4,h5,h6,h7].map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
}

function slowHash(secret, saltHex, iterations) {
  let h = sha256(saltHex + secret);
  for (let i = 1; i < iterations; i++) h = sha256(saltHex + h);
  return h;
}

async function pbkdf2(secret, saltHex, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(saltHex), iterations, hash: 'SHA-256' },
    key, 256,
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Public API ──────────────────────────────────────────────────────────────
// Stored format is "<algo>$<iterations>$<hex>". A bare 64-char hex string is a
// hash from before this module existed and is verified with the legacy scheme.

/** Hash a secret for storage, using the fastest algorithm available. */
export async function hashSecret(secret, saltHex) {
  if (hasSubtle()) {
    const hex = await pbkdf2(secret, saltHex, PBKDF2_ITERATIONS);
    return `pbkdf2$${PBKDF2_ITERATIONS}$${hex}`;
  }
  return `sha256i$${LEGACY_ITERATIONS}$${slowHash(secret, saltHex, LEGACY_ITERATIONS)}`;
}

/**
 * Check a secret against a stored hash of any supported vintage.
 *
 * Returns { ok, upgraded } — `upgraded` carries a re-hash in the fast format
 * when the stored value used the slow one, so the caller can persist it and
 * make every later unlock instant. Nothing is upgraded on a failed attempt.
 */
export async function verifySecret(secret, saltHex, stored) {
  if (!stored || !saltHex) return { ok: false, upgraded: null };

  const parts = String(stored).split('$');
  let ok = false;
  let wasSlow = false;

  if (parts.length === 3) {
    const [algo, iterStr, hex] = parts;
    const iterations = parseInt(iterStr, 10) || LEGACY_ITERATIONS;
    if (algo === 'pbkdf2') {
      // A device that lost crypto.subtle cannot verify a PBKDF2 hash.
      if (!hasSubtle()) return { ok: false, upgraded: null };
      ok = (await pbkdf2(secret, saltHex, iterations)) === hex;
    } else if (algo === 'sha256i') {
      ok = slowHash(secret, saltHex, iterations) === hex;
      wasSlow = true;
    }
  } else {
    // Untagged: written by the previous version.
    ok = slowHash(secret, saltHex, LEGACY_ITERATIONS) === String(stored);
    wasSlow = true;
  }

  if (!ok) return { ok: false, upgraded: null };
  const upgraded = (wasSlow && hasSubtle()) ? await hashSecret(secret, saltHex) : null;
  return { ok: true, upgraded };
}

/** Whether unlocking will use the fast path — for diagnostics. */
export function usingNativeCrypto() { return hasSubtle(); }
