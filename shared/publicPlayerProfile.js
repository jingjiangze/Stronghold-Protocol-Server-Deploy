import {normalizeNamecard} from './namecard.js';
// Only ledger-owned historical totals are public; personal/cloud settings and raw records never leave here.
export function publicPlayerProfile(session,record){
 const p=session.selfProfile||session.profile||{},n=v=>Number.isFinite(v)?Math.max(0,Math.floor(v)):0;
 return {comment:typeof p.comment==='string'?[...p.comment].slice(0,60).join(''):'',namecard:normalizeNamecard(p.namecard),
 matches:n(record?.matches),wins:n(record?.wins),hardWins:n(record?.hardWins),
 totalTitles:Object.fromEntries(Object.entries(record?.titles||{}).filter(([k,v])=>k.length<=64&&Number.isFinite(v)&&v>0).map(([k,v])=>[k,n(v)])),
 source:'server-ledger',settledAt:n(record?.lastAt)};
}
