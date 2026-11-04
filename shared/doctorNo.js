// Public four-digit doctor number, identical on the host and independent modes.
export function doctorNo(id) {
  let h = 2166136261;
  for (const ch of String(id ?? '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return String(h % 10000).padStart(4, '0');
}
