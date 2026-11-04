// Selection is owner-only; rendering uses only the server's current approved, public URL map.
import { parseUploadedNamecardId } from './namecard.js';

let state = { list: [], urls: [], review: null, reviews: [] };
const listeners = new Set();
const safeEntries = entries => (Array.isArray(entries) ? entries : []).filter(entry => {
  const parsed = parseUploadedNamecardId(entry?.id);
  return parsed && typeof entry.url === 'string'
    && ['/data/namecards/approved/' + parsed.owner + '.' + parsed.revision + '.png',
      '/data/namecards/approved/' + parsed.owner + '.' + parsed.revision + '.jpg'].includes(entry.url);
}).map(({ id, url }) => Object.freeze({ id, url }));

export function setNamecardUploads(message) {
  state = Object.freeze({ list: safeEntries(message?.list), urls: safeEntries(message?.urls),
    review: message?.review && typeof message.review === 'object' ? message.review : null,
    reviews: Array.isArray(message?.reviews) ? message.reviews : message?.review ? [message.review] : [] });
  for (const listener of listeners) listener();
}
export const namecardUploads = () => state;
export function subscribeNamecardUploads(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function customNamecardUrl(id) {
  return state.urls.find(entry => entry.id === id)?.url || null;
}
