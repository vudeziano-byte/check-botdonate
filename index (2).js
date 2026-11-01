// Бот пожертвований для StaticGram: звёзды (XTR) автоматически зачисляются на баланс пользователя по юзернейму.
// Запуск: BOT_TOKEN=токен node index.js   (Node.js 18+, без зависимостей)
// Чтобы данные не пропадали на бесплатном хостинге, задайте UPSTASH_URL и UPSTASH_TOKEN (бесплатная база Upstash Redis).
const http = require("http"), fs = require("fs"), crypto = require("crypto");
const BOT_TOKEN = process.env.BOT_TOKEN, API = process.env.API_BASE || "https://api.staticgram.top", MAX = 100000;
const RECIPIENT = (process.env.RECIPIENT || "kreloy").toLowerCase().replace("@", "");   // все пожертвования зачисляются на баланс этого юзернейма
const UP = process.env.UPSTASH_URL, UT = process.env.UPSTASH_TOKEN;
if (!BOT_TOKEN) { console.error("Задайте BOT_TOKEN"); process.exit(1); }

// ---- хранилище: Upstash Redis (если задан) или файл ----
const kv = async cmd => (await (await fetch(UP, { method: "POST", headers: { Authorization: "Bearer " + UT }, body: JSON.stringify(cmd) })).json()).result;
const load = async () => UP ? kv(["GET", "donations"]) : (fs.existsSync("donations.json") ? fs.readFileSync("donations.json", "utf8") : null);
const store = async v => UP ? kv(["SET", "donations", v]) : fs.writeFileSync("donations.json", v);
let db = { balances: {}, chats: {}, invoices: {}, charges: {} }, dirty = false;
const touch = () => { dirty = true; };
setInterval(async () => { if (!dirty) return; dirty = false; try { await store(JSON.stringify(db)); } catch (e) { dirty = true; console.error(e.message); } }, 2000);

const bot = (m, b = {}) => fetch(`${API}/bot${BOT_TOKEN}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());
const say = (chat_id, text) => bot("sendMessage", { chat_id, text });
const keyOf = u => (u.username || "id" + u.id).toLowerCase();
const bal = k => db.balances[k] || 0;
const HELP = `Отправьте число: сумму пожертвования в ⭐, и я выставлю чек.\nВсе пожертвования зачисляются на баланс @${RECIPIENT}.\n/balance: узнать свой баланс`;

http.createServer((q, r) => { r.writeHead(200); r.end("ok"); }).listen(process.env.PORT || 3000);   // для хостинга и UptimeRobot

async function poll(offset = 0) {
  try {
    const r = await bot("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "pre_checkout_query"] });
    for (const u of r.result || []) {
      offset = u.update_id + 1;

      const q = u.pre_checkout_query;                                      // подтвердить нужно за 10 секунд
      if (q) {
        const inv = db.invoices[q.invoice_payload];
        const ok = inv && inv.status === "new" && inv.payerId === String(q.from.id) && q.currency === "XTR" && q.total_amount === inv.amount;
        await bot("answerPreCheckoutQuery", ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: "Чек недействителен" });
        continue;
      }
      const m = u.message; if (!m) continue;
      if (m.chat.type === "private") { db.chats[keyOf(m.from)] = m.chat.id; touch(); }   // чтобы можно было сообщить о пожертвовании

      const sp = m.successful_payment;
      if (sp) {                                                            // оплата прошла: зачисляем получателю
        const inv = db.invoices[sp.invoice_payload], ch = sp.telegram_payment_charge_id;
        if (inv && inv.status === "new" && !db.charges[ch]) {
          inv.status = "paid"; db.charges[ch] = inv.amount; db.balances[inv.to] = bal(inv.to) + inv.amount; touch();
          console.log(`Пожертвование: ${inv.payer} -> ${inv.to}, ${inv.amount} ⭐`);
          await say(m.chat.id, inv.to === inv.payer ? `✅ Ваш баланс пополнен на ${inv.amount} ⭐. Сейчас: ${bal(inv.to)} ⭐` : `✅ Баланс @${inv.to} пополнен на ${inv.amount} ⭐. Спасибо!`);
          if (inv.to !== inv.payer && db.chats[inv.to]) await say(db.chats[inv.to], `🎁 @${inv.payer} пожертвовал вам ${inv.amount} ⭐. Ваш баланс: ${bal(inv.to)} ⭐`);
        }
        continue;
      }
      if (!m.text || m.chat.type !== "private") continue;

      const t = m.text.trim(), mm = t.match(/^(\d+)$/);
      if (t.startsWith("/balance")) await say(m.chat.id, `Ваш баланс: ${bal(keyOf(m.from))} ⭐`);
      else if (mm) {
        const amount = Number(mm[1]), payer = keyOf(m.from), to = RECIPIENT;
        if (amount < 1 || amount > MAX) { await say(m.chat.id, `Введите сумму от 1 до ${MAX}`); continue; }
        const payload = crypto.randomBytes(12).toString("hex");
        db.invoices[payload] = { payer, payerId: String(m.from.id), to, amount, status: "new" }; touch();
        const inv = await bot("sendInvoice", { chat_id: m.chat.id, title: to === payer ? "Пополнение баланса" : "Пожертвование для @" + to, description: to === payer ? `Пополнение вашего баланса на ${amount} ⭐` : `Баланс @${to} будет пополнен на ${amount} ⭐`, payload, currency: "XTR", prices: [{ label: "Пожертвование", amount }] });
        if (!inv.ok) { delete db.invoices[payload]; await say(m.chat.id, "Не удалось выставить чек: " + (inv.description || "ошибка")); }
      } else await say(m.chat.id, HELP);
    }
  } catch (e) { await new Promise(r => setTimeout(r, 3000)); }
  poll(offset);
}
(async () => { try { const d = await load(); if (d) db = Object.assign(db, JSON.parse(d)); } catch (e) { console.error("Не удалось загрузить данные:", e.message); }
  console.log("Бот запущен"); poll(); })();
