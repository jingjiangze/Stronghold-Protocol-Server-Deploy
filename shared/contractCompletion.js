// Shared exact selector. Components join conflicts, prerequisites and capped groups; no UI or server dependency.
export const contractSetId=c=>typeof c.set==='string'?c.set:c.set?.id||'misc';
export function compileContractSelection(list){
 const by=new Map(list.map(c=>[c.id,c])),adj=new Map(list.map(c=>[c.id,new Set()])),setIds=[...new Set(list.map(contractSetId))],setIndex=new Map(setIds.map((id,i)=>[id,i]));
 if(setIds.length>30)throw Error('Too many scoring sets');
 for(const c of list)for(const id of [...(c.requires||[]),...(c.excludes||[]),...(c.requiresAny||[])])if(by.has(id)){adj.get(c.id).add(id);adj.get(id).add(c.id);}
 for(const c of list)if(c.limitGroup)for(const other of list)if(c.id!==other.id&&c.limitGroup===other.limitGroup){adj.get(c.id).add(other.id);adj.get(other.id).add(c.id);}
 const seen=new Set(),components=[];
 for(const c of list)if(!seen.has(c.id)){
  const cards=[],todo=[c.id];seen.add(c.id);while(todo.length){const id=todo.pop();cards.push(by.get(id));for(const next of adj.get(id))if(!seen.has(next)){seen.add(next);todo.push(next);}}
  if(cards.length>20)throw Error('Contract conflict component exceeds exact-score budget');
  const index=new Map(cards.map((card,i)=>[card.id,i])),bit=i=>2**i;
  components.push({cards,index,sets:cards.map(card=>setIndex.get(contractSetId(card))),
   conflicts:cards.map(card=>cards.reduce((mask,o,i)=>mask+((card.excludes?.includes(o.id)||o.excludes?.includes(card.id))?bit(i):0),0)),
   requires:cards.map(card=>(card.requires||[]).reduce((mask,id)=>mask+(index.has(id)?bit(index.get(id)):0),0)),
   any:cards.map(card=>(card.requiresAny||[]).reduce((mask,id)=>mask+(index.has(id)?bit(index.get(id)):0),0)),
   missing:cards.map(card=>(card.requires||[]).some(id=>!index.has(id)))});
 }
 return {list,by,setIds,components};
}
export function visitLegalSelections(component,fixed,onChoice){
 const {cards,index,conflicts,requires,any,missing}=component,required=[...fixed].filter(id=>index.has(id)).reduce((mask,id)=>mask+2**index.get(id),0),limits=new Map();let choices=0;
 const visit=(i,mask,points)=>{
  if(i===cards.length){
   if((mask&required)!==required)return;
   for(let j=0;j<cards.length;j++)if(mask&2**j)if(missing[j]||(mask&requires[j])!==requires[j]||cards[j].requiresAny?.length&&!(mask&any[j]))return;
   choices++;onChoice(mask,points);return;
  }
  const c=cards[i],used=limits.get(c.limitGroup)||0;
  if(!(mask&conflicts[i])&&(!c.limitGroup||used<c.maxInGroup)){
   if(c.limitGroup)limits.set(c.limitGroup,used+1);visit(i+1,mask+2**i,points+c.points);if(c.limitGroup)limits.set(c.limitGroup,used);
  }
  if(!fixed.has(c.id))visit(i+1,mask,points);
 };
 visit(0,0,0);return choices;
}
export function completionForSelection(model,ids){
 const fixed=new Set(ids),counts=new Array(model.setIds.length).fill(0),capacity=new Array(model.setIds.length).fill(0);let valid=[...fixed].every(id=>model.by.has(id));
 for(const id of fixed){const c=model.by.get(id);if(c){counts[model.setIds.indexOf(contractSetId(c))]++;if(c.requires?.some(key=>!fixed.has(key))||c.requiresAny?.length&&!c.requiresAny.some(key=>fixed.has(key)))valid=false;}}
 for(const component of model.components){const best=new Array(model.setIds.length).fill(0),n=visitLegalSelections(component,fixed,mask=>{
  const tally=new Array(model.setIds.length).fill(0);for(let i=0;i<component.cards.length;i++)if(mask&2**i)tally[component.sets[i]]++;
  for(let i=0;i<tally.length;i++)best[i]=Math.max(best[i],tally[i]);
 });if(!n)valid=false;for(let i=0;i<best.length;i++)capacity[i]+=best[i];}
 const sets=model.setIds.map((id,i)=>Object.freeze({id,count:counts[i],total:capacity[i],ratio:capacity[i]?counts[i]/capacity[i]:0,bonus:valid&&counts[i]&&capacity[i]?(counts[i]===capacity[i]?5:counts[i]*5>=capacity[i]*4?2:0):0}));
 return Object.freeze({valid,total:sets.reduce((n,s)=>n+s.bonus,0),sets:Object.freeze(sets)});
}
export function maximumWithCompletion(model){
 let states=new Map([[0,{points:0,ids:[]}]]);
 for(const component of model.components){
  const local=new Map();visitLegalSelections(component,new Set(),(mask,points)=>{
   let coverage=0;const ids=[];for(let i=0;i<component.cards.length;i++)if(mask&2**i){coverage|=2**component.sets[i];ids.push(component.cards[i].id);}
   if(!local.has(coverage)||local.get(coverage).points<points)local.set(coverage,{points,ids});
  });
  const next=new Map();for(const [a,x]of states)for(const [b,y]of local){const mask=a|b,points=x.points+y.points;if(!next.has(mask)||next.get(mask).points<points)next.set(mask,{points,ids:[...x.ids,...y.ids]});}states=next;
 }
 const bits=mask=>{let n=0;while(mask){n+=mask&1;mask>>>=1;}return n;};let best={points:-1,ids:[]};
 // All positive risks make an optimum maximal. Every represented set is then full, worth exactly +5.
 for(const [mask,state]of states){const points=state.points+bits(mask)*5;if(points>best.points)best={points,ids:state.ids};}
 return best;
}
