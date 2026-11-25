# Lessn: a better WebUntis client for Android

Lessn is an unofficial Android app for WebUntis. It shows your timetable, homework, exams and absences in a cleaner interface with more options.

## Install the APK (easy way)

1. Copy `Lessn-2.1.0.apk` to your phone, or download it from GitHub on the phone.
2. Tap it and allow installs from this source. If Play Protect warns, tap **More details → Install anyway**.
3. If 1.0 is already installed, this installs over it and keeps your data.
4. Open **Lessn**. Search for your school on the first screen, then sign in on the second.

If the search can't find your school, tap **Enter the server manually** and type the server (e.g. `nessa.webuntis.com`, or paste the full URL) and the school login name (the `school=` value in that URL).

## Features

- **Home**: holiday banner with the holiday's name and countdown, a red alert for cancelled lessons, a live "Now" card, school announcements (WebUntis messages of the day), new IServ notifications and exams this week.
- **Lessons**: double periods are merged or visibly linked, and cancelled lessons are striped red with a CANCELLED tag (in the week grid too).
- **Week** grid with holidays filled in by name and a current-time line. Swipe to change weeks.
- **Homework**, **Exams** (including tests found in AI summaries), **Grades** (from WebUntis if your school shares them, plus grades you add yourself, with averages).
- **Attendance**: a calendar of days you were or weren't at school. If you turn on the location check, the app checks your location 10 minutes after your first lesson. If you're not at school it asks "Are you at school?" in a notification.
- **Notifications**: reminders before each lesson and alerts for changes. **Do Not Disturb** can switch on automatically during lessons.
- **IServ** with screens built into the app, so they follow your theme. It signs in with your IServ login (it can reuse your WebUntis password):
  - **Messenger**: chats with unread badges, chat bubbles, live new messages, sending, and earlier messages. End-to-end encrypted messages can only be read on the IServ website.
  - **E-Mail**: folders, inbox and reading mails. Replying and writing new mails open IServ's own editor.
  - **Files**: browse your IServ files (WebDAV) and download them.
  - **Calendar**: upcoming dates.
  - **Notifications**: mark them as read.
  - Everything else (tasks, forums, the full website) opens in an in-app IServ browser that signs you in for you and is recoloured to match your theme.
- **Lesson recorder (beta)**: records a lesson (works with the screen off) and sends it to Google Gemini. You get topics, a summary, key points, homework and any tests that were mentioned, with dates. It understands German audio. You need a free Gemini API key from aistudio.google.com/apikey. **Only record with your teacher's and class's permission. In Germany, recording people without consent can be illegal (§201 StGB).**
- **Offline**: the current week, the week before and the next 3 weeks are saved, plus homework, exams and grades.
- **Languages**: English, Deutsch, Türkçe, Français (Menu → Settings).
- **Directions to school** opens Google Maps.

## Hidden customization

There's no visible menu for it. To open it, either **long-press the big title** on any screen, or go to **Menu** and **tap the version text at the bottom 7 times**.

Inside you can change:
- the **theme**: Auto, Material Light, Material Dark, Liquid Glass Light, Liquid Glass Dark, or Black
- the accent color, corner roundness, text size, font, density and lesson colors
- animations on or off
- each subject's color and name
- the timetable options
- the AI model
- a backup of your customization (copy and paste)

## Permissions (all optional, asked only when you turn a feature on)

- **Notifications**: lesson reminders and change alerts
- **Do Not Disturb access**: muting during lessons
- **Location, set to "Allow all the time"**: the "Are you at school?" check
- **Microphone**: the lesson recorder

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

The UI is plain HTML, CSS and JS in `www/js`: `api.js` (WebUntis), `iserv.js` (IServ), `ai.js` (Gemini), `data.js` (loading, caching, scheduling), `views.js` and `features.js` (screens), `login.js`, `i18n.js` (translations) and `app.js` (shell). Native Android code (alarms, Do Not Disturb, location check, recording service, IServ browser) is in `android/app/src/main/java/app/lessn/timetable/`. After you edit it, run `npx cap sync android` and build again. Icons are from Lucide (ISC); run `npm run icons` after adding names in `tools/build-icons.mjs`.

## Notes

- Your login is stored only in the app's private storage on your phone. It is sent only to your school's WebUntis server.
- Homework, exams and absences use the same endpoints as the WebUntis website. If your school turned a feature off, that tab stays empty.
- This app is not affiliated with Untis GmbH.
