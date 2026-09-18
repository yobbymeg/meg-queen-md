/**
 * MEGH ULTRA — createFakeContact helper
 *
 * Wraps a fake "contact message" around replies so the bot's reply
 * appears quoted to a contact card showing the bot's name (MEGH MD).
 *
 * Usage:
 *   const { createFakeContact } = require('./createFakeContact');
 *   await sock.sendMessage(jid, { text: 'hi' }, { quoted: createFakeContact(msg) });
 *
 * Reads botName from db.getBotSetting() (legacy) or env BOT_NAME fallback.
 */

const BOT_NAME_FALLBACK = process.env.BOT_NAME || 'MEGH MD';

function createFakeContact(msg) {
  let botName = BOT_NAME_FALLBACK;
  try {
    const db = require('./db');
    if (db.getBotSetting) {
      const v = db.getBotSetting('botName');
      if (v) botName = v;
    }
  } catch {}

  const participantId = (msg && (msg.key.participant || msg.key.remoteJid)) || '0';
  const cleanId = String(participantId).split(':')[0].split('@')[0] || '0';

  return {
    key: {
      participants: '0@s.whatsapp.net',
      remoteJid: '0@s.whatsapp.net',
      fromMe: false,
      id: 'MEGHULTRA' + Math.random().toString(36).substring(2, 12).toUpperCase(),
    },
    message: {
      contactMessage: {
        displayName: botName,
        vcard:
          'BEGIN:VCARD\nVERSION:3.0\n' +
          'N:Sy;Bot;;;\n' +
          `FN:${botName}\n` +
          `item1.TEL;waid=${cleanId}:${cleanId}\n` +
          'item1.X-ABLabel:Phone\n' +
          'END:VCARD',
      },
    },
    participant: '0@s.whatsapp.net',
  };
}

module.exports = { createFakeContact };
