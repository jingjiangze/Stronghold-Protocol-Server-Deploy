// Prep traits from the maintainer's 2026-10-26 tables; values live in generated garrison blackboards.
import { topActiveBondMeta } from './meta.js';
import { absoluteRangeKeys } from '../../targeting.js';
import { COLS } from '../../constants.js';
import { attackRangeGrid } from '../../../../shared/loadoutRecord.js';

const amount = ctx => ctx.source.bb.count ?? 0;
export function registerOwnerMeta(registry) {
  registry.garrison('OWNER_ELITE_HISTORY', {
    run(ctx) {
      const n = Math.floor(ctx.counter('garrison:owner:elites') / 3) * amount(ctx);
      for (const id of ctx.gd.bondIds) if (ctx.bondActive(id)) ctx.addLayers(id, n, { requireActive: true });
    },
  });
  registry.garrison('OWNER_EVEN_ROUND_EQUIPMENT', {
    run(ctx) {
      if (ctx.round % 2 !== 0) return;
      for (let i = 0; i < amount(ctx); i++) {
        const id = ctx.rollItem();
        if (id) ctx.grantItem(id);
      }
    },
  });
  registry.garrison('OWNER_YAN_MEMBER_LAYERS', {
    run(ctx) {
      if (ctx.bondActive('yanShip')) ctx.addLayers('yanShip', ctx.bondCount('yanShip') * amount(ctx), { requireActive: true });
    },
  });
  registry.garrison('OWNER_FREE_REFRESH_LAYERS', {
    onRefresh(ctx, ev) {
      if (!ev || ev.trigger || ev.price !== 0 || !ctx.bondActive('siracusaShip')) return;
      const key = 'garrison:owner:freeRefreshLayers', uid = ctx.source.piece.uid;
      const n = Math.min(amount(ctx), ctx.source.bb.max_layer - ctx.pieceCounter(uid, key));
      if (n > 0) ctx.incPieceCounter(uid, key, ctx.addLayers('siracusaShip', n, { requireActive: true }));
    },
  });
  registry.garrison('OWNER_SIRACUSA_ROUND_GAINS', {
    run(ctx) { ctx.addLayers('siracusaShip', (ctx.roundStats().ownerSiracusaGains || 0) * amount(ctx), { requireActive: true }); },
  });
  registry.garrison('OWNER_TOP_BOND_TENS', {
    run(ctx) {
      const id = topActiveBondMeta(ctx);
      if (id) ctx.addLayers(id, Math.min(ctx.source.bb.max_layer, Math.floor(ctx.layers(id) / 10) * amount(ctx)), { requireActive: true });
    },
  });
  registry.garrison('OWNER_RANGE_CORE_LAYERS', {
    run(ctx) {
      const p = ctx.piece(ctx.source.piece.uid);
      if (p?.area !== 'board') return;
      const rec = ctx.chessRecord(p.id);
      const keys = new Set(absoluteRangeKeys(attackRangeGrid(rec), p.row, p.col, p.dir));
      // The table says every operator in range; self counts if its tile belongs to the authored grid. Tokens do not.
      const count = ctx.board().filter(t => t.kind === 'chess' && keys.has(t.row * COLS + t.col)).length;
      for (const id of ctx.gd.bondIds) if (ctx.data.bonds[id]?.isCore) ctx.addLayers(id, count * amount(ctx), { requireActive: true });
    },
  });
  registry.garrison('OWNER_SHOP_LEVEL_GIFT', {
    run(ctx) {
      for (let i = 0; i < amount(ctx); i++) {
        const id = ctx.rollChess({ maxTier: ctx.shopLevel() });
        if (id) ctx.grantChess(id);
      }
    },
  });
}
