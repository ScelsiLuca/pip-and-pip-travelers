export type AlertLevel='info'|'warning'|'critical';
export function travelStatus(alerts:Array<{level?:string}>,coverage:'FULL'|'PARTIAL'){if(alerts.some(a=>a.level==='critical'))return'ATTENZIONE';if(alerts.some(a=>a.level==='warning'))return'ATTENZIONE';return coverage==='FULL'?'OK':'DA CONTROLLARE'}
