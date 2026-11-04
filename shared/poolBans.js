// Owner 2026-10-27: seven EXTRA bans, after the existing bond bans. This is a narrow
// mechanism whitelist, never a blanket tier-V/VI exemption or a way to undo a bond ban.
export const EXTRA_OPERATOR_BANS = 7;

// [ASSUMED] Beyond the owner's explicit Dusk/Muelsyse examples, protect these sustained
// faction engines/team enablers. One-shot gains and personal layer-to-stat scaling alone
// do not qualify. Evidence is the named garrison, plus Skadi's team aura kit.
// "提提" is ambiguous: current data contains 缇缇 (titi) and 浊心斯卡蒂 (skadi2).
// Each qualifies independently; this list does not assert which nickname was intended.
export const EXTRA_BAN_CORE_MECHANISMS = Object.freeze([
  ['char_2015_dusk', 'garrison_119_a', '炎/奥术：按本轮招募人数持续叠层'],
  ['char_249_mlyss', 'garrison_76_a', '调和：提供变形同构体，开启转职配对'],
  ['char_4056_titi', 'garrison_125_a', '萨尔贡/精准：沉睡晕眩循环叠层'],
  ['char_1012_skadi2', 'garrison_84_a', '阿戈尔：层数驱动技力与再生，吟游/海嗣团队鼓舞'],
  ['char_1023_ghost2', 'garrison_40_a', '阿戈尔/不屈：本体替身切换循环叠层'],
  ['char_1019_siege2', 'garrison_53_a', '维多利亚/奇迹：不同阶阵容持续叠层'],
  ['char_1032_excu2', 'garrison_23_a', '拉特兰/远见：弹药消耗循环叠层'],
  ['char_4193_lemuen', 'garrison_24_a', '拉特兰/精准：同行阵容与弹药消耗循环叠层'],
  ['char_1045_svash2', 'garrison_126_a', '谢拉格：向队友授予冻结叠层特质'],
  ['char_1014_nearl2', 'garrison_145_a', '卡西米尔：向队友授予层数驱动再部署/攻速'],
  ['char_1038_whitw2', 'garrison_118_a', '叙拉古：精锐向全阵营授予击杀叠层'],
  ['char_264_f12yin', 'garrison_34_a', '投资人：按本轮招募人数持续叠层'],
  ['char_4146_nymph', 'garrison_56_a', '迅捷：整备区人数持续叠层'],
  ['char_1047_halo2', 'garrison_121_a', '灵巧/奥术：资金花费循环叠层'],
  ['char_291_aglina', 'garrison_147_a', '叙拉古：刷新次数循环叠层'],
  ['char_358_lisa', 'garrison_60_a', '重触发队友获得时特质，支持招募/投资叠层循环'],
  ['char_350_surtr', 'garrison_107_a', '突袭：重复部署驱动叠层循环'],
].map(([charId, garrisonId, reason]) => Object.freeze({ charId, garrisonId, reason })));

const coreByChar = new Map(EXTRA_BAN_CORE_MECHANISMS.map(rec => [rec.charId, rec]));

export function isExtraBanProtected(chess) {
  const core = coreByChar.get(chess?.charId);
  return !!core && (chess.tier === 5 || chess.tier === 6) && !chess.isDiy &&
    !chess.isHidden && !chess.isGolden && chess.garrisonIds?.includes(core.garrisonId) === true;
}
