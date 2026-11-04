import { ANIM } from '../../shared/constants.js';
import { createRng } from './rng.js';
import { unitInfo } from './snapshot.js';

/** Render-only second shield row: never enters Battle.units, targeting, protection or rewards. */
export class PatriotAtmosphere {
  constructor(seed) {
    this.rng = createRng(seed ^ 0x50415452);
    this.rows = new Map(); this.figures = []; this.events = []; this.nextId = 1000000;
  }
  living() { return this.figures.filter(x => x.alive); }
  sync(battle) {
    const groups = new Map();
    for (const guard of battle.enemies) {
      const g = guard.mem.patriotGuard;
      if (!guard.alive || !g || !g.body.alive) continue;
      const key = `${g.body.id}:${g.phase}:${g.sign}`;
      if (!groups.has(key)) groups.set(key, { ...g, guards: [] });
      groups.get(key).guards.push(guard);
    }
    const retire = (figure, reason) => {
      figure.alive = false; figure.diedAt = battle.time;
      this.events.push(['die', figure.info.id, reason]);
    };
    for (const [key, row] of this.rows) if (!groups.has(key)) {
      const combat = row.body.alive && row.body.mem.patriot?.phase === (row.phase === 1 ? 0 : 2);
      const live = row.figures.filter(x => x.alive);
      while (live.length) {
        const figure = combat ? this.rng.pick(live) : live[0];
        retire(figure, combat ? 'killed' : 'expired'); live.splice(live.indexOf(figure), 1);
      }
      this.rows.delete(key);
    }
    for (const [key, group] of groups) {
      let row = this.rows.get(key);
      if (!row) { row = { figures: [], body: group.body, phase: group.phase }; this.rows.set(key, row); }
      let live = row.figures.filter(x => x.alive);
      while (live.length > group.guards.length) {
        retire(this.rng.pick(live), 'killed'); live = row.figures.filter(x => x.alive);
      }
      while (live.length < group.guards.length) {
        const occupied = new Set(live.map(x => x.slot));
        let slot = 0; while (occupied.has(slot)) slot++;
        const source = unitInfo(group.guards[0]);
        const info = { ...source, id: this.nextId++, defId: 'studio_patriot_atmosphere',
          name: source.name + '（气氛组）', renderScale: source.renderScale || .65, facing: group.sign };
        const figure = { info, slot, alive: true, bodyId: group.body.id, sign: group.sign, x: 0, y: 0, anim: ANIM.IDLE };
        row.figures.push(figure); this.figures.push(figure); live.push(figure);
        this.place(figure, group); Object.assign(info, { x: figure.x, y: figure.y });
        this.events.push(['spawn', { ...info }]);
      }
      for (const figure of live) this.place(figure, group);
    }
    // Keep fallen figures long enough for their native death clip; bound repeated refill/kill sessions.
    this.figures = this.figures.filter(x => x.alive || battle.time - x.diedAt < 7);
    for (const row of this.rows.values()) row.figures = row.figures.filter(x => x.alive);
  }
  place(figure, group) {
    const dy = group.phase === 1 ? (figure.slot - 2) * .36 : (figure.slot - .5) * .34;
    figure.x = group.body.x + group.sign * (group.phase === 1 ? .42 : .22);
    figure.y = group.body.y + dy;
    figure.anim = group.body.moving ? ANIM.MOVE : ANIM.IDLE;
  }
  infos() { return this.living().map(x => ({ ...x.info, x: x.x, y: x.y })); }
  tuples() { return this.figures.map(x => [x.info.id, x.x, x.y, x.alive ? x.info.maxHp : 0,
    x.info.maxHp, 0, 0, 0, x.alive ? x.anim : ANIM.DIE]); }
  drainEvents() { const out = this.events; this.events = []; return out; }
}
