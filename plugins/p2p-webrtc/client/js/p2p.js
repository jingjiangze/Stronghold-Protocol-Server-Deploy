// p2p-webrtc — a browser-to-browser channel for one room, with a hard fallback to the WebSocket transport.
//
// Phase 1 (this file): signaling. Offers/answers/ICE travel over the existing /ws as `p2p.*` frames; the server only
// relays them inside the room (server/lobby.js relayP2P) and never parses them.
// Phase 2: `connect(peerId)` opens an RTCPeerConnection with one ordered DataChannel. If it is not open within
// FALLBACK_MS the caller keeps using WS — nothing here can ever block the game.
//
// It is inert until something calls `__spP2P.connect(peerId)`: the plugin ships disabled by default and the core
// transport is untouched.
const FALLBACK_MS = 3000;
const ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];

const peers = new Map();   // peerId -> { pc, channel, state }
let net = null;
let selfId = null;
let onFrame = () => {};

const status = () => Object.fromEntries([...peers].map(([id, p]) => [id, p.state]));

function ensure(peerId) {
  const hit = peers.get(peerId);
  if (hit) return hit;
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const entry = { pc, channel: null, state: 'new', startedAt: Date.now() };
  peers.set(peerId, entry);
  pc.onicecandidate = (e) => { if (e.candidate && net) net.send('p2p.ice', { to: peerId, candidate: e.candidate.toJSON ? e.candidate.toJSON() : null }); };
  pc.onconnectionstatechange = () => { entry.state = pc.connectionState; };
  return entry;
}

function bindChannel(peerId, entry, channel) {
  entry.channel = channel;
  channel.binaryType = 'arraybuffer';
  channel.onopen = () => { entry.state = 'open'; };
  channel.onclose = () => { entry.state = 'closed'; };
  channel.onmessage = (e) => { try { onFrame(peerId, e.data); } catch { /* a bad frame is the caller's problem */ } };
}

/** Start a connection to one peer. Returns a promise that resolves true when the channel is open, false on fallback. */
export async function connect(peerId) {
  const entry = ensure(peerId);
  if (entry.channel && entry.state === 'open') return true;
  bindChannel(peerId, entry, entry.pc.createDataChannel('game', { ordered: true }));
  const offer = await entry.pc.createOffer();
  await entry.pc.setLocalDescription(offer);
  net?.send('p2p.offer', { to: peerId, sdp: JSON.stringify(entry.pc.localDescription) });
  const deadline = Date.now() + FALLBACK_MS;
  while (Date.now() < deadline) {
    if (entry.state === 'open') return true;
    if (entry.state === 'failed' || entry.state === 'closed') return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return entry.state === 'open';
}

/** Handle one `p2p.*` frame from the server. */
export async function ingest(msg) {
  const peerId = msg.from;
  if (!peerId) return;
  if (msg.t === 'p2p.offer') {
    const entry = ensure(peerId);
    entry.pc.ondatachannel = (e) => bindChannel(peerId, entry, e.channel);
    await entry.pc.setRemoteDescription(JSON.parse(msg.sdp));
    const answer = await entry.pc.createAnswer();
    await entry.pc.setLocalDescription(answer);
    net?.send('p2p.answer', { to: peerId, sdp: JSON.stringify(entry.pc.localDescription) });
  } else if (msg.t === 'p2p.answer') {
    const entry = peers.get(peerId);
    if (entry) await entry.pc.setRemoteDescription(JSON.parse(msg.sdp));
  } else if (msg.t === 'p2p.ice') {
    const entry = peers.get(peerId);
    if (entry && msg.candidate) { try { await entry.pc.addIceCandidate(msg.candidate); } catch { /* late ICE */ } }
  } else if (msg.t === 'p2p.bye') {
    const entry = peers.get(peerId);
    if (entry) { try { entry.pc.close(); } catch { /* already closed */ } peers.delete(peerId); }
  }
}

/** Send one frame over the peer's channel; false when no channel is open (the caller should use WS). */
export function send(peerId, data) {
  const entry = peers.get(peerId);
  if (!entry || !entry.channel || entry.state !== 'open') return false;
  try { entry.channel.send(data); return true; } catch { return false; }
}

export function closeAll() {
  for (const [id, e] of peers) { try { e.pc.close(); } catch { /* ignore */ } peers.delete(id); }
}

/** Wire the module to a room. `sendFrame` is net.send, `subscribe` receives every p2p.* frame. */
export function install({ net: n, self, onMessage = () => {} } = {}) {
  net = n; selfId = self || null; onFrame = onMessage;
  globalThis.__spP2P = { connect, ingest, send, closeAll, status, FALLBACK_MS };
  return globalThis.__spP2P;
}

export default { connect, ingest, send, closeAll, install, status };
