# 🤝 AI Team Studio

Link AI agents into a team that works on your project together. Each agent gets a role, its own instructions and its own AI model. They plan, build, review and improve each other's work while you watch.

- **Visual team builder.** Drag to link agents. A link that points backwards becomes a feedback loop (for example Reviewer → Developer, repeated until the reviewer writes APPROVED).
- **3 collaboration modes:**
  - **🔗 Pipeline**: work flows along the links, and agents at the same step run in parallel.
  - **💬 Round-table**: agents discuss in turns and a synthesizer writes the final answer.
  - **👑 Manager**: a lead agent plans, hands out tasks, reviews the results and puts the final deliverable together.
- **Many AI providers, and you can mix them in one team:** Anthropic Claude, OpenAI, Google Gemini, OpenRouter, Groq, Ollama (local), or any OpenAI-compatible server. There is also a free **Demo** provider, so you can learn the app without a key.
- **Files workspace.** Code the agents write is collected as files. You get a live HTML preview, copy and download for each file, and a ZIP of the whole project.
- **Continue with feedback.** Tell the team what to change and it revises the work.
- 6 ready-made templates and 15 agent presets. You can save, load and share teams as JSON.
- Runs entirely on your device in one HTML file. No server, no sign-up. API keys stay in local storage.
- Installable as a full-screen app (PWA), plus a native **Android APK** wrapper.

---

## 1. Use it right now

Open `index.html` in Chrome, Edge, Firefox or Safari by double-clicking it. That's it.

1. Press **Run → ▶ Run team** to watch the demo team work. It uses the free Demo provider.
2. Go to **⚙️ Settings**, paste an API key, then under *Defaults for new agents* choose the provider and model and press **Apply to every agent**.
3. Write your project goal on the **Run** tab and run it.
4. Get the results from **📁 Files**: preview, download, or ZIP.

The in-app **📖 Guide** tab explains every feature.

### Where to get API keys
| Provider | Get a key |
|---|---|
| Anthropic Claude | console.anthropic.com → API Keys (models: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) |
| OpenAI | platform.openai.com → API keys |
| Google Gemini | aistudio.google.com → Get API key |
| OpenRouter | openrouter.ai/keys (one key for hundreds of models, many of them free) |
| Groq | console.groq.com/keys |
| Ollama | No key. Install Ollama and start it with `OLLAMA_ORIGINS="*" ollama serve` |

In any agent's editor, press **↻** next to the model field to fetch the provider's current model list. Press **Test** to check that an agent can connect.

---

## 2. Use it like an app, without browser bars

### Option A: install the web app (PWA). Works on Android, iPhone and desktop.
To install, the app has to be served over **https**. The easiest free host is GitHub Pages:
1. In this repository, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Open **Actions → “AI Team Studio – publish web app to GitHub Pages” → Run workflow**.
3. Open the URL it prints (`https://<you>.github.io/<repo>/`) on your phone:
   - **Android / Chrome:** ⋮ menu → **Install app** (or *Add to Home screen*)
   - **iPhone / Safari:** Share → **Add to Home Screen**
   - **Desktop Chrome / Edge:** the install icon in the address bar

The app then opens full-screen with its own icon and works offline (API calls still need internet).

### Option B: Android APK
The `android/` folder holds a small native app. It shows the same web app full-screen in a WebView, with native file saving (to *Downloads/AI Team Studio*), the file picker for imports, and the Back button.

**Build it automatically (no Android Studio needed):** every push that changes `ai-team/` runs the workflow **“AI Team Studio – build Android APK”** (`.github/workflows/ai-team-apk.yml`). You can also start it by hand from the **Actions** tab. When it finishes:
- On your phone, open the repository's **Releases** page, open **“AI Team Studio (latest build)”** and tap **AI-Team-Studio.apk**, or
- download the **AI-Team-Studio-apk** artifact from the workflow run.

Open the APK and allow *Install unknown apps* when Android asks. This is a debug-signed build, which is fine for your own devices.

**Build it locally:** install Android Studio (or the Android SDK plus JDK 17 and Gradle 8.9), then:
```bash
cd ai-team
mkdir -p android/app/src/main/assets/www
cp index.html manifest.webmanifest sw.js icon.svg icon-192.png icon-512.png android/app/src/main/assets/www/
cd android && gradle assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```
You can also open the `android/` folder in Android Studio and press ▶ Run.

---

## 3. How the team works

### Building a team
- **✨ Templates**: Software Dev Team, Game Studio, Content Studio, Full Product Squad, Brainstorm Round-table, Manager-led Team.
- **＋ Agent**: pick a preset (Product Manager, Architect, Developer, Code Reviewer, QA Tester, Designer, Researcher, Writer, Editor, Devil's Advocate, Synthesizer, Team Lead, Marketer, Game Designer) or start blank.
- **Tap an agent** to edit its name, icon, role, instructions (system prompt), provider, model, max output tokens, temperature, or effort (Claude only).
- **Link**: drag from the purple ● on an agent onto another agent. On a phone you can also tick *Sends its output to* in the agent editor.
- **Unlink** by tapping the link. Pan by dragging the background. Zoom with pinch, the mouse wheel, or the ＋/－ buttons. ☷ arranges the agents automatically.

### Pipeline mode in detail
- An agent runs once every agent linking into it has finished, and it receives all of their outputs.
- Agents at the same step run in parallel.
- A link that creates a cycle is a **feedback loop** (orange, dashed). The agent at its start is a quality gate:
  - If its reply contains the approve word (default `APPROVED`), the run finishes.
  - If it doesn't, its feedback goes back to the target agent, and the target plus everything after it runs again.
  - *loops* caps how many times this can repeat.

### Files
Agents are told to put a line like `File: index.html` directly above each code block. Those blocks are collected in **📁 Files**, and newer versions replace older ones. When you preview an HTML file, the CSS and JS files it links to are inlined from the workspace, so multi-file web projects preview correctly.

### Tips
- Be specific in the goal: features, audience, format, constraints.
- Give each agent a narrow, clear job.
- Put a reviewer or tester in a loop with the producer. Most of the quality comes from that loop.
- Mix models: use a strong model as reviewer or manager and cheaper, faster ones for drafting.
- Raise *Max output tokens* (for example 16000–32000) for agents that write a lot of code.

---

## Privacy & costs
- Everything is stored in your browser's local storage on this device.
- Your API keys are sent only to the provider you selected. Team files you export never contain keys. The full backup in Settings does, so keep that file private.
- Providers bill for API usage. The Run tab shows token counts for each agent and in total.
- For Claude models, the app turns on Anthropic's server-side refusal fallback by default. If a request is declined, it is retried on another model. You can turn this off in Settings.

## Files in this folder
| File | Purpose |
|---|---|
| `index.html` | The entire app (HTML + CSS + JS, no dependencies) |
| `manifest.webmanifest`, `sw.js`, `icon*.png/svg` | PWA install and offline support |
| `android/` | Native Android WebView wrapper (APK) |
| `../.github/workflows/ai-team-apk.yml` | Builds the APK on GitHub |
| `../.github/workflows/ai-team-pages.yml` | Publishes the web app to GitHub Pages |
