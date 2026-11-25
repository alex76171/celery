# Lessn: a better WebUntis client for Android

Lessn is an unofficial Android app for WebUntis. It shows your timetable, homework, exams and absences in a cleaner interface with more options.

## Install the APK (easy way)

1. Copy `Lessn-1.0.0.apk` to your phone, or download it from GitHub on the phone.
2. Tap it. Android will ask you to allow installs from this source (your browser or file manager). Allow it.
3. Tap **Install**. If Play Protect warns about an unknown developer, tap **More details → Install anyway**. It warns because the app is not from the Play Store.
4. Open **Lessn**, search for your school, and sign in with your normal WebUntis username and password.

If the school search finds nothing, tap **Enter server manually**:
- **Server**: the host from your WebUntis web address, e.g. `nessa.webuntis.com`. You can also paste the full URL.
- **School login name**: the `school=` value in that URL.

## Features

- **Today**: a live "Now" card with a progress bar and countdown, what's next, breaks and free periods, and cancellations, substitutions and room changes highlighted.
- **Week**: a timetable grid with period numbers, a current-time line, holidays, and side-by-side parallel lessons. Swipe to change weeks.
- **Homework**: grouped by due date, with overdue items highlighted. You can tick tasks off; this is only saved on your phone.
- **Exams**: upcoming exams with a countdown, plus past exams with grades if your school shares them.
- **More**: other class, teacher and room timetables (if your school allows it), absences, holidays and settings.
- Notes on any lesson, pull to refresh, offline cache, and Android back button support.

## Hidden customization

There is no visible menu for customization, so the app looks like it was designed this way. There are two ways to open it:

- **Long-press the big title** at the top of any screen for about a second, or
- go to **More** and tap the version text at the bottom (`Lessn 1.0.0`) **7 times quickly**.

The options are theme (Auto / Light / Dark / Black AMOLED), accent color, corner roundness, text size, font, density, and lesson color mode. You can recolor or rename each subject, set a custom title on the Today screen, and turn on or off: merge double lessons, hide cancelled lessons, show rooms and teachers, full or short names, breaks, period numbers, the time line, the countdown, and vibration. You can also copy and paste your customization as a backup.

## Build it yourself

You need Node 20+, JDK 21 and the Android SDK (platform 36). Android Studio installs the SDK for you.

```bash
cd lessn-app
npm install
npx cap sync android
cd android
./gradlew assembleRelease     # APK: android/app/build/outputs/apk/release/app-release.apk
```

To sign with your own key, create `android/keystore.properties` with this content:
```
storeFile=lessn-release.jks
storePassword=...
keyAlias=lessn
keyPassword=...
```
Without that file, the release build is signed with the debug key. That still installs fine.

The app is plain HTML, CSS and JS in `www/`: `api.js` is the WebUntis client, `app.js` is the UI, and `store.js` handles settings and the cache. After you edit it, run `npx cap sync android` and build again. Icons are from Lucide (ISC); run `npm run icons` after adding names in `tools/build-icons.mjs`.

## Notes

- Your login is stored only in the app's private storage on your phone. It is sent only to your school's WebUntis server.
- Homework, exams and absences use the same endpoints as the WebUntis website. If your school turned a feature off, that tab stays empty.
- This app is not affiliated with Untis GmbH.
