// Emoji catalog for the Emojis tab, grouped by what editors reach for. Strings split on spaces (some emojis are
// multi-codepoint, so never split per character).
const g = (s) => s.split(' ');

export const EMOJI_CATS = [
  ['caras', 'Caras', g('😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 😵‍💫 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👻 👽 🤖 😺 😸 😹 😻 😼 🙈 🙉 🙊')],
  ['gestos', 'Gestos', g('👍 👎 👏 🙌 👐 🤲 🙏 🤝 👊 ✊ 🤛 🤜 🤞 ✌️ 🤟 🤘 👌 🤌 🤏 👈 👉 👆 👇 ☝️ 🫵 ✋ 🤚 🖐️ 🖖 👋 🤙 💪 🦾 🫶 🫰 ✍️ 💅 🤳 👀 👁️ 👂 👃 🧠 🫀 👄 🫦 🦷 🙋 🙅 🙆 💁 🤷 🤦 🙇 🧏 🕺 💃 🏃 🚶 🧘')],
  ['corazones', 'Corazones', g('❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 🩷 🩵 🩶 ❤️‍🔥 ❤️‍🩹 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💌 💋 😘 😍 🥰 💑 💏 🌹')],
  ['redes', 'Redes y contenido', g('📱 📲 💻 🖥️ 📸 📷 📹 🎥 🎬 🎞️ 📽️ 🎙️ 🎤 🎧 📺 📻 🔴 ⏺️ ▶️ ⏸️ ⏯️ ⏹️ ⏭️ ⏮️ ⏩ ⏪ 🔁 🔂 🔊 🔇 🔔 🔕 📢 📣 💬 🗨️ 🗯️ 💭 👁️‍🗨️ 📩 📨 📧 📤 📥 🔗 #️⃣ 🆕 🆒 🆓 🆙 🔥 💯 ⭐ 🌟 ✨ 👑 🏷️ 📌 📍 🔖 📝 🗳️ 👥 🫂 🤳 🪩')],
  ['dinero', 'Dinero y negocios', g('💰 💵 💴 💶 💷 💸 💳 🪙 🤑 💲 💱 🏦 🏧 🧾 💹 📈 📉 📊 💼 🗂️ 📁 📋 📅 📆 🗓️ ⏰ ⌛ ⏳ 🎯 🏆 🥇 🥈 🥉 🏅 🎖️ 💎 🛒 🛍️ 🏪 🏬 🏢 🏭 🤝 📦 🚚 🔑 🗝️ 🔒 🔓 🧮 🖊️ ✏️ 📎 ✂️ 🧠 💡 🚀 📣 🧲 ⚖️')],
  ['senales', 'Flechas y señales', g('⬆️ ⬇️ ⬅️ ➡️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↩️ ↪️ ⤴️ ⤵️ 🔃 🔄 🔙 🔚 🔛 🔜 🔝 🔼 🔽 ⏫ ⏬ ✅ ☑️ ✔️ ❌ ❎ ✖️ ➕ ➖ ➗ ⭕ 🚫 ⛔ ⚠️ 🚨 ❗ ❕ ❓ ❔ ‼️ ⁉️ 💢 💥 💫 💦 💨 🕳️ 🔞 📵 🆗 🆘 🆚 ℹ️ 🔟 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 0️⃣ 🔢 🔤 💤 ♻️ 🔰 🔱 ⚜️')],
  ['fiesta', 'Celebración', g('🎉 🎊 🥳 🎈 🎁 🎀 🎂 🍰 🧁 🍾 🥂 🍻 🍹 🎆 🎇 ✨ 🪅 🪩 🎄 🎃 👻 🦃 🐣 🎅 🤶 🧑‍🎄 🕯️ 🎶 🎵 🎼 🎹 🥁 🎸 🎺 🎷 🪕 🎻 🏁 🎌 🎗️ 🎟️ 🎫')],
  ['comida', 'Comida y bebida', g('🍕 🍔 🍟 🌭 🥪 🌮 🌯 🥙 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍗 🍖 🥩 🥓 🍳 🥞 🧇 🥐 🍞 🥖 🧀 🥗 🥑 🍅 🌶️ 🌽 🥕 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🍿 🍩 🍪 🍫 🍬 🍭 🍦 🍨 ☕ 🍵 🧋 🥤 🧃 🍺 🍷 🥃 🍸')],
  ['naturaleza', 'Naturaleza y clima', g('☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 🌪️ 🌫️ 🌈 ☔ ⚡ 🔥 💧 🌊 🌙 🌛 🌝 🌚 🌞 ⭐ 🌟 🌠 🌌 🪐 🌍 🌎 🌏 🌋 🏔️ ⛰️ 🏝️ 🏖️ 🌵 🌴 🌲 🌳 🍀 🌿 🍁 🍂 🍃 🌸 🌺 🌻 🌼 🌷 💐 🍄')],
  ['animales', 'Animales', g('🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🕷️ 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦒 🦘 🐪 🐄 🐎 🐑 🐐 🦌 🐕 🐩 🐈 🐓 🦚 🦜 🦢 🦩 🐇 🦔 🐾')],
  ['objetos', 'Objetos y tecnología', g('⌚ 📱 💻 ⌨️ 🖱️ 🖨️ 🕹️ 🎮 👾 💾 💿 📀 🔋 🔌 💡 🔦 🕯️ 🧯 🛠️ 🔧 🔨 ⚙️ 🧰 🧪 🔬 🔭 📡 🛰️ 🧭 ⏱️ ⏲️ 🕰️ 📚 📖 📓 📒 📰 🗞️ 🎨 🖌️ 🖍️ 🧵 🧶 👓 🕶️ 🥽 🎒 👜 👟 👠 👕 👗 🧢 🎩 💍 💄 🪞 🛏️ 🚪 🪑 🛁 🧸 🪄 🔮 🧿 🎲 🧩 ♟️ 🎯 🪀 🪁')],
  ['viajes', 'Viajes y lugares', g('🚗 🚕 🚙 🏎️ 🚓 🚑 🚒 🚌 🚎 🛻 🚚 🏍️ 🛵 🚲 🛴 🛹 🚂 🚆 🚇 🚊 ✈️ 🛫 🛬 🚁 🚀 🛸 ⛵ 🚤 🛳️ ⚓ 🗺️ 🧳 🏠 🏡 🏘️ 🏰 🏯 🗼 🗽 🗿 🏟️ 🎡 🎢 🎠 ⛲ ⛺ 🌁 🌃 🏙️ 🌄 🌅 🌆 🌇 🌉 🎑 🛣️ 🚦 🚧 ⛽ 🏁')],
  ['deportes', 'Deportes y juegos', g('⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🏓 🏸 🏒 🏑 🥍 🏏 ⛳ 🥊 🥋 🎽 🛼 ⛸️ 🎿 🏂 🏋️ 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧗 🚴 🚵 🏊 🏄 🤽 🚣 🥇 🏆 🎮 🕹️ 🎲 🃏 🀄 🎳 🎰')],
  ['simbolos', 'Símbolos', g('♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ ☮️ ☯️ ✝️ ☪️ 🕉️ ✡️ 🔯 ♾️ ⚛️ ☢️ ☣️ 💠 🔷 🔶 🔹 🔸 🔺 🔻 🟥 🟧 🟨 🟩 🟦 🟪 🟫 ⬛ ⬜ 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ ♠️ ♥️ ♦️ ♣️ 🔈 🎦 ™️ ©️ ®️ 〰️ ➰ ➿ 💲 🏳️ 🏴 🏳️‍🌈 🚩')],
];

// Recently used (per user, this machine): convenience only, fine if storage is unavailable.
export function recentEmojis() {
  try { return JSON.parse(localStorage.getItem('recentEmojis') || '[]'); } catch { return []; }
}
export function pushRecentEmoji(e) {
  try { localStorage.setItem('recentEmojis', JSON.stringify([e, ...recentEmojis().filter((x) => x !== e)].slice(0, 24))); } catch { /* ignore */ }
}
