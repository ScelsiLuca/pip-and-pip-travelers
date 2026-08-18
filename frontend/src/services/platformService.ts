import {Capacitor} from '@capacitor/core';
import {Geolocation} from '@capacitor/geolocation';
import {Network,type ConnectionStatus} from '@capacitor/network';
import {Preferences} from '@capacitor/preferences';
import {AppLauncher} from '@capacitor/app-launcher';

export type Runtime='web'|'pwa'|'android'|'ios';
export type DevicePosition={lat:number;lon:number;accuracy:number;updatedAt:string};
export type LocationFailure='PERMISSION_DENIED'|'GPS_DISABLED'|'LOCATION_UNAVAILABLE';

export const platformService={
 runtime():Runtime{if(Capacitor.isNativePlatform())return Capacitor.getPlatform() as 'android'|'ios';return matchMedia('(display-mode: standalone)').matches?'pwa':'web'},
 isNative(){return Capacitor.isNativePlatform()},
 async currentPosition():Promise<DevicePosition>{
  if(Capacitor.isNativePlatform()){
   const permission=await Geolocation.checkPermissions();
   if(permission.location==='denied')throw new Error('PERMISSION_DENIED');
   if(permission.location!=='granted'&&permission.coarseLocation!=='granted'){
    const requested=await Geolocation.requestPermissions({permissions:['location']});
    if(requested.location!=='granted')throw new Error('PERMISSION_DENIED');
   }
   try{const p=await Geolocation.getCurrentPosition({enableHighAccuracy:true,timeout:15000,maximumAge:0});return{lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,updatedAt:new Date(p.timestamp).toISOString()}}
   catch(error){const message=String((error as Error)?.message||error).toLowerCase();throw new Error(message.includes('disabled')||message.includes('location services')?'GPS_DISABLED':'LOCATION_UNAVAILABLE')}
  }
  if(!window.isSecureContext)throw new Error('LOCATION_UNAVAILABLE');
  if(!navigator.geolocation)throw new Error('LOCATION_UNAVAILABLE');
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,updatedAt:new Date(p.timestamp).toISOString()}),e=>reject(new Error(e.code===1?'PERMISSION_DENIED':'LOCATION_UNAVAILABLE')),{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
 },
 async watchPosition(callback:(position:DevicePosition)=>void):Promise<{remove:()=>Promise<void>}>{
  if(Capacitor.isNativePlatform()){
   const id=await Geolocation.watchPosition({enableHighAccuracy:true,timeout:20000,maximumAge:60000},p=>{if(p)callback({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,updatedAt:new Date(p.timestamp).toISOString()})});
   return{remove:()=>Geolocation.clearWatch({id})};
  }
  if(!window.isSecureContext||!navigator.geolocation)throw new Error('LOCATION_UNAVAILABLE');
  const id=navigator.geolocation.watchPosition(p=>callback({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,updatedAt:new Date(p.timestamp).toISOString()}),()=>{}, {enableHighAccuracy:true,timeout:20000,maximumAge:60000});
  return{remove:async()=>navigator.geolocation.clearWatch(id)};
 },
 async network():Promise<ConnectionStatus>{return Capacitor.isNativePlatform()?Network.getStatus():{connected:navigator.onLine,connectionType:'unknown'}},
 onNetworkChange(callback:(status:ConnectionStatus)=>void){if(Capacitor.isNativePlatform())return Network.addListener('networkStatusChange',callback);const handler=()=>callback({connected:navigator.onLine,connectionType:'unknown'});window.addEventListener('online',handler);window.addEventListener('offline',handler);return Promise.resolve({remove:async()=>{window.removeEventListener('online',handler);window.removeEventListener('offline',handler)}})},
 async getPreference(key:string){return (await Preferences.get({key})).value},
 async setPreference(key:string,value:string){await Preferences.set({key,value})},
 async navigate(destination:{lat:number;lon:number},fallbackUrl:string){const nativeUrl=`google.navigation:q=${destination.lat},${destination.lon}&mode=d`;if(Capacitor.getPlatform()==='android'){try{if((await AppLauncher.canOpenUrl({url:nativeUrl})).value){await AppLauncher.openUrl({url:nativeUrl});return}}catch{/* HTTPS fallback below */}}window.open(fallbackUrl,'_blank','noopener,noreferrer')}
};
