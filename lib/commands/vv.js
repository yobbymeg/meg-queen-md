/** .vv — Download view-once media and send PRIVATELY to bot owner's DM */
module.exports = {
  name: 'vv',
  aliases: ['viewonce', 'rvo', 'view'],
  desc: 'Unlock view-once media — sends to your DM privately',
  category: 'media',
  async execute({ sock, msg, from, reply, dbSession }) {
    const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted) return reply('❌ Reply to a view-once message.\nUsage: `.vv` (reply to view-once)');

    let mediaMessage, type, mimetype;
    if (quoted.viewOnceMessageV2?.message?.imageMessage) {
      mediaMessage = quoted.viewOnceMessageV2.message.imageMessage;
      type = 'image';
      mimetype = mediaMessage.mimetype;
    } else if (quoted.viewOnceMessageV2?.message?.videoMessage) {
      mediaMessage = quoted.viewOnceMessageV2.message.videoMessage;
      type = 'video';
      mimetype = mediaMessage.mimetype;
    } else if (quoted.imageMessage) {
      mediaMessage = quoted.imageMessage;
      type = 'image';
      mimetype = mediaMessage.mimetype;
    } else if (quoted.videoMessage) {
      mediaMessage = quoted.videoMessage;
      type = 'video';
      mimetype = mediaMessage.mimetype;
    } else if (quoted.audioMessage) {
      mediaMessage = quoted.audioMessage;
      type = 'audio';
      mimetype = mediaMessage.mimetype;
    }

    if (!mediaMessage) return reply('❌ No view-once media found in the replied message.');

    try {
      // Download the media
      const stream = await downloadContentFromMessage(mediaMessage, type);
      let buffer = Buffer.alloc(0);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

      // ★ Send PRIVATELY to owner's DM (not in the chat where .vv was used)
      const ownerNumber = dbSession?.phoneNumber;
      if (!ownerNumber) {
        return reply('❌ Could not determine owner number. Media not sent.');
      }

      const ownerJid = `${ownerNumber}@s.whatsapp.net`;

      // Send confirmation in the current chat (text only — no media shown here)
      await reply('🔒 *View-once media unlocked!*\n\n_Sent privately to your DM_ ✅');

      // Send the actual media to owner's DM
      const senderName = msg.pushName || 'Unknown';
      const chatName = from.endsWith('@g.us') ? 'Group' : 'DM';
      const caption = `🔓 *View-once media unlocked*\n\n👤 *From:* ${senderName}\n💬 *Chat:* ${chatName}\n📅 *Time:* ${new Date().toLocaleString()}`;

      if (type === 'image') {
        await sock.sendMessage(ownerJid, { image: buffer, caption });
      } else if (type === 'video') {
        await sock.sendMessage(ownerJid, { video: buffer, caption, mimetype });
      } else if (type === 'audio') {
        await sock.sendMessage(ownerJid, { audio: buffer, mimetype: 'audio/mpeg', caption });
      }

      console.log(`[VV] Sent view-once ${type} to owner DM (${ownerNumber})`);
    } catch (e) {
      await reply(`❌ Failed: ${e.message}`);
    }
  },
};
