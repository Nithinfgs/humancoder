# HumanCoder ⌨️

> **Realistic Human-Speed Code Simulator for VS Code**  
> Types code into your editor with natural pacing, organic thinking pauses, physical QWERTY key-neighbor typos, automatic backspace corrections, interactive pause/resume controls, and crash recovery.

---

## ✨ Features

- ⚡ **Zero Keyboard Hijacking**: Modifies VS Code documents directly via VS Code's TextEditor API in the background. Your physical keyboard and mouse remain completely free.
- 🌐 **Local HTTP Server (`:3333`)**: Push snippets, scripts, or complete multi-file projects directly into VS Code via standard `curl` requests or HTTP clients.
- 🧠 **Organic Thinking Pauses**: Pauses for 1.5s–3.0s every 25–60 characters to simulate human contemplation and problem-solving rhythm.
- 🎯 **QWERTY Proximity Typos & Corrections**:
  - ~8% typo probability on alphanumeric characters.
  - Generates realistic typos based on physical adjacent keys on a standard QWERTY keyboard (e.g., hitting `s`/`w` instead of `a`).
  - 25% chance of compound double-typos.
  - Naturally pauses, backspaces over mistakes, and retypes the correct character.
- ⏯️ **Live Status Bar Controls**:
  - Dedicated **Pause** (`⏸`) / **Resume** (`▶`) toggle in the VS Code status bar.
  - Dedicated **Stop** (`⏹`) button to immediately abort the typing queue.
- 💾 **Crash & Sleep Resilient (Checkpoints)**:
  - Checkpoints progress to disk after every single character.
  - On VS Code restart or system wake, prompts to seamlessly resume typing from the exact character where it left off.
- ☕ **macOS Sleep Prevention**: Automatically spawns and manages a `caffeinate` process during typing sessions to prevent system display sleep or suspension.
- 📁 **Automated File & Directory Creation**: Specify target file paths via query parameters (`?file=path/to/file.js`); HumanCoder automatically creates necessary parent directories and opens the buffer.

---

## 📦 Installation

### Option 1: Install Prebuilt `.vsix`
```bash
code --install-extension humancoder-1.0.0.vsix
```

### Option 2: Build & Package from Source
```bash
# 1. Install VS Code extension packager
npm install -g @vscode/vsce

# 2. Package the extension
vsce package --no-dependencies

# 3. Install the generated .vsix package
code --install-extension humancoder-1.0.0.vsix
```

### 🔄 Reload VS Code
Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux) → **Developer: Reload Window**.

Once loaded, you will see `$(broadcast) HumanCoder :3333` in the bottom status bar indicating the local server is listening.

---

## 🚀 Usage & API

### 1. Type into the Currently Active Editor Buffer
```bash
curl -X POST http://localhost:3333 --data-binary @index.js
```

### 2. Auto-Create & Type into a Specific File
```bash
curl -X POST "http://localhost:3333?file=src/utils/helpers.ts" --data-binary @helpers.ts
```

### 3. Create Deep Directory Trees on the Fly
```bash
curl -X POST "http://localhost:3333?file=frontend/src/components/Header.tsx" --data-binary @Header.tsx
```

### 4. Send Raw Inline Code or Text
```bash
curl -X POST http://localhost:3333 -d 'console.log("HumanCoder running live!");'
```

---

## ⚙️ Typing Engine Dynamics

| Event / Action | Duration / Frequency | Behavior |
|---|---|---|
| **Base Typing Speed** | 500ms – 800ms / char | Natural, deliberate typing rhythm (~20 WPM baseline) |
| **Punctuation Delay** | 1,200ms – 1,800ms | Extended pause on `.` `,` `;` `:` `{` `}` `(` `)` `[` `]` |
| **Newline Hesitation** | 800ms – 1,200ms | Brief pause when moving to a new line |
| **Thinking Interval** | 1,500ms – 3,000ms | Triggered randomly every 25–60 characters |
| **Typo Probability** | ~8% per char | Key proximity substitution based on physical QWERTY layout |
| **Double Typos** | ~25% of typo events | Types a secondary adjacent key before catching the mistake |
| **Typo Backspace Delay** | 150ms – 300ms / stroke | Human-like hesitation before and during deletion |

---

## ⌨️ VS Code Commands

Access these from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

- **`HumanCoder: Start Server`** — Starts the local HTTP listener on port `3333`.
- **`HumanCoder: Stop Server`** — Closes the HTTP server and clears any active typing sessions.
- **`HumanCoder: Resume After Sleep/Crash`** — Manually recovers and resumes an interrupted session from the saved checkpoint.

---

## 🛠️ Configuration & Customization

You can tweak the timing parameters directly in [`src/extension.js`](./src/extension.js):

```javascript
const MISTAKE_CHANCE   = 0.08; // 0.0 = flawless typing, 0.15 = frequent mistakes
const BASE_DELAY_MIN   = 500;  // Minimum keystroke delay (ms)
const BASE_DELAY_MAX   = 800;  // Maximum keystroke delay (ms)
const PUNCT_MIN        = 800;  // Minimum newline pause (ms)
const PUNCT_MAX        = 1200; // Maximum newline pause (ms)
```

After modifying settings, repackage with `vsce package --no-dependencies` and reinstall.

---

## 📄 License

MIT
