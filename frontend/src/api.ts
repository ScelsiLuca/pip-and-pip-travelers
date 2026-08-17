export const API_BASE_URL=(import.meta.env.VITE_API_BASE_URL||'').replace(/\/$/,'');
export function resolveApiUrl(base:string,path:string){return `${base.replace(/\/$/,'')}${path.startsWith('/')?path:`/${path}`}`}
export function apiUrl(path:string){return resolveApiUrl(API_BASE_URL,path)}
export async function api<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetch(apiUrl(path),{...init,headers:{'Content-Type':'application/json',...(init?.headers||{})}});if(!response.ok)throw new Error(`Richiesta non riuscita (${response.status})`);return response.status===204?undefined as T:response.json()}
