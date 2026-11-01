// Отдельный бот: пользователь вводит число, бот выставляет чек (счёт) на эту сумму в статиках (XTR).
// Запуск: BOT_TOKEN=токен_нового_бота node bot.js   (Node.js 18+, без зависимостей)
const http = require("http");
const BOT_TOKEN = process.env.BOT_TOKEN, API = process.env.API_BASE || "https://api.staticgram.top";
const MAX = 100000;
if (!BOT_TOKEN) { console.error("Задайте BOT_TOKEN"); process.exit(1); }

const bot = (m, b = {}) => fetch(`${API}/bot${BOT_TOKEN}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());
const say = (chat_id, text) => bot("sendMessage", { chat_id, text });

// Мини-сервер, чтобы хостинг видел, что сервис жив (адрес можно добавить в UptimeRobot)
http.createServer((q, r) => { r.writeHead(200); r.end("ok"); }).listen(process.env.PORT || 3000);

async function poll(offset = 0) {
  try {
    const r = await bot("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "pre_checkout_query"] });
    for (const u of r.result || []) {
      offset = u.update_id + 1;

      const q = u.pre_checkout_query;                      // подтвердить оплату нужно за 10 секунд
      if (q) {
        const ok = q.currency === "XTR" && q.invoice_payload === "chk_" + q.total_amount;
        await bot("answerPreCheckoutQuery", ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: "Чек недействителен" });
        continue;
      }
      const m = u.message; if (!m) continue;

      if (m.successful_payment) {                          // чек оплачен
        const p = m.successful_payment;
        await say(m.chat.id, `✅ Чек оплачен: ${p.total_amount} ⭐. Спасибо!`);
        console.log(`Оплата: ${m.from.id} ${p.total_amount} ⭐, платёж ${p.telegram_payment_charge_id}`);
        continue;
      }
      if (!m.text || m.chat.type !== "private") continue;

      const t = m.text.trim();
      if (/^\d+$/.test(t)) {                               // число -> чек на эту сумму
        const amount = Number(t);
        if (amount < 1 || amount > MAX) { await say(m.chat.id, `Введите сумму от 1 до ${MAX}`); continue; }
        const inv = await bot("sendInvoice", { chat_id: m.chat.id, title: "Чек на оплату", description: `Оплата ${amount} ⭐`, payload: "chk_" + amount, currency: "XTR", prices: [{ label: "Оплата", amount }] });
        if (!inv.ok) await say(m.chat.id, "Не удалось выставить чек: " + (inv.description || "ошибка"));
      } else {
        await say(m.chat.id, "Отправьте число: сумму в ⭐, и я выставлю чек.");
      }
    }
  } catch (e) { await new Promise(r => setTimeout(r, 3000)); }
  poll(offset);
}
console.log("Бот запущен");
poll();
