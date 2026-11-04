// shared/accountAuth.js — 密码派生 (客户端算,服务端不存原密码).
//
// THE PROBLEM
//   This project is served over plain HTTP on a LAN — `http://192.168.x.x:3000` is exactly how 预缓存 is meant to be
//   used — so anything on the wire is readable by the network. Sending the player's password in the clear would put a
//   credential they very likely reuse on other sites into a LAN capture and into this server's logs.
//
// WHAT WE DO INSTEAD
//   The client derives a proof with PBKDF2-SHA256 (WebCrypto) and sends THAT; the server hashes the proof again with
//   scrypt (server/accounts.js). The plaintext never leaves the browser.
//
//   ⚠ This is not a substitute for TLS. An attacker who captures a proof can replay it to log in — the proof IS the
//   credential on the wire. What it buys is that the player's real password is not exposed and cannot be reused
//   elsewhere. The bind address and the tunnel remain the trust boundary, exactly as they were before accounts.
//
// WHY NOT A RANDOM SALT FROM THE SERVER
//   That would need a round trip before the player can even register. The account name is used as the salt, which is
//   deterministic and per-account — enough to stop one rainbow table from covering every account at once. The server's
//   scrypt layer carries a random per-account salt, which is where that protection really lives.

/** Iterations. High enough to be expensive per guess, low enough that a phone logs in quickly. */
export const PROOF_ITERATIONS = 120_000;
/** Self-describing prefix, so the server (or a future migration) can tell which scheme produced a proof. */
export const PROOF_PREFIX = 'sp1';

/** @param {any} s @returns {string} */
const enc = (s) => new TextEncoder().encode(String(s));

/**
 * Derive the login proof for an account. Pure and deterministic: the same (account, password) always yields the same
 * proof, which is what lets the server verify it with a plain hash comparison.
 *
 * @param {string} account
 * @param {string} password
 * @returns {Promise<string>} `sp1$<iterations>$<saltHex>$<derivedHex>`
 */
export async function deriveProof(account, password) {
  const name = String(account ?? '').trim();
  const salt = enc(`sp-account:${name}`);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto unavailable');
  // importKey needs a BufferSource; `enc` gives a Uint8Array view onto a fresh buffer.
  const key = await subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PROOF_ITERATIONS },
    key,
    256,
  );
  const hex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${PROOF_PREFIX}$${PROOF_ITERATIONS}$${saltHex}$${hex}`;
}

/**
 * Whether this environment can derive proofs at all.
 *
 * WebCrypto requires a SECURE CONTEXT: on plain `http://` it is present for `localhost` but **undefined** on
 * `http://192.168.x.x:3000`. That is the same address the 预缓存 flow runs on, so this is a real case rather than a
 * theoretical one, and the login screen has to say something useful instead of failing on submit.
 *
 * @returns {boolean}
 */
export const canDeriveProof = () => !!globalThis.crypto?.subtle;
