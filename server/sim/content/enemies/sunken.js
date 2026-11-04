// Native 2157_shadvr blackboards; ordinary-field adaptations are explicit in tools/data/additional-leaders.mjs.
import {T,hurt,elem,targetsNear,areaAlliesInTiles,setForm,castSlot} from './helpers.js';
import {skill} from './archetypes.js';
import {alive,ranged,lives} from './additional-leader-helpers.js';
const CONTROL=new Set(['cold','freeze','stun','fear','lure','palsy']);
const distance2=(a,z)=>(a.x-z.x)*(a.x-z.x)+(a.y-z.y)*(a.y-z.y);

function altar(b,e,r,c){
  const m=e.mem.sunken;if(m.altars.length>=5)return;
  for(const[dr,dc]of [[1,0],[0,1],[0,-1],[-1,0]]){
    const y=r+dr,x=c+dc;if(!b.grid.inRect(y,x)||m.altars.some(n=>n.x===x&&n.y===y))continue;
    // [ASSUMED] A relay marker replaces the original deployable high tile, without changing anyone's board.
    m.altars.push({x,y,altar:true});b.fx('zone',{id:e.id,x,y,r:.4,dur:180,kind:'sunkenAltar'});break;
  }
}
function meteor(b,e,ab){
  const m=e.mem.sunken,s=ab.sk[m.enhanced?'FireAdvance':'Fire'];
  const list=targetsNear(b,e,99).sort((a,z)=>z.aggroSeq-a.aggroSeq||a.id-z.id).slice(0,s.bb.max_target);
  if(!list.length)return;
  castSlot(b,e,s);b.addBuff(e,{key:'sunken:meteorCast',duration:s.bb.duration,flags:{invulnerable:true,noMove:true}});
  for(const u of list){const r=u.tileR,c=u.tileC;b.fx('telegraph',{id:e.id,x:c,y:r,r:1,dur:s.bb.duration,kind:'meteor'});
    b.after(s.bb.duration,()=>{if(!alive(e)||e.mem.additionalRebirthing)return;for(const v of areaAlliesInTiles(b,e,r,c,'plus',1))hurt(b,e,v,e.s.atk*s.bb.atk_scale,'phys');altar(b,e,r,c);},{owner:e});
  }
}
function form(b,e,ab,kind,enhanced=false,withMeteor=true){
  const m=e.mem.sunken;m.form=kind;m.enhanced=enhanced;m.sun=0;m.moon=0;
  if(kind!=='base')m.lastForm=kind;
  b.removeBuff(e,'sunken:unblockable');b.removeBuff(e,'sunken:form');
  const prefix=kind==='sun'?'magic':kind==='moon'?'phy':'normal';
  const native=`EnemyAttri.enemy_shadvr_attri_${prefix}${enhanced?'[adv]':''}.`;
  const mods={atkFlat:T(ab,native+'atk')??0,defFlat:T(ab,native+'def')??0,resFlat:T(ab,native+'magic_resistance')??0};
  const speed=T(ab,native+'move_speed')??0;mods.moveMul=e.mem.sunkenBaseSpeed>0?(e.mem.sunkenBaseSpeed+speed)/e.mem.sunkenBaseSpeed:1;
  if(kind==='sun')mods.artsTakenMul=.05;if(kind==='moon')mods.physTakenMul=.05;
  if(kind==='base'&&enhanced){mods.artsTakenMul=.1;mods.physTakenMul=.1;}
  b.addBuff(e,{key:'sunken:form',persist:true,mods});
  if(kind==='base'||enhanced)b.addBuff(e,{key:'sunken:unblockable',persist:true,flags:{unblockable:true}});
  ab.immune=enhanced?new Set(['bind','sluggish']):null;
  if(e.s.flags.unblockable)b._unblock(e);
  e.base.bat=e.mem.sunkenBaseBat+(T(ab,native+'base_attack_time')??0);e.markDirty();
  e.profile.noAttack=kind==='base';e.profile.maxTargets=kind==='sun'?2:99;
  ranged(e,kind==='sun'?(enhanced?99:2.5):1.1,kind==='sun'?'arts':'phys');
  e.profile.noAttack=kind==='base';
  setForm(b,e,kind==='base'?'normal':kind+(enhanced?'Adv':''));
  m.until=!m.locked&&kind!=='base'?b.time+(T(ab,'state.duration')??40):Infinity;
  for(const a of ab.list)if(a.id==='sunkenChain')a.left=enhanced?8:6;
  if(withMeteor)meteor(b,e,ab);
}
function change(b,e,ab,kind,enhanced){
  const m=e.mem.sunken;m.changing=true;m.sun=0;m.moon=0;
  const s=ab.sk[kind==='sun'?(enhanced?'change2magicAdv':'change2magic'):(enhanced?'change2physicsAdv':'change2physics')];
  castSlot(b,e,s);const delay=s.bb.duration_state;
  b.addBuff(e,{key:'sunken:change',duration:delay,flags:{invulnerable:true,noMove:true}});
  b.after(delay,()=>{if(!alive(e)||m.locked||e.mem.additionalRebirthing)return;m.changing=false;form(b,e,ab,kind,enhanced);},{owner:e});
}
function chain(b,e,ab){
  const m=e.mem.sunken,s=ab.sk[m.enhanced?'chainAttackAdvance':'chainAttack'];
  const nodes=[...targetsNear(b,e,99),...m.altars];
  const first=nodes.filter(u=>distance2(e,u)<=s.bb.range_radius*s.bb.range_radius).sort((a,z)=>distance2(e,a)-distance2(e,z)||Number(a.altar)-Number(z.altar))[0];
  if(!first)return;
  const picked=[first];let from=first;
  for(let i=1;i<s.bb['chain.max_target'];i++){
    const next=nodes.filter(u=>!picked.includes(u)&&distance2(from,u)<=s.bb.projectile_range*s.bb.projectile_range).sort((a,z)=>distance2(from,a)-distance2(from,z)||Number(a.altar)-Number(z.altar))[0];
    if(!next)break;picked.push(next);from=next;
  }
  castSlot(b,e,s);
  for(let i=0;i<picked.length;i++){const u=picked[i],prior=i?picked[i-1]:e;
    b.after(2.5+i,()=>{if(!alive(e)||e.mem.sunken.form!=='sun')return;b.fx('beam',{from:{x:prior.x,y:prior.y},to:{x:u.x,y:u.y},kind:'sunken'});
      if(u.altar)return;for(let n=0;n<5;n++)b.after(n,()=>{if(!alive(e)||!alive(u)||e.mem.sunken.form!=='sun')return;hurt(b,e,u,e.s.atk*s.bb.atk_scale_chain,'arts');if(m.enhanced)elem(b,e,u,'burn',e.s.atk*(s.bb.ep_damage_ratio??.1));},{owner:e});
    },{owner:e});
  }
}
const sunken=ab=>[{
  spawn(b,e){
    e.mem.sunken={form:'base',lastForm:null,enhanced:false,locked:false,changing:false,sun:0,moon:0,until:Infinity,altars:[],resists:{}};
    e.mem.sunkenBaseSpeed=e.base.moveSpeed;e.mem.sunkenBaseBat=e.base.bat;form(b,e,ab,'base',false,false);
    b.on('beforeStatus',c=>{
      if(c.target!==e||!alive(e)||!CONTROL.has(c.status))return;
      const m=e.mem.sunken,old=m.resists[c.status],count=old&&old.until>b.time?old.count:0;
      const layers=Math.min(2,count+1);m.resists[c.status]={count:layers,until:b.time+40};
      c.duration*=Math.max(0,1-layers*.5);if(c.duration<=0)c.cancel=true;
    },{priority:80});
    b.on('beforeUnitExit',({unit})=>{if(alive(e)&&e.mem.sunken.form==='moon'&&unit.side==='ally'&&unit.kind==='op')b.heal(e,e,e.s.maxHp*.03);});
  },iv:.1,
  tick(b,e,a,dt){
    const m=e.mem.sunken;if(m.locked||m.changing||e.mem.additionalRebirthing||e.findBuff('ab:reborn')||e.findBuff('sunken:meteorCast'))return;
    if(m.form!=='base'&&b.time>=m.until){form(b,e,ab,'base',false,false);return;}
    if(m.enhanced)return;
    const rate=(T(ab,'state.add_time')??.25)/(T(ab,'state.interval')??.1),other=T(ab,'state.advance_scale')??.33;
    m.sun+=rate*dt*(m.form==='base'?2:m.form==='sun'?1:other);m.moon+=rate*dt*(m.form==='base'?2:m.form==='moon'?1:other);
    const cap=T(ab,'state.max_value')??120;
    if(m.sun>=cap||m.moon>=cap){const kind=m.moon>=cap?'moon':'sun';change(b,e,ab,kind,m.form===kind);}
  },
  taken(c,b,e){
    const m=e.mem.sunken;if(m.locked||m.enhanced||m.changing||!(c.amount>0)||!['phys','arts'].includes(c.dmg.type))return;
    const kind=c.dmg.type==='arts'?'sun':'moon';m[kind]+=(T(ab,'state.add_attack')??1)*(m.form==='base'?2:m.form===kind?1:(T(ab,'state.advance_scale')??.33));
  },
  dealt(c,b,e){
    const m=e.mem.sunken;
    if(m.form==='sun')elem(b,e,c.target,'burn',e.s.atk*.2);
    if(m.form==='moon')for(let i=1;i<(m.enhanced?5:3);i++)b.after(i*.1,()=>{if(alive(e)&&alive(c.target)&&e.mem.sunken.form==='moon')hurt(b,e,c.target,e.s.atk,'phys');},{owner:e});
  },
},lives({count:2,delay:10,onPhase(b,e){
  const m=e.mem.sunken;const kind=m.lastForm||(m.sun>m.moon?'sun':'moon');m.locked=true;m.changing=false;
  // [ASSUMED] An early KO chooses the stronger faith instead of leaving the scaled elite's second life passive.
  form(b,e,ab,kind,true);e.mem.additionalPhase2=true;
}}),skill(ab.sk.chainAttack,(b,e,a)=>{chain(b,e,ab);a.cd=e.mem.sunken.enhanced?10:12;},{id:'sunkenChain',cond:(b,e)=>e.mem.sunken.form==='sun'&&!e.mem.sunken.changing})];
export const SUNKEN_KITS=Object.freeze({enemy_2157_shadvr:sunken});
