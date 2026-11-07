// server/lobby.js — rooms, seats, host, AI seats, ready/start, reconnect, and room → Match wiring
// (DESIGN §2, §6.1 LOBBY, §8.1). Implements the handler interface consumed by server/net.js.
//
// Rules (the choices where DESIGN is silent are marked ▸):
//   * Rooms are keyed by 4-letter codes from an unambiguous alphabet (no I/O, letters only). Join codes are
//     case-insensitive.
//   * 'solo' rooms hold exactly one human and never bots. Every room opens with DEFAULT_SEATS (4) slots and any free one
//     takes a player, so a 'coop' room seats 4 humans until its host raises the cap — room.setSeatCap { code, seatCap }
//     (2026-11-07, 业主: 房主滑条默认 4 人) takes one of ROOM_CAPACITIES (4/8/12/16/20). A versus room's cap is its
//     teamSize × 2 and has no setter (2026-10-27). The room's `seats` array IS that cap: `seatCap === seats.length`.
//     Humans and bots take the lowest free seat index; seat indexes never compact.
//   * ▸ Being in a LOBBY room and sending room.create / room.join implicitly leaves it. While your room is
//     in a match, create/join of another room fails with ROOM_STARTED (send g.leave or room.leave first).
//   * room.create {mode, difficulty?, test?}: ▸ without a difficulty the room starts at DEFAULT_DIFFICULTY (标准) and the
//     host changes it in the room — the event's 联合模拟 creates the room first (research 06 §3.2), the starting
//     difficulty is not recorded [ASSUMED: 标准, the first one unlocked; the event room research 06 §3.2 describes shows
//     ♜ 标准模拟 in its footer pill]. The game's own lobby always sends the remembered one.
//   * Host-only: room.setDifficulty, room.setAiPicksLast, room.setSoloUnlimited, room.setIncompleteMaps,
//     room.setSeatCap, room.addBot, room.removeBot, room.kick, room.start.
//     ▸ Changing the difficulty or the AI-picks-last option (co-op only) un-readies the other humans.
//     ▸ 「不限时」 (room.setSoloUnlimited { on }, DESIGN §35.23.10): a solo room of a version whose rules.soloTimed is
//       true, off by default. On, the match is built with opts.soloUnlimited (preparation and 机变 untimed — the existing
//       Match opt-out). room.state carries `soloUnlimited: true` only while it is on, so a default room.state stays
//       identical. A switch to a version whose solo is not timed clears it. A create that sends the key on a co-op room
//       or an untimed version is ignored.
//     ▸ room.start requires every other human to be connected and ready; the host's start counts as the host's
//     ready (the host may still toggle room.ready for display).
//   * room.kick {seat, playerId} (community report #17, owner approved): before the match only, the host removes another
//     human like an AI seat (an AI seat stays room.removeBot's; never the host itself). `playerId` names the player the
//     host confirmed: a seat that changed hands meanwhile (left, someone else joined) is refused with BAD_TARGET. The
//     seat is freed at once and the player gets `room.closed {reason:'kicked'}` — now, or on the next resume when
//     offline (with the result replay, as the grace timeout) —, so the reconnect token no longer leads back to the seat
//     (it stays the player's identity: net.js sessions belong to players, not seats). ▸ No ban: the player may join
//     again with the code.
//   * Host migration: when the host leaves (or is removed), the lowest-seat remaining human (connected
//     ones first) becomes host. A room without humans is disposed (bots never keep a room alive).
//   * Disconnect in LOBBY: the seat shows connected=false and is freed after `lobbyGraceMs` (60 s); a
//     session that comes back after that gets `room.closed {reason:'timeout'}`.
//     Disconnect in a match: the seat is kept and match.onDisconnect(playerId) is called.
//   * Reconnect: `hello` with a known token (reconnect window, 10 min, see net.js) rebinds the session;
//     the lobby then broadcasts room.state and, in a match, calls match.onReconnect(playerId).
//     Solo runs (下半: "休整期及机变阶段没有时间限制…24小时内随时返回", research 01 §1 / 06 §17): a session that drops
//     while its solo room's match runs stays resumable for the official `config.constants.singleReconnectTime`
//     (86400 s; option `soloReconnectWindowMs` overrides it) instead of the 10-minute window (net.js
//     session.resumeWindowMs, set at every disconnect). 第一期's constData has no singleReconnectTime, so that solo
//     uses the same 24 h figure as a carried-over convenience [ASSUMED] — not because the run is untimed (a 第一期 solo
//     is timed unless the room's 「不限时」 is on, §35.23.10). Only after that does expiry turn into
//     match.onLeave ('abandoned'). The extension outlives the match, so a run that ended meanwhile (e.g. a server-run
//     Final Assault) still shows its result on the player's return.
//     A repeated hello on a live connection is a full resync: room.state goes to the requester only
//     (broadcast only when the seat visibly changed, e.g. a rename in LOBBY); the heavy part (match.onReconnect,
//     or the result replay below) runs at most once per `resyncMinGapMs` per session — extra requests inside
//     that window coalesce into one deferred resync, so hello spam cannot amplify into ~15 KB per request.
//   * Result replay: the match's final m.public and each human's m.result are kept after the match ends. A
//     human who resyncs (resume after a drop, a reloaded tab, a repeated hello) while the room is back in LOBBY
//     gets room.state followed by those two frames again, until they act in the room (ready, difficulty, the
//     AI-picks-last option, AI seats, start), leave it, or a new match starts. A human removed by the lobby grace
//     gets them right after `room.closed {timeout}` on their next resume (Match.onReconnect cannot do this: the
//     lobby drops the match reference at onEnd and disposes it on the next macrotask).
//   * Per-network limits (internet clients only, see net.js clientAddress): at most `maxRoomsPerAddr` rooms
//     created from one network may exist at once and at most `maxMatchesPerAddr` matches started from one
//     network may run at once (room.create / room.start → ERR.RATE). Without them a socket loop could fill
//     `maxRooms` or keep hundreds of unattended matches simulating for the whole reconnect window.
//   * Permanent departure during a match (room.leave, g.leave, reconnect window expired): the seat is
//     marked departed (shown as connected=false), match.onLeave(playerId) is called, and the seat is freed
//     when the match ends. 'g.leave' is handled here and never reaches match.handle().
//   * All other 'g.*' messages go to room.match.handle(playerId, msg); its {ok}/{error} becomes the reply.
//   * Match lifecycle: room.start → new Match({...}) → room.state (inMatch=true) → match.start(). The match gets
//     `matchNo` = the room's match number (1, 2, …): with the seed it keeps battleIds unique across the room's
//     matches, so a late b.progress / b.result of the previous match is ignored by the next one (DESIGN §14).
//     onEnd(summary) → room back to LOBBY (departed seats freed, humans un-readied, disconnected humans
//     get the lobby grace), dispose() on the next macrotask. Players can start again.
//   * room.closed reasons: 'timeout' (removed after lobby grace), 'kicked' (room.kick, room.removeSpectator), 'empty' (a
//     spectator whose room lost its last player), 'shutdown' (server stopping).
//   * Operator loadout (DESIGN §16): room.loadout { entries } is checked strictly against the game data
//     (shared/protocol.js checkLoadout: known visible chess, a skill index legal for the normal AND the elite status, a
//     module of the elite or 'none'; any bad entry rejects the whole message, nothing is stored). ▸ It is stored on the
//     session (it follows the player into every room they create/join, and survives a resume) and on the seat; the
//     match receives seats[].loadout (bots: none — they fight with the defaults). ▸ Accepted any time: in a LOBBY room
//     (or outside a room) it simply replaces the stored one; while the room's match runs it is also handed to
//     match.setLoadout(playerId, loadout), which accepts it only during INFO_CHECK (the 干员调配 entry of the briefing)
//     and refuses it afterwards (WRONG_PHASE: the match's loadout is locked, the stored one applies to the next match).
//     ▸ Its `ops` (0.2.2: the per-operator 潜能 / 练度, shared/protocol.js checkLoadoutOps — an operator of the 干员调配
//     roster or the 自选 owned pool, strict like the entries) travel with it: session.ops / seat.ops / seats[].ops and
//     match.setLoadout(playerId, loadout, ops); a message without `ops` sets none (every operator 潜能 6, 精英2 Lv.60).
//   * Operator ownership (干员持有, 0.2.0 补位, owner's decision 2026-10-05): room.ownership { notOwned } — the base chess
//     ids the player marked as not owned — is checked leniently (shared/protocol.js checkNotOwned: anything that is not
//     a droppable NORMAL chess is dropped, never the whole list; only a malformed list is BAD_MSG) and stored on the
//     session and the seat like the loadout. The match receives seats[].notOwned when it starts (bots: none — they own
//     every operator) and keeps it for its whole length: the setting is out of match ("局外设置，下一局生效"), so while
//     the room's match runs a new list is only stored for the next match (ROOM_STARTED 'stored for the next match',
//     never handed to the match). A spectator's list stays on its session.
//   * 自选编队 (0.2.0 DIY, the owner's decisions of 2026-10-05): room.diy { picks } — the player's picks for the four DIY
//     slots ({ [slotBaseId]: { charId, skillIndex?, uniEquipId? } | null }) — is checked leniently (shared/protocol.js
//     checkDiyPicks against the game data and the kit registry, server/sim/content/kits/index.js KITTED_CHARS: an
//     illegal pick — an operator without a kit, another tier's prototype, a prototype off its locked skill, a second slot
//     of one owned operator, the same operator twice in a tier, an unknown slot / skill / module — is dropped, never the
//     whole roster; only malformed picks are BAD_MSG) and stored on the session and the seat exactly like the
//     not-owned list: the match receives seats[].diy when it starts (bots: none — they field no 自选 piece [ASSUMED]),
//     and a change while it runs is stored for the next match (ROOM_STARTED 'stored for the next match'). Every
//     `welcome` carries `diyKitted` (welcomeInfo): the operators a DIY slot may field, so the client's picker offers
//     exactly what the server accepts.
//   * 干员皮肤 (docs/SKINS.md): room.skins { skins } — `{ [charId]: skinId }`, the appearance each operator wears — is
//     a plain map of charIds to skinIds, at most SKIN_LIMITS.entries (256 [ASSUMED]); a bad shape is BAD_MSG and does
//     not clear the stored choice. A charId the room's content does not have is dropped (shared/protocol.js
//     checkSkinSelection). An unknown skinId can do nothing worse than fail to resolve in the client's spineEntry.
//     Stored on the session and the seat. Unlike
//     the settings above there is NO phase gate: a match receives seats[].skins when it starts AND takes a later change
//     at once (match.setSkins, any phase), because the choice is public — a teammate sees your model — and cosmetic.
//     The room's members see a seat's map as room.state seats[].skins (human seats with a non-empty map only, so a room
//     without skins sends what it sent before): the waiting room's 名片干员 seat cards wear the outfit of the operator
//     they show (the maintainer's decision 4 of 2026-10-21; the client picks that operator's entry — ui/seatArt.js
//     seatCardSkin — exactly as a match card reads Match.publicView().players[].skins). A changed map is broadcast while
//     the room waits; during a match its m.public carries it, and the room.state at the match's end. [ASSUMED] The whole
//     map rides in room.state, not one skinId per card: a seat without a pick shows an operator its clients choose by
//     player id (ui/seatArt.js seatOperator), which the server does not compute.
//   * 名片干员 (PR #643 split 6): room.card { charId } — the operator whose portrait fills the player's seat card in the
//     waiting room, '' for none — is kept only when it is a visible charId of the room's chess.json (another id, a hidden
//     preset, a stand-in body or a 自选-only operator: BAD_MSG, the stored one stays). Stored on the session (it follows the player into
//     the next room) and the seat; the room's members see it as room.state seats[].card (human seats with a card only,
//     so a room without one sends what it sent before). Checked again when the player takes a seat (humanSeat): a card
//     the room's content does not have (a plugin operator picked in a room with gameplay plugins) is left off that seat
//     — the session keeps it, and the player's page sends the card it can show for the room (ui/loadoutSync.js
//     installCardSync). Cosmetic: no phase gate, never handed to a match. [ASSUMED] A card picked in this browser stands
//     in for the event's account assistant (名片形象, display_meta_table avatarTypeData ASSISTANT); the client's default
//     for a seat without one is ui/seatArt.js'.
//   * Content identity (DESIGN §32, the plugin system's first step): the lobby is given the server's vanilla content
//     (server/plugins/identity.js; none in unit tests that build a Lobby without it). Every `welcome` carries
//     `content: { vanilla: <cs> }` — and `plugins: <n>` when this server has n > 0 unofficial plugins (every class but a
//     language: the title screen's 「本服务器安装了 N 个插件」; a page fetches the catalogue only when n > 0 and something
//     needs it, so a server without plugins sends exactly what it sent before) —, every room's `room.state.content` is
//     `{ cs, vanilla: true, plugins: [] }` while it has
//     no plugin, and the match receives `cs`, which it copies into every BattleSpec (the sim never reads it;
//     diagnostics and replays name the content with it).
//   * The room's plugins (DESIGN §32 P1a — cosmetic plugins only): room.setPlugins { plugins: [{ id }] } — host-only,
//     before the match, and ▸ like a difficulty change it un-readies the other humans. The lobby asks the server's
//     visual sets (server/plugins/visualSet.js resolve: loaded cosmetic plugins of scope `room`, their requirements
//     switched on, in load order, within the size limit — PLUGIN_UNKNOWN / PLUGIN_BLOCKED / PLUGIN_DEPENDENCY /
//     PLUGIN_CONFLICT / PLUGIN_LIMIT otherwise; none given to the Lobby → PLUGIN_UNKNOWN) and the room's content becomes
//     `{ cs, vanilla: true, vs, plugins: [{ id, version, class, hash, auto? }], warnings, bytes }`: `cs` stays the vanilla
//     one — art never changes a battle, so the match, its BattleSpecs and the golden results are those of the original
//     content and ▸ such a match counts as the original game in the statistics overview (the owner's decision of
//     2026-10-13: gameplay and numbers unchanged) —, `vs` names the
//     art every member's page draws with (/vs/<vs16>/overlay.json, composed by public/js/content.js on the page's own
//     manifest). An empty list brings back
//     exactly the vanilla shape above. The set is the room's: kept across its matches and a host change, held in the
//     visual sets while the room uses it (hold / release) and gone with the room. The same set again (the same `vs`)
//     un-readies nobody; ▸ when only its 「自动」 marks changed (a plugin first switched on automatically is now chosen, or
//     the other way round) the new state is broadcast without un-readying. A request that changes nothing (the same `vs`
//     and the same marks) — or a refused one — leaves the host's result replay (a settlement screen still open:
//     dropReplay; a change is the host moving on). ▸ When a plugin of the room's set changes on disk while the room holds
//     it (the visual sets' onStale, after the registry read the folders again), the host is told once (an m.toast: apply
//     the room's plugins again — the panel's 「重新应用」 sends the same list, which resolves to the set of the files as
//     they are now) — during a match, once the room is back in its lobby (onMatchEnd), when it can be done; nothing
//     changes by itself — ▸ but in a room the plugin studio names (DESIGN §32.9: `autoApplyPlugins`, set by
//     server/studio/index.js — a room whose host is the plugin's author or whose host is its only player) the same choice
//     is applied again at once, during a match too (refreshPlugins: art never changes a battle, the `cs` stays the vanilla
//     one; nobody is un-readied), and the host is told only when that fails.
//   * Gameplay plugins (DESIGN §32.6, P1c): room.setPlugins also takes the server's content plugins (data: numbers,
//     records, modes). The lobby's `plugins` (server/plugins/roomSets.js) closes the list over its requirements, refuses
//     conflicts, other classes and scopes, what the server owner's plugins/config.json does not allow and — unless it
//     allows them — gameplay plugins made for other game versions (PLUGIN_INCOMPATIBLE), and builds the room's content set:
//     a `cs` of its own (server/plugins/contentSets.js; at most limits.maxSets such sets held by rooms at once, else
//     PLUGIN_BUSY). The room's content is then `{ cs, vanilla: false, plugins: [{ id, version, class, hash, auto? }],
//     warnings, bytes, dataBytes, vs?, modes?, modeId? }` and ▸ the room is held to it like to a visual set (holdContent /
//     releaseContent). Its members' pages load and check that set (/cs/<cs16>/…, public/js/content.js) and say so with
//     room.contentReady { cs } — `seats[].content` (and `spectators[].content`) is 'loading' | 'ready' | 'failed' in such a
//     room only, reset to 'loading' when the set changes and when the member's socket drops (a reloaded page loads it
//     again); room.ready { ready: true } and room.start wait for every player's 'ready' (CONTENT_NOT_READY). A new room
//     starts with the policy's `default` plugins (none: the original game).
//     room.setMode { modeId } (host, before the match): an official mode of the room's type sets the difficulty; a mode
//     of the room's content set (content.modes, same room type) becomes content.modeId — the match's modeId — until the
//     host picks a difficulty or the set no longer has it; ▸ like a difficulty change it un-readies the other humans.
//     The match of such a room runs in that set's match host (server/match/host/ — a child process, a worker thread with
//     SP_MATCH_HOST=worker: hosts.create — the match is a MatchProxy whose answers are Promises), with opts.cs = the set's cs, opts.requireCs (a b.result naming another
//     content is refused) and opts.vs; ▸ every message and event of such a room is handled in order, one at a time, on
//     the room's own queue (serial): a request waits for the previous one's answer. A vanilla room never queues — its
//     match is in this process and answers at once, exactly as before. A loadout, 干员持有 list or 自选 roster stored while
//     the player was in a room of another content is filtered to the room's data when its match starts (an id the set
//     does not know is dropped, the rest kept — design study §6.9), and room.loadout / room.ownership / room.diy are
//     checked against the room's own data (and its 自选 list). When the worker stops (a crash, the watchdog), the match
//     ends with summary.reason 'plugin-crash' | 'plugin-hang' | 'plugin-start' and the room is back in its lobby.
//   * Spectator seats (community report #26, owner's decision 2026-10-04 — a remake feature, the official room has none):
//     room.spectate { code } takes one of a co-op room's MAX_SPECTATORS (2) spectator seats, in its lobby or while its
//     match runs (▸ solo rooms: ROOM_FULL). A spectator is not a player: never in `seats`, never counted for the 1–4 players
//     or the start gate, never host, never keeps a room alive (a room whose last human leaves closes with room.closed
//     {empty} for its spectators). It receives room.state (`spectators: [{ playerId, name, connected }]`) and every match
//     broadcast (m.public, m.ticker, m.emote, b.pool — public data); the match registers it (opts.spectators /
//     addSpectator) and shows it fields like an eliminated player (b.start watch / m.field), never an m.private. It may
//     only g.watch (the heavy bucket, like every watcher), g.leave / room.leave, and room.loadout / room.ownership /
//     room.diy (stored for its session, never handed to the match); anything else → SPECTATOR (▸ emotes too). Host: room.removeSpectator { playerId } any
//     time → room.closed {kicked} to it. A spectator in a LOBBY room may take a free player seat with room.join of the same
//     code; a player never switches to spectating in place (ALREADY). Disconnect / grace / reconnect / expiry work as for
//     a player seat (the seat is kept and given back on resume).
//   * Official versions (DESIGN §35.23, M1; shared/versions.js, server/versions.js): a room plays one official version,
//     `room.version` — room.create { version? } (omitted: the server's default version; refused VERSION_UNKNOWN when this
//     server does not enable it, VERSION_UNSUPPORTED when it does not offer the room mode, its data failed to load
//     (server/versions.js available; welcome then omits it) or the server owner's fixed plugins (plugins/config.json
//     rooms: fixed) cannot play it; a difficulty the version lacks is lowered — the highest it
//     offers below, else its lowest: 终极 → 绝境). A room of 第二期下半 (act2autochess, the code constant DEFAULT_VERSION)
//     is exactly the room of before: no new key in its room.state, its match in this process. Another version's room:
//     room.state.version, its content `{ cs: <the version's cs>, vanilla: true, version, plugins }` (official — never
//     unofficial; cosmetic plugins only: gameplay plugins play 第二期下半 only, VERSION_UNSUPPORTED), every member's page
//     loads and checks that version's data like a gameplay plugin's set (room.needsContent: seats[].content, contentReady,
//     CONTENT_NOT_READY), room.setDifficulty / room.setMode accept only the version's modes (BAD_TARGET), settings are
//     checked against its data, and its match runs in that version's match host (server/match/host/, kind 'version':
//     opts.version, opts.requireCs) — never in this process, whose module singletons hold 第二期下半's data (INTERNAL
//     without one, unless a test gave its own MatchClass).
//     The version switch, before the match, modelled on 重刷 (server/match/match/setupVote.js): the host proposes
//     (room.proposeVersion { version }: refused NOT_IN_ROOM, SPECTATOR, NOT_HOST, ROOM_STARTED, VERSION_UNKNOWN,
//     VERSION_UNSUPPORTED — the room mode, or gameplay plugins on and the target not 第二期下半 —, ALREADY, VERSION_VOTE,
//     RATE — `versionProposeGapMs` (300 ms) since the last proposal, `versionRetryMs` (5 s) after a declined or expired
//     vote [ASSUMED] —, NOT_READY — a seated human offline —, VERSION_UNSUPPORTED when the target's data failed to load,
//     and VERSION_UNSUPPORTED again when the room's cosmetic plugins do not resolve on the target, checked last);
//     ▸ a lone active human switches at once; otherwise a vote opens: voters = the seated humans then (seat order; AI and
//     spectators never vote), the host counted as agreed, `versionVoteMs` (60 s [ASSUMED]: a room has no clock to pause,
//     unlike 重刷) to answer. room.versionVote { voteId, agree }: a decline cancels (toast to every member), the last
//     agreement switches. room.cancelVersionVote { voteId } (host). A seat taken by a human (a join, a spectator sitting
//     down), a player seat freed (leave, kick, grace timeout, expiry), a host change, a voter's socket dropping and a
//     match start void it (toast); spectators coming or going and AI seats do not. While it is open room.start,
//     room.setPlugins and room.setMode answer VERSION_VOTE. room.state.versionVote { id, proposerId, version, voters,
//     agreed, remainingMs } while open (remainingMs: a duration by the lobby's clock, never a wall clock).
//     The switch (applyVersion): room.version, the difficulty lowered as at create, the content the version's base with
//     the room's cosmetic plugins applied again (none when they do not resolve there), every member's page loading it
//     again, the other humans un-readied, the WHOLE result replay dropped (its frames name the old version's chess ids),
//     every human seat's loadout / 潜能 / 干员持有 / 自选 cleared (the pages send them again) and a seat card the version
//     lacks dropped. ▸ A setting sent in such a room before its page reported the room's content ready is kept unverified
//     (the version's chess ids are reused with other operators: chess_char_1_02 is 角峰 in 第二期, 讯使 in 第一期) — a
//     version room's match then drops that loadout's skill / module choices and that 干员持有 list whole, while 潜能 /
//     练度 and 自选 (keyed by charId) are checked again against the version's data (seatSettings); a setting checked for
//     another content keeps only the ids whose operator (charId) is the same in both data sets.

import { aiTakeover, aiTakeoverDirect, resetAiTakeover, reconcileAiTakeover, maybeRandomAiTakeover } from './aiTakeover.js';
import { randomBytes, randomInt } from 'node:crypto';
import { DIFFICULTIES, LEGACY_DIFFICULTIES, TRAINING_DIFFICULTY, difficultyRank, difficultiesFor, ERR, DEFAULT_SEATS, MAX_SPECTATORS, ROOM_CAPACITIES, ROOM_CODE_LEN, modeIdFor } from '../shared/constants.js';
import { getData } from './data.js';
import { checkLoadout, checkLoadoutOps, cultivationCharIds, checkNotOwned, checkDiyPicks, charPotentialChanges, checkSkinSelection, operatorCharIds } from '../shared/protocol.js';
import { contractsValidFor, resolvePicked } from '../shared/contracts.js';
// 肉鸽「地图主题池」 (room.create { mapPool }, 2026-11-06): 'all' | 'ro1'…'ro6' 的常量表在 shared/rogueThemes.js。
import { isPool } from '../shared/rogueThemes.js';
import { encode, isErrCode, sendRaw, sendSession } from './net.js';
import { getData as defaultGetData, lookup } from './data.js';
import { Match as DefaultMatch } from './match/Match.js';
import { KITTED_CHARS } from './sim/content/kits/index.js';

const VANILLA_KITTED = new Set(KITTED_CHARS);
import { isContentHash } from '../shared/plugins/identity.js';
import { ruleOption } from '../shared/plugins/rules.js';
import { msg, wireMessage } from '../shared/i18n.js';
import { DEFAULT_VERSION } from '../shared/versions.js';
import { parseTestModeEnv, testModeGate, unrecognizedTestMode } from './testMode.js';

/** Room code alphabet: uppercase letters without I and O (and no digits, so no 0/1). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Tunables. */
export const LOBBY_DEFAULTS = Object.freeze({
  lobbyGraceMs: 60_000,   // disconnected humans keep their lobby seat this long
  maxRooms: 1000,
  maxRoomsPerAddr: 16,    // rooms created from one client network that may exist at once (0 = unlimited)
  maxMatchesPerAddr: 8,   // matches started from one client network that may run at once (0 = unlimited)
  resyncMinGapMs: 1000,   // heavy resyncs (match state / result replay) per session at most this often on repeated hellos
  soloReconnectWindowMs: null, // a dropped solo run stays resumable this long (null = data singleReconnectTime, 24 h)
  versionVoteMs: 60_000,  // an open version vote is cancelled after this long (header "Official versions") [ASSUMED]
  versionRetryMs: 5_000,  // no new version proposal this long after a declined or expired vote [ASSUMED]
  versionProposeGapMs: 300, // nor this soon after the last proposal (重刷's debounce)
  roomCode: null,         // --room-code / roomCode: a fixed alliance key for every new room (null = random per room)
});

/** The stamp of a setting a version room's page sent before it reported the room's content ready (header). */
const UNVERIFIED_CS = 'unverified';

/**
 * The difficulty of a room created without one (room.create's `difficulty` left out; see the header) [ASSUMED: 标准 —
 * the event's room is changed by its creator after 创建同盟, its starting difficulty is not recorded; the event room of
 * research 06 §3.2 shows ♜ 标准模拟 in its footer pill].
 */
// 服务端「没给难度」时的兜底仍是旧档 FUNNY（老客户端 / 老脚本语义不变）；界面默认档由客户端给（N1 / 肉鸽 N8）。
export const DEFAULT_DIFFICULTY = 'FUNNY';

/** Official `singleReconnectTime` (s) when the data lacks it (constData, research 01 §1). */
export const SOLO_RECONNECT_FALLBACK_SEC = 86_400;

/** Display names for AI teammates (the tutorial NPCs first, then a few familiar faces). */
export const BOT_NAMES = Object.freeze(['AI·华法琳', 'AI·阿米娅', 'AI·惊蛰', 'AI·杜宾', 'AI·凯尔希', 'AI·可露希尔']); // i18n-ignore: player names (docs/I18N.md)

const OK = Object.freeze({ ok: true });
const fail = (code, detail) => (detail ? { error: code, detail } : { error: code });
/** A match's answer to a request as the platform replies it: OK, or its error (an unknown code: INTERNAL). */
const matchAnswer = (res) => (res && typeof res === 'object' && res.error
  ? fail(isErrCode(res.error) ? res.error : ERR.INTERNAL, typeof res.detail === 'string' ? res.detail : undefined)
  : OK);
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * @typedef {{ seat: number, playerId: string, name: string, isBot: boolean, ready: boolean,
 *             connected: boolean, left: boolean, loadout?: Record<string, { skill: number, module: string|null }> | null,
 *             ops?: Readonly<Record<string, { potential: number, cultivate: number }>> | null,
 *             notOwned?: readonly string[] | null, diy?: Readonly<Record<string, DiyLoadout>> | null,
 *             skins?: Readonly<Record<string, string>> | null,
 *             card?: string | null,
 *             content?: 'ready' | 'failed' | null, contentGen?: number, loadoutCs?: string | null, notOwnedCs?: string | null,
 *             diyCs?: string | null, consentCs?: string | null }} Seat
 *   content: a room with gameplay plugins — whether the player's page loaded and checked its content (header "Gameplay
 *   plugins"; null = still loading); contentGen: counts the seat's disconnects (a queued room.contentReady of an earlier
 *   page no longer counts); loadoutCs / notOwnedCs / diyCs: the content its settings were checked for
 * @typedef {{ charId: string, skillIndex: number, uniEquipId: string|null }} DiyLoadout
 */

/** Deep-frozen copy of a checked loadout (shared by the session, the seat and the match's PlayerState). */
function freezeLoadout(loadout) {
  const out = {};
  for (const [id, e] of Object.entries(loadout || {})) out[id] = Object.freeze({ skill: e.skill, module: e.module ?? null });
  return Object.freeze(out);
}

/** Deep-frozen copy of checked operator settings (0.2.2 潜能 / 练度; shared by the session, the seat and the match). */
function freezeOps(ops) {
  const out = {};
  for (const [id, e] of Object.entries(ops || {})) out[id] = Object.freeze({ potential: e.potential, cultivate: e.cultivate });
  return Object.freeze(out);
}

/** The charIds a player may set a potential / 练度 for, per data object (shared/protocol.js cultivationCharIds). */
const OPS_IDS = new WeakMap();
function opsCharIds(data) {
  if (!data || typeof data !== 'object') return new Set();
  let ids = OPS_IDS.get(data);
  if (!ids) { ids = cultivationCharIds(data.chess, data.backups); OPS_IDS.set(data, ids); }
  return ids;
}

/** The operator charIds of a data object's chess.json that a player can see (room.card's whitelist, the client's picker
 * list: no hidden preset, no stand-in or 自选-only body). */
const CHESS_IDS = new WeakMap();
function chessCharIds(data) {
  const chess = data && typeof data.chess === 'object' ? data.chess : null;
  if (!chess) return new Set();
  let ids = CHESS_IDS.get(chess);
  if (!ids) {
    ids = new Set();
    for (const c of Object.values(chess)) if (c && !c.isDiy && c.visible !== false && typeof c.charId === 'string') ids.add(c.charId);
    CHESS_IDS.set(chess, ids);
  }
  return ids;
}

/** Deep-frozen copy of checked 自选 picks (shared by the session, the seat and the match's PlayerState). */
function freezeDiy(picks) {
  const out = {};
  for (const [id, p] of Object.entries(picks || {})) out[id] = Object.freeze({ charId: p.charId, skillIndex: p.skillIndex, uniEquipId: p.uniEquipId ?? null });
  return Object.freeze(out);
}

/**
 * Frozen copy of a skin selection (docs/SKINS.md), keyed by operator charId.
 *
 * A non-plain object, a key that is not a charId, a value that is not a skinId, or a map over the wire cap is refused
 * (`null` — the caller answers BAD_MSG and does not clear what is already stored). A charId `hasOperator` rejects is
 * dropped. The stored copy is then at most the operator count of the room's content, and ≤ 256 [ASSUMED].
 * @param {Record<string, string>} skins `{ [charId]: skinId }`
 * @param {(charId: string) => boolean} hasOperator
 * @returns {Readonly<Record<string, string>>|null}
 */
function freezeSkins(skins, hasOperator) {
  const res = checkSkinSelection(skins, hasOperator);
  if (!res.ok) return null;
  return Object.freeze({ ...res.skins });
}

/** Do two skin selections hold the same pairs (a resend of the same map is not broadcast again)? */
function sameSkins(a, b) {
  const ka = a ? Object.keys(a) : [], kb = b ? Object.keys(b) : [];
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

/** One room: `seatCap` seat slots (4 by default; the host raises it, a versus room: teamSize × 2), host, difficulty,
 * optional running match. */
/** 已占用的玩家座位数（bot 也算；观众不算）——对抗房用它把人数封在 2 × teamSize。 */
const takenSeats = (room) => room.seats.reduce((n, s) => n + (s ? 1 : 0), 0);

export class Room {
  /**
   * @param {string} code @param {'solo'|'coop'} mode @param {string} difficulty @param {number} now
   * @param {string} [version] the official version the room plays (header "Official versions")
   */
  constructor(code, mode, difficulty, now, version = DEFAULT_VERSION) {
    this.code = code;
    this.mode = mode;
    this.difficulty = difficulty;
    /** the official version the room plays (shared/versions.js id; header "Official versions") */
    this.version = version;
    /**
     * the open version vote, else null: `{ id, proposerId, version, voters, agreed, expiresAt, timer }`
     * @type {{ id: number, proposerId: string, version: string, voters: string[], agreed: Set<string>, expiresAt: number, timer: any } | null}
     */
    this.versionVote = null;
    /** the last vote id (room.state.versionVote.id: 1, 2, …) */
    this.versionVoteSeq = 0;
    /** the lobby clock of the last proposal, and the time before which no proposal is taken (a declined / expired vote) */
    this.versionProposeAt = -Infinity;
    this.versionRetryAt = -Infinity;
    /**
     * 「AI 队友最后选择」 (room.setAiPicksLast, GitHub #338; co-op only, off by default): the match's strategy and 机变 drafts
     * put every human seat before every AI seat (Match opts.aiPicksLast). Kept across the room's matches.
     */
    this.aiPicksLast = false;
    // 2026-11-05 业主口径：默认开启，不再提供开关。
    this.aiTakeoverEnabled = true;
    /**
     * 随机交接 (room.setAiRandom, 2026-10-31; needs aiTakeoverEnabled): the match picks one round in 3–9 and opens a
     * handover request for an online spectator by itself (server/aiTakeover.js maybeRandomAiTakeover). Host opt-in.
     */
    this.aiRandomHandover = false;
    /**
     * 「不限时」 (room.setSoloUnlimited, DESIGN §35.23.10; a timed solo only, off by default): the match is built with
     * opts.soloUnlimited. room.state omits the key unless this is true.
     */
    this.soloUnlimited = false;
    /**
     * 「包含无场景地图」 (room.setIncompleteMaps; off by default): the match is built with opts.incompleteMaps, and its stage
     * pools keep every stage of the mode only while this is true — off, a stage without an official scene package
     * (data/local-assets.json `scene/<stageId>`) is left out of the setup / per-round / node-tier draws. room.state omits
     * the key unless this is true.
     */
    this.incompleteMaps = false;
    /**
     * 肉鸽「地图主题池」 (room.create { mapPool }, shared/rogueThemes.js; 2026-11-06): 'all' | 'ro1'…'ro6'.
     * 只对肉鸽局有意义 —— Match 只在 isRogue 时把它挂到 gd 并收窄 `rogue_ro<池>_` 前缀的图；非肉鸽局恒为 'all'。
     * `'all'` 不过滤（选图与加这个开关之前逐字节一致），room.state 也只在非 'all' 时带这个键。
     */
    this.mapPool = 'all';
    /**
     * 危机合约 (shared/contracts.js): the contract ids the host picked with room.setContracts — already resolved by
     * `setContracts` (exclusivity, prerequisites, the room's size / difficulty), so the list is exactly what the match
     * plays and what room.state shows. A room without contracts keeps `[]`.
     * @type {string[]}
     */
    this.contracts = [];
    /** @type {string | null} */
    this.hostId = null;
    /** lobby 级插件扩展（code.lobby）：room.state 的额外字段与房间事件从这里来 */
    this.ext = null;
    /**
     * 座位上限 (2026-11-07 业主：默认 4 席): the room opens with DEFAULT_SEATS slots and its host raises / lowers it
     * with room.setSeatCap — `seats.length` IS this number (`seatCap === seats.length`, always). A versus room's cap is
     * its teamSize × 2 and has no setter (create). MAX_SEATS is the ceiling of ROOM_CAPACITIES, not the size.
     */
    this.seatCap = DEFAULT_SEATS;
    /** @type {(Seat | null)[]} */
    this.seats = new Array(this.seatCap).fill(null);
    /** @type {{ playerId: string, name: string, connected: boolean }[]} spectator seats, ≤ MAX_SPECTATORS (header) */
    this.spectators = [];
    /** @type {any} running Match instance */
    this.match = null;
    /** @type {{ live: boolean, ended: boolean, disposed: boolean, match: any } | null} */
    this.matchCtx = null;
    this.matchCount = 0;
    /** @type {any} summary passed to onEnd by the last match */
    this.lastSummary = null;
    /**
     * Frames of the last match's end, replayed on resync to humans who have not moved on yet.
     * @type {{ publicFrame: string | null, frames: Map<string, string>, pending: Set<string> } | null}
     */
    this.replay = null;
    /** @type {string[] | null} plugins of the room's set that changed on disk — the host not told yet (Lobby.pluginsChanged) */
    this.pluginsChanged = null;
    this.pluginNoticeKeys = {};
    /** @type {string | null} per-network limit key of the creator (net.js clientAddress) */
    this.ownerKey = null;
    /** @type {string | null} per-network limit key of whoever started the running match */
    this.matchKey = null;
    this.createdAt = now;
    this.disposed = false;
    /**
     * The content set the room plays (DESIGN §32): `{ cs, vanilla, plugins }` — the server's vanilla set, or with the
     * cosmetic plugins its host switched on (header "The room's plugins": `vs`, `warnings`, `bytes` beside them), or a
     * content set with gameplay plugins (header "Gameplay plugins": `vanilla: false`, its own cs, `dataBytes`, `modes`,
     * `modeId`); null when the lobby has no content identity (room.state then carries none).
     * @type {Readonly<{ cs: string, vanilla: boolean, plugins: readonly object[], vs?: string, warnings?: readonly object[],
     *   bytes?: number, dataBytes?: number, modes?: readonly object[], modeId?: string }> | null}
     */
    this.content = null;
    /** Test room (DESIGN §34.8). Set only at create, and only when the process switch is on. Never flipped later. */
    this.test = false;
    /** the room's queue (header "Gameplay plugins": Lobby.serial): what is still waiting or running, and its tail */
    this.queue = { pending: 0, tail: Promise.resolve() };
  }

  /** Does the room play a content set with gameplay plugins (its own cs; header "Gameplay plugins")? */
  get modded() { return !!this.content && this.content.vanilla === false; }

  /**
   * Must every member's page load and check the room's content before ready / start (header "Gameplay plugins",
   * "Official versions")? A set with gameplay plugins, or another official version than 第二期下半.
   */
  get needsContent() { return this.modded || this.version !== DEFAULT_VERSION; }

  /** @param {string} playerId @returns {Seat | null} */
  seatOf(playerId) {
    for (const s of this.seats) if (s && s.playerId === playerId) return s;
    return null;
  }

  /** @param {string} playerId @returns {{ playerId: string, name: string, connected: boolean } | null} */
  spectatorOf(playerId) { return this.spectators.find((s) => s.playerId === playerId) || null; }

  /** Lowest free seat index, or -1. */
  freeSeat() { return this.seats.indexOf(null); }

  /**
   * 座位上限 (room.setSeatCap): make the room exactly `cap` slots wide — new tail slots are null, a shrink drops the
   * tail only. A shrink that would drop a seated player or AI is REFUSED here (`false`, nothing changes): the host's
   * slider asks for at least the highest occupied seat + 1, and a stale page cannot evict anybody.
   * @param {number} cap @returns {boolean} whether the room now has `cap` slots
   */
  resizeSeats(cap) {
    if (cap === this.seats.length) { this.seatCap = cap; return true; }
    if (cap < this.seats.length && this.seats.slice(cap).some((s) => s)) return false;
    if (cap > this.seats.length) this.seats.push(...new Array(cap - this.seats.length).fill(null));
    else this.seats.length = cap;
    this.seatCap = cap;
    return true;
  }

  /** Humans that have not departed, in seat order. @returns {Seat[]} */
  activeHumans() { return this.seats.filter((s) => s && !s.isBot && !s.left); }

  /**
   * `room.state` frame (DESIGN §8.1) plus `inMatch`.
   * @param {number} [now] the lobby's clock (an open version vote's remainingMs)
   */
  toState(now = Date.now()) {
    return {
      t: 'room.state',
      // 2026-11-05：aiTakeoverEnabled 恒下发（客户端按 `=== true` 判面板），投票列表仍只在开启时带上。
      aiTakeoverEnabled: this.aiTakeoverEnabled === true,
      ...(this.aiTakeoverEnabled ? { aiTakeoverVotes: this.aiTakeoverVotes || [] } : {}),
      ...(this.aiRandomHandover ? { aiRandomHandover: true } : {}),
      code: this.code,
      hostId: this.hostId,
      mode: this.mode,
      difficulty: this.difficulty,
      aiPicksLast: this.aiPicksLast,
      // 危机合约 (room.setContracts): the current selection, so a client that joins / resyncs reads what the host
      // ticked. Omitted when empty, so a room without contracts keeps its room.state byte-identical.
      ...(this.contracts.length ? { contracts: this.contracts.slice() } : {}),
      inMatch: !!this.match,
      // 座位上限：对抗房 = 2 × teamSize（2026-10-27）；其余房间 = 房主选的 seatCap（2026-11-07 业主：默认 4 席，
      // 客户端滑条改的就是它）。此前非对抗房不下发这个键，客户端按 MAX_SEATS(20) 画满 —— 4 人房也显示 20 个空座位。
      // 键恒存在：客户端据此画几张座位卡（plugins/*/client/js/screens/room.js normalizeSeats）。
      seatCap: this.mode === 'versus' && this.teamSize ? this.teamSize * 2 : this.seatCap,
      // 玩法变体（xie / rogue）：客户端按它区分入口与文案
      ...(typeof this.variant === 'string' && this.variant ? { variant: this.variant } : {}),
      seats: this.seats.map((s) => (s
        ? { seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, ready: s.ready, connected: s.connected && !s.left,
          // a room with gameplay plugins (header "Gameplay plugins"): has this player's page loaded and checked its content?
          ...(this.needsContent && !s.isBot ? { content: s.content || 'loading' } : {}),
          // 名片干员 (room.card): only a human seat with a card carries the key
          ...(!s.isBot && s.card ? { card: s.card } : {}),
          ...(!s.isBot && s.tag ? { tag: s.tag } : {}),
          ...(!s.isBot && s.nc ? { nc: s.nc } : {}),
          // 干员皮肤 (room.skins, PUBLIC like Match.publicView().players[].skins): the seat card's outfit (header);
          // only a human seat with a non-empty map carries the key
          ...(!s.isBot && s.skins && Object.keys(s.skins).length ? { skins: s.skins } : {}) }
        : null)),
      spectators: this.spectators.map((s) => ({ playerId: s.playerId, name: s.name, connected: s.connected,
        ...(s.tag ? { tag: s.tag } : {}), ...(s.nc ? { nc: s.nc } : {}), ...(this.needsContent ? { content: /** @type {any} */ (s).content || 'loading' } : {}) })),
      ...(this.content ? { content: this.content.trusted ? {...this.content, trusted:{...this.content.trusted, consent:Object.fromEntries(this.seats.filter(x => x && !x.isBot).map(x => [x.seat,x.consentCs === this.content.cs]))}} : this.content } : {}),
      // another official version than 第二期下半, and its open vote (header "Official versions"): omitted otherwise, so a
      // default room's room.state stays identical
      ...(this.version !== DEFAULT_VERSION ? { version: this.version } : {}),
      ...(this.versionVote ? { versionVote: { id: this.versionVote.id, proposerId: this.versionVote.proposerId, version: this.versionVote.version,
        voters: [...this.versionVote.voters], agreed: this.versionVote.voters.filter((id) => this.versionVote?.agreed.has(id)),
        remainingMs: Math.max(0, Math.round(this.versionVote.expiresAt - now)) } } : {}),
      // omitted when false so a normal room.state stays identical
      ...(this.test ? { test: true } : {}),
      // 「不限时」 (header): omitted unless on, so a default room.state stays identical
      ...(this.soloUnlimited === true ? { soloUnlimited: true } : {}),
      // 「包含无场景地图」 (header): likewise omitted unless on
      ...(this.incompleteMaps === true ? { incompleteMaps: true } : {}),
      // 肉鸽「地图主题池」 (header): omitted for 'all' (a default room.state stays identical)
      ...(this.mapPool !== 'all' ? { mapPool: this.mapPool } : {}),
      // 插件平铺进 room.state 的字段（后写的覆盖同名核心键；插件自己保证不冲撞）
      ...(this.ext?.state?.(this) || {}),
    };
  }
}

/** Room registry + lobby message handlers. Pass an instance as the `handler` of net.js Network. */
export class Lobby {
  /**
   * @param {{
   *   registry: import('./net.js').SessionRegistry,
   *   log?: { info: Function, warn: Function, error: Function, debug?: Function },
   *   MatchClass?: new (opts: object) => any,
   *   getData?: () => object,
   *   now?: () => number,
   *   seedFn?: () => number,
   *   content?: { cs: string } | null,
   *   plugins?: { resolve: (ids: string[], opts?: { scope?: 'room' | 'personal', settings?: object, replacing?: object | null }) => any,
   *     hold?: (vs: string) => void, release?: (vs: string) => void, holdContent?: (cs: string) => void,
   *     releaseContent?: (cs: string) => void, onContentStale?: (fn: (cs: string, ids: string[]) => void) => () => void, onStale?: (fn: (vs: string, ids: string[]) => void) => () => void,
   *     unofficial?: () => number, hasNotices?: () => boolean, defaults?: () => string[], dataOf?: (cs: string) => any, kittedOf?: (cs: string) => any,
   *     contentInUse?: () => number } | null,
   *   hosts?: { create: (cs: string, opts: object) => any, stats?: () => object } | null,
   *   versions?: ReturnType<typeof import('./versions.js').createVersionSets> | null,
   *   versionHosts?: { create: (cs: string, opts: object) => any, stats?: () => object } | null,
   *   options?: Partial<typeof LOBBY_DEFAULTS>,
   * }} opts
   *   content: the server's vanilla content (server/plugins/identity.js; header "Content identity"); plugins: what a host
   *   chooses from — the room's sets (server/plugins/roomSets.js: visual sets and content sets; header "The room's
   *   plugins", "Gameplay plugins"); hosts: the match hosts a room with gameplay plugins runs its match in
   *   (server/match/host/index.js; none: such a match runs here, unit tests); versions: the official versions this server
   *   offers (server/versions.js; none: 第二期下半 alone — header "Official versions"); versionHosts: the match hosts of
   *   the other versions (server/match/host/index.js, kind 'version')
   */
  constructor({ registry, log = noopLog, MatchClass = DefaultMatch, getData = defaultGetData, now = Date.now, seedFn, content = null, plugins = null, hosts = null,
    versions = null, versionHosts = null, simPool = null, options = {} }) {
    this.registry = registry;
    /** the vanilla content set every room plays (header "Content identity"), or null */
    this.vanilla = content && isContentHash(content.cs) ? Object.freeze({ cs: content.cs, vanilla: true, plugins: Object.freeze([]) }) : null;
    /** the server's room sets — visual and content (header "The room's plugins", "Gameplay plugins"), or null */
    this.plugins = plugins;
    /** the match hosts (header "Gameplay plugins"), or null */
    this.hosts = hosts;
    /** the official versions this server offers and their match hosts (header "Official versions"), or null */
    this.versions = versions;
    this.versionHosts = versionHosts;
    /**
     * The server's own simulation pool for bot rehearsals (server/workers/roomPool.js), or null when the operator
     * started none — then every rehearsal stays on this thread, exactly as before.
     */
    this.simPool = simPool;
    this.log = log;
    this.MatchClass = MatchClass;
    this.getData = getData;
    this.now = now;
    this.seedFn = seedFn || (() => randomInt(2 ** 32));
    const testModeOpt = options.testMode;
    const testHostOpt = options.testHost;
    if (Object.hasOwn(options, 'testMode') || Object.hasOwn(options, 'testHost')) {
      options = { ...options };
      delete options.testMode;
      delete options.testHost;
    }
    this.opts = { ...LOBBY_DEFAULTS, ...options };
    // A fixed alliance key (--room-code / roomCode): every room this process creates uses it. server/index.js parses
    // the argument once at startup; a test passes it directly. Nothing is read from the environment or persisted.
    if (this.opts.roomCode) {
      // The fixed key is an admission secret: ordinary room lifecycle logs must not expose it either.
      const key = this.opts.roomCode;
      this.log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level,
        (...args) => log[level]?.(...args.map(value => typeof value === 'string' ? value.split(key).join('[fixed room]') : value)),
      ]));
    }
    // Test rooms stay off until the bound address is known (setTestHost). An empty host fails closed, so a
    // server that is about to bind 0.0.0.0 does not briefly accept test rooms on the default. [ASSUMED] the
    // env words are parsed in server/testMode.js.
    const rawMode = testModeOpt != null ? testModeOpt : (typeof process !== 'undefined' && process.env ? process.env.SP_TEST_MODE : undefined);
    this.testMode = parseTestModeEnv(rawMode);
    this.testUnrecognized = unrecognizedTestMode(rawMode);
    this.testHost = '';
    this.testEnabled = false;
    this.testWarn = this.testUnrecognized;
    if (testHostOpt != null) this.setTestHost(testHostOpt);
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /** @type {Map<string, NodeJS.Timeout>} lobby grace timers by playerId */
    this.graceTimers = new Map();
    /** @type {Map<string, NodeJS.Timeout>} deferred (coalesced) resyncs by playerId */
    this.resyncTimers = new Map();
    /** per-network limit warnings: at most one log line per 10 s (the rest are counted) */
    this.limitLog = { at: -Infinity, suppressed: 0 };
    /** log lines said once (warnOnce) */
    this.told = new Set();
    /** a held visual set whose plugins changed on disk: its rooms' hosts are told (header "The room's plugins") */
    this.offStale = typeof plugins?.onStale === 'function' ? plugins.onStale((vs, ids) => this.pluginsChanged(vs, ids)) : null;
    /**
     * Whether a room applies a change of its plugins on disk by itself (header "The room's plugins"): `({ code, hostId,
     * humans, inMatch }) => boolean`, set by the plugin studio (server/studio/index.js); null — every host is told.
     * @type {((room: { code: string, hostId: string, humans: number, inMatch: boolean }) => boolean) | null}
     */
    this.autoApplyPlugins = null;
    /**
     * 默认插件集的启动预热（server/boot-main.js warmContentForRoom，端口打开后由那份代码挂上来）：建房要用的插件集
     * 正被预热构建时返回同一个 Promise，否则 null。没挂（单元测试直接 new Lobby、没有插件层的进程）就一律现算。
     * @type {((ids: string[], version: string) => Promise<unknown> | null) | null}
     */
    this.warmContent = null;
    this.offContentStale = plugins?.onContentStale?.((cs, ids) => this.pluginsChanged(cs, ids, 'content')) || null;
  }

  /**
   * The address this process bound. Test rooms stay disabled until this runs. `host` empty fails closed.
   * @param {string} host
   * @returns {{ enabled: boolean, warn: string|null }}
   */
  setTestHost(host) {
    this.testHost = typeof host === 'string' ? host : '';
    const gate = testModeGate(this.testMode, this.testHost);
    this.testEnabled = gate.enabled === true;
    this.testWarn = this.testUnrecognized || gate.warn;
    return { enabled: this.testEnabled, warn: this.testWarn };
  }

  /**
   * The plugins `ids` of the visual set `vs` changed on disk: the host of every room using it is told to apply the room's
   * plugins again (header "The room's plugins") — a host offline now misses it; the panel's 「重新应用」 is always there.
   * @param {string} vs @param {string[]} ids
   */
  pluginsChanged(vs, ids, kind = 'visual') {
    for (const room of this.rooms.values()) {
      if (room.disposed || (kind === 'content' ? room.content?.cs : room.content?.vs) !== vs) continue;
      const noticeKey = `${room.content?.cs}|${room.content?.vs || ''}`;
      if (room.pluginNoticeKeys[kind] === noticeKey) continue;
      // the plugin studio's rooms (the author hosts, or plays alone): the same choice again at once (refreshPlugins)
      let auto;
      try { auto = !!this.autoApplyPlugins?.({ code: room.code, hostId: room.hostId, humans: room.activeHumans().length, inMatch: !!room.match }); } catch { auto = false; }
      if (kind === 'visual' && auto && this.refreshPlugins(room)) continue;
      room.pluginNoticeKeys[kind] = noticeKey;
      this.log.info(`[lobby] ${room.code} plugins changed on disk: ${ids.join(', ')} — the host is asked to apply them again`);
      // during a match the panel cannot change them: the host hears it once the room is back in its lobby (onMatchEnd)
      room.pluginsChanged = [...new Set([...(room.pluginsChanged || []), ...ids])];
      if (!room.match) this.tellPluginsChanged(room);
    }
  }

  /**
   * `/mod` 改了插件（启用/禁用、上传、抓取）之后：在线房间能热重应用的就地重应用，不能的告知房主。
   *
   * 能热应用的只有「纯外观房间」（`refreshPlugins` 的判据）；含玩法插件的房间换的是 `cs`，所有人要重新加载内容，
   * 只能让房主在面板里确认（`tellPluginsChanged`）—— 这是内容集机制的硬约束，不是这里的选择。
   * @param {string[]} ids the plugin ids that changed on disk
   */
  pluginsReloaded(ids = []) {
    for (const room of this.rooms.values()) {
      if (room.disposed) continue;
      if (this.refreshPlugins(room)) continue;
      room.pluginsChanged = [...new Set([...(room.pluginsChanged || []), ...ids])];
      if (!room.match) this.tellPluginsChanged(room);
    }
  }

  /**
   * Apply a room's plugins again as they are on disk now (header "The room's plugins": the plugin studio's rooms) — the
   * plugins its host chose (not the 「自动」 ones), resolved again (resolveContent); the room's content becomes the new set,
   * held in its place, and every member hears it. Allowed during a match: a cosmetic set never changes a battle (the `cs`
   * stays the vanilla one) and nobody is un-readied. Only a room of cosmetic plugins: one with gameplay plugins (DESIGN
   * §32.6) would get another `cs` — every page loads and checks it again, the players are un-readied, a match keeps its
   * set — so its host is told instead, as is the host of a room whose plugins would now make one. Whether it worked
   * (false: the host is told).
   * @param {Room} room
   */
  refreshPlugins(room) {
    const before = room.content;
    if (!before?.vs || before.vanilla === false || !this.vanilla || !this.plugins) return false;
    const ids = before.plugins.filter((p) => !p.auto).map((p) => p.id);
    const r = this.resolveContent(room, ids);
    if (!('content' in r) || !r.content) { this.log.info(`[lobby] ${room.code} plugins changed on disk and no longer apply: ${'detail' in r && r.detail ? r.detail : ('error' in r ? r.error : '?')}`); return false; }
    const next = r.content;
    if (next.vanilla === false || !next.vs) return false;
    room.pluginsChanged = null;
    if (next.vs === before.vs) return true;
    room.content = next;
    this.holdContent(next);
    this.releaseContent(before);
    this.log.info(`[lobby] ${room.code} plugins applied again: ${next.plugins.map((p) => `${p.id}@${p.version}`).join(', ')}`);
    this.broadcastState(room);
    return true;
  }

  /** Tell the host of `room` that its plugins changed on disk (pluginsChanged), once. @param {Room} room */
  tellPluginsChanged(room) {
    const ids = room.pluginsChanged;
    room.pluginsChanged = null;
    // the room's set changed since (re-applied, switched off): nothing to tell
    if (!ids || !room.content?.plugins?.length) return;
    const names = ids.slice(0, 8).join('、');
    this.sendToPlayer(room, room.hostId, { t: 'm.toast', kind: 'warn', ...wireMessage(msg('房间插件「{names}」的文件在服务器上变了，请在插件面板中点「重新应用」', { names })) });
  }

  /** @param {string} code @returns {Room | null} */
  getRoom(code) { return this.rooms.get(String(code).toUpperCase()) || null; }

  /** Counters for /healthz and the lobby snapshot. */
  stats() {
    let matches = 0;
    let humans = 0;
    let bots = 0;
    let spectators = 0;
    for (const r of this.rooms.values()) {
      if (r.match) matches++;
      for (const s of r.seats) if (s && !s.left) (s.isBot ? bots++ : humans++);
      spectators += r.spectators.length;
    }
    // 在线人数 = 绑定着活连接的会话数。业主 2026-11-02：「大厅在线人数显示不对」——之前这里是
    // humans + spectators（房间里的座次），待在大厅没进房的人不算，掉线但还在重连窗口内的座次反而算，
    // 于是数字既不等于在线玩家、也不等于连接数。registry 里每个会话有唯一 playerId，connected=false
    // 的是「掉线等重连」，bot 没有会话，所以这个计数就是「此刻真的在线的人」。
    let online = 0;
    try {
      for (const s of this.registry.all()) if (s.connected) online++;
    } catch {
      online = humans + spectators; // 没有 registry（单测里手工构造）时退回旧口径
    }
    return { rooms: this.rooms.size, matches, humans, bots, spectators, online };
  }

  /**
   * 大厅快照（业主 2026-10-31：「当前人数显示不准确，房间也是」「根本没做大厅公开机制」）：
   * 在线人数 + 房间/对局数 + **公开房间列表**（私密房不进列表；列表最多 50 条）。
   * 口径与 `/healthz` 的 stats 同源，前端不再把「连接状态」当人数。
   */
  lobbySnapshot() {
    const st = this.stats();
    const list = [];
    for (const r of this.rooms.values()) {
      if (r.disposed || r.private === true) continue;
      const humans = r.seats.filter((s) => s && !s.left && !s.isBot).length;
      list.push({
        code: r.code, mode: r.mode, difficulty: r.difficulty, variant: r.variant || null,
        humans, seats: r.seats.filter(Boolean).length, inMatch: !!r.match, test: r.test === true,
      });
    }
    // 等人多的、没开局排前面（可直接加的那种）
    list.sort((a, b) => (Number(a.inMatch) - Number(b.inMatch)) || (b.humans - a.humans) || a.code.localeCompare(b.code));
    return { t: 'lobby.state', online: st.online, humans: st.humans, bots: st.bots, spectators: st.spectators, rooms: st.rooms, matches: st.matches, list: list.slice(0, 50) };
  }

  /** C2S `room.list`：把大厅快照直接回给请求者（客户端进大厅后轮询它）。 */
  sendLobbySnapshot(session) {
    try { sendSession(session, this.lobbySnapshot()); } catch { /* 尽力而为 */ }
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------------------
  // net.js handler interface
  // ---------------------------------------------------------------------------------------------------

  /**
   * After `welcome`: resend room state / match state for resumed (or repeated) hellos.
   * @param {import('./net.js').Session} session
   * @param {{ resumed: boolean, repeat: boolean }} info
   */
  onHello(session, { resumed, repeat }) {
    if (!resumed && !repeat) return;
    const room = this.roomOf(session);
    if (!room) {
      if (session.notice) {
        sendSession(session, { t: 'room.closed', reason: session.notice });
        session.notice = null;
      }
      if (session.pendingResult) {
        for (const frame of session.pendingResult) if (frame) sendRaw(session.ws, frame);
        session.pendingResult = null;
      }
      return;
    }
    session.notice = null;
    session.pendingResult = null;
    // a player seat, or a spectator seat (header): both carry `connected` / `name`
    const seat = room.seatOf(session.playerId) || room.spectatorOf(session.playerId);
    this.clearGrace(session.playerId);
    // Only a visible change (reconnect, rename, new host) is broadcast; a plain resync (repeated hello on a
    // live socket) answers the requester alone, so hello spam cannot amplify into room-wide traffic.
    let changed = !seat.connected;
    seat.connected = true;
    if (!room.match && seat.name !== session.name) { seat.name = session.name; changed = true; }
    if (!room.match && session.tag && seat.tag !== session.tag) { seat.tag = session.tag; changed = true; }
    if (!room.match && session.nc && seat.nc !== session.nc) { seat.nc = session.nc; changed = true; }
    if (!room.hostId) { this.migrateHost(room); changed = true; }
    if (changed) this.broadcastState(room);
    else this.sendState(room, session);
    this.resync(session, !resumed);
  }

  /**
   * Validated client message from an identified session. A room whose match runs in a match host handles its
   * messages one at a time, in order (serial; header "Gameplay plugins"): the answer is then a Promise (server/net.js
   * replies when it settles).
   * @param {import('./net.js').Session} session
   * @param {any} msg
   * @returns {{ ok: true } | { error: string, detail?: string } | Promise<{ ok: true } | { error: string, detail?: string }>}
   */
  onMessage(session, msg) {
    const room = this.queuedRoom(session);
    if (!room) return this.handleMessage(session, msg);
    // a queued room.contentReady speaks for the page that sent it: the seat and its generation now — a disconnect in
    // between bumps it, and the page that comes back checks the set again (contentReady)
    const ctx = msg && msg.t === 'room.contentReady' ? { from: this.seatGen(room, session.playerId) } : null;
    return this.serial(room, () => this.handleMessage(session, msg, ctx));
  }

  /** A seat (or spectator seat) of `room` and its content generation (header "Gameplay plugins"), or null. */
  seatGen(room, playerId) {
    const seat = room.seatOf(playerId) || room.spectatorOf(playerId);
    return seat ? { seat, gen: seat.contentGen || 0 } : null;
  }

  /**
   * The room of `session` when its messages go through the room's queue: its match runs in a match host
   * (MatchProxy `hosted`), or something of the room is still pending. Null for every vanilla room.
   * @param {import('./net.js').Session} session
   */
  queuedRoom(session) {
    const room = session.roomCode ? this.rooms.get(session.roomCode) : null;
    return room && !room.disposed && (room.queue.pending > 0 || room.match?.hosted === true) ? room : null;
  }

  /**
   * Run `fn` on the room's queue (header "Gameplay plugins"): at once when nothing of the room is pending — a synchronous
   * answer stays synchronous —, else after everything before it has settled. An answer that is a Promise keeps the room's
   * queue busy until it settles.
   * @template T
   * @param {Room} room @param {() => T} fn
   * @returns {T | Promise<Awaited<T>>}
   */
  serial(room, fn) {
    const q = room.queue;
    if (q.pending === 0) {
      const r = fn();
      if (!r || typeof /** @type {any} */ (r).then !== 'function') return r;
      q.pending++;
      const done = Promise.resolve(r).finally(() => { q.pending--; });
      q.tail = done.then(() => {}, () => {});
      return /** @type {any} */ (done);
    }
    q.pending++;
    const done = q.tail.then(() => fn()).finally(() => { q.pending--; });
    q.tail = done.then(() => {}, () => {});
    return /** @type {any} */ (done);
  }

  /** An event of the room (a disconnect, a resync, an expiry) on its queue: nothing waits for it; a failure is logged. */
  queueEvent(room, fn) {
    let r;
    try { r = this.serial(room, fn); } catch (e) { this.log.error(`[lobby] ${room.code} a room event failed`, e); return; }
    if (r && typeof r.then === 'function') r.then(null, (e) => this.log.error(`[lobby] ${room.code} a room event failed`, e));
  }

  /**
   * One message (onMessage), now. `ctx`: what onMessage noted when it queued the message (a contentReady's seat
   * generation), else null.
   * @param {import('./net.js').Session} session
   * @param {any} msg
   * @param {{ from?: { seat: Seat, gen: number } | null } | null} [ctx]
   */
  handleMessage(session, msg, ctx = null) {
    switch (msg.t) {
      case 'room.create': return this.create(session, msg);
      case 'room.join': return this.join(session, msg);
      case 'room.leave': return this.leave(session);
      case 'room.list': return this.sendLobbySnapshot(session);
      case 'room.ready': return this.ready(session, msg);
      case 'room.setDifficulty': return this.setDifficulty(session, msg);
      case 'room.setContracts': return this.setContracts(session, msg);
      case 'room.setAiPicksLast': return this.setAiPicksLast(session, msg);
      case 'room.setSoloUnlimited': return this.setSoloUnlimited(session, msg);
      case 'room.setIncompleteMaps': return this.setIncompleteMaps(session, msg);
      case 'room.setSeatCap': return this.setSeatCap(session, msg);
      case 'room.setAiTakeover': return this.setAiTakeover(session, msg);
      case 'room.setAiRandom': return this.setAiRandom(session, msg);
      case 'room.aiRequest':
      case 'room.aiVote': return aiTakeover(this, session, msg);
      case 'room.aiTakeover': return aiTakeoverDirect(this, session, msg);
      case 'room.addBot': return this.addBot(session);
      case 'room.removeBot': return this.removeBot(session, msg);
      case 'room.kick': return this.kick(session, msg);
      case 'room.start': return this.start(session);
      case 'room.rerollSetup': return this.rerollSetup(session, msg);
      case 'room.cancelReroll': return this.rerollSetup(session, msg, true);
      case 'room.loadout': return this.loadout(session, msg);
      case 'room.ownership': return this.ownership(session, msg);
      case 'room.diy': return this.diy(session, msg);
      case 'room.skins': return this.skins(session, msg);
      case 'room.card': return this.card(session, msg);
      case 'room.spectate': return this.spectate(session, msg);
      case 'room.removeSpectator': return this.removeSpectator(session, msg);
      case 'room.setPlugins': return this.setPlugins(session, msg);
      case 'room.setMode': return this.setMode(session, msg);
      case 'room.contentReady': return this.contentReady(session, msg, ctx);
      case 'room.consent': return this.consent(session,msg);
      case 'room.proposeVersion': return this.proposeVersion(session, msg);
      case 'room.versionVote': return this.versionVote(session, msg);
      case 'room.cancelVersionVote': return this.cancelVersionVote(session, msg);
      // A client that missed a state-delta frame asks for a full one (shared/stateDelta.js StateReceiver; server/net.js
      // throttles it like the other resend-heavy intents). This is the same heavy resync a repeated hello runs, so it
      // draws from the same per-session budget: the match resends its full state, or the lobby its room state.
      case 'state.resync': return this.resync(session, true) ?? { ok: true };
      default:
        if (typeof msg.t === 'string' && msg.t.startsWith('g.')) return this.routeGameNow(session, msg);
        {
          const h = this.ext?.handlers?.get(msg.t);
          if (h) return h(session, msg, ctx, this);
        }
        return fail(ERR.BAD_MSG, `unhandled type ${String(msg.t).slice(0, 32)}`);
    }
  }

  /** The session's socket closed. @param {import('./net.js').Session} session */
  onDisconnect(session) {
    this.clearResync(session.playerId); // the next resume resyncs immediately
    const room = this.roomOf(session);
    // a solo run may be resumed within singleReconnectTime (24 h); everything else keeps the registry's window
    session.resumeWindowMs = room && room.match && room.mode === 'solo' ? this.soloResumeWindowMs(room) : null;
    if (!room) return;
    const player = room.seatOf(session.playerId);
    const seat = player || room.spectatorOf(session.playerId);
    seat.connected = false;
    // the page may come back as a new one (a reload): it loads and checks the room's content again (header "Gameplay
    // plugins") — and a room.contentReady of the page that went, still on the room's queue, no longer counts (seatGen)
    if (room.needsContent) seat.content = null;
    seat.contentGen = (seat.contentGen || 0) + 1;
    // a voter's socket dropped: the version vote is void (header "Official versions")
    if (player && room.versionVote?.voters.includes(session.playerId)) this.voidVersionVote(room, 'members');
    // a spectator's seat is kept like a player's (nothing to tell the match: it plays no field)
    if (room.match) {
      if (player) {
        // a match in a match host hears it in order with the room's messages (header "Gameplay plugins") — not at
        // all when the player is back by then (the resync after the reconnect tells it onReconnect)
        if (this.queuedRoom(session)) this.queueEvent(room, () => { if (!session.connected) this.callMatch(room, 'onDisconnect', session.playerId); });
        else this.callMatch(room, 'onDisconnect', session.playerId);
      }
    } else this.startGrace(room, seat);
    this.broadcastState(room);
  }

  /** The session's reconnect window elapsed (already removed from the registry). */
  onExpire(session) {
    session.notice = null;
    session.pendingResult = null;
    this.clearResync(session.playerId);
    const code = session.roomCode;
    const room = code ? this.rooms.get(code) : null;
    // in order with the room's messages when its match runs in a match host (header "Gameplay plugins")
    if (room && this.queuedRoom(session)) {
      this.queueEvent(room, () => { if (session.roomCode === code) session.roomCode = null; this.removeMember(room, session.playerId); });
      return;
    }
    session.roomCode = null;
    if (room) this.removeMember(room, session.playerId);
  }

  /**
   * Dispose every room (notifying members with room.closed) — used on server shutdown.
   * @param {string} [reason]
   */
  shutdown(reason = 'shutdown') {
    this.offStale?.();
    this.offContentStale?.();
    this.offStale = null;
    this.offContentStale = null;
    for (const room of [...this.rooms.values()]) this.disposeRoom(room, reason);
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    for (const t of this.resyncTimers.values()) clearTimeout(t);
    this.resyncTimers.clear();
  }

  // ---------------------------------------------------------------------------------------------------
  // room.* handlers
  // ---------------------------------------------------------------------------------------------------

  create(session, { mode, difficulty: asked, test, version: askedVersion, soloUnlimited, teamSize, variant, versusAlt, versusSpeed, mapPool } = {}) {
    // A test room exists only when the process switch allowed it. The check runs before the room is built.
    if (test === true && this.testEnabled !== true) return fail(ERR.TEST_DISABLED);
    // the official version (header "Official versions"): left out, the server's default
    const version = askedVersion ?? this.defaultVersion();
    if (!this.versionEnabled(version)) return fail(ERR.VERSION_UNKNOWN);
    if (!this.offered(version, mode).length) return fail(ERR.VERSION_UNSUPPORTED, `${version} has no ${mode} rooms`);
    if (!this.versionAvailable(version)) return fail(ERR.VERSION_UNSUPPORTED, 'the data of this version is not available');
    // left out: the default (header); the protocol refuses any other value that is not a difficulty; one the version
    // lacks is lowered (终极 → 绝境). 训练模式 (mode_training_1) is its own gate: solo rooms whose data carries it.
    // 肉鸽（`mode: 'rogue'`）的难度表是 N1–N20（difficultiesFor('rogue')）：不在这里放行，协议放过来的 N 档会
    // 被当成「不认识」而落到默认档 FUNNY，再被 fallbackDifficulty 降到 N1（2026-11-03 修）。
    const askedOk = DIFFICULTIES.includes(asked) || LEGACY_DIFFICULTIES.includes(asked)
      || (mode === 'rogue' && this.offered(version, mode).includes(asked))
      || (asked === TRAINING_DIFFICULTY && this.offersTraining(version, mode));
    const difficulty = this.fallbackDifficulty(version, mode, askedOk ? asked : DEFAULT_DIFFICULTY);
    const cur = this.roomOf(session);
    if (cur && cur.match) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (this.rooms.size >= this.opts.maxRooms) return fail(ERR.INTERNAL, 'too many rooms');
    const key = session.limitKey || null;
    // The room being left disappears with this create when the creator is its only human (a spectator is none).
    const leaving = !!cur && cur.activeHumans().length === 1 && !cur.spectatorOf(session.playerId);
    if (key && this.opts.maxRoomsPerAddr > 0) {
      if (this.countRooms((r) => r.ownerKey === key) - (leaving && cur.ownerKey === key ? 1 : 0) >= this.opts.maxRoomsPerAddr) {
        this.limitWarn(`room limit (${this.opts.maxRoomsPerAddr}) reached for ${session.addr}`);
        return fail(ERR.RATE, 'too many rooms from your network');
      }
    }
    // A fixed key (--room-code) can only belong to one room. This player's own room may hold it and can be left
    // below (then the key is free again); any other room — or a room this session only watches as a spectator —
    // keeps it, and the create is refused before anything is removed.
    const fixed = this.opts.roomCode || null;
    const fixedIsMine = !!fixed && !!cur && this.rooms.get(fixed) === cur;
    if (fixed) {
      const taken = this.rooms.get(fixed);
      const mine = cur && cur.seatOf(session.playerId);
      const onlyMe = mine && cur.activeHumans().length === 1;
      if (taken && !(taken === cur && onlyMe)) {
        return fail(ERR.ROOM_CODE_TAKEN, 'the fixed alliance key is in use');
      }
    }
    // Treat this sole-human room as yielding its key, but keep membership until all content/version checks pass.
    const code = this.genCode(fixedIsMine ? cur : null);
    if (!code) return fixed ? fail(ERR.ROOM_CODE_TAKEN, 'the fixed alliance key is in use')
      : fail(ERR.INTERNAL, 'no room code available');
    // the server owner's default plugins (plugins/config.json `default`; header "Gameplay plugins"): none — the original
    // game. On another official version (header "Official versions") gameplay plugins are refused: a server whose rooms
    // must play them (rooms: fixed) cannot make that version's room; otherwise the room starts without them. Resolved
    // before the creator leaves the old room (a refusal keeps them there), so a set that room alone holds counts as freed
    // (limits.maxSets), as when the room went first before M1
    let initial = this.contentWithRequired(this.baseContent(version));
    const defaults = this.plugins?.defaults?.() || [];
    if (defaults.length) {
      // 默认插件集可能正被启动预热构建（server/boot-main.js：首次构建要 6-9 s，contentSets 的 memo 键是 ids +
      // 归一化 settings，建完后这里的 resolveContent 直接命中）。所以正是那一套时就等同一个 Promise，而不是把
      // 同一套插件再算一遍。create 保持同步签名（dispatch 层不改）：只有这个冷启动窗口返回 Promise —— server/net.js
      // 本来就按「答案稍后到达」处理 onMessage 的返回值（见那里 res.then 分支）。等待期间房间/配额可能变了，因此
      // 等完重建一次 create；前一轮检查都是只读的（genCode 只挑一个当前未占用的码），重跑会把它们重新校验。
      const warming = this.warmContent?.(defaults, version) || null;
      if (warming) {
        return warming.then(() => this.create(session, {
          mode, difficulty: asked, test, version: askedVersion, soloUnlimited, teamSize, variant, versusAlt, versusSpeed, mapPool,
        }));
      }
      const r = this.resolveContent(null, defaults, {}, version, leaving ? cur.content : null);
      if ('error' in r) {
        const fixed = (() => { try { return this.plugins?.fixed?.() || null; } catch { return null; } })();
        if (fixed && fixed.length && version !== DEFAULT_VERSION) return fail(ERR.VERSION_UNSUPPORTED, `this server fixes every room's plugins (plugins/config.json rooms: fixed): ${r.error}`);
        this.warnOnce(`[lobby] the default plugins (${defaults.join(', ')}) cannot be applied${version !== DEFAULT_VERSION ? ` to ${version}` : ''}: ${r.error}${r.detail ? ` (${r.detail})` : ''}`);
      } else initial = r.content;
    }
    if (cur) this.removeMember(cur, session.playerId);
    const room = new Room(code, mode, difficulty, this.now(), version);
    room.test = test === true;
    // 插件房的分边人数（每队人数，总人数 = 2 × teamSize）：核心只存这一个选项，怎么用由插件的 matchOptions 决定。
    // 2026-10-27 业主：从「只认 2/4」放开到 1..10（总人数 2..20 偶数自定义）。
    if (mode === 'versus') room.teamSize = Number.isInteger(teamSize) && teamSize >= 1 && teamSize <= 10 ? teamSize : 2;
    // 对抗房的座位数由 teamSize 定（2 × 每队人数，≤ 20）：座位数组跟着它长，room.state.seatCap 同口径。
    // 其它房间保持构造器给的 DEFAULT_SEATS（4）—— 房主之后用 room.setSeatCap 改。
    if (mode === 'versus') room.resizeSeats(room.teamSize * 2);
    // 插件房的规则集（例如 协同共竞 'xie'）：核心只存原样字符串，怎么解释由插件的 matchOptions 决定。
    if (typeof variant === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(variant)) room.variant = variant;
    // 对抗是否每回合交换攻守（业主 2026-10-26）：缺省 true（交替）；显式 false 才固定首攻。
    if (mode === 'versus') room.versusAlt = versusAlt !== false;
    // 对抗「倍速」（业主 2026-10-31：赏金档的怪量让玩家自己调）：只认 1 / 1.5 / 2，其它一律回 1。
    if (mode === 'versus') room.versusSpeed = versusSpeed === 1.5 || versusSpeed === 2 ? versusSpeed : 1;
    // 「不限时」 only on a solo room of a version whose solo is timed (header). Anywhere else the key is ignored, so a
    // stray true cannot change a default or co-op create.
    if (mode === 'solo' && soloUnlimited === true && this.versionSoloTimed(version)) room.soloUnlimited = true;
    // 肉鸽「地图主题池」 (header): 只认合法的池 id，且只在肉鸽房里落地 —— 非肉鸽局没有 `rogue_ro*` 图，
    // 收窄会把池清空。'all' / 缺省 / 非法值都不落键（默认值就是 'all'）。
    if ((mode === 'rogue' || variant === 'rogue') && isPool(mapPool) && mapPool !== 'all') room.mapPool = mapPool;
    room.content = initial;
    if (initial !== this.baseContent(version)) this.holdContent(initial);
    room.ownerKey = key;
    room.seats[0] = this.humanSeat(0, session, room);
    room.hostId = session.playerId;
    room.ext = this.ext;
    this.ext?.init?.(room);   // 插件的房间默认字段（聊天缓冲、房间级开关…）在首次广播之前就位
    this.rooms.set(code, room);
    session.roomCode = code;
    session.notice = null;
    session.pendingResult = null;
    this.log.info(`[lobby] ${code} created (${mode}/${difficulty}${version !== DEFAULT_VERSION ? `, ${version}` : ''}${room.test ? ', test' : ''}) by ${session.name}`);
    this.broadcastState(room);
    this.ext?.emit?.('created', room);
    return OK;
  }

  join(session, { code, testAck }) {
    const norm = String(code).trim().toUpperCase();
    const room = norm.length === ROOM_CODE_LEN ? this.rooms.get(norm) : undefined;
    if (!room) return fail(ERR.ROOM_NOT_FOUND);
    if (room.test && testAck !== true) return fail(ERR.TEST_CONFIRM);
    const cur = this.roomOf(session);
    // idempotent for members; a spectator of this room goes on below: it may take a free player seat (header)
    if (cur === room && !room.spectatorOf(session.playerId)) { this.sendState(room, session); return OK; }
    if (cur && cur.match) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo room');
    // 座位上限：对抗房 = 2 × 每队人数（2026-10-27）；其它房间 = 房主选的 seatCap（2026-11-07 默认 4，此前恒为 20）。
    // 因为 seats 数组长度就是 seatCap，下面 freeSeat() < 0 已经等价于满员；这里仍先按上限判一次，读起来就是「满」。
    if (room.mode === 'versus' && room.teamSize && takenSeats(room) >= room.teamSize * 2) return fail(ERR.ROOM_FULL);
    if (takenSeats(room) >= room.seatCap) return fail(ERR.ROOM_FULL);
    const idx = room.freeSeat();
    if (idx < 0) return fail(ERR.ROOM_FULL);
    // a human takes a player seat: the version vote is void (header "Official versions") — before the seat is taken, so
    // its toast reaches the members who saw the vote (a spectator sitting down too), never a joiner who did not
    if (room.versionVote) this.voidVersionVote(room, 'members');
    if (cur) this.removeMember(cur, session.playerId);
    room.seats[idx] = this.humanSeat(idx, session, room);
    session.roomCode = room.code;
    session.notice = null;
    session.pendingResult = null;
    if (!room.hostId) room.hostId = session.playerId;
    room.ext = this.ext;
    this.ext?.init?.(room);
    this.broadcastState(room);
    this.ext?.emit?.('joined', room, session);
    return OK;
  }

  leave(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    this.removeMember(room, session.playerId);
    return OK;
  }

  /**
   * room.spectate: one of a co-op room's MAX_SPECTATORS spectator seats, in its lobby or during its match (header). In a
   * running match the match registers the spectator and resends what it may see (Match.addSpectator).
   */
  spectate(session, { code, testAck }) {
    const norm = String(code).trim().toUpperCase();
    const room = norm.length === ROOM_CODE_LEN ? this.rooms.get(norm) : undefined;
    if (!room) return fail(ERR.ROOM_NOT_FOUND);
    if (room.test && testAck !== true) return fail(ERR.TEST_CONFIRM);
    const cur = this.roomOf(session);
    if (cur === room) {
      if (!room.spectatorOf(session.playerId)) return fail(ERR.ALREADY, 'seated as a player');
      this.sendState(room, session);
      return OK;
    }
    if (cur && cur.match) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo room');
    if (room.spectators.length >= MAX_SPECTATORS) return fail(ERR.ROOM_FULL, 'no free spectator seat');
    if (cur) this.removeMember(cur, session.playerId);
    room.spectators.push({ playerId: session.playerId, name: session.name, connected: session.connected });
    session.roomCode = room.code;
    session.notice = null;
    session.pendingResult = null;
    this.broadcastState(room);
    if (room.match) this.callMatch(room, 'addSpectator', session.playerId);
    return OK;
  }

  /** room.removeSpectator (host, any time): the spectator gets room.closed {kicked} and its seat is freed. */
  removeSpectator(session, { playerId }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (!room.spectatorOf(playerId)) return fail(ERR.BAD_TARGET, 'not a spectator of this room');
    const target = this.registry.byId(playerId);
    const wasHere = !!target && target.roomCode === room.code;
    const replay = this.replayFor(room, playerId);
    this.removeMember(room, playerId);
    if (wasHere) {
      // like room.kick: now, or on the next resume (with the result replay, as after the grace timeout)
      if (target.connected) sendSession(target, { t: 'room.closed', reason: 'kicked' });
      else { target.notice = 'kicked'; target.pendingResult = replay; }
    }
    return OK;
  }

  ready(session, { ready }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    const seat = room.seatOf(session.playerId);
    // a room with gameplay plugins: ready once the page has loaded and checked its content (header "Gameplay plugins")
    if (ready && room.needsContent && seat.content !== 'ready') return fail(ERR.CONTENT_NOT_READY);
    if (seat.ready !== ready) {
      seat.ready = ready;
      this.broadcastState(room);
    }
    return OK;
  }

  setDifficulty(session, { difficulty }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    // the room's version offers it (header "Official versions": 第二期上半 / 第一期 have no 终极)
    // 版本提供的档位；旧 4 档名另外放行（老客户端），但前提是这个版本的数据里确实有那条 mode。
    // 训练模式（入门协议）只给单人房，且该版本数据里有 mode_training_1（difficultyAllowed）。
    if (!this.difficultyAllowed(room.version, room.mode, difficulty)) {
      return fail(ERR.BAD_TARGET, 'not a mode of this version');
    }
    this.dropReplay(room, session.playerId);
    // a plugin mode chosen (header "Gameplay plugins") carries its own difficulty: picking one leaves it
    if (room.difficulty !== difficulty || room.content?.modeId) {
      room.difficulty = difficulty;
      if (room.content?.modeId) { const rest = { ...room.content }; delete rest.modeId; room.content = Object.freeze(rest); }
      for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
      // 危机合约: a lower difficulty may no longer allow the room's selection (CONTRACT_MIN_DIFFICULTY, minDifficulty);
      // the clearing rides this broadcast, nobody else is told twice
      this.revalidateContracts(room);
      this.broadcastState(room);
    }
    return OK;
  }

  /**
   * room.setContracts (host-only, before the match; 危机合约, shared/contracts.js): the host replaces the room's
   * selection with `contracts`, a list of contract ids from the 危机合约 screen. `contractsValidFor` judges every id
   * against THIS room — its size (`takenSeats`, the lobby's own player count: bots included, spectators not) and its
   * difficulty — and reports the first refusal (`reason` + the offending `bad` id), which becomes the error's detail
   * so the client can say why instead of a bare 无效的目标.
   *
   * A legal list is stored **resolved**: `resolvePicked` applies the exclusivity / prerequisite / profession-limit
   * rules, so what the room keeps — and what the match plays — is one self-consistent selection. Like a difficulty
   * change, a changed selection un-readies the other humans (they re-read the room before ready).
   */
  setContracts(session, { contracts }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (!Array.isArray(contracts)) return fail(ERR.BAD_MSG, 'contracts must be an array');
    const players = takenSeats(room);
    const valid = contractsValidFor(contracts, { players, difficulty: room.difficulty });
    if (!valid.ok) return fail(ERR.BAD_TARGET, `${valid.reason}: ${valid.bad}`);
    const ids = resolvePicked(contracts, players, room.difficulty);
    const same = ids.length === room.contracts.length && ids.every((id, i) => id === room.contracts[i]);
    if (!same) {
      this.dropReplay(room, session.playerId);
      room.contracts = ids;
      for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
      this.broadcastState(room);
    }
    return OK;
  }

  /**
   * 危机合约 (shared/contracts.js): re-check the room's selection against the room **as it is now** — its size
   * (`takenSeats`, the lobby's own count: bots included, spectators not) and its difficulty — and clear it when it no
   * longer holds. `setContracts` only judges the picks of the moment; afterwards the room shrinks (a player leaves, is
   * kicked, a bot is removed, a grace timeout frees a seat) or its difficulty drops (`setDifficulty`, `setMode`, a
   * version switch's `fallbackDifficulty`), and the match would otherwise play a contract the room cannot support —
   * `noLpSharing` needs 5 players, every contract needs 终极 (`CONTRACT_MIN_DIFFICULTY`).
   *
   * Conservative by design: an invalid selection is **cleared**, not narrowed to the part that still resolves. The two
   * differ only on a partial failure, and keeping the survivors would silently play a weaker challenge than the screen
   * showed when the host ticked it; an empty list is something the room already knows how to run (no 危机合约) and the
   * host re-picks it deliberately. `resolvePicked` therefore runs only in `setContracts`.
   *
   * Like a changed selection in `setContracts`, a cleared list un-readies the other humans (they re-read the room before
   * ready). No broadcast here: every call site already broadcasts room.state right after (or `dropReplay`/`voidVersionVote`
   * of the same step), so the clearing never costs a second frame.
   *
   * @param {Room} room @returns {boolean} true when the selection was cleared
   */
  revalidateContracts(room) {
    // a running match owns its own copy (Match.opts.contracts, frozen): the room's list is a lobby-only state
    if (!room || room.disposed || room.match || !room.contracts.length) return false;
    const players = takenSeats(room);
    const valid = contractsValidFor(room.contracts, { players, difficulty: room.difficulty });
    if (valid.ok) return false;
    this.log.info(`[lobby] ${room.code} contracts cleared (${valid.reason}: ${valid.bad}) — room: ${players} players @ ${room.difficulty}`);
    room.contracts = [];
    for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
    return true;
  }

  /** 「AI 队友最后选择」 (GitHub #338): host-only, before the match, co-op rooms only (a solo room has no AI seat). */
  /** Host-only opt-in, fixed before play; inherited seat metrics never become personal rewards (§35.100). */
  setAiTakeover(session, { on }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.mode === 'solo' || (on && room.version !== DEFAULT_VERSION)) return fail(ERR.BAD_TARGET);
    if (room.aiTakeoverEnabled !== on) {
      this.dropReplay(room, session.playerId);
      room.aiTakeoverEnabled = on;
      // 随机交接是接管的加强项：关掉接管就一起关（否则开关会留在一个不可能生效的房间里）
      if (!on) room.aiRandomHandover = false;
      resetAiTakeover(room);
      for (const seat of room.seats) if (seat && !seat.isBot && seat.playerId !== room.hostId) seat.ready = false;
      this.broadcastState(room);
    }
    return OK;
  }

  /** room.setAiRandom { on } (host, before the match): 3–9 回合随机交接，需要相接管的开关已打开。 */
  setAiRandom(session, { on }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.mode === 'solo' || (on && room.version !== DEFAULT_VERSION)) return fail(ERR.BAD_TARGET);
    if (on && room.aiTakeoverEnabled !== true) return fail(ERR.BAD_TARGET, 'enable AI handover first');
    if (room.aiRandomHandover !== on) {
      this.dropReplay(room, session.playerId);
      room.aiRandomHandover = on;
      room.aiRandomRound = null; room.aiRandomFired = false;
      this.broadcastState(room);
    }
    return OK;
  }

  setAiPicksLast(session, { on }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.mode === 'solo') return fail(ERR.BAD_TARGET, 'solo rooms have no AI teammates');
    this.dropReplay(room, session.playerId);
    if (room.aiPicksLast !== on) {
      room.aiPicksLast = on;
      for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
      this.broadcastState(room);
    }
    return OK;
  }

  /**
   * 「包含无场景地图」 (host-only, before the match; every mode): off (the default) the match's stage pools keep only the
   * stages with an official scene package (server/match/sceneStages.js); on, every stage of the mode is drawn again and a
   * stage without a scene gets the procedural board. `on: false` clears the flag and drops the room.state key.
   */
  setIncompleteMaps(session, { on }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    const next = on === true;
    if (room.incompleteMaps !== next) {
      room.incompleteMaps = next;
      this.broadcastState(room);
    }
    return OK;
  }

  /**
   * 「不限时」 (DESIGN §35.23.10): host-only, before the match, a solo room of a version whose solo is timed. `on: false`
   * clears the flag and drops the room.state key. A co-op room or a version whose solo is already untimed is BAD_TARGET.
   */
  setSoloUnlimited(session, { on }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.mode !== 'solo' || !this.versionSoloTimed(room.version)) return fail(ERR.BAD_TARGET, 'this version\'s solo is not timed');
    this.dropReplay(room, session.playerId);
    const next = on === true;
    if (room.soloUnlimited !== next) {
      room.soloUnlimited = next;
      this.broadcastState(room);
    }
    return OK;
  }

  /**
   * 房间人数上限 (room.setSeatCap { code, seatCap }; 2026-11-07 业主: 默认 4 席,房主用房间里的滑条改): host-only, before
   * the match. `seatCap` must be one of ROOM_CAPACITIES (4/8/12/16/20 — the same multiples of 4 the protocol's own
   * check allows) and it must still hold everybody seated: a shrink never evicts a player or AI, so the lowest accepted
   * cap is the highest occupied seat + 1 (the client's slider asks for exactly that bound). `code` is the alliance key
   * the page believes it is in, so a stale tab cannot resize another room. The room's `seats` array grows / shrinks
   * with the cap (`seatCap === seats.length`) and room.state carries the new number on the next broadcast.
   * A versus room is BAD_TARGET: its seats come from teamSize (2 × teamSize, room.state.seatCap).
   */
  setSeatCap(session, { code, seatCap } = {}) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (typeof code === 'string' && code.toUpperCase() !== room.code) return fail(ERR.BAD_TARGET, 'stale room code');
    if (!ROOM_CAPACITIES.includes(seatCap)) return fail(ERR.BAD_TARGET, `seat cap must be one of ${ROOM_CAPACITIES.join('/')}`);
    if (room.mode === 'versus') return fail(ERR.BAD_TARGET, 'a versus room takes its seats from teamSize');
    if (seatCap === room.seats.length) return OK;
    // the seats array is the cap: a shrink into an occupied seat is refused (resizeSeats), never silently clamped —
    // and a refusal leaves everything else alone (the host's result replay included)
    if (!room.resizeSeats(seatCap)) return fail(ERR.BAD_TARGET, 'that cap would drop a seated player');
    this.dropReplay(room, session.playerId);
    this.log.info(`[lobby] ${room.code} seat cap → ${seatCap}`);
    this.broadcastState(room);
    return OK;
  }

  /**
   * room.setPlugins (header "The room's plugins", "Gameplay plugins"): host-only, before the match; the set of the plugins
   * asked for becomes the room's content and the other humans are un-readied — nothing changes (and nobody is un-readied)
   * when it is the set the room already has. The host's result replay (a settlement screen still open) is dropped only
   * when the set did change: re-applying the same plugins, or a refused set, leaves it.
   * The server owner's `required` plugins (plugins/config.json) are added to what a host asks for — a host cannot switch
   * them off, so a list that leaves them out still gives the set with them (and the room.state that says so). When this
   * resolve cannot apply them (the install does not enable such a plugin), the host's own list is used instead, with one
   * warning: a `required` line must not stop a host from switching anything on.
   */
  setPlugins(session, { plugins }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.versionVote) return fail(ERR.VERSION_VOTE);
    const ids = [...new Set(plugins.map((p) => p.id))];
    /** @type {Record<string, Record<string, unknown>>} */
    const settings = {};
    for (const p of plugins) if (p.settings) settings[p.id] = p.settings;
    // 服务端 required（plugins/config.json `required`，server/plugins/roomSets.js `required`）：这些插件房主关不掉，
    // 并回他选的那一列里再去 resolve。房主以为关掉了其实还在时，下面的 sameSet / marks 比较会把它变成一次真实广播。
    // 这次 resolve 认不下并回的那些（本安装没启用、策略不许、没装…）就退回房主自己选的那一列，并记一次警告：
    // 一条 required 配置不该让房主连别的插件都开不了（本安装默认不启用 plugin 脚本，required 里正有这类插件）。
    const extra = this.requiredIds().filter((id) => !ids.includes(id));
    let r = this.resolveContent(room, extra.length ? [...ids, ...extra] : ids, settings);
    if (extra.length && 'error' in r) {
      const own = this.resolveContent(room, ids, settings);
      if ('content' in own) {
        this.warnOnce(`[lobby] required plugin(s) ${extra.join(', ')} cannot be applied (${r.error}${r.detail ? `: ${r.detail}` : ''}); the room keeps the host's own set`);
        r = own;
      }
    }
    if ('error' in r) return r;
    let content = r.content;
    const before = room.content;
    const sameSet = (before?.vs ?? null) === (content?.vs ?? null) && (before?.cs ?? null) === (content?.cs ?? null);
    const marks = (c) => JSON.stringify((c?.plugins || []).map((p) => [p.id, !!p.auto, p.settings || null]));
    if (sameSet && marks(before) === marks(content)) return OK;
    this.dropReplay(room, session.playerId);
    // another set: a notice still waiting for the end of a match (pluginsChanged) is moot
    if (!sameSet) { room.pluginsChanged = null; room.pluginNoticeKeys = {}; }
    // the plugin mode chosen stays while the set still provides it (header "Gameplay plugins")
    if (before?.modeId && content?.modes?.some((m) => m.id === before.modeId)) content = Object.freeze({ ...content, modeId: before.modeId });
    room.content = content;
    if (!sameSet) {
      this.holdContent(content);
      this.releaseContent(before);
      for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
      // another content set: every page loads and checks it again (room.contentReady)
      if ((before?.cs ?? null) !== (content?.cs ?? null)) for (const s of [...room.seats, ...room.spectators]) if (s && !s.isBot)  { s.content = null; s.consentCs = null; }
      this.log.info(`[lobby] ${room.code} plugins: ${content?.plugins?.length ? content.plugins.map((p) => `${p.id}@${p.version}`).join(', ') : 'none'}${room.modded ? ` (content ${content.cs.slice(0, 8)})` : ''}`);
    }
    this.broadcastState(room);
    return OK;
  }

  /**
   * 每个房间都必须保留的插件（`plugins/config.json` 的 `required` — server/plugins/roomSets.js `required`）：房主
   * 关不掉它们。本进程没有插件层、策略说房间只玩原版（rooms: off）或读不出来：空列表。
   * @returns {string[]}
   */
  requiredIds() {
    try {
      const ids = this.plugins?.required?.();
      return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id.length > 0) : [];
    } catch { return []; }
  }

  /**
   * 随房间内容集一起下发的 `required`：哪些 id 房主关不掉。内容对象是冻结的（Object.freeze），所以这个字段只能在
   * 冻结之前写进去；事后补就用展开新建一个。已经写着同一份列表的对象原样返回，room.state 的形状不因此变化。
   * @param {Room['content']} content
   * @returns {Room['content']}
   */
  contentWithRequired(content) {
    if (!content) return content;
    const ids = this.requiredIds();
    // 没有 required：房主没有关不掉的东西，旧形状一个字都不动（P0 的房间照旧）
    if (!ids.length) return content;
    const had = Array.isArray(content.required) ? content.required : null;
    if (had && had.length === ids.length && had.every((id, i) => id === ids[i])) return content;
    return Object.freeze({ ...content, required: Object.freeze(ids) });
  }

  /**
   * The content a room gets for the plugins `ids` (header "The room's plugins", "Gameplay plugins"): the vanilla set for
   * none, else what the room sets resolve — cosmetic plugins only: the vanilla cs with their `vs`; content plugins: the
   * content set's own cs (`vanilla: false`). Nothing is held yet (holdContent). On another official version (header
   * "Official versions") the base is that version's content (its cs, `version`) and gameplay plugins are refused
   * (VERSION_UNSUPPORTED).
   * @param {Room | null} room @param {string[]} ids @param {Record<string, Record<string, unknown>>} [settings]
   * @param {string} [version] the version the content is for (default: the room's)
   * @param {Room['content'] | null} [replacing] the content this change frees (default: the room's — room.create passes
   *   the creator's old room's when it goes away with the create: its set counts as freed against limits.maxSets)
   * @returns {{ content: Room['content'] } | { error: string, detail?: string }}
   */
  resolveContent(room, ids, settings = {}, version = room ? room.version : DEFAULT_VERSION, replacing = room?.content ?? null) {
    const base = this.baseContent(version);
    if (!ids.length) {
      // the server owner may fix every room's plugins (plugins/config.json rooms: fixed): the original game is not one
      const fixed = (() => { try { return this.plugins?.fixed?.() || null; } catch { return null; } })();
      if (fixed && fixed.length) return fail(ERR.PLUGIN_BLOCKED, 'this server fixes every room\'s plugins (plugins/config.json rooms: fixed)');
      return { content: this.contentWithRequired(base) };
    }
    if (!this.vanilla || !this.plugins || !base) return fail(ERR.PLUGIN_UNKNOWN, 'this server applies no plugins');
    const gameplay = version === DEFAULT_VERSION;
    let r;
    try { r = this.plugins.resolve(ids, { scope: 'room', settings, replacing, gameplay }); } catch (e) {
      this.log.error(`[lobby] ${room?.code ?? '----'} plugin set failed`, e);
      return fail(ERR.INTERNAL);
    }
    if (!r || !r.ok) return fail(r && isErrCode(r.error) ? r.error : ERR.INTERNAL, r && typeof r.detail === 'string' ? r.detail.slice(0, 200) : undefined);
    const { cs, vs, plugins: list, warnings, bytes, dataBytes, modes, kitted, trusted, execution, rules, code } = r.set;
    const modded = isContentHash(cs) && cs !== this.vanilla.cs;
    // (roomSets refuses them itself; a room-sets object that does not know the option must not slip one through)
    if (modded && !gameplay) return fail(ERR.VERSION_UNSUPPORTED, 'gameplay plugins play the default version (act2autochess) only');
    const frozen = (a) => Object.freeze((Array.isArray(a) ? a : []).map((p) => Object.freeze({ ...p })));
    const required = this.requiredIds();
    // the operators its plugins add to a 自选 slot's list (welcome.diyKitted holds the server's own): the pages' pickers
    const extra = modded && Array.isArray(kitted) ? kitted.filter((id) => typeof id === 'string' && !VANILLA_KITTED.has(id)).slice(0, 200) : [];
    return {
      content: Object.freeze({
        cs: modded ? cs : base.cs,
        vanilla: !modded,
        ...(base.version ? { version: base.version } : {}),
        ...(vs ? { vs } : {}),
        plugins: frozen(list),
        // 房主关不掉的插件（plugins/config.json required）：客户端据此把它们的开关钉住。没有就省略，旧形状不动。
        ...(required.length ? { required: Object.freeze(required) } : {}),
        ...(trusted ? {trusted} : {}),
        ...(execution ? {execution} : {}),
        warnings: Object.freeze([...(warnings || [])]),
        bytes: Number(bytes) || 0,
        ...(modded ? { dataBytes: Number(dataBytes) || 0, modes: frozen(modes), ...(extra.length ? { kittedExtra: Object.freeze(extra) } : {}) } : {}),
        ...(rules ? { rules } : {}),
        // 无损插件的代码根（Match 入口/客户端覆盖/数据根）：房间内容在这一层被重建，不带上它宿主只会加载上游 Match。
        ...(modded && code ? { code } : {}),
      }),
    };
  }

  /** A room now uses `content`: its visual set and its content set are held (released by releaseContent). */
  holdContent(content) {
    if (content?.vs) this.plugins?.hold?.(content.vs);
    if (content && content.vanilla === false) this.plugins?.holdContent?.(content.cs);
  }

  /** A room no longer uses `content`. */
  releaseContent(content) {
    if (content?.vs) this.plugins?.release?.(content.vs);
    if (content && content.vanilla === false) this.plugins?.releaseContent?.(content.cs);
  }

  /**
   * room.setMode (header "Gameplay plugins"): host-only, before the match. An official mode of the room's type sets its
   * difficulty (and leaves a plugin mode); a mode of the room's content set (content.modes, the room's type) becomes
   * content.modeId — its difficulty the room's. Like a difficulty change it un-readies the other humans.
   */
  setMode(session, { modeId }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.versionVote) return fail(ERR.VERSION_VOTE);
    // 训练模式（入门协议 mode_training_1）没有 single/multi 的 id：只有单人房的候选里才放它，
    // 放进来之后仍然走下面同一条 offered / 数据校验（不绕过）。
    // 肉鸽的候选是 N1–N20（difficultiesFor('rogue')），id 是它自己那一族 mode_rogue_<难度>。
    const rogue = room.mode === 'rogue';
    const candidates = rogue ? [...difficultiesFor('rogue')]
      : room.mode === 'solo'
        ? [...DIFFICULTIES, ...LEGACY_DIFFICULTIES, TRAINING_DIFFICULTY]
        : [...DIFFICULTIES, ...LEGACY_DIFFICULTIES];
    const official = candidates.find((d) => modeIdFor(room.mode, d, rogue ? 'rogue' : undefined) === modeId);
    let difficulty = room.difficulty;
    let content = room.content;
    if (official) {
      // the room's version offers it (header "Official versions")；
      // 旧 4 档名另放行（该版本数据里确有这条 mode 就行），否则老客户端的「切换模式」会全部被判无效
      if (!this.difficultyAllowed(room.version, room.mode, official)) {
        return fail(ERR.BAD_TARGET, 'not a mode of this version');
      }
      difficulty = official;
      if (content?.modeId) { const rest = { ...content }; delete rest.modeId; content = Object.freeze(rest); }
    } else {
      const mode = Array.isArray(content?.modes) ? content.modes.find((m) => m && m.id === modeId) : null;
      if (!mode) return fail(ERR.BAD_TARGET, 'not a mode of this room');
      if (mode.roomMode !== room.mode) return fail(ERR.BAD_TARGET, `a mode of ${mode.roomMode} rooms`);
      if (DIFFICULTIES.includes(mode.difficulty) || LEGACY_DIFFICULTIES.includes(mode.difficulty)) difficulty = mode.difficulty;
      if (content.modeId !== modeId) content = Object.freeze({ ...content, modeId });
    }
    if (difficulty === room.difficulty && content === room.content) return OK;
    this.dropReplay(room, session.playerId);
    room.difficulty = difficulty;
    room.content = content;
    for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
    // 危机合约: the chosen mode may carry a lower difficulty than the selection allows (same rule as setDifficulty)
    this.revalidateContracts(room);
    this.broadcastState(room);
    return OK;
  }

  /**
   * room.contentReady { cs, ok? } (header "Gameplay plugins"): the member's page has loaded and checked the room's content
   * set (`ok: false`: it could not). Recorded for the room's current set only — a page that checked an older one is
   * answered OK and changes nothing — and only for the page that is there: a session whose socket is gone, or a message
   * that waited on the room's queue across a disconnect of its seat (`ctx.from`: the seat's generation when it was
   * queued), is answered OK and writes nothing (the page that comes back checks the set again).
   * @param {import('./net.js').Session} session @param {{ cs: string, ok?: boolean }} msg
   * @param {{ from?: { seat: Seat, gen: number } | null } | null} [ctx]
   */
  contentReady(session, { cs, ok }, ctx = null) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (!room.needsContent || room.content?.cs !== cs) return OK;
    if (!session.connected) return OK;
    const seat = room.seatOf(session.playerId) || room.spectatorOf(session.playerId);
    if (!seat) return OK;
    if (ctx && ctx.from && (ctx.from.seat !== seat || ctx.from.gen !== (seat.contentGen || 0))) return OK;
    if (ok !== false && room.content?.trusted && room.seatOf(session.playerId) && seat.consentCs !== cs) return fail(ERR.PLUGIN_CONSENT);
    const state = ok === false ? 'failed' : 'ready';
    if (seat.content === state) return OK;
    seat.content = state;
    if (state === 'failed') this.log.warn(`[lobby] ${room.code} ${session.name}: the room's content ${cs.slice(0, 8)} did not load or check on that page`);
    this.broadcastState(room);
    return OK;
  }

  /** Each live session consents only for its own seat and the current cs. Reconnect keeps the seat. */
  consent(session, {cs,accept}) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    const seat = room.seatOf(session.playerId);
    if (!seat || seat.isBot) return fail(ERR.SPECTATOR);
    if (!session.connected || !room.content?.trusted || room.content.cs !== cs) return fail(ERR.PLUGIN_CONSENT);
    if (room.match) return fail(ERR.ROOM_STARTED);
    const changed = (seat.consentCs === cs) !== accept;
    seat.consentCs = accept ? cs : null;
    if (changed) seat.content = null;
    if (!accept) { seat.ready = false; seat.content = null; }
    this.broadcastState(room);
    return OK;
  }

  // ---------------------------------------------------------------------------------------------------
  // Official versions (header "Official versions")
  // ---------------------------------------------------------------------------------------------------

  /**
   * The server's default version (a room created without one, the settings outside a room). When the configured one's
   * data failed to load: 第二期下半 if enabled, else the first enabled version that loads (server/versions.js welcome
   * marks the same one the default).
   */
  defaultVersion() {
    const v = this.versions;
    const id = v?.defaultId ?? DEFAULT_VERSION;
    if (!v || this.versionAvailable(id)) return id;
    if (v.isEnabled(DEFAULT_VERSION)) return DEFAULT_VERSION;
    return v.ids.find((x) => this.versionAvailable(x)) ?? id;
  }

  /** Does this server offer the version `id`? @param {unknown} id */
  versionEnabled(id) { return this.versions ? this.versions.isEnabled(id) : id === DEFAULT_VERSION; }

  /**
   * Can a room play the enabled version `id` now? Another version's data loads on first use (a room of it loads it
   * anyway); a failed load is remembered (server/versions.js available), and such a version is never offered again.
   * @param {string} id
   */
  versionAvailable(id) { return id === DEFAULT_VERSION || typeof this.versions?.available !== 'function' || this.versions.available(id); }

  /** A room's content base for a version: the vanilla content for 第二期下半, else the version's own. @param {string} v */
  baseContent(v) {
    if (v === DEFAULT_VERSION || !this.versions) return this.vanilla;
    return this.versions.content(v) || null;
  }

  /**
   * The difficulties a version offers a room mode (DIFFICULTIES for 第二期下半 / a server without versions).
   * @param {string} v @param {string} mode @returns {readonly string[]}
   */
  /** lobby 级插件面（server/plugins/lobbyModules.js）：null 表示本进程没有插件声明 code.lobby。 */
  setExtensions(ext) {
    this.ext = ext || null;
    for (const room of this.rooms.values()) room.ext = this.ext;
  }

  offered(v, mode) {
    // 2026-11-03 业主：N1–N20 只给肉鸽；标准/同盟/对抗/协同共竞仍用旧 4 档。
    if (!this.versions || v === DEFAULT_VERSION) return difficultiesFor(mode);
    // 肉鸽是默认版本专属玩法（官方版本的数据里没有 mode_rogue_*）⇒ 非默认版本没有肉鸽房。
    if (mode === 'rogue') return [];
    const family = mode === 'versus' ? 'coop' : mode;
    return this.versions.offered(v, /** @type {'solo' | 'coop'} */ (family));
  }

  /**
   * Does this version's solo use the official per-round timers (`config.version.rules.soloTimed`)? 第二期下半, a server
   * without the versions service, and a version whose data cannot be read: no.
   * @param {string} id
   */
  versionSoloTimed(id) {
    if (!id || id === DEFAULT_VERSION || !this.versions) return false;
    try {
      const data = this.versions.data(id);
      return data?.config?.version?.rules?.soloTimed === true;
    } catch (e) {
      this.log.error(`[lobby] the solo timer of ${id} failed`, e);
      return false;
    }
  }

  /**
   * `d`, or the difficulty the version offers instead: the highest below it, else its lowest (终极 → 绝境).
   * @param {string} v @param {string} mode @param {string} d
   */
  fallbackDifficulty(v, mode, d) {
    const offered = this.offered(v, mode);
    if (!offered.length || offered.includes(d)) return d;
    // 训练模式不在 offered 列表里（它不参与难度阶梯，见 offersTraining）：该版本仍有这条 mode 就保留，
    // 否则按下面的阶梯降级 —— 换版本后不会把房间留在一个这版数据里没有的 modeId 上。
    if (d === TRAINING_DIFFICULTY && this.offersTraining(v, mode)) return d;
    // 「选择器里没有」但**该版本的数据里确实有这条 mode**（旧 4 档就是这种情况）⇒ 保留原档，
    // 这样老房间 / 老客户端 / 默认档 FUNNY 都不会被悄悄改成别的档。
    if (LEGACY_DIFFICULTIES.includes(d) && this.hasModeOfVersion(v, mode, d)) return d;
    // 按**难度阶梯序**取「不高于它、且这个版本提供」的最高一档；都不高于它就取最低一档。
    // 这样 N 档 ↔ 旧 4 档能互相映射（N1→FUNNY、N20→HARD/ABYSS…），而不是各自算各自的 index。
    const want = difficultyRank(d) || 1;
    const ranked = offered.map((x) => [x, difficultyRank(x)]).filter(([, r]) => r > 0);
    const below = ranked.filter(([, r]) => r <= want).sort((a, b) => b[1] - a[1])[0];
    const pick = below || ranked.sort((a, b) => a[1] - b[1])[0];
    return pick ? pick[0] : offered[0];
  }

  /**
   * 这个房间版本的**数据里**是否有该难度的 mode 记录（与「版本是否对外提供」不同：
   * 旧档名在任何版本的数据里都还在，只是不在选择器里）。`setDifficulty` 用它放行旧客户端。
   */
  hasModeOfVersion(v, roomMode, d) {
    try {
      const cfg = v === DEFAULT_VERSION || !this.versions ? getData().config
        : (this.versions.data?.(v)?.config ?? null);
      if (!cfg) return false;
      return Object.hasOwn(cfg.modes || {}, modeIdFor(roomMode, d, roomMode === 'rogue' ? 'rogue' : null));
    } catch { return false; }
  }

  /**
   * 训练模式（入门协议 `mode_training_1`, shared/constants.js TRAINING_DIFFICULTY）能不能在这个房间问：
   * **单人房**才行（LOCAL 是单人语义），而且这个版本的数据里确实有这条 mode。它不在 DIFFICULTIES / LEGACY_DIFFICULTIES
   * 里，所以 create / setDifficulty / setMode 三处各自用它放行，普通档位与 coop 房的校验一个字都不动。
   * @param {string} v @param {'solo'|'coop'|'versus'|'rogue'} mode
   */
  offersTraining(v, mode) {
    return mode === 'solo' && this.hasModeOfVersion(v, mode, TRAINING_DIFFICULTY);
  }

  /**
   * May this version's rooms of `mode` carry `d`: the version's selector, an old 4-tier name whose mode record the
   * version's data has (老客户端), or 训练模式 on a solo room whose data carries mode_training_1.
   * @param {string} v @param {string} mode @param {string} d
   */
  difficultyAllowed(v, mode, d) {
    return this.offered(v, mode).includes(d)
      || (LEGACY_DIFFICULTIES.includes(d) && this.hasModeOfVersion(v, mode, d))
      || (d === TRAINING_DIFFICULTY && this.offersTraining(v, mode));
  }

  /**
   * room.proposeVersion { version } (host, before the match): a lone active human switches at once, else the seated
   * humans vote (header "Official versions").
   */
  proposeVersion(session, { version }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (!this.versionEnabled(version)) return fail(ERR.VERSION_UNKNOWN);
    if (!this.offered(version, room.mode).length) return fail(ERR.VERSION_UNSUPPORTED, `${version} has no ${room.mode} rooms`);
    if (room.modded && version !== DEFAULT_VERSION) return fail(ERR.VERSION_UNSUPPORTED, 'gameplay plugins play the default version (act2autochess) only');
    if (version === room.version) return fail(ERR.ALREADY);
    if (room.versionVote) return fail(ERR.VERSION_VOTE);
    const now = this.now();
    if (now - room.versionProposeAt < this.opts.versionProposeGapMs || now < room.versionRetryAt) return fail(ERR.RATE);
    const humans = room.activeHumans();
    if (humans.some((s) => !s.connected)) return fail(ERR.NOT_READY);
    if (!this.versionAvailable(version)) return fail(ERR.VERSION_UNSUPPORTED, 'the data of this version is not available');
    room.versionProposeAt = now;
    // the room's cosmetic plugins must resolve on the target (the server owner's policy, a plugin refused there)
    const ids = (room.content?.plugins || []).filter((p) => !p.auto).map((p) => p.id);
    if (ids.length) {
      const r = this.resolveContent(room, ids, this.pluginSettings(room.content), version);
      if ('error' in r) return fail(ERR.VERSION_UNSUPPORTED, `the room's plugins do not apply to ${version}: ${r.error}`);
    }
    this.dropReplay(room, session.playerId);
    if (humans.length === 1) { this.applyVersion(room, version, 'alone'); return OK; }
    room.versionVoteSeq = room.versionVoteSeq >= 2 ** 31 ? 1 : room.versionVoteSeq + 1;
    const id = room.versionVoteSeq;
    const ms = Math.max(0, Number(this.opts.versionVoteMs) || 0);
    const timer = setTimeout(() => {
      const run = () => { if (!room.disposed && room.versionVote?.id === id) this.voidVersionVote(room, 'expired'); };
      // in order with the room's messages when something of the room is still pending (header "Gameplay plugins")
      if (room.queue.pending > 0) this.queueEvent(room, run); else run();
    }, ms);
    timer.unref?.();
    room.versionVote = { id, proposerId: session.playerId, version, voters: humans.map((s) => s.playerId), agreed: new Set([session.playerId]), expiresAt: now + ms, timer };
    this.log.info(`[lobby] ${room.code} version vote #${id} → ${version} (${humans.length} voters)`);
    this.broadcastState(room);
    return OK;
  }

  /** room.versionVote { voteId, agree } (a voter): a decline cancels the vote, the last agreement switches. */
  versionVote(session, { voteId, agree }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    const vote = room.versionVote;
    if (!vote) return fail(ERR.WRONG_PHASE);
    if (vote.id !== voteId) return fail(ERR.BAD_TARGET, 'vote changed');
    if (!vote.voters.includes(session.playerId)) return fail(ERR.BAD_TARGET, 'not a voter');
    this.dropReplay(room, session.playerId);
    if (!agree) {
      this.voidVersionVote(room, 'declined', session.name);
      return OK;
    }
    if (vote.agreed.has(session.playerId)) return OK;
    vote.agreed.add(session.playerId);
    if (vote.voters.every((id) => vote.agreed.has(id))) this.applyVersion(room, vote.version, 'vote');
    else this.broadcastState(room);
    return OK;
  }

  /** room.cancelVersionVote { voteId } (host): the vote ends, the room keeps its version. */
  cancelVersionVote(session, { voteId }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (!room.versionVote) return fail(ERR.WRONG_PHASE);
    if (room.versionVote.id !== voteId) return fail(ERR.BAD_TARGET, 'vote changed');
    this.dropReplay(room, session.playerId);
    this.voidVersionVote(room, 'cancelled');
    return OK;
  }

  /**
   * End the room's open version vote without a switch and tell its members (header "Official versions"): `declined`
   * (by `name`; every member), `expired` (every member), `members` (a seat or the host changed, a voter dropped, a match
   * started; every member), `cancelled` (by the host; everyone but the host). A declined or expired vote holds the next
   * proposal back versionRetryMs. room.state is broadcast — but for `members`: every such caller broadcasts it next.
   * @param {Room} room @param {'declined' | 'expired' | 'members' | 'cancelled'} reason @param {string} [name]
   */
  voidVersionVote(room, reason, name = '') {
    const vote = room.versionVote;
    if (!vote) return;
    clearTimeout(vote.timer);
    room.versionVote = null;
    if (reason === 'declined' || reason === 'expired') room.versionRetryAt = this.now() + this.opts.versionRetryMs;
    this.log.info(`[lobby] ${room.code} version vote #${vote.id} ended (${reason})`);
    if (room.disposed) return;
    if (reason !== 'members') this.broadcastState(room);
    const text = reason === 'declined' ? msg('{name}拒绝了切换版本', { name })
      : reason === 'expired' ? msg('切换版本投票已超时，房间版本未改变')
        : reason === 'cancelled' ? msg('创建者取消了切换版本投票')
          : msg('同盟成员有变动，切换版本投票已取消');
    const toast = { t: 'm.toast', kind: reason === 'cancelled' ? 'info' : 'warn', ...wireMessage(text) };
    if (reason !== 'cancelled') { this.broadcastRoom(room, toast); return; }
    for (const s of [...room.seats, ...room.spectators]) if (s && !/** @type {any} */ (s).isBot && s.playerId !== room.hostId) this.sendToPlayer(room, s.playerId, toast);
  }

  /** The per-plugin settings of a room content's plugins (to resolve the same choice again). */
  pluginSettings(content) {
    /** @type {Record<string, Record<string, unknown>>} */
    const out = {};
    for (const p of content?.plugins || []) if (p.settings && typeof p.settings === 'object') out[p.id] = { ...p.settings };
    return out;
  }

  /**
   * Switch the room to `version` (header "Official versions"): its difficulty, its content (the version's base with the
   * room's cosmetic plugins again — none when they no longer resolve), every member's page loading it, the other humans
   * un-readied, the whole result replay and every human seat's stored settings dropped, a seat card the version lacks
   * dropped. Broadcast.
   * @param {Room} room @param {string} version @param {'vote' | 'alone'} how
   */
  applyVersion(room, version, how) {
    if (room.versionVote) { clearTimeout(room.versionVote.timer); room.versionVote = null; }
    const before = room.content;
    room.version = version;
    // 「不限时」 belongs to a timed solo only (header): a co-op room, or a version whose solo is not timed, drops it.
    // Switching between the two 第一期 versions keeps it.
    if (room.mode !== 'solo' || !this.versionSoloTimed(version)) room.soloUnlimited = false;
    room.difficulty = this.fallbackDifficulty(version, room.mode, room.difficulty);
    let next = this.contentWithRequired(this.baseContent(version));
    const ids = (before?.plugins || []).filter((p) => !p.auto).map((p) => p.id);
    if (ids.length) {
      const r = this.resolveContent(room, ids, this.pluginSettings(before));
      if ('content' in r && r.content && r.content.vanilla !== false) next = r.content;
      else this.warnOnce(`[lobby] ${room.code} plugins (${ids.join(', ')}) dropped on the switch to ${version}: ${'error' in r ? r.error : '?'}${'detail' in r && r.detail ? ` (${r.detail})` : ''}`);
    }
    room.content = next;
    this.holdContent(next);
    this.releaseContent(before);
    room.pluginsChanged = null;
    room.pluginNoticeKeys = {};
    room.replay = null;
    const data = this.dataFor(room);
    const operators = chessCharIds(data);
    for (const s of [...room.seats, ...room.spectators]) {
      if (!s || /** @type {any} */ (s).isBot) continue;
      const seat = /** @type {Seat} */ (s);
      seat.content = null;
      seat.consentCs = null;
    }
    for (const s of room.seats) {
      if (!s || s.isBot) continue;
      if (s.playerId !== room.hostId) s.ready = false;
      s.loadout = null; s.ops = null; s.notOwned = null; s.diy = null;
      s.loadoutCs = null; s.notOwnedCs = null; s.diyCs = null;
      if (s.card && !operators.has(s.card)) s.card = null;
    }
    // 危机合约: the new version's fallbackDifficulty may not allow the room's selection (CONTRACT_MIN_DIFFICULTY); the
    // clearing rides this broadcast
    this.revalidateContracts(room);
    this.log.info(`[lobby] ${room.code} version → ${version} (${how})`);
    this.broadcastState(room);
  }

  addBot(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo rooms cannot have AI teammates');
    // 对抗房：bot 也算座位，封在 2 × 每队人数（2026-10-27）；其它房间封在房主选的 seatCap（2026-11-07 默认 4）
    if (room.mode === 'versus' && room.teamSize && takenSeats(room) >= room.teamSize * 2) return fail(ERR.ROOM_FULL);
    if (takenSeats(room) >= room.seatCap) return fail(ERR.ROOM_FULL);
    const idx = room.freeSeat();
    if (idx < 0) return fail(ERR.ROOM_FULL);
    const used = new Set(room.seats.filter((s) => s && s.isBot).map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `AI·${idx + 1}`;
    let playerId;
    do playerId = 'ai_' + randomBytes(4).toString('hex'); while (room.seatOf(playerId));
    room.seats[idx] = { seat: idx, playerId, name, isBot: true, ready: true, connected: true, left: false };
    this.broadcastState(room);
    return OK;
  }

  removeBot(session, { seat }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    const target = room.seats[seat];
    if (!target || !target.isBot) return fail(ERR.BAD_TARGET, 'seat does not hold an AI');
    room.seats[seat] = null;
    // 危机合约: one seat fewer may drop the room below a contract's threshold (aidCommsDown minPlayers)
    this.revalidateContracts(room);
    this.broadcastState(room);
    return OK;
  }

  /** Host removes another human before the match (header: room.kick). */
  kick(session, { seat, playerId }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    const target = room.seats[seat];
    if (!target || target.left) return fail(ERR.BAD_TARGET, 'seat holds no player');
    if (target.playerId !== playerId) return fail(ERR.BAD_TARGET, 'seat changed hands'); // the confirmed player left meanwhile
    if (target.isBot) return fail(ERR.BAD_TARGET, 'seat holds an AI (room.removeBot)');
    if (target.playerId === session.playerId) return fail(ERR.BAD_TARGET, 'cannot kick yourself');
    const kicked = this.registry.byId(target.playerId);
    const wasHere = !!kicked && kicked.roomCode === room.code;
    const replay = this.replayFor(room, target.playerId);
    this.removeMember(room, target.playerId);
    if (wasHere) {
      if (kicked.connected) sendSession(kicked, { t: 'room.closed', reason: 'kicked' });
      else { kicked.notice = 'kicked'; kicked.pendingResult = replay; }
    }
    this.log.info(`[lobby] ${room.code} ${target.name} removed by the host`);
    return OK;
  }

  start(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.versionVote) return fail(ERR.VERSION_VOTE);
    // 插件在开局前补席 / 校验（对抗房按分边人数补 AI、锁座位）
    const pre = this.ext?.beforeStart?.(room, session, this);
    if (pre && pre.error) return pre;
    const humans = room.activeHumans();
    if (room.content?.trusted && humans.some(s => s.consentCs !== room.content.cs)) return fail(ERR.PLUGIN_CONSENT);
    for (const s of humans) {
      if (s.playerId !== room.hostId && (!s.connected || !s.ready)) return fail(ERR.NOT_READY);
    }
    // a room with gameplay plugins, or of another official version, starts once every player's page has loaded and checked
    // its content (the host's too)
    if (room.needsContent && humans.some((s) => s.content !== 'ready')) return fail(ERR.CONTENT_NOT_READY);
    const bots = room.seats.filter((s) => s && s.isBot);
    if (humans.length < 1 || (room.mode === 'solo' && (humans.length !== 1 || bots.length > 0))) {
      return fail(ERR.BAD_MSG, 'invalid seat configuration');
    }
    const key = session.limitKey || null;
    if (key && this.opts.maxMatchesPerAddr > 0 && this.countRooms((r) => !!r.match && r.matchKey === key) >= this.opts.maxMatchesPerAddr) {
      this.limitWarn(`match limit (${this.opts.maxMatchesPerAddr}) reached for ${session.addr}`);
      return fail(ERR.RATE, 'too many running matches from your network');
    }
    return this.startMatch(room, key);
  }

  /**
   * Any seated player may open or cancel the vote (issue #854); the match owns the vote, the per-seat cooldown and the
   * setup replacement itself. A spectator has no seat and therefore nothing to reroll.
   */
  rerollSetup(session, msg, cancel = false) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    const method = cancel ? 'cancelSetupReroll' : 'requestSetupReroll';
    if (!room.match || typeof room.match[method] !== 'function') return fail(ERR.WRONG_PHASE);
    return this.callMatch(room, method, session.playerId, cancel ? msg.voteId : msg.setupRevision) || fail(ERR.INTERNAL);
  }

  /**
   * room.loadout (DESIGN §16): check the operator loadout — and its per-operator 潜能 / 练度 `ops` (0.2.2) — against the
   * game data, store both on the session and the seat, and — while a match runs — hand them to the match (accepted only
   * during INFO_CHECK, see the header). Either part refused: nothing is stored.
   */
  loadout(session, { entries, ops }) {
    const room = this.roomOf(session);
    // checked against the room's own data: a room with gameplay plugins knows its plugins' operators (header "Gameplay plugins")
    const data = this.dataFor(room);
    const res = checkLoadout(entries, (id) => lookup('chess', id, data));
    if (!res || res.error) return fail(res && isErrCode(res.error) ? res.error : ERR.BAD_MSG, res && res.detail);
    const ids = opsCharIds(data);
    const resOps = checkLoadoutOps(ops, (id) => ids.has(id), (id) => charPotentialChanges(data, id));
    if (!resOps || resOps.error) return fail(resOps && isErrCode(resOps.error) ? resOps.error : ERR.BAD_MSG, resOps && resOps.detail);
    const loadout = freezeLoadout(res.loadout);
    const opsSet = freezeOps(resOps.ops);
    const cs = this.settingsCs(room, session.playerId);
    session.loadout = loadout;
    session.ops = opsSet;
    session.loadoutCs = cs;
    if (!room) return OK;
    const seat = room.seatOf(session.playerId);
    if (seat) { seat.loadout = loadout; seat.ops = opsSet; seat.loadoutCs = cs; }
    if (!room.match || !seat) return OK; // a spectator's loadout stays on its session, never reaching the match
    if (typeof room.match.setLoadout !== 'function') return fail(ERR.ROOM_STARTED, 'stored for the next match');
    let r;
    try {
      // Preserve named defaults for prep merging: normalisation drops them, but they mean reset this operator.
      r = ruleOption(room.content?.rules, 'prepLoadout') === 'prep'
        ? room.match.setLoadout(session.playerId, entries, ops)
        : room.match.setLoadout(session.playerId, loadout, opsSet);
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match.setLoadout threw`, e);
      return fail(ERR.INTERNAL);
    }
    // a match in a match host answers later (header "Gameplay plugins")
    if (r && typeof r.then === 'function') return Promise.resolve(r).then(matchAnswer, () => fail(ERR.INTERNAL));
    return matchAnswer(r);
  }

  /**
   * room.ownership (0.2.0 补位): keep the droppable chess of the not-owned list, store it on the session and the seat
   * (see the header). A running match never takes it: it keeps the list its seat had at its start.
   */
  ownership(session, { notOwned }) {
    const room = this.roomOf(session);
    const data = this.dataFor(room);
    const res = checkNotOwned(notOwned, (id) => lookup('chess', id, data));
    if (!res || res.error) return fail(ERR.BAD_MSG, res && res.detail);
    const list = Object.freeze(res.notOwned.slice());
    const cs = this.settingsCs(room, session.playerId);
    session.notOwned = list;
    session.notOwnedCs = cs;
    if (!room) return OK;
    const seat = room.seatOf(session.playerId);
    if (seat) { seat.notOwned = list; seat.notOwnedCs = cs; }
    if (room.match && seat) return fail(ERR.ROOM_STARTED, 'stored for the next match');
    return OK;
  }

  /**
   * room.diy (0.2.0 自选编队): keep the legal picks (checkDiyPicks against the data and KITTED_CHARS — the room's own in a
   * room with gameplay plugins), store them on the session and the seat (see the header). A running match never takes
   * them: it keeps the picks its seat had at its start.
   */
  diy(session, { picks }) {
    const room = this.roomOf(session);
    const res = checkDiyPicks(picks, { data: this.dataFor(room), kitted: this.kittedFor(room) });
    if (!res || !('ok' in res)) return fail(ERR.BAD_MSG, res && res.detail);
    const kept = freezeDiy(res.picks);
    const cs = this.settingsCs(room, session.playerId);
    session.diy = kept;
    session.diyCs = cs;
    if (!room) return OK;
    const seat = room.seatOf(session.playerId);
    if (seat) { seat.diy = kept; seat.diyCs = cs; }
    if (room.match && seat) return fail(ERR.ROOM_STARTED, 'stored for the next match');
    return OK;
  }

  /**
   * room.skins (docs/SKINS.md): store the appearances this player chose for their operators, on the session and the
   * seat, and hand them to a running match. A waiting room is shown a changed map (room.state seats[].skins: its seat
   * cards wear them — header 干员皮肤).
   *
   * Unlike room.loadout there is no phase gate. The loadout is frozen at INFO_CHECK because it changes what a unit
   * *does*; a skin changes only what it looks like, and it is public — a teammate switching model mid-match is
   * harmless, and the next `m.public` broadcast carries it to everyone.
   */
  skins(session, { skins }) {
    const room = this.roomOf(session);
    const ids = operatorCharIds(this.dataFor(room));
    const kept = freezeSkins(skins, (id) => ids.has(id));
    if (!kept) return fail(ERR.BAD_MSG, 'bad skin selection');
    session.skins = kept;
    if (!room) return OK;
    const seat = room.seatOf(session.playerId);
    if (seat) {
      const changed = !sameSkins(seat.skins, kept);
      seat.skins = kept;
      // the waiting room's seat cards wear them (room.state seats[].skins, header); a match shows them in its m.public
      if (changed && !room.match) this.broadcastState(room);
    }
    if (!room.match || !seat) return OK;
    if (typeof room.match.setSkins !== 'function') return fail(ERR.ROOM_STARTED, 'stored for the next match');
    return matchAnswer(this.callMatch(room, 'setSkins', session.playerId, kept));
  }

  /**
   * 名片干员 (room.card): the operator whose portrait fills the player's seat card — a visible charId of the room's
   * chess.json (the server's outside a room), '' for none. Kept on the session and the seat; a change is broadcast to the room.
   * Cosmetic: accepted in any phase, never touches a match.
   */
  card(session, { charId }) {
    const room = this.roomOf(session);
    if (charId && !chessCharIds(this.dataFor(room)).has(charId)) return fail(ERR.BAD_MSG, 'unknown operator');
    session.card = charId || null;
    const seat = room ? room.seatOf(session.playerId) : null;
    if (seat && seat.card !== session.card) {
      seat.card = session.card;
      this.broadcastState(room);
    }
    return OK;
  }

  /**
   * The game data of a room's content (header "Gameplay plugins", "Official versions"): its content set's, else its
   * version's — outside a room, the server's default version's —, else the server's. Another version's data that cannot
   * be read is logged and nothing (every check then refuses), never 第二期下半's.
   * @param {Room | null} room
   */
  dataFor(room) {
    if (room?.modded) {
      try {
        const d = this.plugins?.dataOf?.(room.content.cs);
        if (d) return d;
      } catch (e) { this.log.error(`[lobby] ${room.code} content data failed`, e); }
    }
    const v = room ? room.version : this.defaultVersion();
    if (v !== DEFAULT_VERSION) {
      try {
        const d = this.versions?.data(v);
        if (d) return d;
        this.warnOnce(`[lobby] the data of ${v} is not available`);
      } catch (e) { this.log.error(`[lobby] ${room?.code ?? '----'} the data of ${v} failed`, e); }
      return Object.freeze({});
    }
    return this.safeData();
  }

  /** The operators a 自选 slot may field in a room (its content set's list, else the vanilla one). @param {Room | null} room */
  kittedFor(room) {
    if (room?.modded) {
      try {
        const k = this.plugins?.kittedOf?.(room.content.cs);
        if (Array.isArray(k)) return k;
      } catch (e) { this.log.error(`[lobby] ${room.code} content 自选 list failed`, e); }
    }
    return KITTED_CHARS;
  }

  /**
   * The content a setting stored now is checked for: the room's cs, else (outside a room) the server's default version's
   * — the vanilla one unless the server's default is another version. @param {Room | null} room
   */
  csOf(room) { return room?.content?.cs ?? this.baseContent(this.defaultVersion())?.cs ?? this.vanilla?.cs ?? null; }

  /**
   * The stamp of a setting a player sends now (loadout / ownership / diy): csOf(room) — but in a room whose pages must
   * load its content (needsContent) only once the sender's page reported that content ready; before, UNVERIFIED_CS: the
   * page may still show another version's data, whose chess ids name other operators (header "Official versions").
   * @param {Room | null} room @param {string} playerId
   */
  settingsCs(room, playerId) {
    if (!room || !room.needsContent) return this.csOf(room);
    const seat = room.seatOf(playerId) || room.spectatorOf(playerId);
    return seat && /** @type {any} */ (seat).content === 'ready' ? this.csOf(room) : UNVERIFIED_CS;
  }

  /**
   * The data a setting stamped with `cs` was checked against: the vanilla data, a version's, a content set's — null when
   * none is known (an unverified stamp, a set no longer kept). @param {string | null} cs
   */
  dataOfCs(cs) {
    if (!cs || cs === UNVERIFIED_CS) return null;
    if (this.vanilla && cs === this.vanilla.cs) return this.safeData();
    try {
      const v = this.versions?.dataOfCs?.(cs);
      if (v) return v;
      const p = this.plugins?.dataOf?.(cs);
      if (p) return p;
    } catch (e) { this.log.error(`[lobby] the data of content ${String(cs).slice(0, 8)} failed`, e); }
    return null;
  }

  /**
   * A human seat's stored settings for a match of `room` (header "Gameplay plugins", the design study's §6.9): kept as
   * they are when they were checked for the room's content; filtered to its data otherwise — an id it does not know is
   * dropped, the rest kept (never the whole setting refused). A loadout or 干员持有 list checked for another data set also
   * loses every chess id whose operator (charId) differs between the two (header "Official versions": chess ids are
   * reused across versions); in a room of another version than 第二期下半, one whose data is unknown (an unverified
   * stamp) is dropped whole.
   * @param {Room} room @param {Seat} s @param {Readonly<Record<string, any>>} data
   */
  seatSettings(room, s, data) {
    const cs = this.csOf(room);
    const vanillaCs = this.vanilla?.cs ?? null;
    const other = (checked) => !!cs && (checked ?? vanillaCs) !== cs;
    const versioned = room.version !== DEFAULT_VERSION;
    let loadout = s.loadout || null;
    let ops = s.ops || null;
    let notOwned = s.notOwned || null;
    let diy = s.diy || null;
    const chess = (id) => lookup('chess', id, data);
    /** the chess ids of `from` whose operator is the room data's too (null `from`: every id) */
    const sameOperator = (from, id) => !from || (lookup('chess', id, from)?.charId ?? null) === (chess(id)?.charId ?? undefined);
    if (loadout && other(s.loadoutCs)) {
      const from = this.dataOfCs(s.loadoutCs ?? vanillaCs);
      const keep = {};
      if (from || !versioned) {
        for (const [id, e] of Object.entries(loadout)) {
          if (!sameOperator(from, id)) continue;
          const r = checkLoadout({ [id]: { skill: e.skill, ...(e.module != null ? { module: e.module } : {}) } }, chess);
          if (r && !r.error && r.loadout[id]) keep[id] = r.loadout[id];
        }
      }
      loadout = freezeLoadout(keep);
      const ids = opsCharIds(data);
      const changes = (x) => charPotentialChanges(data, x);
      const keepOps = {};
      for (const [id, e] of Object.entries(ops || {})) {
        // a 潜能 that changes nothing on this content's operator (a plugin's char_x_ without a curve) is dropped, its 练度
        // kept — as the page's sanitizeOps does (public/js/ui/loadoutModel.js)
        const one = changes(id) === false ? { cultivate: e.cultivate } : { potential: e.potential, cultivate: e.cultivate };
        const r = checkLoadoutOps({ [id]: one }, (x) => ids.has(x), changes);
        if (r && !r.error && r.ops[id]) keepOps[id] = r.ops[id];
      }
      ops = freezeOps(keepOps);
    }
    if (notOwned && other(s.notOwnedCs)) {
      const from = this.dataOfCs(s.notOwnedCs ?? vanillaCs);
      const r = from || !versioned ? checkNotOwned(notOwned.filter((id) => sameOperator(from, id)), chess) : null;
      notOwned = r && !r.error ? Object.freeze(r.notOwned.slice()) : null;
    }
    if (diy && other(s.diyCs)) {
      const r = checkDiyPicks({ ...diy }, { data, kitted: this.kittedFor(room) });
      diy = r && 'ok' in r ? freezeDiy(r.picks) : null;
    }
    // 干员皮肤 (docs/SKINS.md): the skinId lives in a cosmetic overlay, not the content set, but the KEY is an operator
    // of this room. A charId the content does not have is dropped; a map that is no longer a plain charId→skinId
    // selection is left off the seat rather than handed to the match.
    let skins = null;
    if (s.skins && typeof s.skins === 'object') {
      const ids = operatorCharIds(data);
      const res = checkSkinSelection(s.skins, (id) => ids.has(id));
      if (res.ok) skins = Object.freeze({ ...res.skins });
    }
    return { loadout, ops, notOwned, diy, skins };
  }

  /**
   * Extra fields of every `welcome` (net.js): the operators a 自选 slot may field (shared/diy.js `kitted`) and the
   * server's content identity (header "Content identity").
   */
  welcomeInfo() {
    let info;
    if (!this.vanilla) info = { diyKitted: KITTED_CHARS };
    else {
      let n;
      try { n = Number(this.plugins?.unofficial?.()) || 0; } catch { n = 0; }
      info = { diyKitted: KITTED_CHARS, content: n > 0 ? { vanilla: this.vanilla.cs, plugins: n } : { vanilla: this.vanilla.cs } };
      // Catalogue metadata, never part of a room or match; omitted when no loaded plugin publishes a notice.
      if (this.plugins?.hasNotices?.()) info.content.notices = true;
    }
    // the official versions (header "Official versions"): only when the server offers more than 第二期下半, so a
    // welcome from a server narrowed to that version alone stays without `versions`
    let versions = null;
    try { versions = this.versions?.welcome?.() || null; } catch (e) { this.log.error('[lobby] the versions list failed', e); }
    if (versions) info.versions = versions;
    // Omitted when the switch is off, so a welcome from a normal server stays identical.
    if (this.testEnabled === true) info.testMode = true;
    return info;
  }

  // ---------------------------------------------------------------------------------------------------
  // Match wiring
  // ---------------------------------------------------------------------------------------------------

  /** @param {Room} room @param {string | null} [key] per-network limit key of the starter */
  startMatch(room, key = null) {
    if (room.test && !this.testEnabled) return fail(ERR.TEST_DISABLED);
    // another official version's match runs in that version's match host — never here, where every module singleton
    // holds 第二期下半's data (header "Official versions"); a test that gave its own MatchClass runs it in place
    const versioned = room.version !== DEFAULT_VERSION;
    if (versioned && !this.versionHosts && this.MatchClass === DefaultMatch) {
      this.log.error(`[lobby] ${room.code} has no match host for ${room.version}`);
      return fail(ERR.INTERNAL, 'no match host for this version');
    }
    // (room.start refuses during a vote; a start from elsewhere voids it)
    if (room.versionVote) this.voidVersionVote(room, 'members');
    // 危机合约, defensive: every mutating path re-checks the selection (room.revalidateContracts), but a lobby plugin's
    // beforeStart may still have changed the seats. An invalid selection starts the match WITHOUT contracts rather than
    // failing the start: startMatch's refusals are about the environment (another version's host, the per-network limit,
    // a plugin-busy content set) and the lobby has no error code for "the picks became illegal" (that is setContracts'
    // BAD_TARGET); refusing here would strand the host mid-start with a state room.start cannot repair. Empty +
    // logged + broadcast below is the room's normal "no 危机合约" shape, and the host re-picks deliberately next time.
    this.revalidateContracts(room);
    const host = room.seatOf(room.hostId);
    if (host) host.ready = true;
    // the room's data: its content set's in a room with gameplay plugins (header "Gameplay plugins")
    const data = this.dataFor(room);
    const seats = room.seats.filter(Boolean).map((s) => {
      // a setting checked for another content is filtered to this room's data (header "Gameplay plugins")
      const own = s.isBot ? null : this.seatSettings(room, s, data);
      return {
        seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, connected: s.connected,
        // DESIGN §16: the human's checked operator loadout and (0.2.2) per-operator 潜能 / 练度 (bots fight with the defaults)
        loadout: own ? own.loadout : null,
        ops: own ? own.ops : null,
        // 0.2.0 补位: the chess the human marked as not owned (bots own every operator)
        notOwned: own ? own.notOwned : null,
        // 0.2.0 自选编队: the human's checked DIY picks (bots field no 自选 piece [ASSUMED])
        diy: own ? own.diy : null,
        // 干员皮肤 (docs/SKINS.md): the appearances the human wears, keyed by operator charId (bots always default)
        skins: own ? own.skins : null,
      };
    });
    // lastPublic / results: the latest m.public broadcast and the m.result frames (encoded), kept for the replay.
    const ctx = { live: true, ended: false, disposed: false, match: null, lastPublic: null, sharedResult: null, results: new Map() };
    let seed = 0;
    try { seed = this.seedFn() >>> 0; } catch { seed = randomInt(2 ** 32); }
    const modded = room.modded;
    // 随机交接是每局一次的（server/aiTakeover.js）：新对局把上一次的落点清掉。
    room.aiRandomRound = null; room.aiRandomFired = false; room._aiRandomSeen = null;
    try {
      const opts = {
        // 插件的 Match opts（例如对抗的分边人数）——引擎字段在前，插件只能补自己认识的键
        ...(this.ext?.options?.(room) || {}),
        roomCode: room.code,
        mode: room.mode,
        difficulty: room.difficulty,
        // a plugin mode the host chose (header "Gameplay plugins"), else the official mode of the difficulty
        // 肉鸽用自己的一份 mode 记录（mode_rogue_<难度>）：回合数/敌人数值都从那里读，不再借用多人的表。
        // 独立模式看 room.mode，老写法（coop + variant:'rogue'）看 room.variant；solo/coop 传 undefined，结果不变。
        modeId: (this.ext?.options?.(room) || {}).modeId || room.content?.modeId
          || modeIdFor(room.mode, room.difficulty, room.mode === 'rogue' || room.variant === 'rogue' ? 'rogue' : undefined),
        // 房间变体（协同共竞 'xie' / 肉鸽 'rogue' / 无限火力 blitz…）。**必须透传给 Match**：引擎侧
        // `Match.roomVariant` 靠它判 `isRogue`。以前只把变体存进 `room.variant` 并广播给客户端，却没进 opts
        // ⇒ `isRogue` 恒 false，肉鸽的藏品节奏 / 随机事件 / 随机词缀 / 每回合换图**全部静默失效**（2026-10-31 修）。
        ...(typeof room.variant === 'string' && room.variant ? { variant: room.variant } : {}),
        // 「AI 队友最后选择」 (GitHub #338): fixed for the match
        aiPicksLast: room.mode !== 'solo' && room.aiPicksLast === true,
        // 危机合约 (room.setContracts): the selection the match plays, already resolved. Omitted while the room has
        // none, so a normal match's opts keep their keys.
        ...(room.contracts.length ? { contracts: room.contracts.slice() } : {}),
        seats,
        // the spectator seats (header): watched like eliminated players, never players
        spectators: room.spectators.map((s) => s.playerId),
        // the room's host: the current executor of a delegated bot layout rehearsal (DESIGN §14; setHost follows a
        // migration while the match runs)
        hostId: room.hostId,
        // only a room created as a test room; a normal match opts object does not grow a test key
        ...(room.test === true ? { test: true } : {}),
        seed,
        // the room's match number: with the seed it keeps battleIds unique across the room's matches (DESIGN §14)
        matchNo: room.matchCount + 1,
        // the room's content hash (header "Content identity"): copied into every BattleSpec; its visual set too (a
        // replay names the art), and with gameplay plugins a b.result must name the room's cs (header "Gameplay plugins")
        ...(room.content ? { cs: room.content.cs } : {}),
        ...(room.content?.vs ? { vs: room.content.vs } : {}),
        ...(modded || versioned ? { requireCs: true } : {}),
        // another official version (header "Official versions"): its registry id; a default room's opts keep their keys
        ...(versioned ? { version: room.version } : {}),
        // 「不限时」 (header): only while the room's flag is on, so a default match's opts keep their keys
        ...(room.mode === 'solo' && room.soloUnlimited === true ? { soloUnlimited: true } : {}),
        // 「包含无场景地图」 (header): only while the room's flag is on; off, the match narrows its stage pools itself
        ...(room.incompleteMaps === true ? { incompleteMaps: true } : {}),
        // 肉鸽「地图主题池」 (header): only while a theme is selected; 'all' keeps the opts' keys as before
        ...(room.mapPool !== 'all' ? { mapPool: room.mapPool } : {}),
        // The list the lobby just checked the picks with (kittedFor). Vanilla rooms omit it: setDiy stays on
        // KITTED_CHARS, and the worker payload / test journal of a normal match do not grow a key.
        ...(modded ? { kitted: this.kittedFor(room) } : {}),
        ...(room.content?.rules ? { rules: room.content.rules } : {}),
        data,
        log: this.log,
        now: this.now,
        // the server's own simulation pool (server/workers/roomPool.js) for bot rehearsals, when the operator started
        // one: null keeps every rehearsal on this thread, exactly as before (Match.simPool / MatchRehearsal.poolRehearsal)
        ...(!modded && !versioned && this.simPool ? { simPool: this.simPool } : {}),
        send: (playerId, msg, encoded) => (ctx.live ? this.matchSend(room, ctx, playerId, msg, encoded) : false),
        broadcast: (msg, encoded) => { if (ctx.live) this.matchBroadcast(room, ctx, msg, encoded); },
        onEnd: (summary) => this.onMatchEnd(room, ctx, summary),
      };
      // a room with gameplay plugins plays in its content set's match host, a room of another official version in that
      // version's; every other room here, as always
      // 无损插件的代码根（含 Match 入口）随内容集一起交给宿主；没有这一项时宿主只会加载上游 Match。
      const match = modded && this.hosts ? this.hosts.create(room.content.cs, { ...opts, code: room.content.code || null })
        : versioned && this.versionHosts ? this.versionHosts.create(room.content.cs, opts)
          : new this.MatchClass(opts);
      ctx.match = match;
      room.match = match;
      room.matchCtx = ctx;
      room.matchKey = key;
      room.replay = null;
      room.matchCount++;
      this.log.info(`[lobby] ${room.code} match #${room.matchCount} starting (${room.mode}/${room.difficulty}, ${seats.length} seats, seed ${seed}${room.test ? ', test' : ''}${modded ? `, content ${room.content.cs.slice(0, 8)}${match.hosted ? ' in its match host' : ''}` : ''}${versioned ? `, version ${room.version}${match.hosted ? ' in its match host' : ''}` : ''})`);
      this.broadcastState(room);
      match.start();
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match failed to start`, e);
      if (room.matchCtx === ctx) {
        resetAiTakeover(room);
        room.match = null; room.matchCtx = null; room.matchKey = null;
      }
      this.disposeMatchCtx(ctx);
      this.broadcastState(room);
      // the match hosts refuse one content set more than they run (PLUGIN_BUSY: server/match/host/index.js)
      return fail(e && isErrCode(e.code) ? e.code : ERR.INTERNAL, 'match failed to start');
    }
    return OK;
  }

  /** onEnd callback: return the room to LOBBY and dispose the match on the next macrotask. */
  onMatchEnd(room, ctx, summary) {
    if (ctx.ended || !ctx.live || room.matchCtx !== ctx || room.disposed) return;
    ctx.ended = true;
    room.lastSummary = summary ?? null;
    resetAiTakeover(room);
    room.match = null;
    room.matchCtx = null;
    room.matchKey = null;
    room.replay = this.buildReplay(room, ctx);
    setImmediate(() => this.disposeMatchCtx(ctx));
    // a match of gameplay plugins, or of an official version, whose match host stopped (header "Gameplay plugins",
    // "Official versions"; its members were told: proxy.js)
    const why = summary && typeof summary.reason === 'string' && /^(?:plugin|version)-/.test(summary.reason) ? ` (${summary.reason}${summary.detail ? `: ${summary.detail}` : ''})` : '';
    this.log.info(`[lobby] ${room.code} match #${room.matchCount} ended${why}`);
    for (let i = 0; i < room.seats.length; i++) {
      const s = room.seats[i];
      if (!s || s.isBot) continue;
      if (s.left) { room.seats[i] = null; continue; }
      s.ready = false;
      if (!s.connected) this.startGrace(room, s);
    }
    for (const s of room.spectators) if (!s.connected) this.startGrace(room, s);
    const host = room.hostId ? room.seatOf(room.hostId) : null;
    if (!host || host.isBot || host.left) this.migrateHost(room);
    if (room.activeHumans().length === 0) this.disposeRoom(room, 'empty');
    else {
      this.broadcastState(room);
      // its plugins changed on disk during the match: the host can apply them again now
      if (room.pluginsChanged) this.tellPluginsChanged(room);
    }
  }

  /** Match unicast; m.result frames are also kept for the replay. */
  matchSend(room, ctx, playerId, msg, encoded = null) {
    if (msg && msg.t === 'm.result') {
      const data = encoded ?? encode(msg);
      if (data != null) ctx.results.set(playerId, data);
    }
    return this.sendToPlayer(room, playerId, msg, encoded);
  }

  /** Match broadcast; the latest m.public and a broadcast m.result are also kept for the replay. */
  matchBroadcast(room, ctx, msg, encoded = null) {
    if (msg.t === 'm.public' && reconcileAiTakeover(this, room)) this.broadcastState(room);
    // 随机交接 (server/aiTakeover.js)：插件的 Match 跑在 match host 的 worker 里，lobby 传进去的回调跨不过去，
    // 所以房间能看到的「回合钟」只有它自己的 m.public 帧——每回合的 PREP 帧到了就试一次（内部有窗口与一次性判定）。
    if (msg.t === 'm.public' && msg.phase === 'PREP' && msg.round !== room._aiRandomSeen) {
      room._aiRandomSeen = msg.round;
      // 插件对局的 Match 在 worker 里，问状态要走 RPC ⇒ 这一步是异步的；帧广播不能等它，失败只记日志。
      const pendingRandom = (() => { try { return maybeRandomAiTakeover(this, room, msg.round); } catch (e) { this.log.error('[lobby] random AI handover failed', e); return null; } })();
      if (pendingRandom && typeof pendingRandom.then === 'function') pendingRandom.catch((e) => this.log.error('[lobby] random AI handover failed', e));
    }
    const data = this.broadcastRoom(room, msg, encoded);
    if (data == null) return;
    if (msg.t === 'm.public') ctx.lastPublic = data;
    else if (msg.t === 'm.result') ctx.sharedResult = data;
  }

  /**
   * Replay record for the humans still seated when a match ends (null when the match produced no m.result,
   * e.g. it was abandoned: those clients then see "simulation closed").
   * @param {Room} room @returns {Room['replay']}
   */
  buildReplay(room, ctx) {
    const frames = new Map();
    for (const s of [...room.seats, ...room.spectators]) {
      if (!s || s.isBot || s.left) continue;
      const frame = ctx.results.get(s.playerId) || ctx.sharedResult;
      if (frame) frames.set(s.playerId, frame);
    }
    if (frames.size === 0) return null;
    return { publicFrame: ctx.lastPublic, frames, pending: new Set(frames.keys()) };
  }

  /** The replay frames still owed to a player (null when they moved on). @returns {string[] | null} */
  replayFor(room, playerId) {
    const r = room.replay;
    if (!r || !r.pending.has(playerId)) return null;
    return [r.publicFrame, r.frames.get(playerId)].filter(Boolean);
  }

  /** The player moved on from the result screen (acted in the room, left): stop replaying it. */
  dropReplay(room, playerId) {
    const r = room.replay;
    if (!r || !r.pending.delete(playerId)) return;
    r.frames.delete(playerId);
    if (r.pending.size === 0) room.replay = null;
  }

  /**
   * The heavy part of a resync — full match state (match.onReconnect) or, back in LOBBY, the result replay.
   * Immediate after a (re)connect; for repeated hellos on a live socket at most once per resyncMinGapMs
   * (requests inside the window coalesce into one deferred resync).
   * @param {import('./net.js').Session} session @param {boolean} coalesce
   */
  resync(session, coalesce) {
    const pid = session.playerId;
    if (coalesce) {
      if (this.resyncTimers.has(pid)) return; // the scheduled resync answers this request too
      const wait = (Number.isFinite(session.resyncAt) ? session.resyncAt : -Infinity) + this.opts.resyncMinGapMs - this.now();
      if (wait > 0) {
        const t = setTimeout(() => { this.resyncTimers.delete(pid); this.runResync(session); }, wait);
        t.unref?.();
        this.resyncTimers.set(pid, t);
        return;
      }
    } else {
      this.clearResync(pid);
    }
    this.runResync(session);
  }

  /** @param {import('./net.js').Session} session */
  runResync(session) {
    if (!session.connected || this.registry.byId(session.playerId) !== session) return;
    const room = this.roomOf(session);
    if (!room) return;
    // in order with the room's messages when its match runs in a match host (header "Gameplay plugins")
    if (this.queuedRoom(session)) { this.queueEvent(room, () => this.resyncNow(session)); return; }
    this.resyncNow(session);
  }

  /** runResync, now. @param {import('./net.js').Session} session */
  resyncNow(session) {
    if (!session.connected || this.registry.byId(session.playerId) !== session) return;
    const room = this.roomOf(session);
    if (!room) return;
    session.resyncAt = this.now();
    if (room.match) {
      this.callMatch(room, room.spectatorOf(session.playerId) ? 'addSpectator' : 'onReconnect', session.playerId);
      return;
    }
    const frames = this.replayFor(room, session.playerId);
    if (frames) for (const frame of frames) sendRaw(session.ws, frame);
  }

  clearResync(playerId) {
    const t = this.resyncTimers.get(playerId);
    if (t) { clearTimeout(t); this.resyncTimers.delete(playerId); }
  }

  /** Log a per-network limit refusal without letting a refusal loop flood the log. */
  limitWarn(text) {
    const now = this.now();
    if (now - this.limitLog.at < 10_000) { this.limitLog.suppressed++; return; }
    const more = this.limitLog.suppressed ? ` (+${this.limitLog.suppressed} similar refusals)` : '';
    this.limitLog.at = now;
    this.limitLog.suppressed = 0;
    this.log.warn(`[lobby] ${text}${more}`);
  }

  /** A warning logged once per text (the default plugins that cannot be applied …). @param {string} line */
  warnOnce(line) {
    if (this.told.has(line)) return;
    if (this.told.size < 256) this.told.add(line);
    this.log.warn(line);
  }

  /** Number of rooms matching a predicate. */
  countRooms(pred) {
    let n = 0;
    for (const r of this.rooms.values()) if (pred(r)) n++;
    return n;
  }

  /**
   * Route a 'g.*' intent or a 'b.*' report (server/net.js) to the running match — on the room's queue when its match runs
   * in a match host (header "Gameplay plugins").
   */
  routeGame(session, msg) {
    const room = this.queuedRoom(session);
    return room ? this.serial(room, () => this.routeGameNow(session, msg)) : this.routeGameNow(session, msg);
  }

  /** routeGame, now. */
  routeGameNow(session, msg) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (msg.t === 'g.test') {
      if (!this.testEnabled) return fail(ERR.TEST_DISABLED);
      if (room.test !== true) return fail(ERR.TEST_FORBIDDEN);
    }
    if (!room.match) return fail(ERR.WRONG_PHASE, 'no running match');
    if (msg.t === 'g.leave') {
      this.removeMember(room, session.playerId);
      return OK;
    }
    // a spectator only watches (header): nothing else of it ever reaches the match
    if (msg.t !== 'g.watch' && !(room.test && msg.t === 'g.test') && room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    let res;
    try {
      res = room.match.handle(session.playerId, msg);
      if (reconcileAiTakeover(this, room)) this.broadcastState(room);
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match.handle(${msg.t}) threw`, e);
      return fail(ERR.INTERNAL);
    }
    if (res && typeof res.then === 'function') {
      // a match in a match host answers later (header "Gameplay plugins"): the reply waits for it
      if (room.match?.hosted === true) {
        return Promise.resolve(res).then((r) => matchAnswer(r), (e) => {
          this.log.error(`[lobby] ${room.code} match.handle(${msg.t}) rejected`, e);
          return fail(ERR.INTERNAL);
        });
      }
      // Contract violation (handle must be synchronous): never let the rejection go unhandled.
      this.log.error(`[lobby] ${room.code} match.handle(${msg.t}) returned a Promise; it must be synchronous`);
      Promise.resolve(res).catch((e) => this.log.error(`[lobby] ${room.code} match.handle(${msg.t}) rejected`, e));
      return OK;
    }
    return matchAnswer(res);
  }

  /** Call an optional match hook without letting it throw. onLeave falls back to onDisconnect. */
  callMatch(room, method, ...args) {
    const m = room.match;
    if (!m) return undefined;
    let fn = m[method];
    if (typeof fn !== 'function' && method === 'onLeave') fn = m.onDisconnect;
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.apply(m, args);
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match.${method} threw`, e);
      return undefined;
    }
  }

  disposeMatchCtx(ctx) {
    if (ctx.disposed) return;
    ctx.disposed = true;
    ctx.live = false;
    try { ctx.match?.dispose?.(); } catch (e) { this.log.error('[lobby] match.dispose threw', e); }
  }

  safeData() {
    try { return this.getData(); } catch (e) { this.log.error('[lobby] getData failed', e); return Object.freeze({}); }
  }

  /**
   * How long a dropped solo run stays resumable (ms): the option, else data singleReconnectTime — the room's version's
   * (header "Official versions": 第一期 has none, so the 24 h figure below) —, else 24 h. The 24 h fallback is a
   * carried-over convenience [ASSUMED]: 第一期's constData never gained singleReconnectTime, and M2 did not add it.
   * The code path is unchanged (§35.23.10). It is not official 第一期 data, and it is not "because the solo is untimed"
   * — a 第一期 solo is timed unless the room's 「不限时」 is on.
   * @param {Room | null} [room]
   */
  soloResumeWindowMs(room = null) {
    const o = this.opts.soloReconnectWindowMs;
    if (typeof o === 'number' && Number.isFinite(o) && o > 0) return o;
    const data = room && room.version !== DEFAULT_VERSION ? this.dataFor(room) : this.safeData();
    const sec = data?.config?.constants?.singleReconnectTime;
    return (typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? sec : SOLO_RECONNECT_FALLBACK_SEC) * 1000;
  }

  // ---------------------------------------------------------------------------------------------------
  // Membership helpers
  // ---------------------------------------------------------------------------------------------------

  /** The session's current room (self-heals stale `roomCode`). @returns {Room | null} */
  roomOf(session) {
    if (!session.roomCode) return null;
    const room = this.rooms.get(session.roomCode);
    const seat = room ? room.seatOf(session.playerId) : null;
    if (room && !seat && room.spectatorOf(session.playerId)) return room; // a spectator seat
    if (!room || !seat || seat.left || seat.isBot) { session.roomCode = null; return null; }
    return room;
  }

  /**
   * A human seat for `session` in `room`. The card is checked against the room's operators (header 名片干员): one the
   * room's content lacks is left off the seat, never cleared from the session.
   * @param {number} idx @param {any} session @param {Room} room
   * @returns {Seat}
   */
  humanSeat(idx, session, room) {
    const card = session.card && chessCharIds(this.dataFor(room)).has(session.card) ? session.card : null;
    return {
      seat: idx, playerId: session.playerId, name: session.name, isBot: false, ready: false, connected: session.connected, left: false,
      loadout: session.loadout || null,
      ops: session.ops || null,
      notOwned: session.notOwned || null,
      diy: session.diy || null,
      // 干员皮肤 (docs/SKINS.md): the appearances this player wears, keyed by operator charId (PUBLIC: the match
      // publishes them to teammates)
      skins: session.skins || null,
      // 名片干员 (room.card): the operator on this player's seat card (PUBLIC: room.state seats[].card)
      card,
      // 名片代号 / 卡面 (业主 2026-11-02)：重名时显示「名字#代号」；卡面只是素材 id
      tag: session.tag || null,
      nc: session.nc || null,
      // the content each was checked for (header "Gameplay plugins": filtered at the match start when it is another)
      loadoutCs: session.loadoutCs ?? null,
      notOwnedCs: session.notOwnedCs ?? null,
      diyCs: session.diyCs ?? null,
    };
  }

  /**
   * Remove a human from a room permanently (leave, grace timeout, expiry, switching rooms).
   * In LOBBY the seat is freed; during a match it is marked departed and match.onLeave is called.
   * @param {Room} room @param {string} playerId
   */
  removeMember(room, playerId) {
    const session = this.registry.byId(playerId);
    if (session && session.roomCode === room.code) session.roomCode = null;
    this.clearGrace(playerId);
    this.dropReplay(room, playerId);
    if (this.freeSpectatorSeat(room, playerId)) return;
    const seat = room.seatOf(playerId);
    if (!seat || seat.isBot || seat.left || room.disposed) return;
    if (room.match) {
      seat.left = true;
      seat.connected = false;
      seat.ready = false;
      this.callMatch(room, 'onLeave', playerId);
    } else {
      room.seats[seat.seat] = null;
      // a player seat freed: the version vote is void (header "Official versions")
      if (room.versionVote) this.voidVersionVote(room, 'members');
      // 危机合约 (room.revalidateContracts): a smaller room may no longer support the host's selection. The broadcast
      // below (or the dispose) is the only frame either way — voidVersionVote('members') broadcasts nothing itself.
      this.revalidateContracts(room);
    }
    if (room.disposed) return; // onLeave may have ended the match and emptied the room
    if (room.hostId === playerId) this.migrateHost(room);
    if (room.activeHumans().length === 0) this.disposeRoom(room, 'empty');
    else this.broadcastState(room);
  }

  /**
   * Free a spectator seat (removeMember): the match forgets the spectator; never a host change or a disposal — a
   * spectator neither holds the host nor keeps a room alive. @returns {boolean} true when it was a spectator seat
   */
  freeSpectatorSeat(room, playerId) {
    const i = room.spectators.findIndex((s) => s.playerId === playerId);
    if (i < 0) return false;
    room.spectators.splice(i, 1);
    if (room.disposed) return true;
    this.callMatch(room, 'removeSpectator', playerId);
    this.broadcastState(room);
    return true;
  }

  /** Lowest-seat connected human becomes host (else lowest-seat human, else null). */
  migrateHost(room) {
    const humans = room.activeHumans();
    const pick = humans.find((s) => s.connected) || humans[0] || null;
    const prev = room.hostId;
    room.hostId = pick ? pick.playerId : null;
    if (pick && prev !== pick.playerId) this.log.info(`[lobby] ${room.code} host → ${pick.name}`);
    // a host change voids the version vote (header "Official versions") — defensive: while a vote is open (no match) the
    // host only changes by leaving, kick or grace timeout, whose freed seat voided it already (removeMember)
    if (room.hostId !== prev && room.versionVote) this.voidVersionVote(room, 'members');
    // a running match follows the host change: its delegated bot rehearsals fall back to the server and later ones ask
    // the new host (DESIGN §14, Match.setHost)
    if (room.match && room.hostId !== prev) this.callMatch(room, 'setHost', room.hostId);
  }

  startGrace(room, seat) {
    const playerId = seat.playerId;
    this.clearGrace(playerId);
    const t = setTimeout(() => {
      this.graceTimers.delete(playerId);
      if (room.disposed || room.match) return;
      const s = room.seatOf(playerId) || room.spectatorOf(playerId);
      if (!s || s.connected) return;
      const session = this.registry.byId(playerId);
      if (session && session.roomCode === room.code) {
        session.notice = 'timeout';
        session.pendingResult = this.replayFor(room, playerId); // still shown after room.closed on resume
      }
      this.removeMember(room, playerId);
    }, this.opts.lobbyGraceMs);
    t.unref?.();
    this.graceTimers.set(playerId, t);
  }

  clearGrace(playerId) {
    const t = this.graceTimers.get(playerId);
    if (t) { clearTimeout(t); this.graceTimers.delete(playerId); }
  }

  /**
   * Delete a room, detach its members (room.closed unless the room simply emptied) and dispose its match.
   * @param {Room} room @param {string} reason
   */
  disposeRoom(room, reason) {
    if (room.disposed) return;
    room.disposed = true;
    try { this.ext?.emit?.('disposed', room); } catch { /* 插件自己的清理失败不拖垮房间 */ }
    if (this.rooms.get(room.code) === room) { this.trustedRuntime?.event('roomClosed',{room:room.toState(this.now())}); this.rooms.delete(room.code); }
    // an open version vote ends with the room (its timer)
    if (room.versionVote) { clearTimeout(room.versionVote.timer); room.versionVote = null; }
    const ctx = room.matchCtx;
    resetAiTakeover(room);
    room.match = null;
    room.matchCtx = null;
    room.matchKey = null;
    room.replay = null;
    for (const s of room.seats) {
      if (!s || s.isBot) continue;
      this.clearGrace(s.playerId);
      const session = this.registry.byId(s.playerId);
      if (!session || session.roomCode !== room.code) continue;
      session.roomCode = null;
      if (s.left || reason === 'empty') continue;
      if (session.connected) sendSession(session, { t: 'room.closed', reason });
      else session.notice = reason;
    }
    // spectators did not leave: they are told whatever closed the room (its last human leaving included)
    for (const s of room.spectators) {
      this.clearGrace(s.playerId);
      const session = this.registry.byId(s.playerId);
      if (!session || session.roomCode !== room.code) continue;
      session.roomCode = null;
      if (session.connected) sendSession(session, { t: 'room.closed', reason });
      else session.notice = reason;
    }
    if (ctx) this.disposeMatchCtx(ctx);
    // the room's visual set and content set are no longer held by it (server/plugins/visualSet.js, contentSets.js)
    this.releaseContent(room.content);
    this.log.info(`[lobby] ${room.code} disposed (${reason})`);
  }

  genCode(yieldingRoom = null) {
    // create() may reuse its caller's sole-human room only after validation; no membership changes here.
    const fixed = this.opts.roomCode || null;
    if (fixed) return this.rooms.has(fixed) && this.rooms.get(fixed) !== yieldingRoom ? null : fixed;
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LEN; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------------------------------

  /** Connected, non-departed human sessions of a room — its spectators included (room.state, match broadcasts). */
  *memberSessions(room) {
    for (const s of [...room.seats, ...room.spectators]) {
      if (!s || s.isBot || s.left) continue;
      const session = this.registry.byId(s.playerId);
      if (session && session.connected && session.roomCode === room.code) yield session;
    }
  }

  broadcastState(room) {
    if (room.disposed) return;
    reconcileAiTakeover(this, room);
    if (this.trustedRuntime) {
      const state = room.toState(this.now()), prev = room.trustedPrevious;
      const event = (name,extra={}) => this.trustedRuntime.event(name,{room:state,...extra});
      if (!prev) event('roomCreated');
      const before = new Set((prev?.seats || []).filter(Boolean).map(s => s.playerId));
      const after = new Set(state.seats.filter(Boolean).map(s => s.playerId));
      for (const id of after) if (!before.has(id)) event('playerJoined',{playerId:id});
      for (const id of before) if (!after.has(id)) event('playerLeft',{playerId:id});
      if (state.inMatch && !prev?.inMatch) event('matchStarted');
      room.trustedPrevious = state;
    }
    const data = encode(room.toState(this.now()));
    for (const session of this.memberSessions(room)) sendRaw(session.ws, data);
  }

  sendState(room, session) {
    sendSession(session, room.toState(this.now()));
  }

  /** Match broadcast: encode once, send to every connected member. @returns {string | null} the encoded frame */
  broadcastRoom(room, msg, encoded = null) {
    if (room.disposed) return null;
    const data = encoded ?? encode(msg);
    if (data == null) { this.log.error(`[lobby] ${room.code} unserializable broadcast ${msg && msg.t}`); return null; }
    // per connection: sendSession runs the state transport, which owns each socket's delta baseline (and the
    // droppable/backpressure rules) - one shared byte string in, one frame per member out
    for (const session of this.memberSessions(room)) sendSession(session, msg, data);
    return data;
  }

  /** Match unicast. @returns {boolean} */
  sendToPlayer(room, playerId, msg, encoded = null) {
    if (room.disposed) return false;
    const seat = room.seatOf(playerId) || room.spectatorOf(playerId);
    if (!seat || seat.isBot || seat.left) return false;
    const session = this.registry.byId(playerId);
    if (!session || session.roomCode !== room.code) return false;
    return sendSession(session, msg, encoded);
  }
}
