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

// Spanish search words → emojis. ponytail: hand-picked common words, not a full CLDR dictionary; add words as asked.
const KW = `dinero plata pago rico:💰 💵 💸 🤑 💲 💳 🪙 🏦 💎|fuego caliente hot:🔥 ❤️‍🔥 🌶️ 🥵 💥|amor corazon:❤️ 😍 🥰 💕 💖 💘 😘 🫶 💋
risa reir gracioso jaja:😂 🤣 😆 😹 😅|triste llorar:😢 😭 😞 😔 💔 🥺|enojo enojado furia:😠 😡 🤬 💢 👿|sorpresa wow:😮 😲 🤯 😱 🙀 😳
pensar idea duda:🤔 💡 🧠 ❓ 💭|ok bien si like:👍 👌 ✅ ✔️ 👏 🙌|no mal error:👎 ❌ 🚫 ⛔ 🙅|fiesta celebrar cumpleaños:🎉 🥳 🎊 🎂 🎈 🎁 🍾 🥂
musica cancion:🎵 🎶 🎧 🎤 🎸 🎹 🥁|video camara grabar:🎥 📹 🎬 📸 📷 🔴|telefono celular movil:📱 📲 ☎️|computadora pc:💻 🖥️ ⌨️ 🖱️
tiempo reloj hora:⏰ ⌛ ⏳ ⏱️ 🕐|ganar exito premio trofeo:🏆 🥇 🏅 🎯 📈 🚀|perder caida:📉 💀 😵|cohete rapido:🚀 ⚡ 💨 🏎️
estrella brillo magia:⭐ 🌟 ✨ 💫 🪄|sol verano playa:☀️ 🌞 🏖️ 🌴 🌊|lluvia frio invierno nieve:🌧️ ☔ ❄️ ☃️ 🥶|noche luna dormir:🌙 😴 💤 🌃
comida hambre:🍕 🍔 🍟 🌮 🍣 🍩 😋|cafe:☕|bebida brindis:🥂 🍻 🍹 🍷|perro:🐶 🐕|gato:🐱 🐈 😺|flor planta:🌹 🌸 🌻 🌷 🌱
mirar ver ojos:👀 👁️ 🧐|mano saludo hola adios:👋 🙋 🤙|fuerza fuerte gym:💪 🏋️ 🦾|rezar gracias por favor:🙏|secreto silencio:🤫 🤐
genial cool:😎 🆒 🤩|muerto calavera:💀 ☠️ 👻|bomba explosion boom:💣 💥 🧨|alerta atencion importante:⚠️ 🚨 ❗ ‼️ 📢
flecha arriba:⬆️ 👆 🔝|flecha abajo:⬇️ 👇|derecha:➡️ 👉|izquierda:⬅️ 👈|nuevo:🆕 ✨|gratis:🆓 🎁|top cien perfecto:💯 🔝
carro auto viaje avion:🚗 ✈️ 🧳 🗺️|casa hogar:🏠 🏡|libro estudiar escuela:📚 📖 ✏️ 🎓|trabajo oficina negocio:💼 📊 🏢 🤝
juego gamer:🎮 🕹️ 👾|deporte futbol:⚽ 🏀 🏈 🎾|corona rey reina:👑|bebe:👶 🍼|regalo:🎁 🎀|suscribete campana:🔔 📩`;
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const INDEX = KW.split(/[|\n]/).map((e) => { const [w, l] = e.split(':'); return [w.split(' '), l.trim().split(' ')]; });
export function searchEmojis(q) {
  q = norm(q.trim());
  if (!q) return [];
  const hit = new Set();
  for (const [ws, l] of INDEX) if (ws.some((w) => w.startsWith(q) || q.startsWith(w))) l.forEach((e) => hit.add(e));
  for (const [, name, l] of EMOJI_CATS) if (norm(name).includes(q)) l.forEach((e) => hit.add(e));
  return [...hit];
}
