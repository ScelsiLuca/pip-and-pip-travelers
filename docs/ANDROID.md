# Pip & Pip Travelers Android

## Requirements

- Node 22+ (Capacitor 8). Questo workspace può usare il runtime Node incluso in Codex.
- Android Studio 2025.2.1+, Android SDK API 36 e JDK compatibile.
- Backend FastAPI raggiungibile. Una release autonoma richiede un URL HTTPS pubblico.

## Android Studio e Capacitor

Il progetto nativo è in `frontend/android`, con app ID stabile `com.pipandpip.travelers`, `versionName 1.0.0` e `versionCode 1`.

```powershell
Set-Location frontend
npm run android:sync
npx cap open android
```

## Build

Debug:

```powershell
Set-Location frontend
npm run android:debug
```

L'APK viene prodotto in `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

## Backend URL

Impostare `VITE_API_BASE_URL` prima della build. Per una DEBUG LAN HTTP usare anche `CAPACITOR_DEV_HTTP=true`; non usare mai questa variabile per una release. La release deve puntare a un backend FastAPI pubblico HTTPS e lasciare `CAPACITOR_DEV_HTTP` vuota. Non inserire chiavi TomTom/Google nell'app.

## Samsung Galaxy A55 e USB debugging

1. Impostazioni → Informazioni sul telefono → Informazioni software.
2. Toccare sette volte “Versione build” per abilitare Opzioni sviluppatore.
3. Abilitare Debug USB.
4. Collegare il telefono e autorizzare questo PC sul dispositivo.
5. Eseguire `adb devices`; lo stato deve essere `device`, non `unauthorized`.
6. Installare con `adb install -r frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

L'app richiede posizione precisa solo in foreground; non dichiara `ACCESS_BACKGROUND_LOCATION` e non conserva una cronologia GPS.

## Release APK e signing

Creare e custodire offline un unico keystore: identifica in modo permanente l'autore degli aggiornamenti. Se viene perso, non sarà possibile installare nuovi APK come aggiornamento della stessa app. Non salvarlo nel repository; `*.jks`, `*.keystore` e `keystore.properties` sono ignorati.

Configurare la firma release in Android Studio (`Build → Generate Signed Bundle / APK`) o tramite un `keystore.properties` locale. Il risultato può essere rinominato `Pip-and-Pip-Travelers-release.apk`.

## Updating the app

Mantenere lo stesso app ID e lo stesso keystore, aumentare sempre `versionCode` e aggiornare `versionName`, quindi:

```text
modifica React → npm run build → npx cap sync android → build APK firmato → installazione aggiornamento
```

## Offline e storage

Preferences conserva solo impostazioni leggere. La posizione GPS resta in memoria. Web/PWA usa il service worker; Android conserva gli asset applicativi e mostra lo stato rete. I dati live disponibili offline dipendono dalla cache backend/app già popolata.

## Icona, splash e tema

La splash usa il nome dell'app e i colori del progetto. `frontend/resources/app-icon-placeholder.svg` è un placeholder da sostituire prima della release definitiva; rigenerare poi le risorse Android. Status bar e safe area sono configurate per uso portrait e tema di sistema.

## Troubleshooting

- `adb unauthorized`: confermare il dialogo RSA sul Samsung.
- API irraggiungibile: verificare `VITE_API_BASE_URL`, rete e HTTPS.
- GPS disabled: attivare Localizzazione Android.
- Permission denied: concedere Posizione dalle impostazioni dell'app.
- Dopo modifiche web eseguire sempre `npm run android:sync`.

## Evoluzioni future

Notifiche Etna/alert/traffico/mare a app chiusa richiederanno backend online e push provider dedicato; non sono implementate in questa versione.
