# Dispute Defender for Android

A small companion app for [Dispute Defender](../README.md). It connects to your Dispute Defender server, or runs a fully **offline demo** on the phone, so you can handle disputes from anywhere:

- **Disputes:** open disputes sorted by deadline, money at stake, and an Autopilot on/off switch.
- **Investigate and approve:** run the AI investigation and watch each step live. Read the recommendation, win odds and track-record calibration, edit the text, then approve. Nothing is sent to PayPal until you confirm.
- **Rulings:** see PayPal's ruling on each case. In demo mode you can simulate it.
- **Track Record:** how often the agent's plans worked, and what it learned.
- **Alerts:** notifications for new disputes, cases Autopilot holds for you, automatic actions, and PayPal rulings.
- **Offline demo:** no internet or server needed. See [Offline demo](#offline-demo).

It's built with [Capacitor](https://capacitorjs.com): plain HTML/JS screens in [www/](www/) inside a native Android shell in [android/](android/).

## Requirements

- Node.js 20+
- Android Studio (it includes the Android SDK and Java 21)
- A running Dispute Defender server (see the main README). The app talks to it over HTTP.

## Build the APK

```bash
cd mobile
npm install
npm run sync                 # copies www/ into the Android project
cd android
gradlew.bat assembleDebug    # macOS/Linux: ./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

If Gradle can't find Java or the SDK, point it at Android Studio's copies first (Git Bash shown):

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
```

You can also run `npm run open` to open the project in Android Studio and press ▶ Run.

## Install on a phone

- **USB:** turn on *Developer options → USB debugging* on the phone, plug it in, then run `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
- **Without a cable:** send the APK to the phone (Drive, email, etc.), open it, and allow "install unknown apps" when Android asks.

## Offline demo

On first launch, tap **Use offline demo**. (You can switch any time in Settings.) The app then runs the server's demo mode on the phone: the sample disputes, the scripted AI agent, Autopilot, simulated PayPal rulings and the Track Record. Nothing is sent anywhere, and everything resets when the app restarts. Claude and the PayPal sandbox need a server.

How it works: [scripts/copy-engine.mjs](scripts/copy-engine.mjs) copies the demo engine from [../src](../src) (`demoData`, `store`, `photos`, `scripted`, `autopilot`, `outcomes`) into `www/offline/engine/`. [www/offline/server.js](www/offline/server.js) answers the same API paths as the server's demo mode. An import map in `www/index.html` points the engine's Node imports (`fs`, `path`, `events`, `zod`, Claude) at small stand-ins in `www/offline/shims/`. `npm run sync` and the build scripts recopy the engine, so changes in `src/` reach the app on the next build.

## Connect to your server

To use your own server instead, enter its address on first launch (or in Settings):

| Server runs on | Address to enter |
|---|---|
| Render (hosted) | `https://<your-app>.onrender.com` |
| Your PC, phone on the same Wi-Fi | `http://<PC's Wi-Fi IP>:3000` (run `ipconfig` to find the IPv4 address; allow Node through Windows Firewall if asked) |
| Your PC, Android emulator | `http://10.0.2.2:3000` |

The server allows API calls from `localhost` origins (the app's WebView is `http://localhost`) and refuses other websites.

## Alerts

Alerts come over the server's live event stream while the app is open or in the background. They stop if Android closes the app. Alerts with the app fully closed would need push notifications (Firebase Cloud Messaging), which this version doesn't include.

## Publish to Google Play

1. Create an upload key: `keytool -genkey -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`. Keep it out of git.
2. In Android Studio: **Build → Generate Signed App Bundle** and pick the key. Or set up signing in `android/app/build.gradle` and run `npm run build:release`.
3. Upload the `.aab` in the [Play Console](https://play.google.com/console).

## Change the screens

Edit files in `www/` (but not `www/offline/engine/`, which is copied from `src/`), then run `npm run sync` and rebuild. To preview the screens in a desktop browser, run `npm run serve`, open http://localhost:5174 and connect to `http://localhost:3000`, or tap **Use offline demo**. Native features like alerts and haptics only work in the APK.
