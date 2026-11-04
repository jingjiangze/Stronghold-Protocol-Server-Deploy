// Row fire uses the same position and speed in simulation and client effects.
// It stops at the first eligible collision, including units moving into a lane.
import { TICK } from '../../constants.js';
import { areaSelectable } from '../../targeting.js';
import { hurt } from '../enemies.js';

export function launchBlackSnakeRow(battle, source, row, { speed = 2.5, damage = source.s.atk, side = 'L' } = {}) {
  const direction = side === 'R' ? -1 : 1;
  const from = side === 'R' ? battle.rect.c1 + 0.65 : battle.rect.c0 - 0.65;
  const to = side === 'R' ? battle.rect.c0 - 0.65 : battle.rect.c1 + 0.65;
  const shot = `${source.id}:${battle.time.toFixed(6)}:${row}:${side}`;
  battle.fx('bsFireball', { x: from, y: row, tx: to, ty: row, speed,
    dur: Math.abs(to - from) / speed, shot, id: source.id, kind: 'bsFireball' });
  let x = from;
  const advance = () => {
    if (battle.finished || !source.alive) return;
    const next = direction > 0 ? Math.min(to, x + speed * TICK) : Math.max(to, x - speed * TICK);
    const target = battle.allies().filter((u) => areaSelectable(source, u)
      && Math.abs(u.y - row) <= 0.35 && u.x >= Math.min(x, next) - 0.25 && u.x <= Math.max(x, next) + 0.25)
      .sort((a, b) => (a.x - b.x) * direction || a.id - b.id)[0];
    if (target) {
      hurt(battle, source, target, damage, 'arts', { tags: ['bsFire'] });
      battle.fx('bsFireHit', { x: target.x, y: target.y, id: target.id, shot, kind: 'bsFireHit' });
      return;
    }
    x = next;
    if ((to - x) * direction > 0) battle.after(TICK, advance, { owner: source });
  };
  battle.after(TICK, advance, { owner: source });
}
