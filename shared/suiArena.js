// Owner's bilateral adaptation: narrow unused left space, two flank shells and a central second form.
export const SUI_BOSS='boss_sui';
export const SUI_STAGE='sui_raid';
export const SUI_RECT=Object.freeze({r0:2,r1:5,c0:2,c1:18});
export const SUI_SHELL_SLOTS=Object.freeze([Object.freeze([4,8]),Object.freeze([4,12])]);
export const SUI_CENTER=Object.freeze([4,10]);
const terrace=row=>{const tiles=row.split('');for(const col of [4,5,15,16])tiles[col]='h';return tiles.join('');};
export const SUI_STAGE_ROWS=Object.freeze([
 'aaaaaaaaaa#aaaaaaaaaa',
 '####AAAAA###AAAAA####',
 terrace('##hrrrrrrrrrrrrrrrh##'),
 '##hrrrrrrrrrrrrrrrh##',
 '##ErrrrrrrrrrrrrrrE##',
 terrace('##hrrrrrrrrrrrrrrrh##'),
 '#########SSS#########',
 ...Array(12).fill('XXXXXXXXXXXXXXXXXXXXX'),
]);

// [ASSUMED] 2026-10-28 owner-requested further nerf; exact combat coefficients
// are chosen here. Native phases, pool HP, card costs and animation timings stay.
export const SUI_ATTACK_MUL=.8;
export const SUI_BALANCE=Object.freeze({shellDodge:.15,cardAttack:.2,bodyDamageMul:.6});
export const SUI_ATTACK_KEYS=Object.freeze(['enemy_2126_dycyue','enemy_2127_dysuih','enemy_2130_dyswrd','enemy_2131_dyfire']);
/** Decorate actual spawn previews; never synthesize another body or another independent HP budget. */
export function suiPreviewOf(entries,maxHp){
 if(!Number.isFinite(maxHp)||maxHp<=0)return entries;
 const bossPool={id:SUI_BOSS,hp:maxHp,maxHp};
 const bossHpWindow={min:maxHp*.5,max:maxHp};
 return entries.map(e=>e?.boss&&e.enemyKey===SUI_ATTACK_KEYS[0]?{...e,bossPool,bossHpWindow,suiPhase:1,facing:e.start?.[1]>SUI_CENTER[1]?1:-1}:e);
}
