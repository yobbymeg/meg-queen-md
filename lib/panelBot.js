/**
 * MEGH ULTRA — Panel Bot (single-user, SESSION_ID-based)
 *
 * Used when deployed on Pterodactyl with env var SESSION_ID.
 * Flow:
 *   1. Read SESSION_ID from env (format: megh-ultra:~XXXXX)
 *   2. Fetch base64 creds from the pairing tool: PAIRING_API_URL/api/get-creds/SESSION_ID
 *   3. Decode creds → write to auth_state/ folder
 *   4. Start Baileys with Chrome browser, markOnlineOnConnect: false
 *   5. On connect: send CONNECTED banner to owner, register all commands/anti handlers
 *   6. Cache creds locally in SQLite so subsequent restarts don't re-fetch
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} = require('@whiskeysockets/baileys');
const P = require('pino');

const { handleMessage, handleAnti } = require('./handler');

// ============ Config ============
const SESSION_ID = process.env.SESSION_ID || '';
const PAIRING_API_URL = process.env.PAIRING_API_URL || 'https://megh-pairing.onrender.com';
const BOT_NAME = process.env.BOT_NAME || 'MEGH MD ULTRA';
const OWNER_NAME = process.env.OWNER_NAME || '®killer🫟';
const PREFIX = process.env.PREFIX || '.';
const REPO_URL = process.env.REPO_URL || 'https://github.com/yobbymeg/meg-queen-md';
const AUTH_DIR = path.join(__dirname, '..', 'auth_state');

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

const logger = P({ level: 'warn' }, P.destination({ sync: true }));

let sock = null;
let connectionState = { connected: false, user: null, startedAt: null, ownerJid: null };

// ============ Helpers ============
function formatTime(date = new Date()) {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  const mm = String(m).padStart(2, '0');
  return `${hh}:${mm} ${ampm}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Render the CONNECTED banner with the current time.
 */
function connectedBanner() {
  return `┏━━━━━━✧ CONNECTED ✧━━━━━━━
┃✧ Bot: ${BOT_NAME}
┃✧ Prefix: [ ${PREFIX} ]
┃✧ Owner: ${OWNER_NAME}
┃✧ Platform: 🖥️ Panel
┃✧ Status: online
┃✧ Time: ${formatTime()}
┃✧ Repo: ${REPO_URL}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

/**
 * Decode base64 creds → write each file to auth_state/.
 * creds format: { filename: base64contents, ... }
 */
function decodeCredsToAuthDir(credsBase64, authDir) {
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
  const creds = JSON.parse(Buffer.from(credsBase64, 'base64').toString('utf8'));
  let count = 0;
  for (const [fname, b64] of Object.entries(creds)) {
    const fpath = path.join(authDir, fname);
    fs.writeFileSync(fpath, Buffer.from(b64, 'base64'));
    count++;
  }
  return count;
}

/**
 * Fetch creds from the pairing tool API.
 * Returns base64 string, or throws on error.
 */
async function fetchCreds(sessionId) {
  if (!sessionId) throw new Error('SESSION_ID env var is required');
  if (!PAIRING_API_URL) throw new Error('PAIRING_API_URL env var is required');

  console.log(`[PANEL] Fetching creds for ${sessionId} from ${PAIRING_API_URL}...`);
  const r = await axios.get(`${PAIRING_API_URL}/api/get-creds/${encodeURIComponent(sessionId)}`, {
    timeout: 30000,
    validateStatus: () => true,
  });

  if (r.status !== 200) {
    throw new Error(`Pairing API returned ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
  }

  if (!r.data?.creds_base64) throw new Error('Pairing API returned no creds_base64');
  console.log(`[PANEL] Got ${r.data.creds_base64.length} base64 chars (owner: ${r.data.owner_phone})`);
  return r.data.creds_base64;
}

/**
 * Boot the panel bot.
 */
async function startPanelBot() {
  if (!SESSION_ID) {
    console.error('[PANEL] FATAL: SESSION_ID env var is not set.');
    console.error('[PANEL] Set it to a megh-ultra:~XXXXX session ID obtained from the pairing tool.');
    process.exit(1);
  }

  // 1. Fetch creds (if auth_state is empty)
  const authFiles = fs.existsSync(AUTH_DIR) ? fs.readdirSync(AUTH_DIR) : [];
  if (authFiles.length === 0) {
    try {
      const credsB64 = await fetchCreds(SESSION_ID);
      const n = decodeCredsToAuthDir(credsB64, AUTH_DIR);
      console.log(`[PANEL] ✓ Wrote ${n} auth files to ${AUTH_DIR}`);
    } catch (e) {
      console.error('[PANEL] Failed to fetch creds:', e.message);
      process.exit(2);
    }
  } else {
    console.log(`[PANEL] Using cached auth_state (${authFiles.length} files)`);
  }

  // 2. Connect Baileys
  await connectSock();
}

async function connectSock() {
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[PANEL] Baileys v${version} (latest: ${isLatest})`);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    // ★ Chrome browser fingerprint — must look like a real browser
    browser: Browsers.appropriate('Chrome'),
    defaultQueryTimeoutMs: 120000,
    connectTimeoutMs: 120000,
    keepAliveIntervalMs: 30000,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    linkPreview: false,
    retryRequestDelayMs: 2000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, receivedPendingNotifications } = update;
    console.log(`[PANEL] connection.update:`, JSON.stringify({ connection, code: lastDisconnect?.error?.output?.statusCode, receivedPendingNotifications }));

    if (connection === 'open') {
      const user = sock.user;
      connectionState = {
        connected: true,
        user: { id: user.id, name: user.name },
        ownerJid: user.id,
        startedAt: Date.now(),
      };
      console.log(`[PANEL] ✓ Connected as ${user.id.split(':')[0]}`);

      // Send CONNECTED banner to owner
      try {
        await sock.sendMessage(user.id, { text: connectedBanner() });
        console.log('[PANEL] Sent CONNECTED banner');
      } catch (e) {
        console.error('[PANEL] Failed to send banner:', e.message);
      }
    } else if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = code === DisconnectReason.loggedOut;
      console.log(`[PANEL] closed: code=${code} loggedOut=${isLoggedOut}`);

      if (isLoggedOut) {
        // Session was revoked — wipe and prompt re-pair
        console.error('[PANEL] Session logged out. Wiping auth_state.');
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        fs.mkdirSync(AUTH_DIR, { recursive: true });
        process.exit(10);
      }

      // Reconnect for transient errors
      setTimeout(() => {
        connectSock().catch((e) => console.error('[PANEL] reconnect failed:', e.message));
      }, 2500);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        // Build a fake dbSession that matches what the multi-user server expects
        const ownerPhone = connectionState.ownerJid?.split(':')[0]?.split('@')[0] || '';
        const dbSession = {
          id: 'panel_session',
          phoneNumber: ownerPhone,
          displayName: connectionState.user?.name || OWNER_NAME,
          prefix: PREFIX,
          mode: 'public',
          commandsExecuted: 0,
          messagesReceived: 0,
          messagesSent: 0,
        };

        await handleMessage(sock, msg, dbSession);
        await handleAnti(sock, msg, dbSession);
      } catch (e) {
        console.error('[PANEL] msg handler error:', e.message);
      }
    }
  });

  // Anti-call
  sock.ev.on('call', async (calls) => {
    try {
      for (const call of calls) {
        if (call.status === 'offer') {
          await sock.rejectCall(call.id, call.from);
          const ownerPhone = connectionState.ownerJid?.split(':')[0]?.split('@')[0] || '';
          await sock.sendMessage(call.from, {
            text: `🚫 Calls are rejected. ${BOT_NAME} is a bot — use ${PREFIX}menu in chat.`,
          });
        }
      }
    } catch {}
  });
}

module.exports = { startPanelBot, connectedBanner, formatTime };
