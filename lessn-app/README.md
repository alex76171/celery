# Lessn: a better WebUntis client for Android

Lessn is an unofficial Android app for WebUntis. It shows your timetable, homework, exams and absences in a cleaner interface with more options.

## Install the APK (easy way)

1. Copy `Lessn-2.3.0.apk` to your phone, or download it from GitHub on the phone.
2. Tap it and allow installs from this source. If Play Protect warns, tap **More details → Install anyway**.
3. If 1.0 is already installed, this installs over it and keeps your data.
4. Open **Lessn**. Search for your school on the first screen, then sign in on the second.

If the search can't find your school, tap **Enter the server manually** and type the server (e.g. `nessa.webuntis.com`, or paste the full URL) and the school login name (the `school=` value in that URL).

## First start

1. A **Hello** screen cycles through Hello / Hallo / Merhaba / Bonjour. Pick your language and tap the arrow.
2. **Find schools near me** uses your location once to list WebUntis schools in your town. You can also search by name.
3. Sign in with your WebUntis login.
4. Set up the **AI helper**: paste a free Gemini key, or skip.
5. Set up **IServ**: Lessn tries to find your school's IServ server automatically (via the school's website on OpenStreetMap). Enter your password, or skip.

## Features

- **Home is your day plan**: holiday banner, cancelled-lesson alert, Now/Next card, homework due today and tomorrow, today's study-plan tasks, new IServ notifications, announcements, all lessons of the day, and exams this week.
- **Tabs you choose**: Menu → Settings → Tabs. Pick up to 4 of Home, Week, Homework, Exams, IServ, AI, Grades, Attendance and Recorder, and change their order. Menu is always there and links to everything else.
- **Homework from everywhere**: WebUntis homework, **IServ tasks** ("Aufgaben") and your own homework (tap **+**). Every item has an **AI button** that opens a chat about that task. The chat already knows the task and what your last recorded lessons covered, and you can send photos.
- **AI helper**: a Gemini-style start screen with a greeting, suggestions for your homework, exams and last lesson, recent chats, and the message bar at the bottom. Free chats with photo upload, a tutor-style helper (hints first, full solutions if you ask) and quick-start questions.
- **Exams**: tap an exam for **Study with AI** (explanations and quiz questions) and **Make a study plan**. The plan is built from your lesson summaries and spread over the days before the exam, with a checkbox for each task. Today's tasks show on Home.
- **Lesson recorder (beta)**: records a lesson and turns it into a summary that feeds the homework help and study plans. **Only record with your teacher's and class's permission (§201 StGB).**
- **IServ**: messenger, mail, files, calendar and notifications in the app's design. **IServ notifications** check for new IServ notifications and chat messages every 15 minutes, even when the app is closed.
- **Week** as a list (default) or as a grid,, **Grades**, **Attendance** (with the optional "Are you at school?" location check), lesson reminders, Do Not Disturb during lessons, offline cache, and 9 languages (English, Deutsch, Türkçe, Français, Español, Polski, Українська, Русский, العربية, including right-to-left layout).

## Hidden customization

There's no visible menu for it. To open it, either **long-press the big title** on any screen, or go to **Menu** and **tap the version text at the bottom 7 times**.

Inside you can change:
- the **theme**, out of 14: Auto, Material Light/Dark, Liquid Glass Light/Dark, **One UI Light/Dark** (large collapsing titles, round cards, floating tab bar), Black, Sunset, Ocean, Forest, Paper, Neon and Pastel. Each theme has its own background, default font and animation style (slide, blur, bloom, wave, grow, page-flip, neon flicker, bounce).
- the **font**: theme default, System, Inter, Poppins, Nunito, Outfit, Space Grotesk, Lora or JetBrains Mono. All are bundled, so they work offline.
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
