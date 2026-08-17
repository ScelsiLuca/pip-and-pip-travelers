import type{Activity,Coordinates,TripDay}from'./types';
export type StopStatus='planned'|'done'|'skipped';
export type TripStop={id:string;key:string;name:string;city:string;kind:'poi'|'experience';coordinates:Coordinates|null;status:StopStatus;sourceIndex:number};
export type LocationGroup={name:string;stops:TripStop[]};
export type DayPresentation={day:TripDay;groups:LocationGroup[];transfers:TripDay['routes']};

const ranges:Record<number,Array<[string,number,number]>>={
  1:[['Catania',0,8]],2:[['Taormina',0,6]],4:[['Ortigia',0,7],['Siracusa',7,11]],
  5:[['Pillirina',0,1],['Noto',1,8],['Marzamemi',8,11]],
  6:[['Ragusa',0,5],['Ragusa Ibla',5,12],['Modica',12,16],['Scicli',16,25],['Valle dei Templi',25,26]],
  7:[['Agrigento',0,8],['Scala dei Turchi',8,9]],8:[['Gibellina',0,2],['Trapani',2,3]],
  10:[['Favignana',0,1]],11:[['San Vito Lo Capo',0,1]],13:[['Riserva dello Zingaro',0,1]]
};
export const slugify=(value:string)=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
export const poiIdentity=(name:string,city:string)=>`${slugify(name)}-${slugify(city)}`;
const statusKey=(id:string)=>`pip-stop:${id}`;
export const readStopStatus=(id:string):StopStatus=>(typeof localStorage==='undefined'?null:localStorage.getItem(statusKey(id)) as StopStatus)||'planned';
export const writeStopStatus=(id:string,status:StopStatus)=>{if(typeof localStorage!=='undefined')localStorage.setItem(statusKey(id),status)};
const activityStop=(a:Activity,day:number,index:number,city:string):TripStop=>{const id=poiIdentity(a.title,city);return{id,key:id,name:a.title,city,kind:'experience',coordinates:a.coordinates,status:(a.status==='completed'?'done':a.status==='skipped'?'skipped':'planned'),sourceIndex:1000+index}};

export function presentDay(day:TripDay):DayPresentation{
  const definitions=ranges[day.dayNumber]||[[day.baseCity||day.title||`Giorno ${day.dayNumber}`,0,day.pointsOfInterest.length]];
  const groups:LocationGroup[]=definitions.map(([name,start,end])=>({name,stops:day.pointsOfInterest.slice(start,end).map((p,i)=>{const id=poiIdentity(p.name,name);return{id,key:id,name:p.name,city:name,kind:'poi' as const,coordinates:p.coordinates||null,status:readStopStatus(id),sourceIndex:start+i}})}));
  const experiences=day.activities.filter(a=>['sea','boat_trip','etna','hiking','nature'].includes(a.activityType)||/tramonto|escursione|boat tour|mare\b/i.test(a.title));
  experiences.forEach((a,i)=>{const location=a.location||day.baseCity||day.title||'Esperienza';let group=groups.find(g=>location.toLowerCase().includes(g.name.toLowerCase())||g.name.toLowerCase().includes(location.toLowerCase()))||groups[0];if(!group){group={name:location,stops:[]};groups.push(group)}if(!group.stops.some(s=>s.name.toLowerCase()===a.title.toLowerCase()))group.stops.unshift(activityStop(a,day.dayNumber,i,group.name))});
  return{day,groups:groups.filter(g=>g.stops.length),transfers:day.routes};
}
export const nextStop=(day:TripDay)=>presentDay(day).groups.flatMap(g=>g.stops).find(s=>s.status==='planned')||null;
export const stopCount=(day:TripDay)=>presentDay(day).groups.reduce((n,g)=>n+g.stops.length,0);
export const searchGuideStops=(days:TripDay[],query:string)=>guidesFromDays(days).flatMap(g=>g.stops).filter(s=>`${s.name} ${s.city}`.toLowerCase().includes(query.trim().toLowerCase()));

export type Guide={slug:string;title:string;subtitle:string;overview:string;stops:TripStop[]};
export function guidesFromDays(days:TripDay[]):Guide[]{const map=new Map<string,Guide>();days.forEach(day=>presentDay(day).groups.forEach(group=>{const slug=group.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');const current=map.get(slug);if(current)current.stops.push(...group.stops.filter(s=>!current.stops.some(x=>x.name===s.name)));else map.set(slug,{slug,title:group.name,subtitle:`${group.stops.length} ${group.stops.length===1?'tappa':'tappe'} del viaggio`,overview:`Una guida essenziale ai luoghi previsti dall’itinerario di ${group.name}. I dettagli operativi variabili vanno verificati presso le fonti ufficiali prima della visita.`,stops:[...group.stops]})}));return[...map.values()]}
