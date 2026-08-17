import type {CapacitorConfig} from '@capacitor/cli';
declare const process:{env:Record<string,string|undefined>};
const developmentHttp=process.env.CAPACITOR_DEV_HTTP==='true';

const config:CapacitorConfig={
 appId:'com.pipandpip.travelers',
 appName:'Pip & Pip Travelers',
 webDir:'dist',
 server:{androidScheme:'https',cleartext:developmentHttp},
 plugins:{
  SplashScreen:{launchShowDuration:1800,backgroundColor:'#0d2a25',showSpinner:false},
  StatusBar:{overlaysWebView:false,backgroundColor:'#0d2a25'}
 }
};
export default config;
