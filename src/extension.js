const vscode = require('vscode');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

let server = null;
let statusBar = null;
let pauseBar = null;
let stopBar = null;

// ─── State ────────────────────────────────────────────────────────────────────
let isPaused = false;
let isStopped = false;
let isTyping = false;
let caffeinateProcess = null;

function startCaffeinate() {
  if (process.platform !== 'darwin') return;
  if (caffeinateProcess) return;
  try {
    caffeinateProcess = cp.spawn('caffeinate', ['-d', '-i']);
    log('caffeinate started');
  } catch (e) {
    log(`Failed to start caffeinate: ${e.message}`);
  }
}

function stopCaffeinate() {
  if (!caffeinateProcess) return;
  try {
    caffeinateProcess.kill();
    log('caffeinate stopped');
  } catch (e) {
    log(`Failed to stop caffeinate: ${e.message}`);
  }
  caffeinateProcess = null;
}

const LOG_FILE = path.join(require('os').tmpdir(), 'humancoder_log.txt');

function log(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch(e) {}
}

process.on('uncaughtException', err => log(`UNCAUGHT: ${err.message}\n${err.stack}`));
process.on('unhandledRejection', err => log(`UNHANDLED: ${err}`));

// ─── Activate ─────────────────────────────────────────────────────────────────
function activate(context) {
  // Main status bar (server toggle)
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 103);
  statusBar.text = '$(circle-outline) HumanCoder';
  statusBar.tooltip = 'HumanCoder idle — click to start server';
  statusBar.command = 'humancoder.start';
  statusBar.show();

  // Pause/Resume button — only visible while typing
  pauseBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102);
  pauseBar.text = '$(debug-pause) Pause';
  pauseBar.tooltip = 'Pause typing';
  pauseBar.command = 'humancoder.pause';

  // Stop button — only visible while typing
  stopBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
  stopBar.text = '$(debug-stop) Stop';
  stopBar.tooltip = 'Stop typing';
  stopBar.command = 'humancoder.stopTyping';

  context.subscriptions.push(
    vscode.commands.registerCommand('humancoder.start', startServer),
    vscode.commands.registerCommand('humancoder.stop', stopServer),
    vscode.commands.registerCommand('humancoder.pause', togglePause),
    vscode.commands.registerCommand('humancoder.stopTyping', stopTyping),
    vscode.commands.registerCommand('humancoder.resumeCheckpoint', resumeFromCheckpoint),
    statusBar, pauseBar, stopBar
  );

  startServer();
  checkForStalledCheckpoint();
}

// ─── Resume after sleep/crash ────────────────────────────────────────────────
function checkForStalledCheckpoint() {
  const cp = loadCheckpoint();
  if (!cp) return;
  const minutesAgo = Math.round((Date.now() - cp.ts) / 60000);
  vscode.window
    .showWarningMessage(
      `HumanCoder: found an unfinished typing session (stopped ~${minutesAgo} min ago, ${cp.index}/${cp.content.length} chars done). Resume it?`,
      'Resume', 'Discard'
    )
    .then(choice => {
      if (choice === 'Resume') resumeFromCheckpoint();
      else clearCheckpoint();
    });
}

async function resumeFromCheckpoint() {
  const cp = loadCheckpoint();
  if (!cp) {
    vscode.window.showInformationMessage('HumanCoder: no saved session to resume.');
    return;
  }

  isStopped = false;
  isPaused = false;
  openPauseGate();
  showTypingControls(true);
  startCaffeinate();

  try {
    if (cp.filePath === '__ACTIVE_EDITOR__') {
      await typeIntoActiveEditor(cp.content, cp.index);
    } else {
      await typeIntoNewFile(cp.filePath, cp.content, cp.index);
    }
  } finally {
    showTypingControls(false);
    stopCaffeinate();
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────
function startServer() {
  if (server) {
    vscode.window.showInformationMessage('HumanCoder is already running on port 3333.');
    return;
  }

  server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405); res.end('Use POST.'); return;
    }

    const url = new URL(req.url, 'http://localhost:3333');
    let body = '';
    req.on('data', chunk => (body += chunk.toString()));
    req.on('end', async () => {
      try {
        const filePath = url.searchParams.get('file') || null;
        if (!body.trim()) { res.writeHead(400); res.end('No content.'); return; }

        res.writeHead(200); res.end('OK — typing started.\n');

        log(`SESSION START — ${body.length} chars, file: ${filePath || 'active editor'}`);
        isStopped = false;
        isPaused = false;
        showTypingControls(true);
        startCaffeinate();
        await sleepCheckingState(10000); // 10‑second delay before typing begins
        saveSessionContent(body);

        if (filePath) await typeIntoNewFile(filePath, body);
        else await typeIntoActiveEditor(body);

        log(`SESSION END — isStopped=${isStopped}`);
        showTypingControls(false);
        stopCaffeinate();
      } catch (err) {
        log(`SERVER ERROR: ${err.message}\n${err.stack}`);
        console.error('HumanCoder error:', err);
        showTypingControls(false);
        stopCaffeinate();
      }
    });
  });

  // Aggressive keepalive: write to disk every 5s to keep Node event loop truly alive
  // A no-op status bar touch isn't enough — VS Code can still suspend the host
  const KEEPALIVE_FILE = path.join(require('os').tmpdir(), 'humancoder_keepalive');
  const keepalive = setInterval(() => {
    try { fs.writeFileSync(KEEPALIVE_FILE, Date.now().toString()); } catch(e) {}
  }, 5000);

  server.listen(3333, '127.0.0.1', () => {
    statusBar.text = '$(broadcast) HumanCoder :3333';
    statusBar.tooltip = 'HumanCoder running — click to stop server';
    statusBar.command = 'humancoder.stop';
    vscode.window.showInformationMessage('HumanCoder started on http://localhost:3333');
  });

  server.on('close', () => clearInterval(keepalive));

  server.on('error', err => {
    vscode.window.showErrorMessage(`HumanCoder: ${err.message}`);
    server = null;
  });
}

function stopServer() {
  if (!server) { vscode.window.showInformationMessage('HumanCoder is not running.'); return; }
  isStopped = true;
  openPauseGate();
  server.close(() => {
    server = null;
    statusBar.text = '$(circle-outline) HumanCoder';
    statusBar.tooltip = 'HumanCoder idle — click to start server';
    statusBar.command = 'humancoder.start';
    showTypingControls(false);
    vscode.window.showInformationMessage('HumanCoder stopped.');
  });
}

// ─── Pause / Stop typing controls ────────────────────────────────────────────
function togglePause() {
  if (!isTyping) return;
  if (isPaused) {
    isPaused = false;
    openPauseGate();
    startCaffeinate();
    pauseBar.text = '$(debug-pause) Pause';
    pauseBar.tooltip = 'Pause typing';
    statusBar.text = '$(broadcast) HumanCoder :3333';
    vscode.window.showInformationMessage('HumanCoder resumed ▶');
  } else {
    isPaused = true;
    closePauseGate();
    stopCaffeinate();
    pauseBar.text = '$(debug-continue) Resume';
    pauseBar.tooltip = 'Resume typing';
    statusBar.text = '$(debug-pause) HumanCoder: paused';
    vscode.window.showInformationMessage('HumanCoder paused ⏸ — click Resume to continue');
  }
}

function stopTyping() {
  if (!isTyping) return;
  isStopped = true;
  isPaused = false;
  openPauseGate(); // unblock any waiting sleeps so the loop can exit
  clearCheckpoint();
  stopCaffeinate();
  statusBar.text = '$(broadcast) HumanCoder :3333';
  showTypingControls(false);
  vscode.window.showInformationMessage('HumanCoder: typing stopped ⏹');
}

function showTypingControls(visible) {
  isTyping = visible;
  if (visible) { pauseBar.show(); stopBar.show(); }
  else { pauseBar.hide(); stopBar.hide(); }
}

// ─── Typing helpers ───────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function typo(char) {
  const qwerty = {
    a: 'sqwz', b: 'vghn', c: 'xdfv', d: 'erfcs', e: 'wrds',
    f: 'rtgvd', g: 'tyhbf', h: 'yunji', i: 'uojk', j: 'uiknh',
    k: 'iolmj', l: 'opk', m: 'njk', n: 'bhjm', o: 'ipkl',
    p: 'ol', q: 'wa', r: 'etfd', s: 'wedaz', t: 'ryfg',
    u: 'yhji', v: 'cfgb', w: 'qase', x: 'zsdc', y: 'tugj',
    z: 'asx', ' ': ' cv',
  };
  const lower = char.toLowerCase();
  const neighbors = qwerty[lower];
  if (!neighbors) return char;
  const wrong = neighbors[Math.floor(Math.random() * neighbors.length)];
  return char === char.toUpperCase() ? wrong.toUpperCase() : wrong;
}

// ─── Pause gate — single shared promise ──────────────────────────────────────
let pauseGate = Promise.resolve();
let pauseGateResolve = null;

function openPauseGate() {
  if (pauseGateResolve) { pauseGateResolve(); pauseGateResolve = null; }
  pauseGate = Promise.resolve();
}

function closePauseGate() {
  pauseGate = new Promise(resolve => { pauseGateResolve = resolve; });
}

async function waitIfPaused() {
  await pauseGate;
}

// ─── Pause-aware sleep ────────────────────────────────────────────────────────
async function sleepCheckingState(ms) {
  const CHUNK = 100;
  let elapsed = 0;
  while (elapsed < ms) {
    if (isStopped) return;
    await waitIfPaused();
    if (isStopped) return;
    await sleep(Math.min(CHUNK, ms - elapsed));
    elapsed += CHUNK;
  }
}

// ─── Type into editors ────────────────────────────────────────────────────────
async function typeIntoActiveEditor(content, startIndex = 0) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showErrorMessage('HumanCoder: No active editor.'); return; }
  await typeContent(editor, content, startIndex, '__ACTIVE_EDITOR__');
}

async function typeIntoNewFile(filePath, content, startIndex = 0) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let fullPath = filePath;
  if (!path.isAbsolute(filePath) && workspaceFolders && workspaceFolders.length > 0) {
    fullPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
  }
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(fullPath)) fs.writeFileSync(fullPath, '');
  const uri = vscode.Uri.file(fullPath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  await typeContent(editor, content, startIndex, fullPath);
}

// ─── Core typing engine ───────────────────────────────────────────────────────
const STATE_FILE = path.join(require('os').tmpdir(), 'humancoder_state.json');
const CONTENT_FILE = path.join(require('os').tmpdir(), 'humancoder_content.txt');

function saveSessionContent(content) {
  try {
    fs.writeFileSync(CONTENT_FILE, content);
  } catch (e) { /* non-fatal */ }
}

function saveCheckpoint(filePath, index) {
  try {
    fs.writeFile(STATE_FILE, JSON.stringify({ filePath, index, ts: Date.now() }), () => {});
  } catch (e) { /* non-fatal */ }
}

function clearCheckpoint() {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    if (fs.existsSync(CONTENT_FILE)) fs.unlinkSync(CONTENT_FILE);
  } catch (e) { /* non-fatal */ }
}

function loadCheckpoint() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const cpData = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (fs.existsSync(CONTENT_FILE)) {
      cpData.content = fs.readFileSync(CONTENT_FILE, 'utf8');
    } else {
      return null;
    }
    return cpData;
  } catch (e) { return null; }
}

async function typeContent(editor, content, startIndex = 0, checkpointFilePath = null) {
  const MISTAKE_CHANCE   = 0.08; // increased typo chance
  const BASE_DELAY_MIN   = 500; // approx 20 wpm base delay
  const BASE_DELAY_MAX   = 800;
  const PUNCT_MIN        = 800; // longer pause after newline
  const PUNCT_MAX        = 1200; // longer pause after newline
  let charsSinceThink = 0;
  let nextThinkAt     = randomBetween(25, 60);

  for (let i = startIndex; i < content.length; i++) {
    if (isStopped) break;

    // Check for pause at every iteration
    await waitIfPaused();
    if (isStopped) break;

    const char = content[i];

    // Save checkpoint every char so a sleep/crash mid-typing can resume here
    saveCheckpoint(checkpointFilePath, i);

    // Log progress every 100 chars
    if (i % 100 === 0) log(`PROGRESS: ${i}/${content.length} chars`);

    // Thinking pause every 25–60 chars
    charsSinceThink++;
    if (charsSinceThink >= nextThinkAt) {
      await sleepCheckingState(randomBetween(1500, 3000)); // longer thinking pause
      if (isStopped) break;
      charsSinceThink = 0;
      nextThinkAt = randomBetween(25, 60);
    }

    // Typo
    const isTypeable = /[a-zA-Z0-9]/.test(char);
    if (isTypeable && Math.random() < MISTAKE_CHANCE) {
      await insertChar(editor, typo(char));
      await sleepCheckingState(randomBetween(200, 400));
      if (isStopped) break;

      const extraWrong = Math.random() < 0.25 ? 1 : 0;
      for (let e = 0; e < extraWrong; e++) {
        await insertChar(editor, typo(char));
        await sleepCheckingState(randomBetween(200, 350));
        if (isStopped) break;
      }
      if (isStopped) break;

      await sleepCheckingState(randomBetween(400, 900));
      if (isStopped) break;

      for (let d = 0; d < 1 + extraWrong; d++) {
        await backspace(editor);
        await sleepCheckingState(randomBetween(150, 300));
        if (isStopped) break;
      }
      if (isStopped) break;

      await sleepCheckingState(randomBetween(200, 500));
      if (isStopped) break;
    }

    await insertChar(editor, char);

    if (char === '\n') {
      await sleepCheckingState(randomBetween(PUNCT_MIN, PUNCT_MAX));
    } else if (/[.;:,{}()[\]]/.test(char)) {
      await sleepCheckingState(randomBetween(1200, 1800)); // longest pause after punctuation
    } else {
      await sleepCheckingState(randomBetween(BASE_DELAY_MIN, BASE_DELAY_MAX));
    }
  }

  // Finished naturally or stopped — clear the checkpoint either way
  if (!isStopped) clearCheckpoint();
}

async function insertChar(editor, char) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const ok = await editor.edit(eb => eb.insert(editor.selection.active, char));
      if (ok) return;
      log(`insertChar failed attempt ${attempt + 1} for char: ${JSON.stringify(char)}`);
    } catch(e) {
      log(`insertChar error attempt ${attempt + 1}: ${e.message}`);
    }
    await sleep(200);
  }
  log(`insertChar GAVE UP on char: ${JSON.stringify(char)}`);
}

async function backspace(editor) {
  const pos = editor.selection.active;
  if (pos.character === 0 && pos.line === 0) return;
  const prevPos = pos.character > 0
    ? new vscode.Position(pos.line, pos.character - 1)
    : new vscode.Position(pos.line - 1, editor.document.lineAt(pos.line - 1).text.length);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const ok = await editor.edit(eb => eb.delete(new vscode.Range(prevPos, pos)));
      if (ok) return;
    } catch(e) {}
    await sleep(200);
  }
}

function deactivate() {
  isStopped = true;
  stopCaffeinate();
  if (server) server.close();
}

module.exports = { activate, deactivate };
