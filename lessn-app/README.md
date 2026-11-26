# Lessn: a better WebUntis client for Android and Windows

Lessn is an unofficial Android and Windows app for WebUntis. It shows your timetable, homework, exams and absences in a cleaner interface with more options.

## Install the APK (easy way)

1. Copy `Lessn-3.0.0.apk` to your phone, or download it from GitHub on the phone.
2. Tap it and allow installs from this source. If Play Protect warns, tap **More details → Install anyway**.
3. If 1.0 is already installed, this installs over it and keeps your data.
4. Open **Lessn**. Search for your school on the first screen, then sign in on the second.

If the search can't find your school, tap **Enter the server manually** and type the server (e.g. `nessa.webuntis.com`, or paste the full URL) and the school login name (the `school=` value in that URL).

## Lessn for Windows

The installer is `lessn-desktop/Lessn-Setup-3.0.0.exe` (download it from GitHub on the PC).

1. Run it. Windows SmartScreen may warn because the installer is not signed: click **More info → Run anyway**.
2. Choose the folder and options: desktop shortcut, **Start with Windows (in the tray)** and **Allow phones in your network (firewall)** (asks for admin rights once; without it Windows asks the first time your phone connects — choose *Private networks*).
3. Lessn opens with the same features and themes as the phone, laid out for a big screen (sidebar, dialogs instead of bottom sheets).
4. **Already use Lessn on the phone?** The first screen on the PC shows a 6-digit code. On the phone open **Menu → PC → Search for my PC**, pick the PC and type the code. Your login, homework, notes, chats, AI keys and settings come over by themselves and the PC signs in.

**Closing the window keeps Lessn running** in the hidden icons of the taskbar (so your phone can reach the PC and reminders still pop up). Right-click the tray icon → **Quit Lessn** to close it completely. Uninstall it in Windows Settings → Apps.

### Phone ↔ PC (both in the same Wi-Fi)
- **Pair**: on the phone *Menu → PC → Search for my PC* (or type the address shown on the PC), then the code from the PC's **Phone** page.
- **Sync**: homework, notes, done-marks, AI chats, lesson summaries, study plans, grades and settings sync automatically (last change wins; layout settings stay per device). Logins and AI keys too, unless you turn that off.
- **PC files on the phone**: the PC shares the folder `Documents\Lessn` (change it on the PC's Phone page). On the phone you can browse it, open files in the viewer, upload photos, camera shots, files and scans, make folders, rename and delete. Also reachable from **Files → PC**.
- **Phone files on the PC**: on the phone choose *Share a folder with the PC* (e.g. Download or DCIM). The PC's Phone page then shows that folder: open files, send files to the phone, delete. This works while Lessn is open on the phone.
- **Local AI (free, private, no internet)**: install [Ollama](https://ollama.com/download/windows) on the PC, then on the PC's Phone page download a model (Gemma 3 4B, Qwen 3 8B, Llama 3.2 3B, Qwen 2.5 VL or any other) and tap **Use it as an AI helper**. On the phone tap **Use the PC's AI** on the PC page. It then appears as "Lessn PC (local AI)" in AI helpers and can be the default or a backup.
- The link uses your local network only (port 47900, discovery on UDP 47901), protected by a pairing code and a private token per phone.

### What is different on the PC
Lesson recording uses the PC's microphone (saved as MP3 so every AI accepts it); voice messages work too. Do Not Disturb and the "Are you at school?" location check are phone-only. IServ notifications and lesson reminders show as Windows notifications while Lessn runs in the tray.

### Build the Windows app yourself
In `lessn-desktop/`: `npm install`, then `npm start` to run it, or `npm run dist` to build the installer (needs `makensis` from NSIS; works on Windows, Linux or macOS, no Wine needed).

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
- **AI providers**: Google Gemini, OpenAI (ChatGPT), Anthropic Claude, Mistral, OpenRouter (hundreds of models) or any OpenAI-compatible server (Groq, Ollama, LM Studio, DeepSeek…). **Link as many as you like** in Menu → Settings → AI helpers: pick a default, choose which AI does chats, study plans, files and lesson summaries, switch AI in every chat (the chip above the message bar), tap **Ask another AI** under an answer to compare answers, and turn on **Backup AI** so the next linked AI answers when one fails (limit reached, no credit). To add one, paste its key and save; the key is tested first. The **Model** dropdown lists every model your key can use (loaded automatically once a key is saved, or with the list button), each with its price per 1M tokens (input / output) or a **Free** / **Free tier** label, plus a rough cost per answer for the selected model. Long lists (OpenRouter) have a search box — type "free" to see only free models. Claude prices are Anthropic's list prices; OpenRouter prices come live from OpenRouter; Gemini, OpenAI and Mistral prices are built-in estimates (marked ≈, checked November 2026) — tap **Price list** for the provider's current prices. Lesson recordings need a provider that can handle audio (Gemini directly; OpenAI, Mistral and custom servers via speech-to-text). If your chat provider can't, Lessn uses another saved Gemini/OpenAI/Mistral key for the audio part.
- **AI helper**: a Gemini-style start screen with a greeting, suggestions for your homework, exams and last lesson, recent chats, and the message bar at the bottom. Free chats with photos, camera, documents (PDF pages and text files) and files straight from IServ, a tutor-style helper (hints first, full solutions if you ask) and quick-start questions.
- **Scan homework with AI**: in Homework → +, take a photo of the board, worksheet or planner and the AI fills in the homework (subject and due date) for you to confirm.
- **Exams**: tap an exam for **Study with AI** (explanations and quiz questions) and **Make a study plan**. The plan is built from your lesson summaries and spread over the days before the exam, with a checkbox for each task. Today's tasks show on Home.
- **Lesson recorder (beta)**: records a lesson and turns it into a summary that feeds the homework help and study plans. **Only record with your teacher's and class's permission (§201 StGB).**
- **IServ**, built into the app in your theme:
  - **Messenger**: chats with photos, files (tap to open them in the app), **voice messages**, invitations, edited messages and replies shown correctly, and new chats. Send photos, camera shots, any file, **Scan to PDF** (several pages from the camera), or a file from your IServ files. AI extras: **Summarize chat**, **AI reply** (suggests an answer; type a few words first to steer it) and **Translate** (long-press a message). Sign-in tries several ways (a saved session, IServ's messenger token, single sign-on with your IServ session, and a password login to the chat server). If none works, the screen shows what was tried and opens the IServ web messenger in the app instead. End-to-end encrypted chats can only be read on the IServ website.
  - **Files**: tap any file to **open it in the app**: photos, PDFs (page by page), text files, Word/PowerPoint/Excel/OpenDocument (as text), audio and video. Then **Open with…** another app, **Share**, **Save** to Downloads, or **Ask AI** (summary, simple explanation, quiz, flashcards, help with the tasks in it, or a chat about the file). Upload photos, camera shots, any files, **Scan to PDF** or a **text note**; new folder, rename and delete.
  - **Tasks**: current IServ tasks with description, attachments that open in the app, "Get help from AI", and hand-in through IServ.
  - **E-Mail extras**: attachments open in the app, plus **Summarize** (with tasks and deadlines) and **Draft a reply** with AI.
  - **E-Mail**, **Calendar**, **Notifications**, plus links to forums, video conferences, news, polls, plans, room booking, address book and your profile (these open in the in-app IServ browser).
  - **IServ notifications** for new messages and notifications, checked every 15 minutes.
- **Homework and tests in the timetable**: lessons show a badge when homework is due or a test is written in them (also as icons in the week grid and list). Tap a lesson to see the homework due, homework given in it, the test with "Study with AI", and add homework for that subject (due date defaults to the next lesson).
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

## Look and feel

All dropdowns, menus, pop-up dialogs and the date picker are drawn by the app in the current theme (no Android system dialogs). The app never vibrates: no haptic feedback, and its notifications are silent of vibration (sound only).

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
