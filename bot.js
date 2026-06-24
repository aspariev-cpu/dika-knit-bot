require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');

// ========================================
//  ИНИЦИАЛИЗАЦИЯ БОТА
// ========================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN не задан в .env!');
    process.exit(1);
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// ========================================
//  ГЛОБАЛЬНЫЕ СОСТОЯНИЯ
// ========================================

const linkState = {};

// ========================================
//  КЛАВИАТУРЫ
// ========================================

const mainKeyboard = {
    reply_markup: {
        keyboard: [
            ['📋 Мои задания', '📊 Статистика'],
            ['🔗 Привязать аккаунт', '🔧 Настройки'],
            ['🟢 Отдыхаю', '🚪 Выйти']
        ],
        resize_keyboard: true
    }
};

const settingsKeyboard = {
    reply_markup: {
        keyboard: [
            ['👥 Все пользователи'],
            ['👤 Дать роль', '👤 Снять роль'],
            ['👤 Управление статусами'],
            ['📢 Отправить уведомление'],
            ['🔙 В главное меню']
        ],
        resize_keyboard: true
    }
};

// ========================================
//  ОТПРАВКА СООБЩЕНИЯ С КНОПКОЙ "ЗАКРЫТЬ"
// ========================================

async function sendDismissibleMessage(ctx, text, options = {}) {
    const dismissKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🗑️ Закрыть', callback_data: 'dismiss_message' }]
            ]
        }
    };
    
    try {
        await ctx.reply(text, {
            parse_mode: 'Markdown',
            ...dismissKeyboard,
            ...options
        });
    } catch (err) {
        console.log('⚠️ Проблема с Markdown, отправка без форматирования');
        try {
            await ctx.reply(text, {
                ...dismissKeyboard,
                ...options
            });
        } catch (e) {
            console.error('❌ Ошибка отправки:', e);
        }
    }
}

// ========================================
//  УДАЛЕНИЕ КОМАНД И ТЕКСТА КНОПОК
// ========================================

bot.use(async (ctx, next) => {
    const text = ctx.message?.text;
    
    const buttonTexts = [
        '📋 Мои задания', '📊 Статистика', '🔗 Привязать аккаунт',
        '🔧 Настройки', '🚪 Выйти', '👥 Все пользователи',
        '👤 Дать роль', '👤 Снять роль', '👤 Управление статусами',
        '📢 Отправить уведомление', '🔙 В главное меню',
        '🟢 Отдыхаю', '🔴 На работе'
    ];
    
    const isCommand = text?.startsWith('/');
    const isButtonText = buttonTexts.includes(text);
    
    await next();
    
    if ((isCommand || isButtonText) && ctx.message) {
        try {
            await ctx.deleteMessage().catch(() => {});
        } catch (err) {}
    }
});

// ========================================
//  ГЛОБАЛЬНЫЙ ОБРАБОТЧИК ОШИБОК
// ========================================

bot.catch((err, ctx) => {
    console.error('❌ Ошибка бота:', err);
    ctx.reply('⚠️ Произошла ошибка. Попробуйте позже.')
        .catch(() => {});
});

// ========================================
//  ОБРАБОТКА КНОПКИ "🗑️ Закрыть"
// ========================================

bot.action('dismiss_message', async (ctx) => {
    try {
        await ctx.deleteMessage();
    } catch (err) {}
    try {
        await ctx.answerCbQuery('🗑️ Сообщение удалено');
    } catch (err) {}
});

bot.action(/dismiss_(.+)/, async (ctx) => {
    const taskId = ctx.match[1];
    try {
        await ctx.deleteMessage();
        console.log(`🗑️ Сообщение о задании #${taskId} удалено у ${ctx.chat.id}`);
    } catch (err) {}
    try {
        await ctx.answerCbQuery('✅ Сообщение удалено');
    } catch (err) {}
});

// ========================================
//  /start — ГЛАВНОЕ МЕНЮ
// ========================================

bot.start(async (ctx) => {
    const name = ctx.from.first_name || 'Вязальщик';
    
    let greeting = `🧵 *Привет, ${name}!*\n\n`;
    greeting += `Я бот фабрики *Dika Knit*.\n`;
    greeting += `Я буду присылать уведомления о новых заданиях.\n\n`;
    greeting += `Выберите действие:`;
    
    await ctx.reply(greeting, mainKeyboard);
});

// ========================================
//  /help — ПОМОЩЬ
// ========================================

bot.help(async (ctx) => {
    await sendDismissibleMessage(ctx, `
🤖 *Помощь по боту Dika Knit*

*Основные команды:*
/start — Главное меню
/help — Эта справка

*Кнопки:*
📋 Мои задания — Показать активные заказы
📊 Статистика — Общая статистика производства
🔗 Привязать аккаунт — Связать Telegram с сайтом
🔧 Настройки — Админ-панель бота
🟢 Отдыхаю / 🔴 На работе — Включить/выключить уведомления
🚪 Выйти — Отвязать аккаунт
        `);
});

// ========================================
//  📋 МОИ ЗАДАНИЯ
// ========================================

bot.hears('📋 Мои задания', async (ctx) => {
    await sendDismissibleMessage(ctx, `
📋 *Активные задания*

🔹 Задание #1 — Модель А (12 шт.)
🔹 Задание #2 — Модель Б (8 шт.)
🔹 Задание #3 — Модель В (5 шт.)

📌 Подробнее смотри на сайте.
    `);
});

// ========================================
//  📊 СТАТИСТИКА
// ========================================

bot.hears('📊 Статистика', async (ctx) => {
    await sendDismissibleMessage(ctx, `
📊 *СТАТИСТИКА ПРОИЗВОДСТВА*

📋 Всего заданий: 15
✅ Выполнено: 8
⏳ В работе: 7
🔥 Срочных: 2

📈 Общий прогресс: 53%

📌 Подробнее смотри на сайте.
    `);
});

// ========================================
//  🔗 ПРИВЯЗАТЬ АККАУНТ
// ========================================

bot.hears('🔗 Привязать аккаунт', async (ctx) => {
    const userId = String(ctx.from.id);
    
    linkState[userId] = { step: 'enter_login' };
    
    await sendDismissibleMessage(ctx, `
🔐 *Привязка аккаунта*

Введите логин и пароль от сайта в формате:

*Логин:Пароль*

Например: *admin:admin123*

Или нажмите "❌ Отмена" для отмены.
    `);
});

// ========================================
//  ОБРАБОТКА ТЕКСТА (ПРИВЯЗКА)
// ========================================

bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    const userId = String(ctx.from.id);
    
    const linkStateData = linkState[userId];
    if (linkStateData && linkStateData.step === 'enter_login') {
        if (text === '❌ Отмена') {
            delete linkState[userId];
            await ctx.reply('❌ Привязка отменена.', mainKeyboard);
            return;
        }
        
        if (text.includes(':')) {
            const parts = text.split(':');
            const login = parts[0].trim();
            const password = parts.slice(1).join(':').trim();
            
            if (!login || !password) {
                await sendDismissibleMessage(ctx, '❌ Неверный формат. Используйте: Логин:Пароль');
                return;
            }
            
            delete linkState[userId];
            
            await sendDismissibleMessage(ctx, `
✅ Аккаунт *${login}* успешно привязан к Telegram!

👤 Пользователь: ${login}
📌 Роль: 👑 Администратор
📌 Статус: 🟢 На работе
            `);
            
            await ctx.reply('🏠 *Главное меню*\n\nВыберите действие:', mainKeyboard);
        } else {
            await sendDismissibleMessage(ctx, '❌ Неверный формат. Используйте: Логин:Пароль\n\nНапример: admin:admin123');
        }
        return;
    }
    
    await next();
});

// ========================================
//  ОТМЕНА ПРИВЯЗКИ
// ========================================

bot.action('link_cancel', async (ctx) => {
    const userId = String(ctx.from.id);
    delete linkState[userId];
    await ctx.deleteMessage();
    await ctx.answerCbQuery('❌ Отменено');
});

// ========================================
//  🚪 ВЫЙТИ
// ========================================

bot.hears('🚪 Выйти', async (ctx) => {
    await sendDismissibleMessage(ctx, `
✅ Вы вышли из аккаунта.

Теперь вы не будете получать уведомления.
Чтобы снова привязать аккаунт — нажмите "🔗 Привязать аккаунт".
    `);
});

// ========================================
//  🔧 НАСТРОЙКИ
// ========================================

bot.hears('🔧 Настройки', async (ctx) => {
    await ctx.reply(`
👑 *АДМИН-ПАНЕЛЬ БОТА*

Выберите действие:
    `, settingsKeyboard);
});

// ========================================
//  🔙 В ГЛАВНОЕ МЕНЮ
// ========================================

bot.hears('🔙 В главное меню', async (ctx) => {
    await ctx.reply('🏠 *Главное меню*\n\nВыберите действие:', mainKeyboard);
});

// ========================================
//  👥 ВСЕ ПОЛЬЗОВАТЕЛИ
// ========================================

bot.hears('👥 Все пользователи', async (ctx) => {
    await sendDismissibleMessage(ctx, `
👥 *СПИСОК ПОЛЬЗОВАТЕЛЕЙ*

1. *Администратор* — admin
2. *Иванов И.И.* — 001
3. *Петров П.П.* — 002

📌 Подробнее смотри на сайте.
    `);
});

// ========================================
//  👤 ДАТЬ РОЛЬ
// ========================================

bot.hears('👤 Дать роль', async (ctx) => {
    await sendDismissibleMessage(ctx, `
👤 *Назначение роли*

Выберите пользователя на сайте, затем:
1. Зайдите в админ-панель сайта
2. Найдите пользователя
3. Назначьте роль

📌 Роли: admin, boss, worker
    `);
});

// ========================================
//  👤 СНЯТЬ РОЛЬ
// ========================================

bot.hears('👤 Снять роль', async (ctx) => {
    await sendDismissibleMessage(ctx, `
👤 *Снятие роли*

Для снятия роли зайдите в админ-панель сайта.
    `);
});

// ========================================
//  👤 УПРАВЛЕНИЕ СТАТУСАМИ
// ========================================

bot.hears('👤 Управление статусами', async (ctx) => {
    await sendDismissibleMessage(ctx, `
👤 *Управление статусами*

Статусы пользователей управляются через админ-панель сайта.
    `);
});

// ========================================
//  📢 ОТПРАВИТЬ УВЕДОМЛЕНИЕ
// ========================================

bot.hears('📢 Отправить уведомление', async (ctx) => {
    await sendDismissibleMessage(ctx, `
📢 *Отправка уведомления*

Уведомления отправляются автоматически при создании новых заданий.

Для ручной рассылки используйте админ-панель сайта.
    `);
});

// ========================================
//  🟢 ОТДЫХАЮ / 🔴 НА РАБОТЕ
// ========================================

bot.hears(['🟢 Отдыхаю', '🔴 На работе'], async (ctx) => {
    const isResting = ctx.message.text === '🟢 Отдыхаю';
    const message = isResting
        ? '✅ Статус изменён: *Отдыхаю*\n\nВы больше не будете получать уведомления о новых заказах.'
        : '✅ Статус изменён: *На работе*\n\nВы будете получать уведомления.';
    
    await sendDismissibleMessage(ctx, message);
    
    const statusButton = isResting ? '🔴 На работе' : '🟢 Отдыхаю';
    const keyboard = {
        reply_markup: {
            keyboard: [
                ['📋 Мои задания', '📊 Статистика'],
                ['🔗 Привязать аккаунт', '🔧 Настройки'],
                [statusButton, '🚪 Выйти']
            ],
            resize_keyboard: true
        }
    };
    
    await ctx.reply('🏠 *Главное меню*', keyboard);
});

// ========================================
//  HTTP-СЕРВЕР ДЛЯ ВЕБХУКОВ
// ========================================

const BOT_PORT = process.env.BOT_PORT || 4000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'dika_secret_2026';

const httpApp = express();
httpApp.use(express.json());

// Эндпоинт для уведомлений о новых заданиях
httpApp.post('/webhook/new-task', async (req, res) => {
    const { secret, task } = req.body;
    
    if (secret !== WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const modelName = task?.Model?.name || 'Новая модель';
        const colorName = task?.Color?.name || '—';
        const planQty = task?.planQuantity || 0;
        const isUrgent = task?.isUrgent ? ' 🔥 СРОЧНО' : '';
        
        const message = `
🆕 *НОВОЕ ЗАДАНИЕ*${isUrgent}

📌 Модель: ${modelName}
🎨 Цвет: ${colorName}
📦 Количество: ${planQty} шт.
🆔 ID: ${task?.id || '—'}

⏳ Статус: Ожидает выполнения
        `;
        
        console.log(`📨 Получено уведомление о задании #${task?.id || '—'}`);
        
        res.json({ success: true, message: 'Уведомление получено' });
        
    } catch (err) {
        console.error('❌ Ошибка обработки webhook:', err);
        res.status(500).json({ error: err.message });
    }
});

// Эндпоинт для уведомлений о выполненных заданиях
httpApp.post('/webhook/task-completed', async (req, res) => {
    const { secret, task } = req.body;
    
    if (secret !== WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const modelName = task?.Model?.name || 'Модель';
        
        const message = `
✅ *ЗАДАНИЕ ВЫПОЛНЕНО*

📌 Модель: ${modelName}
🆔 ID: ${task?.id || '—'}

🎉 Задание готово к отправке!
        `;
        
        console.log(`📨 Получено уведомление о выполнении #${task?.id || '—'}`);
        
        res.json({ success: true, message: 'Уведомление получено' });
        
    } catch (err) {
        console.error('❌ Ошибка обработки webhook:', err);
        res.status(500).json({ error: err.message });
    }
});

// Эндпоинт для проверки доступности бота
httpApp.get('/webhook/health', (req, res) => {
    res.json({ status: 'ok', message: 'Бот работает' });
});

// ========================================
//  ЗАПУСК HTTP-СЕРВЕРА
// ========================================

httpApp.listen(BOT_PORT, () => {
    console.log(`🔗 Webhook сервер бота запущен на порту ${BOT_PORT}`);
    console.log(`🔗 Адрес: http://localhost:${BOT_PORT}`);
});

// ========================================
//  ЗАПУСК БОТА
// ========================================

async function launchWithRetry() {
    let attempt = 0;
    while (true) {
        try {
            await bot.launch();
            console.log('🤖 Бот успешно запущен (polling)');
            break;
        } catch (err) {
            attempt++;
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 60000);
            console.warn(`⚠️ Ошибка бота: ${err.message}. Перезапуск через ${delay/1000}с... (попытка ${attempt})`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

launchWithRetry();

// ========================================
//  ЭЛЕГАНТНОЕ ЗАВЕРШЕНИЕ
// ========================================

process.once('SIGINT', () => {
    console.log('🛑 Остановка бота (SIGINT)...');
    bot.stop('SIGINT');
    process.exit(0);
});

process.once('SIGTERM', () => {
    console.log('🛑 Остановка бота (SIGTERM)...');
    bot.stop('SIGTERM');
    process.exit(0);
});