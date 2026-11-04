/** Separate from test mode: these games never enable developer commands. */
export function matchUnrankedReasons(v){
 const out=[];
 if(v?.cricket?.enabled)out.push('cricket');
 if(v?.randomEvents?.enabled)out.push('randomEvents');
 return out;
}
export const matchIsUnranked=v=>v?.unranked===true||matchUnrankedReasons(v).length>0;
export const matchRecordsAllowed=v=>v?.test!==true&&!matchIsUnranked(v);
