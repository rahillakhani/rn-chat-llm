# rn-chat-llm: offline FAQ chatbot (POC)

A React Native (Expo SDK 57) chatbot that answers questions from an FAQ dataset stored in a SQLite vector
database, in **English and Spanish**. Everything runs **on the phone**: no server and no cloud AI API. The AI
models are **not bundled** in the app. They are downloaded once, right after install, and from then on the
chatbot works fully offline.

## 1. How it works

There are two small AI models, both run on the device by [llama.cpp](https://github.com/ggml-org/llama.cpp)
through [`llama.rn`](https://github.com/mybigday/llama.rn):

- a **multilingual embedding model** that turns text into a list of 384 numbers (a vector). Texts with the same
  meaning get similar vectors **even across languages**, so "¿Dónde está mi pedido?" and "Where is my order?"
  land next to each other;
- a **chat model (the LLM)** that can rewrite English answers in plain language, when **AI** answer mode is on.

**Setup (once, on first launch):**

1. The 52 FAQs in [`src/data/faq.json`](src/data/faq.json), each in English and Spanish, are copied into a
   SQLite database on the phone.
2. For every FAQ and language, the question, 2–3 **alternative phrasings** ("I forgot my password",
   "Olvidé mi contraseña") and the question+answer are each turned into a vector: 454 vectors in total. They are
   stored in a `faq_vec` table using the [sqlite-vec](https://github.com/asg017/sqlite-vec) extension, which
   makes SQLite a vector database.

**Every time the user asks a question:**

```
"¿Cuándo me devuelven el dinero?"
   │
   ▼  1. Detect the language (English or Spanish)      → es
   ▼  2. Embed the question                            → 384-number vector
   ▼  3. Vector search in SQLite (sqlite-vec)           → similarity to all 454 stored texts
   ▼  4. Score each FAQ = best vector similarity + 0.3 × keyword overlap
   ▼  5. Decide, based on the best score:
   │      ≥ 0.56        → answer it
   │      0.50 – 0.56   → "Not sure, is it one of these?" + top 3 questions to tap
   │      < 0.50        → "Sorry, I couldn't find that in our FAQ"
   ▼  6. Answer, in the language of the question:
          FAQ mode (default) → the FAQ answer exactly as written, English or Spanish
          AI mode            → English: the LLM rewrites the FAQ answer (FAQ text if it returns nothing)
                               Spanish: still the FAQ answer as written
          + "Did you mean…" buttons for FAQs that scored almost as high
          + the matched FAQ question and its match %
```

Answers always come from the FAQ: the LLM only ever sees the one matched FAQ entry, and it is never asked
when nothing matches. Spanish answers skip the LLM because the lightest model writes poor Spanish.

### Answer mode: FAQ vs AI (testing switch)

The **FAQ | AI** switch in the chat header lets testers compare both on the same question. It starts on
**FAQ** each time the app opens. Each reply is labelled **From FAQ** or **AI-written · may be inaccurate**.

Why FAQ is the default: SmolLM2-135M was tested on 10 English questions, 3 runs each, with the app's exact
prompt. Of 30 answers, **11 copied the prompt back** (so one reply looked like several Q&As), **7 invented
content** such as fake links, and most of the remaining 12 were refusals or wrong ("I don't know how to reset my
password"). For comparison, Qwen2.5-0.5B (491 MB) produced 30/30 clean answers but sometimes dropped details
such as prices or steps. Showing the FAQ text as written is the only option that is always complete.

### Languages

- **App text** (buttons, messages, FAQ list) starts in the phone's language (Spanish if the phone is set to
  Spanish, otherwise English) and can be switched with the **EN | ES** toggle in the chat header.
- **Answers** follow the language the question is typed in, whatever the toggle says. If a question has no
  clear language (e.g. just "PayPal"), the toggle's language is used.

### How accurate is the matching?

Measured with the app's own matching code and the real embedding model, on a held-out set of 120 test
questions ([`src/rag/__fixtures__/retrieval-eval.json`](src/rag/__fixtures__/retrieval-eval.json)): 52 English,
52 Spanish, each worded differently from the FAQ and its alternatives, plus 16 off-topic questions.

| Measure                                                      | Result    |
| ------------------------------------------------------------ | --------- |
| Right FAQ answered directly (top-1)                          | **90.4%** |
| Right FAQ answered **or** offered as a button to tap         | **97.1%** |
| Fully correct, incl. off-topic questions getting "no answer" | 88.3%     |
| Language of the question detected correctly                  | 96.7%     |
| Off-topic questions shown suggestions instead of "no answer" | 2 of 16   |

How we got there (same test set):

| Setup                                          | Top-1 (EN / ES) |
| ---------------------------------------------- | --------------- |
| Previous English-only model (all-MiniLM-L6-v2) | 55% (92% / 17%) |
| Multilingual model, question+answer only       | 83% (88% / 77%) |
| + alternative phrasings per FAQ                | 86% (92% / 79%) |
| + keyword overlap (final)                      | **90%**         |

The test questions and the alternative phrasings were both written by Claude for this POC, so real users may
score somewhat lower; testers should report questions that fail. To re-run the measurement:

```bash
brew install llama.cpp
llama-server -m paraphrase-multilingual-MiniLM-L12-118M-v2-Q4_K_M.gguf --embeddings --pooling mean --port 8080
LIVE_EMBEDDINGS_URL=http://localhost:8080 npm run eval:retrieval -- --silent=false
```

## 2. Which models we use

| Role       | Model                                                                                                                                    | Download   | Notes                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| Chat LLM   | [SmolLM2-135M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct), Q4_K_M GGUF                                         | **105 MB** | Lightest instruct model. Only used in AI mode, English only |
| Embeddings | [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2), Q4_K_M GGUF | **125 MB** | 384-dim vectors, 50+ languages incl. English and Spanish    |

- The app always uses **SmolLM2-135M**, the lightest model. There is no model picker: everything is downloaded
  automatically on first launch.
- The embedding model is bigger than the old English-only one (25 MB) because it carries a vocabulary for 50+
  languages. Its 4-bit (Q4_K_M) version matched the 8-bit one on the accuracy test and is 7 MB smaller. A
  multilingual-e5-small file was also tested and rejected (it scored 12% in llama.cpp).
- "Q4_K_M" means the model weights are compressed (quantized) to about 4 bits, which is what makes them small
  enough for a phone.
- Files are downloaded from Hugging Face. URLs and sizes are in [`src/config/models.ts`](src/config/models.ts).
  The embedding file is a community GGUF conversion; for production, convert and host it yourself.
- **GPU:** the chat model is offloaded to the GPU when the phone supports it: Metal on iPhone, OpenCL on
  Android phones with a Qualcomm Adreno 700-series or newer GPU (roughly Snapdragon 8 Gen 1 and later). Other
  Android phones (e.g. Samsung Exynos, MediaTek) fall back to the CPU automatically. The chat header shows
  `GPU` or `CPU` so testers can see which one is used. For a model this small, GPU is not guaranteed to be
  faster than CPU; compare on your test phones.
- **Better English answers:** if SmolLM2-135M is too weak, swap `CHAT_MODEL` in `src/config/models.ts` for
  SmolLM2-360M (271 MB) or Qwen2.5-0.5B (491 MB); the URLs are in the comment there.

Other libraries: [`@op-engineering/op-sqlite`](https://github.com/OP-Engineering/op-sqlite) (SQLite with
sqlite-vec built in), `expo-file-system` (model download with progress and pause), `expo-localization`
(phone language).

## 3. App size

**Installed app (before any download): ~117 MB.** This is the measured size of a release APK
for 64-bit Android phones (arm64), measured before Spanish support was added; the Spanish text and the
language module add well under 1 MB. Most of it is the llama.cpp engine, which ships several builds tuned for
different phone CPUs; the right one is picked at runtime. The app contains the FAQ data but no AI model.
iOS has not been built yet, so there is no iOS figure.

**Downloaded on first launch** (one time, needs internet):

| Chat model (SmolLM2-135M) | + Embedding model (multilingual) | **Total download** |
| ------------------------- | -------------------------------- | ------------------ |
| 105 MB                    | 125 MB                           | **230 MB**         |

**Total storage after setup:** ~117 MB app + 230 MB models. The SQLite database itself is small (the FAQs in
two languages and their 454 vectors are under 1 MB). The app checks for free space before downloading and
shows an error instead of starting if there is not enough room. Model files from older app versions are
deleted automatically.

## 4. When the chatbot becomes available

The chat screen is **not usable until the models are downloaded**. The download **starts automatically** the
first time the app is opened; the user doesn't need to tap anything.

| Step                               | What the user sees                             | Roughly how long                                                      |
| ---------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| 1. Install app and open it         | Download starts by itself                      | —                                                                     |
| 2. Download the models (230 MB)    | Progress bar with MB and %, and a Pause button | Depends on network: 230 MB is ~40 s at 50 Mbit/s, ~3 min at 10 Mbit/s |
| 3. Build the FAQ search index      | "Building search index… 120/454"               | Roughly 5–30 s depending on the phone (estimate)                      |
| 4. Load the chat model into memory | "Loading SmolLM2 135M Instruct…"               | A few seconds (estimate)                                              |
| 5. **Chatbot ready**               | Chat screen                                    |                                                                       |

**Every launch after that** skips steps 1–3: the models are already on the phone, so the app loads them
(a few seconds) and opens straight to chat, **with no internet needed**.

Notes:

- If the user taps **Pause**, or the download fails (e.g. no internet), the app shows **Resume download** /
  **Try again**. If the app is closed mid-download, the download starts again automatically on next launch.
  A half-downloaded file is never used.
- The download starts on any connection, including mobile data. A production app should ask first, or wait
  for Wi-Fi.
- Step 3 runs again only when the FAQ data or the embedding model changes (see "Changing the FAQ data").
- The timings for steps 3 and 4 and the answer speed have **not been measured on a real phone yet**.

## 5. Testing: the FAQ list

Tap **FAQ list** in the chat header (or **Browse all FAQs** on the empty chat) to see every FAQ stored in
SQLite, in the selected language, grouped by category with a filter box. Tap a question to send it to the
chatbot. Testers should also try:

- reworded questions in both languages ("how do I get my money back?", "¿cuándo me devuelven el dinero?");
- Spanish without accents or question marks ("como cancelo mi pedido"), which is how people often type;
- off-topic questions ("what's the weather?", "¿qué hora es?") to check the bot says it doesn't know.

## 6. Changing the FAQ data

Edit `src/data/faq.json` and **bump `version`**. Each FAQ needs `en` and `es` blocks with `question`,
`answer` and at least two `alternates` (other ways people ask it; this is the single biggest lever for
matching accuracy). On next launch the rows are re-loaded into SQLite and the vectors are rebuilt. After
editing, re-run the accuracy test (section 1) and add test questions for new FAQs.

## Project layout

```
App.tsx                    Setup screen ↔ chat screen
src/config/models.ts       Model catalog (URLs, sizes, dimensions)
src/data/faq.json          FAQ dataset (52 sample entries, fictional store)
src/db/faqStore.ts         SQLite schema, seeding, vec0 KNN search (+ JS cosine fallback)
src/models/modelFiles.ts   Download / check / delete GGUF files
src/llm/engine.ts          llama.rn wrapper: embedder + generator
src/i18n/                  EN/ES app text, phone-language detection
src/rag/                   Language detection, keyword index, ranking, prompt, orchestration (unit tested)
src/rag/__fixtures__/      Held-out accuracy test questions
src/ui/                    useAssistant state machine, SetupScreen, ChatScreen, FaqListModal
```

## Android build environment (macOS)

Tested with: JDK 21 (Temurin), Android SDK platform 36, build-tools 36, NDK 27.1, Gradle 9.3.1. You don't
install Gradle yourself: the project's Gradle wrapper (`android/gradlew`) downloads the right version.

Add to `~/.zshrc`, then open a new terminal (or run `source ~/.zshrc`):

```bash
# Java (JDK 17 or 21)
export JAVA_HOME=$(/usr/libexec/java_home -v 21)

# Android SDK (default Android Studio location)
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"   # older tools still read this name
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

# Optional: build only for 64-bit ARM phones, much faster than all 4 CPU types
export ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a
```

Check: `java -version` shows 21, `adb devices` lists your phone (USB debugging on) or a running emulator.
The first `npm run android` takes 15–20 minutes (it compiles llama.cpp's React Native glue and SQLite); later
builds are much faster.

## Running it

Native modules (llama.rn, op-sqlite) mean **Expo Go will not work**. You need a development build.

```bash
npm install

# Android (device or emulator; a real arm64 device is much faster)
npm run android            # = expo run:android

# iOS (needs Xcode + CocoaPods: `brew install cocoapods`)
npm run ios                # = expo run:ios
```

`ios/` and `android/` are generated by `expo prebuild` and git-ignored; configure native things in
`app.json` / `package.json` (`"op-sqlite": { "sqliteVec": true }`).

Quality checks:

```bash
npm run lint && npm run typecheck && npm test && npm run format:check
```

## POC limitations / next steps

- In AI mode the 135M LLM is unreliable (see "Answer mode"). If testers settle on FAQ mode, the chat model can
  be dropped entirely, cutting the first-launch download from 230 MB to 125 MB. If they prefer AI answers,
  Qwen2.5-0.5B is the smallest model that answered cleanly in testing (download ~615 MB in total).
- The thresholds (`src/rag/ranking.ts`) were tuned on 120 test questions; re-tune them on real user
  questions once testers have collected some.
- Embeddings are computed on the phone at first launch. For large datasets, precompute them at build time
  with the same model and ship a pre-filled SQLite file instead.
- No chat history is sent to the model (each question is answered on its own), which keeps it fast.
- Downloads come from Hugging Face over HTTPS; for production, host the files yourself and verify a SHA-256.
- The app size could be cut by shipping only the llama.cpp builds for the CPUs you target, and by
  publishing an Android App Bundle so each phone downloads only what it needs.
