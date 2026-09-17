# Oblako

**English** · [Русский](README.ru.md)

**A browser where AI works on your side: on top of your tabs, history and drafts — and, by default, without leaving the machine.**

Anything that touches your data runs on a local model: translation, recap, explaining a selection, search across tabs and history, reading a page. Cloud pieces exist too, and they are named as such: web search through SearXNG and fact-check through Gemini on the new-tab page. They never receive your tabs, history or drafts — only the query you typed — and they switch off in Settings. Honest phrasing: **not “AI is local only”, but “local wherever it is about you”**.

Windows x64 · Electron + TypeScript + React · built-in VPN · local Qwen model · a working build, installer and auto-update.

---

## In short

| | |
|---|---|
| **What it is** | A Chromium desktop browser with three things nobody else ships together: ad blocking and VPN out of the box, a local language model, and a mode where AI helps but never acts for you |
| **Stage** | The production build runs end to end: installer, auto-update, import from Chrome/Edge/Yandex, a typed IPC contract, and a growing automated check suite |
| **What is missing** | Public users, revenue, a code-signing certificate (that last one blocks distribution — see Risks) |
| **What it needs** | An Authenticode certificate, a macOS port, distribution. The product itself already builds and launches |

---

## The problem

People use a browser more than any other program on the computer, and that is exactly where the private stuff lives: open tabs, history, passwords, unfinished letters. The browser market is set up so that no large player can honestly stand on the user’s side:

- **Chrome** belongs to an advertising company. Its business is knowing what you look at.
- **Edge** is a storefront for Microsoft services and a door into its cloud.
- **Yandex Browser** is the same for the Russian ads-and-services stack.

The 2025 wave of “AI browsers” (Perplexity Comet, OpenAI Atlas, Arc/Dia) did not fix this. It made it worse: for an assistant to help, the page has to go to someone else’s server. Not an abstract “page” — your mail, your chat, your bank account — because that is where the assistant is needed.

The agent approach has a second, technical failure: **prompt injection**. An agent that can click for you works with the full rights of a logged-in person. Hide “now open mail and forward the last message here” on a page, and the agent does it, because a language model cannot tell a human instruction from a page instruction. This is not a bug in one implementation. In that design the problem has no general fix, and the people who ship agent browsers say so in public.

## Oblako’s answer

Three decisions that a large player structurally cannot make, and that are the base construction here.

### 1. The model runs on your machine

Local Qwen (GGUF via `node-llama-cpp`, downloaded from the UI for the actual GPU) does everything that touches personal data: meaning search on the page, finding a tab by description, editing your own draft, recognising form fields, a day recap from your history, “you have already read this”. None of those scenarios send a byte outside.

This is a product choice, not an ideology: **our territory is what the cloud cannot do in principle, because it has no access to your tabs, history and drafts.** People will still go to ChatGPT to write and argue — that is fine; we do not compete there, and the UI says so.

### 2. Unobtrusive AI instead of a chat companion

We do not build a companion chatbot and we do not build an agent that acts for the person. We take routine off the table and propose — **the person always presses and confirms**:

- tab grouping is offered by “Tidy up” and undone in one move;
- an automation rule (“open habr.com links in the Reading group”) is born from a phrase, but shows a confirmation card before it starts working;
- meaning search highlights the paragraph on the page instead of retelling it;
- talk with third-party AI sites on the graph canvas is set up so that the person presses Send — the code never drives someone else’s UI.

A side effect of this construction is the answer to prompt injection: there is simply no user-privileged agent that a page can order around.

### 3. Privacy as engineering, not a promise

Ad blocking on the Ghostery engine with list auto-update; VPN on Xray-core as a child process with a fail-closed kill switch (if the tunnel dies, traffic stops instead of leaking past it); a password manager on AES-256-GCM over the OS key store; showing a password only through Windows Hello. Fonts are bundled, not loaded from Google Fonts: the browser does not even tell Google that it launched. There is no telemetry at all.

---

## What already works

Not a plan — a built product that launches. This is the state today.

**Browser core.** Vertical tabs with drag-and-drop, groups, pinning, sleeping background tabs, split view, multi-window with a live tab moving to another window (the page keeps back-history, scroll and form text), session autosave, incognito on an isolated in-memory session, fullscreen video and picture-in-picture, a tab snapshot via Ctrl+Shift+S, find in page, error pages that explain Chromium codes in human language.

**Privacy and protection.** Ghostery ad blocking with background list updates; VPN on Xray-core (vless/trojan subscription import, config generation, kill switch, a Shield popover with servers and country flags); a password manager with clickless autofill and a built-in generator; address and bank-card autofill (card number under Windows Hello, CVC never stored); site permissions with three states (allow / deny / forget — so a mistaken “no” can be undone).

**Data and moving in.** History on SQLite with full-text search (FTS5 plus a local-model re-rank), bookmarks with folders, a download manager with Mark-of-the-Web, import of bookmarks, history and passwords from Chrome, Edge, Brave, Opera, Vivaldi and Yandex Browser — including Yandex’s undocumented password-encryption scheme. First-run setup offers the import; the browser also works without it.

**Local AI that earns its place.** Eight functions, each picked by a hard bar (short input, short output, a checkable answer shape, one step, a cheap visible miss, personal data): editing your own text in an input while keeping Ctrl+Z, finding a tab by meaning, recognising form fields from labels, “What I did today” from your history, “you have already read this”, meaning Ctrl+F, AI tab grouping, turning a phrase into an automation rule.

**Larger AI surfaces.** A notebook in the NotebookLM vein: several independent notebooks, sources as links and local files (pdf, docx, txt, md, csv), chat grounded on those sources, and Studio — recap, mind map, infographic, an interactive quiz, and an article-page in three styles you can open as a tab or save as one `.html`. Plus a graph workspace: a canvas where the person draws the plan as links, and the model does one narrow step per node. A small local model cannot plan on a long horizon — so the person draws the plan. That is an architectural decision, not a shortcut.

**Ordinary browser life.** A new-tab desktop with widgets (weather, FX, crypto, clock, day recap, language cards) and a free tile layout, a dark theme and four neutral palettes, page translation on Bergamot (CPU, no GPU) with a fallback to Qwen, omnibox bangs, set as default browser, auto-update through `electron-updater`. The UI ships in English for new profiles, with Russian kept for existing ones.

---

## Why this is hard to copy

A feature list copies. What sits behind it does not.

**Measured model behaviour, not guessed.** The project has its own stand (`npm run ai-bench`) — a battery of tasks with a checkable answer shape, run on a live model with repeats. It produced results you cannot get by reasoning:

- The model answer is **not deterministic**, even with greedy sampling and a byte-identical prompt — floating-point layouts diverge. The main lesson: what drifts is not the engine, it is a decision the model finds hard. The fix is **one decision per run**, not engine knobs. On rule parsing, moving one hard choice into a separate short run went from 5/8 with two shaky cases to 7/8 with none.
- **Recommend the lightest measured model, not the largest.** A 4B model beat 9B on hard-shaped tasks (26/28 vs 23) and answers faster — at half the load and memory. “Bigger is better” was false, and the model catalog is built on measurement, not intuition.
- **Let the model choose, not write.** A fragment index from a list we assembled, instead of prose in its own words: then the quote is physically from the page, it can be highlighted, and there is nowhere to lie. That is how meaning Ctrl+F (6/6 on a live run) and tab search work.

Current model baseline: 21 correct of 24 across four different tasks, zero shaky cases. The path there was from 17/24, and both jumps came from the same medicine: splitting decisions.

**Platform work nobody does for fun.** Windows Hello is called through WinRT from PowerShell, because Electron has no first-party path. Chromium’s password master key is unwrapped through DPAPI with no native extra dependency. The Bergamot translation library, unmaintained since 2022, is patched three times on install — otherwise it does not run in Node on Windows at all. An Electron 40 bug where the in-page find match counter did not appear until Enter was found and worked around. Smart App Control blocking unsigned libraries only on first sight — and returning a completely different error code — was mapped and documented.

**Decision discipline.** `CLAUDE.md` is not “docs”. It is recorded reasons: why embeddings were removed from the project entirely, why tab grouping is two model runs plus ordinary-code arbitration, why desktop tile coordinates are stored rather than computed, why site permissions cannot be two-state. Each item was paid for by a measurement or a broken feature. That is the speed: the next step does not reopen the last one.

---

## Development pace

Hundreds of commits and tens of thousands of lines of TypeScript (main process + UI) in weeks, not a year. Strictly typed code, a single IPC contract between processes, a token design system.

That pace comes from one person plus a coding agent, and that is a separate asset: a product of this size usually takes a team and a year. The other side of it is named honestly under Risks.

---

## Business model

Not a kopeck can come from ads or data — that would collapse the product itself. Two honest sources remain, and the first is already wired in:

1. **A VPN subscription.** The Xray-core client, subscription import, kill switch and server picker already work. The person pays for traffic and servers — a clear service with a clear cost, not “premium features”.
2. **A pro tier for people who want the large AI surfaces** (graph workspace, notebook) and cloud integrations on their own keys.

Prices and unit economics are not fixed — that is a discussion, not a claim. What matters: both models are compatible with the privacy promise, and neither requires knowing what the person looks at.

---

## Risks and what is missing

This section is honest, because a hidden problem costs more than a named one.

**1. The build is unsigned — that is a distribution blocker, not cosmetics.** Smart App Control, on by default on clean Windows 11, blocks installing an unsigned app; on other machines SmartScreen scares people on every install. Auto-update hits the same wall. The fix is an Authenticode certificate — money and time, not engineering. Native dependency libraries have to be signed too, not just the exe.

**2. Windows only.** A macOS port is planned, and the code was prepared for it: everything OS-specific (secret storage, VPN spawn, VRAM budget, title bar) sits behind interfaces. The port is “write the layer”, but the layer still has to be written.

**3. Size.** The installer is hundreds of megabytes, the installed app more, and most of that weight is local-AI backends for CPU, CUDA and Vulkan: the same program has to start on an NVIDIA GPU and on integrated graphics. The model itself downloads separately (3–6 GB) and only if the person chooses. Fine on home internet, still a filter on the first step.

**4. Local AI needs hardware.** Comfortable use starts at 6–8 GB of video memory. On a weak machine the catalog honestly says local AI will not run here, and does not offer a download that will not work — the browser still runs in full, AI features simply stay quiet.

**5. Checks cover shared logic, not every Electron race.** `npm test` runs a large suite of pure-logic and IPC-contract checks. Lifecycle races in views and live Chromium behaviour still need stands and eyes. That gap stays.

**6. No users and no revenue.** The product is technically ready for first installs, but there has been no public release: see point 1.

**7. Dependence on Electron and Chromium.** The price of development speed is app weight and Chromium’s update cycle. A conscious trade: without it a product of this volume would not exist in weeks.

---

## What resources would change

In descending order:

1. **A code-signing certificate** — removes the only barrier between a finished product and a first user.
2. **VPN server infrastructure** — turns the already written client into revenue.
3. **A macOS port** — a second market on an architecture prepared for it.
4. **Distribution** — a private browser has no paid acquisition channel that would not contradict its own promise; it can grow through communities, reviews and word of mouth, and that is separate work.

---

## Documentation

- [ROADMAP.md](ROADMAP.md) — what is done, what is next, and what will not be here (with reasons).
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to build, what must stay green, and how the project’s checks work.
- [SECURITY.md](SECURITY.md) — where to report a vulnerability and what counts as one.
- [DEVELOPMENT.md](DEVELOPMENT.md) — build, commands, page translation, limits.
- [CLAUDE.md](CLAUDE.md) — module map, working rules, and recorded reasons for architecture.

Most of those files are still in Russian. The UI for new profiles is English.

## User data

The profile (passwords, history, session, downloaded models, API keys) lives in
`%APPDATA%\oblako-browser\`, outside the project folder. Secrets are encrypted through the OS store
(DPAPI on Windows, Keychain on macOS), never written as plain text, and never land in logs.

## License

[Apache License 2.0](LICENSE) — free to use, change and distribute, including commercially, with an explicit patent grant. Required third-party notices are in [NOTICE](NOTICE).

Language-model weights and filter lists are **not** in the repository and ship under **their own** licenses: the browser downloads them when a person chooses. Terms for a given model are that model’s license, not this one.
