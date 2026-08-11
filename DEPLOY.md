# ПТН ПНХ — деплой у Telegram як Mini App (крок за кроком)

Гра тепер працює як **повноцінний Telegram Mini App** — не через застарілий Games API. Ключова відмінність: гра відкривається у справжньому WebView з повним доступом до `Telegram.WebApp` API (нативне поширення, haptics тощо), а не в обмеженому iframe класичних ігор, який блокує навігацію й закриває гру при спробі показати вікно поширення.

Гра складається з двох частин:

| Частина | Що це | Де хоститься |
|---|---|---|
| `game/` | HTML5-гра (index.html + assets/) | Статичний хостинг, напр. **GitLab/GitHub Pages** |
| `bot/`  | Node.js-сервер бота (тримає токен, видає меню-кнопку, приймає рахунок) | Сервер, що постійно працює — напр. **Render.com** |

Pages не вміє запускати серверний код і не може безпечно зберігати токен бота, тому боту потрібен окремий хостинг. Гра ж — це просто статичні файли.

---

## Крок 1. Створити бота через @BotFather

1. Напишіть [@BotFather](https://t.me/BotFather) → `/newbot`, дайте імʼя. Збережіть виданий **токен**.
2. Більше нічого налаштовувати в BotFather не треба — на відміну від класичних Games тут не потрібні `/newgame`, inline mode чи short name. Постійна кнопка меню («Play») бот виставляє собі сам автоматично при старті (`setChatMenuButton` у `server.js`).

---

## Крок 2. Викласти гру на Pages

У папці `game/` вже лежить `index.html`, `assets/` і (якщо деплоїте на GitLab) готовий `.gitlab-ci.yml`.

```bash
cd game
git init
git add .
git commit -m "PTN PNH game"
git branch -M main
git remote add origin https://github.com/ВАШ_НІК/ptn-pnh-game.git   # або gitlab.com
git push -u origin main
```

Увімкніть Pages в налаштуваннях репозиторію (GitHub: **Settings → Pages**; GitLab: пайплайн `pages` запуститься сам). Отримаєте посилання типу:

```
https://ВАШ_НІК.github.io/ptn-pnh-game/index.html
```

Це і є ваш `GAME_URL`. **Важливо:** Mini App вимагає саме `https://` — `http://` не працюватиме.

---

## Крок 3. Налаштувати й задеплоїти бота (Render.com, безкоштовно)

### 3.1. Реєстрація
Зайдіть на [render.com](https://render.com) → Sign Up → увійдіть через GitHub чи GitLab (той сервіс, куди ви запушили `bot/`). Безкоштовний акаунт не вимагає картки для Web Service.

### 3.2. Створення Web Service
На дашборді → **New → Web Service** → оберіть репозиторій із `bot/`.

- Якщо `bot/` — підпапка в тому ж репозиторії, що й гра, обовʼязково вкажіть **Root Directory: bot**.
- **Name**: будь-яке (напр. `ptn-pnh-bot`).
- **Region**: найближчий до вашої аудиторії.
- **Branch**: main.
- **Environment**: Node.
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Instance Type**: Free.

### 3.3. Змінні середовища
У розділі **Environment** додайте (з `bot/.env.example`):

| Змінна | Звідки взяти |
|---|---|
| `BOT_TOKEN` | Токен від @BotFather (крок 1) |
| `GAME_URL` | Посилання на задеплоєний `index.html` гри (крок 2) |

`PORT` можна не додавати — Render підставляє його сам. **Ніколи не кладіть ці значення в код чи в git** — тільки в Environment.

### 3.4. Перший деплой
Натисніть **Create Web Service**. На вкладці **Logs** — `npm install`, потім `npm start`. Успіх — рядок `PTN-PNH Mini App bot server listening on :10000` **і одразу після нього** `setChatMenuButton` без помилок (це підтверджує, що кнопка меню виставилась). Статус угорі стане зеленим **Live**.

### 3.5. Перевірка
Render видасть URL, напр. `https://ptn-pnh-bot.onrender.com`. Відкрийте `https://ptn-pnh-bot.onrender.com/health` — має повернути `{"ok":true}`.

### 3.6. Вебхук

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://ptn-pnh-bot.onrender.com/webhook"
```

Успішна відповідь: `{"ok":true,"result":true,...}`. Перевірити стан будь-коли:
```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

### 3.7. Особливість безкоштовного плану
Сервіс засинає після ~15 хв без запитів і «прокидається» за 30-50 секунд на перший запит — це нормально, не баг.

### 3.8. Подальші оновлення
Кожен `git push` у main автоматично тригерить редеплой. Зміну змінних середовища теж треба зберегти кнопкою **Save Changes**.

---

## Крок 4. Прописати SCORE_ENDPOINT у грі

У `game/index.html`:
```js
const SCORE_ENDPOINT = 'https://YOUR-BACKEND-URL.example.com/api/score';
```
замініть на реальний URL, наприклад:
```js
const SCORE_ENDPOINT = 'https://ptn-pnh-bot.onrender.com/api/score';
```
Закомітьте й запуште — Pages оновиться автоматично.

---

## Крок 4.5. Відродження через винагороджувану рекламу (опційно)

На екрані «Mission failed» — кнопка «▶ Watch ad · +1 shield» через [Adsgram](https://adsgram.ai), до 3 разів за забіг. Далі гра завершується остаточно.

Поки `AD_BLOCK_ID` не налаштований — показується 3-секундна симуляція для тестування. Щоб увімкнути реальну рекламу: зареєструйтесь на [adsgram.ai](https://adsgram.ai), створіть Rewarded-блок, вставте Block ID у `game/index.html`:
```js
const AD_BLOCK_ID = 'YOUR-ADSGRAM-BLOCK-ID';
```

---

## Крок 5. Перевірка

1. Напишіть боту `/start` або `/play` — прийде повідомлення з кнопкою **▶ Play PTN PNH**.
2. Або скористайтесь постійною кнопкою **Play** біля поля вводу повідомлення (menu button) — вона з'являється автоматично, без потреби писати команду щоразу.
3. Натисніть — гра відкриється як повноцінний Mini App.
4. Рахунок автоматично піде на `/api/score`, перевіряється через офіційну `initData`-верифікацію.
5. Переглянути топ гравців: `GET https://ptn-pnh-bot.onrender.com/api/leaderboard` (простий JSON, без нативного інтерфейсу — Mini App не має вбудованого лідерборду, як мали класичні Games).

---

## Нотатки з безпеки

- **Ніколи** не кладіть `BOT_TOKEN` у `game/index.html` чи будь-де на клієнті — тільки в `bot/.env` на сервері.
- Рахунок захищений офіційною Telegram-верифікацією `initData` (HMAC-SHA256 з ключем, похідним від токена бота) — підробити рахунок для чужого `user_id` неможливо без токена.
- `leaderboard.json` на сервері зберігає лише найкращий рахунок і публічне імʼя користувача (username/first_name) — жодних персональних даних понад те, що Telegram і так публічно показує.

## Чим це відрізняється від попередньої (Games API) версії

| | Games API (було) | Mini App (стало) |
|---|---|---|
| Запуск | `sendGame` + `callback_query` | `web_app` кнопка (меню або inline) |
| Ідентифікація гравця | Підпис у URL, який генерував бот | Офіційний `tg.initData` |
| Поширення з гри | Не працює — закриває гру | Працює нативно |
| Лідерборд | Вбудований у Telegram (`setGameScore`) | Власний, `/api/leaderboard` |
| Потрібні `/newgame`, inline mode | Так | Ні |
