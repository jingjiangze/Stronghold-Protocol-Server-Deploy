// Owner-provided emotes (2026-10-27). Keep original image formats and all animation frames.
// Separate pages keep every image reachable in the existing six-cell wheel.
import { N_ } from './i18n.js';

export const EMOTE_PACK_DIR = 'commander_20261027';
export const EMOTE_SIX_DIR = 'commander_20261102';
export const EXTRA_EMOTE_THEMES = Object.freeze([
  { themeId: 'emoticon_commander_extra_20261027_1', dir: EMOTE_PACK_DIR, sortId: 2001, isBasic: false, name: N_('表情套组：团长加料 2'), emotes: [
    Object.freeze({ id: 'commander_battle_red_stone', sortId: 2200, picId: 'pic_red_stone', ext: 'jpg', label: N_('赤到石了') }),
    Object.freeze({ id: 'commander_battle_horn_character', sortId: 2201, picId: 'pic_horn_character', ext: 'gif', label: N_('角角角色') }),
    Object.freeze({ id: 'commander_battle_operator_added', sortId: 2202, picId: 'pic_operator_added', ext: 'jpg', label: N_('干员追加') }),
    Object.freeze({ id: 'commander_battle_flying_laugh', sortId: 2203, picId: 'pic_flying_laugh', ext: 'gif', label: N_('飞天笑哭') }),
    Object.freeze({ id: 'commander_battle_cat_gang', sortId: 2204, picId: 'pic_cat_gang', ext: 'gif', label: N_('小猫黑帮') }),
    Object.freeze({ id: 'commander_battle_blank_thought', sortId: 2205, picId: 'pic_blank_thought', ext: 'jpg', label: N_('空白想法') }),
  ] },
  { themeId: 'emoticon_commander_extra_20261027_2', dir: EMOTE_PACK_DIR, sortId: 2002, isBasic: false, name: N_('表情套组：团长加料 3'), emotes: [
    Object.freeze({ id: 'commander_battle_reverse_zone', sortId: 2206, picId: 'pic_reverse_zone', ext: 'png', label: N_('倒转区') }),
  ] },
  { themeId: 'emoticon_commander_extra_20261102', dir: EMOTE_SIX_DIR, sortId: 2003, isBasic: false, name: N_('表情套组：团长加料 4'), emotes: [
    Object.freeze({ id: 'commander_battle_spin_20261102', sortId: 2300, picId: 'pic_spin', ext: 'gif', label: N_('转圈圈') }),
    Object.freeze({ id: 'commander_battle_thunder_20261102', sortId: 2301, picId: 'pic_thunder', ext: 'jpg', label: N_('天雷滚滚') }),
    Object.freeze({ id: 'commander_battle_blue_shark_20261102', sortId: 2302, picId: 'pic_blue_shark', ext: 'gif', label: N_('蓝色小鲨鱼') }),
    Object.freeze({ id: 'commander_battle_sea_takeoff_20261102', sortId: 2303, picId: 'pic_sea_takeoff', ext: 'gif', label: N_('海面起飞') }),
    Object.freeze({ id: 'commander_battle_blank_stare_20261102', sortId: 2304, picId: 'pic_blank_stare', ext: 'jpg', label: N_('茫然凝视') }),
    Object.freeze({ id: 'commander_battle_rain_cry_20261102', sortId: 2305, picId: 'pic_rain_cry', ext: 'jpg', label: N_('雨中大哭') }),
  ] },
].map(t => Object.freeze({ ...t, emotes: Object.freeze(t.emotes) })));
