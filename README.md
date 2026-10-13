# rn-chat-llm: offline FAQ chatbot (POC)

A React Native (Expo SDK 57) chatbot that answers questions from an FAQ dataset stored in a SQLite vector
database. Everything runs **on the phone**: no server and no cloud AI API. The AI models are **not bundled**
in the app. They are downloaded once, right after install, and from then on the chatbot works fully offline.

## 1. How it works

There are two small AI models, both run on the device by [llama.cpp](https://github.com/ggml-org/llama.cpp)
through [`llama.rn`](https://github.com/mybigday/llama.rn):

- an **embedding model** that turns text into a list of 384 numbers (a vector), so that texts with similar
  meaning get similar vectors;
- a **chat model (the LLM)** that writes the final answer in plain language.

**Setup (once, on first launch):**

1. The 52 FAQ entries in [`src/data/faq.json`](src/data/faq.json) are copied into a SQLite database on the phone.
2. Each FAQ (question + answer) is turned into a vector by the embedding model and stored in a `faq_vec`
   table. This table uses the [sqlite-vec](https://github.com/asg017/sqlite-vec) extension, which makes
   SQLite a vector database that can find the nearest vectors quickly.

**Every time the user asks a question:**

```
"How do I get my money back?"
   │
   ▼  1. Embed the question                     → 384-number vector
   ▼  2. Vector search in SQLite (sqlite-vec)    → 5 closest FAQs, each with a match score
   ▼  3. Relevance check
   │      best match below 45%? → reply "Sorry, I couldn't find that in our FAQ"  (LLM is not used)
   ▼  4. Send the 1–3 best FAQs + the question to the LLM
   │      "Answer using ONLY these FAQ entries, in 1–3 sentences"
   ▼  5. Answer streams into the chat, word by word,
          with the FAQ entries it used and their match % shown underneath
```

This pattern is called **RAG (retrieval-augmented generation)**: the LLM doesn't need to "know" the FAQ, it is
handed the relevant entries each time. Step 3 matters for a tiny model: if nothing relevant is found, the LLM is
never asked, so it can't invent an answer. If the LLM returns an empty reply, the best FAQ answer is shown as-is.

## 2. Which LLM we use

| Role       | Model                                                                                            | Download   | Notes                                        |
| ---------- | ------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------- |
| Chat LLM   | [SmolLM2-135M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct), Q4_K_M GGUF | **105 MB** | Lightest instruct model. Fast, basic answers |
| Embeddings | [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), Q8_0 GGUF     | **25 MB**  | 384-dimension vectors                        |

- The app always uses **SmolLM2-135M**, the lightest model. There is no model picker: it is downloaded
  automatically on first launch.
- "Q4_K_M" / "Q8_0" means the model weights are compressed (quantized) to about 4 or 8 bits, which is what
  makes them small enough for a phone.
- Files are downloaded from Hugging Face. URL and size are in [`src/config/models.ts`](src/config/models.ts).
- **GPU:** the chat model is offloaded to the GPU when the phone supports it: Metal on iPhone, OpenCL on
  Android phones with a Qualcomm Adreno 700-series or newer GPU (roughly Snapdragon 8 Gen 1 and later). Other
  Android phones (e.g. Samsung Exynos, MediaTek) fall back to the CPU automatically. The chat header shows
  `GPU` or `CPU` so testers can see which one is used. For a model this small, GPU is not guaranteed to be
  faster than CPU; compare on your test phones.
- **Better answers:** if SmolLM2-135M is too weak, swap `CHAT_MODEL` in `src/config/models.ts` for
  SmolLM2-360M (271 MB) or Qwen2.5-0.5B (491 MB); the URLs are in the comment there.

Other libraries: [`@op-engineering/op-sqlite`](https://github.com/OP-Engineering/op-sqlite) (SQLite with
sqlite-vec built in), `expo-file-system` (model download with progress and pause).

## 3. App size

**Installed app (before any download): ~117 MB.** This is the measured size of a release APK
for 64-bit Android phones (arm64). Most of it is the llama.cpp engine, which ships several builds tuned for
different phone CPUs; the right one is picked at runtime. The app contains the FAQ data but no AI model.
iOS has not been built yet, so there is no iOS figure.

**Downloaded on first launch** (one time, needs internet):

| Chat model (SmolLM2-135M) | + Embedding model | **Total download** |
| ------------------------- | ----------------- | ------------------ |
| 105 MB                    | 25 MB             | **130 MB**         |

**Total storage after setup:** ~117 MB app + 130 MB models. The SQLite database
itself is tiny (the 52 FAQs and their vectors are well under 1 MB). The app checks for free space before
downloading and shows an error instead of starting if there is not enough room.

## 4. When the chatbot becomes available

The chat screen is **not usable until the models are downloaded**. The download **starts automatically** the
first time the app is opened; the user doesn't need to tap anything.

| Step                               | What the user sees                             | Roughly how long                                                      |
| ---------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| 1. Install app and open it         | Download starts by itself                      | —                                                                     |
| 2. Download the models (130 MB)    | Progress bar with MB and %, and a Pause button | Depends on network: 130 MB is ~20 s at 50 Mbit/s, ~2 min at 10 Mbit/s |
| 3. Build the FAQ vector index      | "Building vector index… 12/52"                 | A few seconds (estimate)                                              |
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
- Step 3 runs again only when the FAQ data changes (see "Changing the FAQ data").
- The timings for steps 3 and 4 and the answer speed have **not been measured on a real phone yet**. They
  depend on the phone; a recent mid-range phone should answer within a few seconds with the default model.

## 5. Testing: the FAQ list

Tap **FAQ list** in the chat header (or **Browse all FAQs** on the empty chat) to see every FAQ stored in
SQLite, grouped by category with a filter box. Tap a question to send it to the chatbot. Testers should also
try:

- reworded questions ("how do I get my money back?") to check the vector search finds the right FAQ;
- off-topic questions ("what's the weather?") to check the bot says it doesn't know instead of inventing.

## 6. Changing the FAQ data

Edit `src/data/faq.json` and **bump `version`**. On next launch the rows are re-loaded into SQLite and the
vectors are rebuilt.

## Project layout

```
App.tsx                    Setup screen ↔ chat screen
src/config/models.ts       Model catalog (URLs, sizes, dimensions)
src/data/faq.json          FAQ dataset (52 sample entries, fictional store)
src/db/faqStore.ts         SQLite schema, seeding, vec0 KNN search (+ JS cosine fallback)
src/models/modelFiles.ts   Download / check / delete GGUF files
src/llm/engine.ts          llama.rn wrapper: embedder + generator
src/rag/                   Relevance check, prompt building, orchestration (unit tested)
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

- Tiny models paraphrase imperfectly. Every answer shows the matched FAQ entries with a match %, and if the
  model returns nothing the best FAQ answer is shown word for word. A larger model (see section 2) gives
  noticeably better answers.
- The 45% relevance cutoff (`src/rag/retrieval.ts`) is a starting guess; tune it on real questions.
- Embeddings are computed on the phone at first launch. For large datasets, precompute them at build time
  with the same model and ship a pre-filled SQLite file instead.
- No chat history is sent to the model (each question is answered on its own), which keeps it fast.
- Downloads come from Hugging Face over HTTPS; for production, host the files yourself and verify a SHA-256.
- The app size could be cut by shipping only the llama.cpp builds for the CPUs you target, and by
  publishing an Android App Bundle so each phone downloads only what it needs.
