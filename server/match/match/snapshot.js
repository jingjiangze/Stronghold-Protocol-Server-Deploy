// server/match/match/snapshot.js — Match methods: hand the run to the clients, and rebuild it from one of them.
//
// Why the client holds it: the deployment (a ModelScope container) keeps nothing across a redeploy, so a snapshot
// on the server's disk dies with the process. The player's page survives the restart, so the server sends it a
// snapshot at every round start and asks for it back when a resume finds the room but no match. The page is a
// dumb store: it cannot invent state the server did not send it.
//
// Applied at the NEXT round start (Match.phases afterBattleCheck), never mid-phase: the round engine then runs
// its own normal path and the restored numbers ride along, so there is no second flow to keep in sync.
import { makeSnapshot } from '../../../shared/matchSnapshot.mjs';

/** Wall-clock guard: a snapshot from another process/build may carry a piece shape this build cannot use. */
const MAX_PIECE_BYTES = 4096;

export class MatchSnapshot {
  /** @returns {object|null} the snapshot to send, or null when this round's payload would exceed the frame budget */
  snapshotNow() {
    const players = {};
    for (const ps of this.players.values()) {
      players[ps.playerId] = {
        lp: ps.lp,
        funds: ps.funds,
        bandId: ps.bandId || null,
        // the board is a Map keyed by tile ("r,c"): the key is part of the snapshot, the piece is plain data
        board: [...ps.board.entries()].map(([key, piece]) => [key, piece]),
        hand: ps.hand,
        temp: ps.temp,
        shop: { level: ps.shop?.level, upgradePrice: ps.shop?.upgradePrice },
      };
    }
    try {
      return makeSnapshot({
      round: this.round, phase: this.phase, players,
      // 进程重启后房间本身也没了：把房间骨架一起带上，回来的人才能把它重建出来。
      room: {
        code: this.roomCode, mode: this.mode, difficulty: this.difficulty,
        variant: this.variant || null,
        seats: [...this.players.values()].map((ps) => ({ seat: ps.seat, playerId: ps.playerId, name: ps.name, isBot: ps.isBot })),
      },
    });
    } catch { return null; }
  }

  /**
   * Hand the snapshot to a bounded set of keepers. 20 humans x 37 KB is 750 KB per round start, and a recovery
   * needs only a few copies: up to 4 humans every seat keeps one, above that the host plus two backups that rotate
   * by round. Spectators and bots are not stores. Fail-open.
   */
  broadcastSnapshot() {
    if (this.snapshotDisabled) return;
    let snap = null;
    try { snap = this.snapshotNow(); } catch { snap = null; }
    if (!snap) return;   // over the frame budget: no store this round (the previous one stays valid)
    const humans = [...this.players.values()].filter((ps) => !ps.isBot && !ps.left);
    if (!humans.length) return;
    let keepers = humans;
    if (humans.length > 4) {
      const host = humans.find((ps) => ps.playerId === this.hostId) || humans[0];
      const backups = humans.filter((ps) => ps !== host);
      const start = (Number(this.round) || 0) % backups.length;
      keepers = [host, backups[start], backups[(start + 1) % backups.length]].filter(Boolean);
    }
    for (const ps of new Set(keepers)) {
      try { this.sendTo(ps.playerId, { t: 'b.snapshot', snapshot: snap }); } catch { /* one dead socket must not stop the rest */ }
    }
  }

  /**
   * Apply a snapshot taken at this match's round start. Only numbers and the board/hand/temp/shop lists move; every
   * running object (wave, timers, fields) is the one the round engine just built, so nothing here can leave a stale
   * timer behind.
   * @param {object} snap a snapshot already normalised by shared/matchSnapshot.mjs checkSnapshot
   */
  applyBootstrap(snap) {
    for (const [playerId, p] of Object.entries(snap.players || {})) {
      const ps = this.players.get(playerId);
      if (!ps || !p) continue;
      if (p.lp != null) ps.lp = p.lp;
      if (p.funds != null) ps.funds = p.funds;
      if (p.bandId) ps.bandId = p.bandId;
      if (p.shop && ps.shop) {
        if (p.shop.level != null) ps.shop.level = p.shop.level;
        if (p.shop.upgradePrice != null) ps.shop.upgradePrice = p.shop.upgradePrice;
      }
      try {
        ps.board.clear();
        for (const [key, piece] of Array.isArray(p.board) ? p.board : []) {
          if (typeof key !== 'string' || !piece) continue;
          if (JSON.stringify(piece).length > MAX_PIECE_BYTES) continue;
          ps.board.set(key, piece);
        }
        const fit = (arr, size) => {
          const out = new Array(size).fill(null);
          for (let i = 0; i < Math.min(size, arr.length); i++) out[i] = arr[i] || null;
          return out;
        };
        if (Array.isArray(p.hand)) ps.hand = fit(p.hand, ps.hand.length);
        if (Array.isArray(p.temp)) ps.temp = fit(p.temp, ps.temp.length);
      } catch (e) {
        this.log?.warn?.(`[match ${this.roomCode}] restore of ${playerId} partially failed: ${e?.message || e}`);
      }
      try { ps.recompute(); } catch { /* a piece this build cannot score is left for the next recompute */ }
    }
    this.log?.info?.(`[match ${this.roomCode}] restored at round ${this.round} from a client snapshot`);
  }
}
