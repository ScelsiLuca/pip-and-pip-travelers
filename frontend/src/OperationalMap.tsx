import { useEffect, useMemo, useState } from "react";
import { Circle, CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import type { Coordinates, RouteLive, TripDay } from "./types";
import { platformService, type DevicePosition } from "./services/platformService";

export type TripLeg={id:number|null;kind:string;dayId:number;origin:string;destination:string;originCoordinates:Coordinates|null;destinationCoordinates:Coordinates|null;originAddress?:string|null;destinationAddress?:string|null;plannedDeparture:string|null;googleMapsUrl?:string|null};
function Fit({points}:{points:Coordinates[]}){const map=useMap();useEffect(()=>{if(points.length>1)map.fitBounds(points.map(p=>[p.lat,p.lon]),{padding:[38,38],maxZoom:13});else if(points[0])map.setView([points[0].lat,points[0].lon],12)},[map,points]);return null}
function Locate({position,requestToken}:{position:DevicePosition|null;requestToken:number}){const map=useMap();useEffect(()=>{if(position&&requestToken)map.setView([position.lat,position.lon],16,{animate:true})},[map,position,requestToken]);useEffect(()=>{setTimeout(()=>map.invalidateSize(),120)},[map]);return null}

export default function OperationalMap({day,days,currentPosition,nextLeg,route,onPositionChange}:{day:TripDay|null;days:TripDay[];currentPosition:Coordinates|null;nextLeg:TripLeg|null;route:RouteLive|null;onPositionChange?:(position:Coordinates|null)=>void}){
  const[mode,setMode]=useState<'today'|'trip'>('today'),[expanded,setExpanded]=useState(false);
  const[gps,setGps]=useState<DevicePosition|null>(null),[gpsState,setGpsState]=useState<'idle'|'loading'|'located'|'denied'|'unavailable'>('idle'),[requestToken,setRequestToken]=useState(0);
  const userPosition=gps||currentPosition,planned=day?.coordinates||null,origin=userPosition||planned;
  const nextActivity=day?.activities.find(a=>a.status!=='completed'&&a.status!=='skipped');
  const activity=nextActivity?.coordinates||null,destination=nextLeg?.destinationCoordinates||null;
  const pois=useMemo(()=>(mode==='today'?day?.pointsOfInterest||[]:days.flatMap(d=>d.coordinates?[{name:d.baseCity||d.title||`Day ${d.dayNumber}`,category:d.activityType,coordinates:d.coordinates}]:[])).filter(p=>p.coordinates),[mode,day,days]);
  const routePoints=useMemo(()=>(route?.geometry?.coordinates||[]).map(c=>({lat:c[1],lon:c[0]})),[route?.geometry]);
  const bounds=useMemo(()=>[origin,activity,destination,...pois.map(p=>p.coordinates!),...routePoints].filter(Boolean) as Coordinates[],[origin,activity,destination,pois,routePoints]);
  const center=origin||destination||{lat:37.6,lon:14};
  const locate=async()=>{setGpsState('loading');try{const next=await platformService.currentPosition();setGps(next);onPositionChange?.(next);setGpsState('located');setRequestToken(x=>x+1)}catch(error){setGpsState(String((error as Error).message)==='PERMISSION_DENIED'?'denied':'unavailable')}};
  const feedback=gpsState==='denied'?'Permesso posizione negato':gpsState==='unavailable'?'Posizione non disponibile':'';
  return <section className={`operational-map ${expanded?'expanded':''}`} aria-label="Mappa operativa">
    <div className="map-toolbar"><div className="segmented"><button className={mode==='today'?'active':''} onClick={()=>setMode('today')}>OGGI</button><button className={mode==='trip'?'active':''} onClick={()=>setMode('trip')}>VIAGGIO</button></div><button className="icon-label" onClick={()=>setExpanded(x=>!x)} aria-label={expanded?'Chiudi mappa a schermo intero':'Apri mappa a schermo intero'}><span aria-hidden="true">{expanded?'↙':'↗'}</span>{expanded?' Chiudi':' Espandi'}</button></div>
    <div className="map-canvas"><MapContainer center={[center.lat,center.lon]} zoom={10} scrollWheelZoom dragging touchZoom doubleClickZoom zoomControl>
      <Fit points={bounds}/><Locate position={gps} requestToken={requestToken}/><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"/>
      {route?.geometry&&<Polyline positions={route.geometry.coordinates.map(c=>[c[1],c[0]])} pathOptions={{color:'#f26b38',weight:5,opacity:.9}}/>}
      {userPosition&&<><Circle center={[userPosition.lat,userPosition.lon]} radius={gps?.accuracy||20} pathOptions={{color:'#22b8b5',fillColor:'#22b8b5',fillOpacity:.12,weight:1}}/><CircleMarker center={[userPosition.lat,userPosition.lon]} radius={9} className="user-marker" pathOptions={{color:'#fff',weight:3,fillColor:'#0f8b8d',fillOpacity:1}}><Popup><strong>La tua posizione</strong>{gps&&<><br/>Precisione ±{Math.round(gps.accuracy)} m</>}</Popup></CircleMarker></>}
      {!userPosition&&planned&&<CircleMarker center={[planned.lat,planned.lon]} radius={8} pathOptions={{color:'#fff',fillColor:'#687772',fillOpacity:1}}><Popup><strong>Posizione pianificata</strong></Popup></CircleMarker>}
      {activity&&<CircleMarker center={[activity.lat,activity.lon]} radius={8} pathOptions={{color:'#fff',weight:2,fillColor:'#f2b544',fillOpacity:1}}><Popup><strong>{nextActivity?.title}</strong><br/>Prossima attività</Popup></CircleMarker>}
      {destination&&<CircleMarker center={[destination.lat,destination.lon]} radius={9} pathOptions={{color:'#fff',weight:2,fillColor:'#f26b38',fillOpacity:1}}><Popup><strong>{nextLeg?.destination}</strong><br/>Prossima destinazione<br/><a href={`https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lon}`} target="_blank" rel="noreferrer">Google Maps</a></Popup></CircleMarker>}
      {pois.map((p,i)=><CircleMarker key={`${p.name}-${i}`} center={[p.coordinates!.lat,p.coordinates!.lon]} radius={6} pathOptions={{color:'#0b4f55',fillColor:'#fff8ed',fillOpacity:1}}><Popup><strong>{p.name}</strong><br/>{p.category||'POI'}</Popup></CircleMarker>)}
    </MapContainer><div className="map-floating-controls"><button className={`gps-button ${gpsState}`} onClick={locate} disabled={gpsState==='loading'} aria-label="Centra la mappa sulla mia posizione" title="La mia posizione"><span aria-hidden="true">➤</span></button></div>{feedback&&<div className="map-feedback" role="status">{feedback}</div>}</div>
    {nextLeg&&<div className="map-route-overlay"><div><small>PROSSIMA TRATTA</small><strong>{nextLeg.origin} → {nextLeg.destination}</strong>{route?.distanceKm&&<span>{route.distanceKm} km · {route.durationMinutes} min</span>}</div>{destination&&<a href={`https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lon}`} target="_blank" rel="noreferrer">Naviga</a>}</div>}
    {!navigator.onLine&&<small>Offline: i tile non già visualizzati potrebbero non essere disponibili.</small>}
  </section>
}
