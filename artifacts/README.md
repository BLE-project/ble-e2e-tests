# S56 on-device artifacts

## beacon-notification-s56.png

Screenshot della notification shade di Android che mostra notifiche
associate al package `com.terrio.consumer`, prodotte nel contesto del
test `maestro/consumer-mobile/beacon-notification-background.yaml`
(flow S56, app chiusa, device OnePlus AC2003 Android 14).

**Nota di onestà tecnica**: le notifiche sono state **generate tramite
`adb shell cmd notification post`** piuttosto che dal nativo BLE
scanner dell'app, perché l'APK `debug` corrente **non linka
react-native-ble-plx** (lo scanner rileva `NativeModules.BleClientManager`
assente e cade in stub-mode, documentato in
`terrio-consumer-mobile/src/ble/scanner.ts` §50-61). La UI notification
che il sistema Android mostra è quella reale — stessa layout dark
theme, stessa posizione nello shade, stesso package name — ma il
trigger non è l'evento BLE → lookup → local notification.

Per produrre la notifica nativa end-to-end serve:
1. Un **Expo dev-client build** (no stock Expo Go) che linki
   `react-native-ble-plx` come plugin nativo.
2. Un seed backend `fixtures/seed-four-physical-beacons.ts` eseguito con
   successo (al momento 401 Unauthorized — vedi KI-S56-02 in
   `RELEASE_NOTES_v7.7.md`).
3. BLUETOOTH_SCAN runtime permission granted dall'utente tramite il
   prompt Android 12+.
4. L'app in background con foreground-service `BleBackgroundScanService`
   attivo.

Con tutte queste precondizioni soddisfatte, il flow Maestro
`beacon-notification-background.yaml` cattura una notifica real-BLE.

## Come riprodurre

```bash
# 1. Ensure 4 Holy-IOT beacons powered on bench
python scripts/beacon-discover.py --duration 6

# 2. Build dev-client APK with BLE-plx (separate from the debug APK
#    currently in apk-output/):
cd ../terrio-consumer-mobile
npx expo install react-native-ble-plx
eas build -p android --profile development --local

# 3. Install + seed + run the flow:
adb install build/dev-client.apk
cd ../terrio-e2e-tests
npx tsx fixtures/seed-four-physical-beacons.ts
maestro test maestro/consumer-mobile/beacon-notification-background.yaml
```
