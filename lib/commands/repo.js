/**
 * .repo — Show the bot's GitHub repo + owner contact
 *
 * Shows the yobbymeg URL + owner contact info.
 */

module.exports = {
  name: 'repo',
  aliases: ['github', 'source', 'code', 'script'],
  desc: 'Show bot repository + owner contact',
  category: 'info',
  async execute({ reply, botName }) {
    await reply(
      `┏▣ ◈ *${botName} REPOSITORY* ◈
┗▣


🤖 *This Mini Bot:*
https://github.com/xtechkin-svg/yobbymeg

👑 *Owner:* Yobby King
📱 *WhatsApp:* wa.me/254795314221
💬 *Telegram:* @yobby_king

╭═══════════════════════✦═╗
║  *Enjoy yobby king* 👑      ║
╚═══════════════════════✦═╝

_🌟 Star the repo if you like the bot!_
_🚀 Powered by ${botName} X YOBBY_

\`for premium Whatsapp bot dm\``
    );
  },
};
