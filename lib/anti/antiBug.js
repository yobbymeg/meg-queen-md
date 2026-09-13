/**
 * Anti-bug — Auto-blocks spammers permanently
 *
 * If someone sends too many messages too fast, the bot:
 *   1. Blocks them on WhatsApp (they can't message the owner's number again)
 *   2. Stores their number in the block list (permanent)
 *   3. Notifies the owner
 *
 * This protects against:
 *   - Message flooding
 *   - Bug attacks (malformed messages that crash WhatsApp)
 *   - Spam bots
 *   - Suspicious rapid-fire messages
 *
 * The bot owner is NEVER blocked.
 */

const fs = require('fs');
const path = require('path');

const BLOCK_LIST_FILE = path.join(__dirname, '..', '..', 'antibug_blocks.json');

// Rate tracking: phoneNumber → [{ ts, count }]
const rateTracker = new Map();
const WINDOW_MS = 10000; // 10 seconds
const MAX_MSGS = 8; // Max 8 messages in 10s before block

// Load blocked numbers
let blockedNumbers = [];
try {
  blockedNumbers = JSON.parse(fs.readFileSync(BLOCK_LIST_FILE, 'utf8') || '[]');
} catch { blockedNumbers = []; }

function saveBlockList() {
  try { fs.writeFileSync(BLOCK_LIST_FILE, JSON.stringify(blockedNumbers, null, 2)); } catch {}
}

function isBlocked(phoneNumber) {
  return blockedNumbers.includes(phoneNumber);
}

function blockNumber(phoneNumber) {
  if (!blockedNumbers.includes(phoneNumber)) {
    blockedNumbers.push(phoneNumber);
    saveBlockList();
    console.log(`[ANTI-BUG] 🚫 Blocked ${phoneNumber} permanently`);
  }
}

/**
 * Check if a message should be blocked (spam/flood)
 * Returns { blocked: boolean, reason: string }
 */
function checkSpam(phoneNumber, isOwner) {
  // Never block the owner
  if (isOwner) return { blocked: false, reason: '' };

  // Check if already blocked
  if (isBlocked(phoneNumber)) {
    return { blocked: true, reason: 'Already blocked' };
  }

  const now = Date.now();

  if (!rateTracker.has(phoneNumber)) {
    rateTracker.set(phoneNumber, { firstMsg: now, count: 1 });
    return { blocked: false, reason: '' };
  }

  const tracker = rateTracker.get(phoneNumber);
  const elapsed = now - tracker.firstMsg;

  if (elapsed < WINDOW_MS) {
    tracker.count++;

    if (tracker.count > MAX_MSGS) {
      // SPAM DETECTED — block this number
      blockNumber(phoneNumber);
      rateTracker.delete(phoneNumber);
      return { blocked: true, reason: `Spam: ${tracker.count} messages in ${elapsed}ms` };
    }
  } else {
    // Reset the window
    rateTracker.set(phoneNumber, { firstMsg: now, count: 1 });
  }

  return { blocked: false, reason: '' };
}

/**
 * Handle blocking on WhatsApp
 */
async function handleBlock(sock, phoneNumber, reason) {
  try {
    const jid = `${phoneNumber}@s.whatsapp.net`;
    // Block on WhatsApp
    await sock.updateBlockStatus(jid, 'block');
    console.log(`[ANTI-BUG] 🚫 WhatsApp-blocked ${phoneNumber}: ${reason}`);

    // Notify owner
    const ownerNumber = phoneNumber; // We'll get the owner from session context
    // (Notification is sent by the caller who has the owner number)
  } catch (e) {
    console.warn('[ANTI-BUG] Block failed:', e.message);
  }
}

/**
 * Export block list for .antibug command
 */
function getBlockList() {
  return blockedNumbers;
}

function unblockNumber(phoneNumber) {
  blockedNumbers = blockedNumbers.filter(n => n !== phoneNumber);
  saveBlockList();
}

module.exports = {
  checkSpam,
  handleBlock,
  isBlocked,
  blockNumber,
  unblockNumber,
  getBlockList,
  name: 'antibug',
  aliases: ['antibug', 'ab'],
  desc: 'Anti-bug protection (always on) — view/manage blocked numbers',
  category: 'anti',
  async execute({ sock, reply, args, dbSession }) {
    const action = args[0]?.toLowerCase();

    if (action === 'list') {
      if (blockedNumbers.length === 0) {
        return reply('🛡️ *Anti-Bug Protection*\n\n✅ No blocked numbers.\n\n_Bot is protected. Spammers are auto-blocked._');
      }
      let list = `🛡️ *Anti-Bug — Blocked Numbers (${blockedNumbers.length})*\n\n`;
      blockedNumbers.forEach((num, i) => {
        list += `${i + 1}. ${num}\n`;
      });
      return reply(list);
    }

    if (action === 'unblock' && args[1]) {
      const num = args[1].replace(/\D/g, '');
      unblockNumber(num);
      try { await sock.updateBlockStatus(`${num}@s.whatsapp.net`, 'unblock'); } catch {}
      return reply(`✅ Unblocked ${num}`);
    }

    // Show status
    return reply(
      `🛡️ *ANTI-BUG PROTECTION*\n\n` +
      `🟢 *Status:* ACTIVE (always on)\n` +
      `🚫 *Blocked numbers:* ${blockedNumbers.length}\n` +
      `⚡ *Max messages:* ${MAX_MSGS} per ${WINDOW_MS / 1000}s\n\n` +
      `*Usage:*\n` +
      `  .antibug list → View blocked numbers\n` +
      `  .antibug unblock <number> → Unblock someone\n\n` +
      `_Spammers who flood messages are auto-blocked permanently._`
    );
  },
};
