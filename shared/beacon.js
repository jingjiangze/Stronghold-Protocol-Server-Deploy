export const BEACON_BUFF='use_equip_recruit_new_char_and_give_char_to_player_most_bond';
export const isBeaconItem=record=>!!record?.buffs?.some(buff=>buff.key===BEACON_BUFF);
