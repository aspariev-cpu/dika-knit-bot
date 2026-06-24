require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const { Sequelize, Op } = require('sequelize');
const bcrypt = require('bcryptjs');

// ========================================
//  ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ
// ========================================

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    timezone: '+03:00',
    dialectOptions: {
        useUTC: false,
        timezone: 'Europe/Moscow'
    }
});

// ========================================
//  МОДЕЛИ (копия из основного проекта)
// ========================================

const { DataTypes } = require('sequelize');

const User = sequelize.define('User', {
    login: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    fullName: { type: DataTypes.STRING, allowNull: false },
    isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
    telegramId: { type: DataTypes.STRING, allowNull: true },
    role: { 
        type: DataTypes.ENUM('bot_admin', 'admin', 'boss', 'master', 'worker'), 
        defaultValue: 'worker' 
    },
    lastActiveAt: { type: DataTypes.DATE, allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

const Machine = sequelize.define('Machine', {
    machineNumber: { type: DataTypes.INTEGER, unique: true, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

const Model = sequelize.define('Model', {
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    program: { type: DataTypes.STRING, allowNull: false },
    size: { type: DataTypes.STRING, allowNull: false },
    className: { type: DataTypes.STRING, allowNull: false },
    yarn: { type: DataTypes.STRING, allowNull: true },
    image: { type: DataTypes.TEXT, allowNull: true },
    isCoat: { type: DataTypes.BOOLEAN, defaultValue: false },
    threading: { type: DataTypes.TEXT, allowNull: true }
});

const ModelPart = sequelize.define('ModelPart', {
    partName: { type: DataTypes.STRING, allowNull: false },
    program: { type: DataTypes.STRING, allowNull: false },
    size: { type: DataTypes.STRING, allowNull: true },
    className: { type: DataTypes.STRING, allowNull: true },
    yarn: { type: DataTypes.STRING, allowNull: false },
    threading: { type: DataTypes.TEXT, allowNull: true },
    image: { type: DataTypes.TEXT, allowNull: true }
});

const Color = sequelize.define('Color', {
    name: { type: DataTypes.STRING, allowNull: false, unique: true }
});

const Task = sequelize.define('Task', {
    planQuantity: { type: DataTypes.INTEGER, allowNull: false },
    isUrgent: { type: DataTypes.BOOLEAN, defaultValue: false },
    status: { type: DataTypes.ENUM('pending', 'in_progress', 'completed'), defaultValue: 'pending' },
    lastPrintedAt: { type: DataTypes.DATE, defaultValue: null },
    ip: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    isCoat: { type: DataTypes.BOOLEAN, defaultValue: false },
    isPart: { type: DataTypes.BOOLEAN, defaultValue: false },
    partName: { type: DataTypes.STRING, allowNull: true },
    parentTaskId: { type: DataTypes.INTEGER, allowNull: true },
    doneQuantity: { type: DataTypes.INTEGER, defaultValue: 0 }
});

const Operation = sequelize.define('Operation', {
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    printedAt: { type: DataTypes.DATE, defaultValue: null },
    colorName: { type: DataTypes.STRING, allowNull: true },
    modelName: { type: DataTypes.STRING, allowNull: true },
    partName: { type: DataTypes.STRING, allowNull: true }
});

// ========================================
//  СВЯЗИ
// ========================================

Model.hasMany(ModelPart, { as: 'parts', foreignKey: 'modelId' });
ModelPart.belongsTo(Model, { foreignKey: 'modelId' });

Task.belongsTo(Model, { foreignKey: 'modelId' });
Task.belongsTo(Color, { foreignKey: 'colorId' });

Task.hasMany(Task, { as: 'parts', foreignKey: 'parentTaskId' });
Task.belongsTo(Task, { as: 'parent', foreignKey: 'parentTaskId' });

Task.hasMany(Operation, { as: 'operations', foreignKey: 'taskId' });
Operation.belongsTo(Task, { foreignKey: 'taskId' });
Operation.belongsTo(User, { as: 'employee', foreignKey: 'employeeId' });
Operation.belongsTo(Machine, { as: 'machine', foreignKey: 'machineId' });

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
const roleState = {};
const roleTempData = {};
const notificationState = {};

// ========================================
//  ФУНКЦИИ УВЕДОМЛЕНИЙ
// ========================================

async function notifyActiveUsers(message, taskId) {
    console.log('📨 notifyActiveUsers вызвана');
    
    try {
        const users = await User.findAll({
            where: {
                telegramId: { [Op.not]: null },
                isActive: true
            }
        });
        
        if (!users || users.length === 0) {
            console.log('⚠️ Нет активных пользователей для уведомления');
            return 0;
        }
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [[{ text: '✅ Прочитал', callback_data: `dismiss_${taskId}` }]]
            }
        };
        
        let sent = 0;
        for (const u of users) {
            try {
                await bot.telegram.sendMessage(u.telegramId, message, { parse_mode: 'Markdown', ...keyboard });
                sent++;
            } catch (e) {
                console.error(`❌ ${u.login}:`, e.message);
            }
        }
        return sent;
    } catch (err) {
        console.error('Ошибка уведомления пользователей:', err);
        return 0;
    }
}

async function notifyAdmins(message, taskId) {
    try {
        const admins = await User.findAll({
            where: {
                role: 'admin',
                telegramId: { [Op.not]: null },
                isActive: true
            }
        });
        if (!admins || admins.length === 0) return 0;
        const keyboard = {
            reply_markup: {
                inline_keyboard: [[{ text: '✅ Прочитал', callback_data: `dismiss_${taskId}` }]]
            }
        };
        let sent = 0;
        for (const a of admins) {
            try {
                await bot.telegram.sendMessage(a.telegramId, message, { parse_mode: 'Markdown', ...keyboard });
                sent++;
            } catch (e) {
                console.error(`❌ ${a.login}:`, e.message);
            }
        }
        return sent;
    } catch (err) {
        console.error('Ошибка уведомления админов:', err);
        return 0;
    }
}

async function notifyBosses(message) {
    try {
        const bosses = await User.findAll({
            where: {
                role: 'boss',
                telegramId: { [Op.not]: null },
                isActive: true
            }
        });
        if (!bosses || bosses.length === 0) return 0;
        let sent = 0;
        for (const b of bosses) {
            try {
                await bot.telegram.sendMessage(b.telegramId, message, { parse_mode: 'Markdown' });
                sent++;
            } catch (e) {
                console.error(`❌ ${b.login}:`, e.message);
            }
        }
        return sent;
    } catch (err) {
        console.error('Ошибка уведомления начальства:', err);
        return 0;
    }
}

async function generateShiftReport(date, shift) {
    try {
        const now = new Date();
        const startDate = new Date(now);
        startDate.setHours(now.getHours() - 24, 0, 0, 0);
        const endDate = new Date(now);

        const ops = await Operation.findAll({
            where: { createdAt: { [Op.gte]: startDate, [Op.lt]: endDate } },
            include: [
                { model: User, as: 'employee' },
                { model: Machine, as: 'machine' },
                { 
                    model: Task, 
                    include: [
                        { model: Model },
                        { model: Color }
                    ] 
                }
            ]
        });

        if (!ops || ops.length === 0) {
            return `📊 За последние 24 часа данных нет.`;
        }

        const employees = {};
        for (const op of ops) {
            const name = op.employee?.fullName || 'Неизвестный';
            if (!employees[name]) {
                employees[name] = {
                    total: 0,
                    machines: new Set()
                };
            }
            employees[name].total += op.quantity;
            if (op.machine) {
                employees[name].machines.add(op.machine.machineNumber);
            }
        }

        const machines = {};
        const coatOrders = {};

        for (const op of ops) {
            const task = op.Task;
            const model = task?.Model;
            const color = task?.Color;
            
            if (!model) continue;

            const machineNum = op.machine?.machineNumber || '?';
            const className = model.className || '—';
            const modelName = model.name || '—';
            const quantity = op.quantity;
            const isCoat = model.isCoat || false;
            const partName = op.partName || null;
            const size = model.size || '—';
            const colorName = color?.name || '—';

            if (isCoat) {
                const key = `${modelName} (${size}) — ${colorName}`;
                if (!coatOrders[key]) {
                    coatOrders[key] = {
                        modelName: modelName,
                        size: size,
                        color: colorName,
                        parts: {}
                    };
                }
                const partKey = partName || 'Деталь';
                if (!coatOrders[key].parts[partKey]) {
                    coatOrders[key].parts[partKey] = 0;
                }
                coatOrders[key].parts[partKey] += quantity;
                continue;
            }

            const machineKey = `№${machineNum} (Класс ${className})`;
            if (!machines[machineKey]) {
                machines[machineKey] = {};
            }
            const orderKey = `${modelName} (${colorName})`;
            if (!machines[machineKey][orderKey]) {
                machines[machineKey][orderKey] = 0;
            }
            machines[machineKey][orderKey] += quantity;
        }

        let report = `📊 *ОТЧЁТ ЗА СМЕНУ*\n`;
        report += `${new Date(startDate).toLocaleDateString('ru-RU')} ${new Date(startDate).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — ${new Date(endDate).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}\n`;
        report += `━━━━━━━━━━━━━━━━━━\n\n`;

        report += `👥 *СОТРУДНИКИ*\n`;
        const sortedEmployees = Object.entries(employees).sort((a, b) => b[1].total - a[1].total);
        for (const [name, data] of sortedEmployees) {
            const machinesList = Array.from(data.machines).sort((a, b) => a - b).join(', ');
            report += `   ${name} — ${data.total} шт. (машины: ${machinesList || '—'})\n`;
        }
        report += `\n`;

        if (Object.keys(machines).length > 0) {
            report += `🖥️ *ЗАКАЗЫ ПО МАШИНКАМ*\n`;
            const sortedMachines = Object.keys(machines).sort();
            for (const machine of sortedMachines) {
                const models = machines[machine];
                for (const [orderKey, qty] of Object.entries(models)) {
                    report += `   ${machine} — ${orderKey}: ${qty} шт.\n`;
                }
            }
            report += `\n`;
        }

        if (Object.keys(coatOrders).length > 0) {
            report += `👕 *КОФТЫ*\n`;
            for (const [key, data] of Object.entries(coatOrders)) {
                report += `   ${data.modelName} (${data.size}) — ${data.color}\n`;
                for (const [partName, qty] of Object.entries(data.parts)) {
                    report += `      ${partName}: ${qty} шт.\n`;
                }
            }
            report += `\n`;
        }

        const totalQuantity = Object.values(employees).reduce((sum, e) => sum + e.total, 0);
        report += `━━━━━━━━━━━━━━━━━━\n`;
        report += `📊 *ИТОГО:* ${totalQuantity} шт.`;

        return report;
    } catch (err) {
        console.error('Ошибка генерации отчёта:', err);
        return '❌ Ошибка при формировании отчёта';
    }
}

function getRoleDisplay(role) {
    const roleMap = {
        'bot_admin': '🤖 Главный админ бота',
        'admin': '👑 Администратор сайта',
        'boss': '💼 Начальство',
        'worker': '🧵 Вязальщик'
    };
    return roleMap[role] || role;
}

function getRecipientName(recipient) {
    const names = {
        'workers': '👥 Вязальщики',
        'admins': '👑 Админы сайта',
        'bosses': '💼 Начальство',
        'all': '📢 Все пользователи'
    };
    return names[recipient] || recipient;
}

function hasAccess(user, allowedRoles) {
    if (!user) return false;
    if (user.role === 'bot_admin') return true;
    return allowedRoles.includes(user.role);
}

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
            ['📊 Тест отчёта'],
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
        '📢 Отправить уведомление', '📊 Тест отчёта',
        '🔙 В главное меню', '🟢 Отдыхаю', '🔴 На работе'
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
    const userId = String(ctx.from.id);
    
    const user = await User.findOne({ where: { telegramId: userId } });
    
    let status = '';
    let keyboard = mainKeyboard;
    let statusText = '';
    
    if (user) {
        status = `\n✅ Аккаунт привязан: *${user.login}* (${getRoleDisplay(user.role)})`;
        const isActive = user.isActive !== false;
        statusText = isActive ? '🟢 Отдыхаю' : '🔴 На работе';
        
        const statusButton = isActive ? '🟢 Отдыхаю' : '🔴 На работе';
        keyboard.reply_markup.keyboard[2] = [statusButton, '🚪 Выйти'];
    } else {
        status = '\n⚠️ Аккаунт не привязан. Нажмите "🔗 Привязать аккаунт"';
    }
    
    let greeting = `🧵 *Привет, ${name}!*\n\n`;
    greeting += `Я бот фабрики *Dika Knit*.\n`;
    greeting += status;
    if (user) {
        greeting += `\n📌 Статус: ${statusText}`;
    }
    greeting += '\n\nВыберите действие:';
    
    await ctx.reply(greeting, keyboard);
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

*Для администраторов:*
👤 Дать роль — Назначить роль пользователю
👤 Снять роль — Снять роль с пользователя
👤 Управление статусами — Включить/выключить уведомления для пользователей
📢 Отправить уведомление — Рассылка
📊 Тест отчёта — Проверить отчёт за сегодня
        `);
});

// ========================================
//  🟢 ОТДЫХАЮ / 🔴 НА РАБОТЕ
// ========================================

bot.hears(['🟢 Отдыхаю', '🔴 На работе'], async (ctx) => {
    const userId = String(ctx.from.id);
    const user = await User.findOne({ where: { telegramId: userId } });
    
    if (!user) {
        await sendDismissibleMessage(ctx, '❌ Вы не привязаны к аккаунту. Сначала нажмите "🔗 Привязать аккаунт".');
        return;
    }
    
    const currentStatus = user.isActive !== false;
    const newStatus = !currentStatus;
    
    await user.update({ isActive: newStatus });
    
    const statusText = newStatus ? '🟢 Отдыхаю' : '🔴 На работе';
    const message = newStatus 
        ? '✅ Статус изменён: *Отдыхаю*\n\nВы больше не будете получать уведомления о новых заказах.\nЧтобы снова получать уведомления — нажмите "🟢 На работе".'
        : '🔴 Статус изменён: *На работе*\n\nВы будете получать уведомления.';
    
    await sendDismissibleMessage(ctx, message);
    
    const keyboard = {
        reply_markup: {
            keyboard: [
                ['📋 Мои задания', '📊 Статистика'],
                ['🔗 Привязать аккаунт', '🔧 Настройки'],
                [statusText, '🚪 Выйти']
            ],
            resize_keyboard: true
        }
    };
    
    await ctx.reply('🏠 *Главное меню*', keyboard);
});

// ========================================
//  🔗 ПРИВЯЗАТЬ АККАУНТ
// ========================================

bot.hears('🔗 Привязать аккаунт', async (ctx) => {
    const userId = String(ctx.from.id);
    
    const users = await User.findAll({
        where: {
            telegramId: null
        },
        order: [['fullName', 'ASC']]
    });
    
    if (!users || users.length === 0) {
        await sendDismissibleMessage(ctx, '📭 Нет доступных пользователей для привязки.\n\nВсе пользователи уже привязаны к Telegram.');
        return;
    }
    
    linkState[userId] = { step: 'select_user', targetUserId: null };
    
    const userButtons = users.map(u => {
        return [{ text: `${u.fullName || u.login} (${u.login})`, callback_data: `link_user_${u.id}` }];
    });
    
    userButtons.push([{ text: '❌ Отмена', callback_data: 'link_cancel' }]);
    
    await ctx.reply('👤 *Выберите пользователя для привязки к Telegram:*', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: userButtons
        }
    });
});

// ========================================
//  ОБРАБОТКА ВЫБОРА ПОЛЬЗОВАТЕЛЯ ДЛЯ ПРИВЯЗКИ
// ========================================

bot.action(/link_user_(.+)/, async (ctx) => {
    const userId = String(ctx.from.id);
    const targetUserId = parseInt(ctx.match[1]);
    
    const targetUser = await User.findByPk(targetUserId);
    if (!targetUser) {
        await ctx.answerCbQuery('❌ Пользователь не найден');
        return;
    }
    
    linkState[userId] = {
        step: 'enter_password',
        targetUserId: targetUserId,
        targetLogin: targetUser.login,
        targetName: targetUser.fullName || targetUser.login
    };
    
    await ctx.editMessageText(`
🔐 *Введите пароль для пользователя:*

👤 ${targetUser.fullName || targetUser.login} (${targetUser.login})

Введите пароль текстовым сообщением.
        `, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '❌ Отмена', callback_data: 'link_cancel' }]
            ]
        }
    });
    
    await ctx.answerCbQuery();
});

// ========================================
//  ОБРАБОТКА ОТМЕНЫ ПРИВЯЗКИ
// ========================================

bot.action('link_cancel', async (ctx) => {
    const userId = String(ctx.from.id);
    delete linkState[userId];
    await ctx.deleteMessage();
    await ctx.answerCbQuery('❌ Отменено');
});

// ========================================
//  ОБРАБОТКА ТЕКСТА (ПРИВЯЗКА, РОЛИ, УВЕДОМЛЕНИЯ)
// ========================================

bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    const userId = String(ctx.from.id);
    
    const linkStateData = linkState[userId];
    if (linkStateData && linkStateData.step === 'enter_password') {
        const password = text.trim();
        
        if (!password) {
            await sendDismissibleMessage(ctx, '❌ Введите пароль.');
            return;
        }
        
        try {
            const targetUser = await User.findByPk(linkStateData.targetUserId);
            if (!targetUser) {
                await sendDismissibleMessage(ctx, '❌ Пользователь не найден.');
                delete linkState[userId];
                return;
            }
            
            const isValid = await bcrypt.compare(password, targetUser.password);
            
            if (!isValid) {
                await sendDismissibleMessage(ctx, '❌ Неверный пароль. Попробуйте снова.');
                return;
            }
            
            const telegramId = String(ctx.from.id);
            await targetUser.update({ telegramId: telegramId });
            
            delete linkState[userId];
            
            await sendDismissibleMessage(ctx, `
✅ Аккаунт *${targetUser.login}* успешно привязан к Telegram!

👤 Пользователь: ${targetUser.fullName || targetUser.login}
📌 Роль: ${getRoleDisplay(targetUser.role)}
📌 Статус: ${targetUser.isActive !== false ? '🟢 Отдыхаю' : '🔴 На работе'}
            `);
            
            const isActive = targetUser.isActive !== false;
            const statusButton = isActive ? '🟢 Отдыхаю' : '🔴 На работе';
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
            
            await ctx.reply('🏠 *Главное меню*\n\nВыберите действие:', keyboard);
            
        } catch (err) {
            console.error('Ошибка привязки:', err);
            await sendDismissibleMessage(ctx, '❌ Ошибка при привязке аккаунта. Попробуйте позже.');
            delete linkState[userId];
        }
        return;
    }
    
    if (roleState[userId]) {
        return await next();
    }
    
    if (notificationState[userId]) {
        return await next();
    }
    
    if (text.includes(':')) {
        const parts = text.split(':');
        const login = parts[0].trim();
        const password = parts.slice(1).join(':').trim();
        
        if (!login || !password) {
            await sendDismissibleMessage(ctx, '❌ Неверный формат. Используйте: Логин:Пароль');
            return;
        }
        
        try {
            const user = await User.findOne({ where: { login } });
            
            if (!user) {
                await sendDismissibleMessage(ctx, '❌ Пользователь с таким логином не найден.');
                return;
            }
            
            const isValid = await bcrypt.compare(password, user.password);
            
            if (!isValid) {
                await sendDismissibleMessage(ctx, '❌ Неверный пароль.');
                return;
            }
            
            const telegramId = String(ctx.from.id);
            await user.update({ telegramId: telegramId });
            
            await sendDismissibleMessage(ctx, `✅ Аккаунт ${login} успешно привязан к Telegram!`);
            
        } catch (err) {
            console.error('Ошибка привязки:', err);
            await sendDismissibleMessage(ctx, '❌ Ошибка при привязке аккаунта. Попробуйте позже.');
        }
        return;
    }
    
    await next();
});

// ========================================
//  📋 МОИ ЗАДАНИЯ
// ========================================

bot.hears('📋 Мои задания', async (ctx) => {
    try {
        const tasks = await Task.findAll({
            where: { status: ['pending', 'in_progress'], isPart: false },
            include: [
                { model: Model },
                { model: Color },
                { model: Operation, as: 'operations' }
            ],
            limit: 10,
            order: [['isUrgent', 'DESC'], ['createdAt', 'ASC']]
        });

        if (!tasks || tasks.length === 0) {
            await sendDismissibleMessage(ctx, '📭 Активных заданий нет\n\nВсе задания выполнены! 🎉');
            return;
        }

        let message = '📋 *Активные задания*\n━━━━━━━━━━━━━━━━━━\n';

        (tasks || []).forEach((task, index) => {
            const modelName = task.Model?.name || 'Без модели';
            const colorName = task.Color?.name || '—';
            const urgent = task.isUrgent ? ' 🔥' : '';
            
            const done = task.doneQuantity || 0;
            const plan = task.planQuantity || 0;
            const percent = plan > 0 ? Math.round((done / plan) * 100) : 0;
            
            const barLength = 10;
            const filled = Math.round((percent / 100) * barLength);
            const empty = barLength - filled;
            const bar = '█'.repeat(filled) + '░'.repeat(empty);

            message += `\n${index + 1}. *${modelName}*${urgent}\n`;
            message += `   🎨 ${colorName}  |  📦 ${plan} шт.\n`;
            message += `   ${bar} ${percent}%\n`;
            message += `   🆔 ID: ${task.id}\n`;
            message += `   📌 ${task.status === 'pending' ? '⏳ Ожидает' : '🔄 В работе'}\n`;
        });

        message += '\n━━━━━━━━━━━━━━━━━━\n';
        message += `📊 Всего: ${tasks.length} заданий в работе`;

        await sendDismissibleMessage(ctx, message);

    } catch (err) {
        console.error('Ошибка /tasks:', err);
        await sendDismissibleMessage(ctx, '❌ Ошибка при загрузке заданий');
    }
});

// ========================================
//  📊 СТАТИСТИКА
// ========================================

bot.hears('📊 Статистика', async (ctx) => {
    try {
        const total = await Task.count();
        const completed = await Task.count({ where: { status: 'completed' } });
        const inProgress = await Task.count({ where: { status: ['pending', 'in_progress'] } });
        const urgent = await Task.count({ where: { isUrgent: true, status: ['pending', 'in_progress'] } });
        
        const allOperations = await Operation.findAll();
        const totalDone = (allOperations || []).reduce((sum, op) => sum + op.quantity, 0);
        
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        
        const barLength = 15;
        const filled = Math.round((percent / 100) * barLength);
        const empty = barLength - filled;
        const bar = '█'.repeat(filled) + '░'.repeat(empty);

        await sendDismissibleMessage(ctx, `
📊 *СТАТИСТИКА ПРОИЗВОДСТВА*
━━━━━━━━━━━━━━━━━━

📋 Всего заданий: ${total}
✅ Выполнено: ${completed}
⏳ В работе: ${inProgress}
🔥 Срочных: ${urgent}

📈 Общий прогресс:
${bar} ${percent}%

🧶 Всего связано: ${totalDone} шт.

${percent >= 100 ? '🎉 Отлично! Все задания выполнены!' : '💪 Продолжайте в том же духе!'}
        `);

    } catch (err) {
        console.error('Ошибка статистики:', err);
        await sendDismissibleMessage(ctx, '❌ Ошибка при загрузке статистики');
    }
});

// ========================================
//  🚪 ВЫЙТИ (ОТВЯЗАТЬ АККАУНТ)
// ========================================

bot.hears('🚪 Выйти', async (ctx) => {
    const userId = String(ctx.from.id);
    
    try {
        const user = await User.findOne({ where: { telegramId: userId } });
        
        if (!user) {
            await sendDismissibleMessage(ctx, '❌ Вы не привязаны к аккаунту.');
            return;
        }
        
        const login = user.login;
        await user.update({ telegramId: null });
        
        await sendDismissibleMessage(ctx, `
✅ Вы вышли из аккаунта ${login}.

Теперь вы не будете получать уведомления.
Чтобы снова привязать аккаунт — нажмите "🔗 Привязать аккаунт".
        `);
        
    } catch (err) {
        console.error('Ошибка выхода:', err);
        await sendDismissibleMessage(ctx, '❌ Ошибка при выходе из аккаунта.');
    }
});

// ========================================
//  🔧 НАСТРОЙКИ
// ========================================

bot.hears('🔧 Настройки', async (ctx) => {
    const userId = String(ctx.from.id);
    const user = await User.findOne({ where: { telegramId: userId } });
    
    if (!user || !hasAccess(user, ['bot_admin'])) {
        await sendDismissibleMessage(ctx, '❌ У вас нет прав для доступа к настройкам бота.');
        return;
    }
    
    await ctx.reply(`
👑 *АДМИН-ПАНЕЛЬ БОТА*

Добро пожаловать, ${user.fullName || user.login}!

Выберите действие:
    `, settingsKeyboard);
});

// ========================================
//  🔙 В ГЛАВНОЕ МЕНЮ
// ========================================

bot.hears('🔙 В главное меню', async (ctx) => {
    const userId = String(ctx.from.id);
    const user = await User.findOne({ where: { telegramId: userId } });
    
    let keyboard = mainKeyboard;
    if (user) {
        const isActive = user.isActive !== false;
        const statusButton = isActive ? '🟢 Отдыхаю' : '🔴 На работе';
        keyboard.reply_markup.keyboard[2] = [statusButton, '🚪 Выйти'];
    }
    
    await ctx.reply('🏠 *Главное меню*\n\nВыберите действие:', keyboard);
});

// ========================================
//  👥 ВСЕ ПОЛЬЗОВАТЕЛИ
// ========================================

bot.hears('👥 Все пользователи', async (ctx) => {
    const userId = String(ctx.from.id);
    const user = await User.findOne({ where: { telegramId: userId } });
    
    if (!user || !hasAccess(user, ['bot_admin', 'admin', 'boss', 'worker'])) {
        await sendDismissibleMessage(ctx, '❌ У вас нет прав для просмотра списка пользователей.');
        return;
    }
    
    try {
        const users = await User.findAll({
            order: [['role', 'ASC'], ['fullName', 'ASC']]
        });
        
        if (!users || users.length === 0) {
            await sendDismissibleMessage(ctx, '📭 Пользователей пока нет.');
            return;
        }
        
        let message = '👥 *СПИСОК ПОЛЬЗОВАТЕЛЕЙ*\n━━━━━━━━━━━━━━━━━━\n';
        
        (users || []).forEach((u, index) => {
            const roleDisplay = u.role ? getRoleDisplay(u.role) : '❌ Нет роли';
            const tgStatus = u.telegramId ? '✅' : '❌';
            const activeStatus = u.isActive !== false ? '🟢' : '🔴';
            message += `\n${index + 1}. *${u.fullName || u.login}*\n`;
            message += `   Логин: ${u.login} | Роль: ${roleDisplay}\n`;
            message += `   TG: ${tgStatus} ${u.telegramId ? 'привязан' : 'не привязан'}\n`;
            message += `   Статус: ${activeStatus} ${u.isActive !== false ? 'На работе' : 'Отдыхает'}\n`;
        });
        
        message += '\n━━━━━━━━━━━━━━━━━━\n';
        message += `👥 Всего: ${users.length} пользователей`;

        await sendDismissibleMessage(ctx, message);

    } catch (err) {
        console.error('Ошибка списка пользователей:', err);
        await sendDismissibleMessage(ctx, '❌ Ошибка при загрузке пользователей');
    }
});

// ========================================
//  👤 УПРАВЛЕНИЕ СТАТУСАМИ
// ========================================

bot.hears('👤 Управление статусами', async (ctx) => {
    const userId = String(ctx.from.id);
    const user = await User.findOne({ where: { telegramId: userId } });
    
    if (!user || !hasAccess(user, ['bot_admin'])) {
        await sendDismissibleMessage(ctx, '❌ У вас нет прав для этой команды.');
        return;
    }
    
    const users = await User.findAll({
        where: {
            telegramId: { [Op.not]: null },
            role: { [Op.ne]: 'bot_admin' }
        },
        order: [['fullName', 'ASC']]
    });
    
    if (!users || users.length === 0) {
        await sendDismissibleMessage(ctx, '📭 Нет пользователей с привязанным Telegram.');
        return;
    }
    
    const userButtons = (users || []).map(u => {
        const statusText = u.isActive !== false ? '🟢 Отдыхает' : '🔴 Работает';
        return [{ text: `${u.fullName || u.login} (${u.login}) — ${statusText}`, callback_data: `status_user_${u.id}` }];
    });
    
    userButtons.push([{ text: '❌ Отмена', callback_data: 'status_cancel' }]);
    
    await ctx.reply('👤 *Выберите пользователя для изменения статуса:*', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: userButtons
        }
    });
});

// ========================================
//  ОБРАБОТКА ВЫБОРА ПОЛЬЗОВАТЕЛЯ ДЛЯ СТАТУСА
// ========================================

bot.action(/status_user_(.+)/, async (ctx) => {
    const targetUserId = parseInt(ctx.match[1]);
    
    const targetUser = await User.findByPk(targetUserId);
    if (!targetUser) {
        await ctx.answerCbQuery('❌ Пользователь не найден');
        return;
    }
    
    if (targetUser.role === 'bot_admin') {
        await ctx.answerCbQuery('❌ Нельзя менять статус главного администратора');
        return;
    }
    
    const currentStatus = targetUser.isActive !== false;
    const newStatus = !currentStatus;
    
    await targetUser.update({ isActive: newStatus });
    
    const statusText = newStatus ? '🟢 Отдыхает' : '🔴 На работе';
    const statusEmoji = newStatus ? '🟢' : '🔴';
    
    await ctx.deleteMessage();
    await sendDismissibleMessage(ctx, `
✅ *Статус изменён!*

👤 Пользователь: ${targetUser.fullName || targetUser.login}
📌 Логин: ${targetUser.login}
🔄 Новый статус: ${statusEmoji} ${statusText}
    `);
    
    if (targetUser.telegramId) {
        try {
            await bot.telegram.sendMessage(targetUser.telegramId, `
🔔 *Ваш статус изменён администратором*

📌 Новый статус: ${statusEmoji} ${statusText}

${newStatus ? 'Теперь вы будете получать уведомления о новых заказах.' : 'Теперь вы не будете получать уведомления о новых заказах.'}
            `, { parse_mode: 'Markdown' });
        } catch (e) {
            console.error(`❌ ${targetUser.login}:`, e.message);
        }
    }
    
    await ctx.answerCbQuery('✅ Статус изменён');
});

// ========================================
//  ОТМЕНА (СТАТУСЫ)
// ========================================

bot.action('status_cancel', async (ctx) => {
    await ctx.deleteMessage();
    await ctx.answerCbQuery('❌ Отменено');
});

// ========================================
//  👤 ДАТЬ РОЛЬ
// ========================================

bot.hears('👤 Дать роль', async (ctx) => {
    const userId = String(ctx.from.id);
    const user = await User.findOne({ where: { telegramId: userId } });
    
    if (!user || !hasAccess(user, ['bot_admin'])) {
        await sendDismissibleMessage(ctx, '❌ У вас нет прав для этой команды.');
        return;
    }
    
    const users = await User.findAll({
        where: { role: { [Op.ne]: 'bot_admin' } },
        order: [['fullName', 'ASC']]
    });
    
    if (!users || users.length === 0) {
        await sendDismissibleMessage(ctx, '📭 Нет пользователей для назначения роли.');
        return;
    }
    
    roleState[userId] = 'give';
    
    const userButtons = (users || []).map(u => {
        const roleDisplay = u.role ? getRoleDisplay(u.role) : '❌ Нет роли';
        return [{ text: `${u.fullName || u.login} (${u.login}) — ${roleDisplay}`, callback_data: `role_user_${u.id}` }];
    });
    
    userButtons.push([{ text: '❌ Отмена', callback_data: 'role_cancel' }]);
    
    await ctx.reply('👤 *Выберите пользователя для назначения роли:*', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: userButtons
        }
    });
});

// ========================================
//  👤 СНЯТЬ РОЛЬ
// ========================================

bot.hears('👤 Снять роль', async (ctx) => {
    const userId = String(ctx.from.id);
    const user = await User.findOne({ where: { telegramId: userId } });
    
    if (!user || !hasAccess(user, ['bot_admin'])) {
        await sendDismissibleMessage(ctx, '❌ У вас нет прав для этой команды.');
        return;
    }
    
    const users = await User.findAll({
        where: {
            role: { [Op.ne]: null, [Op.ne]: 'bot_admin' }
        },
        order: [['fullName', 'ASC']]
    });
    
    if (!users || users.length === 0) {
        await sendDismissibleMessage(ctx, '📭 Нет пользователей с ролями для снятия.');
        return;
    }
    
    roleState[userId] = 'remove';
    
    const userButtons = (users || []).map(u => {
        const roleDisplay = u.role ? getRoleDisplay(u.role) : '❌ Нет роли';
        return [{ text: `${u.fullName || u.login} (${u.login}) — ${roleDisplay}`, callback_data: `role_user_${u.id}` }];
    });
    
    userButtons.push([{ text: '❌ Отмена', callback_data: 'role_cancel' }]);
    
    await ctx.reply('👤 *Выберите пользователя для снятия роли:*', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: userButtons
        }
    });
});

// ========================================
//  ОБРАБОТКА ВЫБОРА ПОЛЬЗОВАТЕЛЯ ДЛЯ РОЛИ
// ========================================

bot.action(/role_user_(.+)/, async (ctx) => {
    const userId = String(ctx.from.id);
    const targetUserId = parseInt(ctx.match[1]);
    const action = roleState[userId];
    
    if (!action) {
        await ctx.answerCbQuery('❌ Сессия истекла, начните заново');
        return;
    }
    
    const targetUser = await User.findByPk(targetUserId);
    if (!targetUser) {
        await ctx.answerCbQuery('❌ Пользователь не найден');
        return;
    }
    
    if (targetUser.role === 'bot_admin') {
        await ctx.answerCbQuery('❌ Нельзя менять роль главного администратора');
        return;
    }
    
    if (action === 'remove') {
        if (!targetUser.role) {
            await ctx.answerCbQuery('❌ У пользователя уже нет роли');
            return;
        }
        
        const oldRole = targetUser.role;
        const oldRoleDisplay = getRoleDisplay(oldRole);
        
        await targetUser.update({ role: null });
        
        delete roleState[userId];
        
        await ctx.deleteMessage();
        await sendDismissibleMessage(ctx, `
✅ *Роль снята!*

👤 Пользователь: ${targetUser.fullName || targetUser.login}
📌 Логин: ${targetUser.login}
🔄 Снята роль: ${oldRoleDisplay}
📌 Теперь: ❌ Нет роли (доступ закрыт)
        `);
        
        await ctx.answerCbQuery('✅ Роль снята');
        
    } else if (action === 'give') {
        roleTempData[userId] = {
            targetUserId: targetUser.id,
            targetUserLogin: targetUser.login,
            targetUserName: targetUser.fullName || targetUser.login
        };
        
        const roles = [
            { code: 'admin', display: '👑 Администратор сайта' },
            { code: 'boss', display: '💼 Начальство' },
            { code: 'worker', display: '🧵 Вязальщик' }
        ];
        
        const roleButtons = roles.map(r => {
            return [{ text: r.display, callback_data: `role_set_${r.code}` }];
        });
        
        roleButtons.push([{ text: '🔙 Назад', callback_data: 'role_back_users' }]);
        roleButtons.push([{ text: '❌ Отмена', callback_data: 'role_cancel' }]);
        
        await ctx.editMessageText(`
👤 *Выберите роль для пользователя:*

📌 ${targetUser.fullName || targetUser.login} (${targetUser.login})
        `, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: roleButtons
            }
        });
        
        await ctx.answerCbQuery();
    }
});

// ========================================
//  ОБРАБОТКА ВЫБОРА РОЛИ
// ========================================

bot.action(/role_set_(.+)/, async (ctx) => {
    const userId = String(ctx.from.id);
    const roleCode = ctx.match[1];
    const tempData = roleTempData[userId];
    
    if (!tempData) {
        await ctx.answerCbQuery('❌ Сессия истекла, начните заново');
        return;
    }
    
    const targetUser = await User.findByPk(tempData.targetUserId);
    if (!targetUser) {
        await ctx.answerCbQuery('❌ Пользователь не найден');
        return;
    }
    
    const oldRole = targetUser.role;
    const oldRoleDisplay = oldRole ? getRoleDisplay(oldRole) : '❌ Нет роли';
    const newRoleDisplay = getRoleDisplay(roleCode);
    
    await targetUser.update({ role: roleCode });
    
    delete roleState[userId];
    delete roleTempData[userId];
    
    await ctx.deleteMessage();
    await sendDismissibleMessage(ctx, `
✅ *Роль назначена!*

👤 Пользователь: ${targetUser.fullName || targetUser.login}
📌 Логин: ${targetUser.login}
🔄 Старая роль: ${oldRoleDisplay}
🆕 Новая роль: ${newRoleDisplay}
    `);
    
    await ctx.answerCbQuery('✅ Роль назначена');
});

// ========================================
//  НАЗАД К СПИСКУ ПОЛЬЗОВАТЕЛЕЙ (РОЛИ)
// ========================================

bot.action('role_back_users', async (ctx) => {
    const userId = String(ctx.from.id);
    const action = roleState[userId];
    
    if (!action) {
        await ctx.answerCbQuery('❌ Сессия истекла');
        return;
    }
    
    const users = await User.findAll({
        where: { role: { [Op.ne]: 'bot_admin' } },
        order: [['fullName', 'ASC']]
    });
    
    const userButtons = (users || []).map(u => {
        const roleDisplay = u.role ? getRoleDisplay(u.role) : '❌ Нет роли';
        return [{ text: `${u.fullName || u.login} (${u.login}) — ${roleDisplay}`, callback_data: `role_user_${u.id}` }];
    });
    
    userButtons.push([{ text: '❌ Отмена', callback_data: 'role_cancel' }]);
    
    await ctx.editMessageText('👤 *Выберите пользователя для назначения роли:*', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: userButtons
        }
    });
    
    await ctx.answerCbQuery();
});

// ========================================
//  ОТМЕНА (РОЛИ)
// ========================================

bot.action('role_cancel', async (ctx) => {
    const userId = String(ctx.from.id);
    
    delete roleState[userId];
    delete roleTempData[userId];
    
    await ctx.deleteMessage();
    await ctx.answerCbQuery('❌ Отменено');
});

// ========================================
//  📢 ОТПРАВИТЬ УВЕДОМЛЕНИЕ
// ========================================

bot.hears('📢 Отправить уведомление', async (ctx) => {
    const userId = String(ctx.from.id);
    const user = await User.findOne({ where: { telegramId: userId } });
    
    if (!user || !hasAccess(user, ['bot_admin', 'admin', 'boss', 'worker'])) {
        await sendDismissibleMessage(ctx, '❌ У вас нет прав для этой команды.');
        return;
    }
    
    const recipientKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '👥 Вязальщикам', callback_data: 'notify_workers' }],
                [{ text: '👑 Админам сайта', callback_data: 'notify_admins' }],
                [{ text: '💼 Начальству', callback_data: 'notify_bosses' }],
                [{ text: '📢 Всем', callback_data: 'notify_all' }],
                [{ text: '❌ Отмена', callback_data: 'notify_cancel' }]
            ]
        }
    };
    
    await ctx.reply('📢 *Кому отправить уведомление?*', {
        parse_mode: 'Markdown',
        ...recipientKeyboard
    });
});

// ========================================
//  ОБРАБОТКА ВЫБОРА ПОЛУЧАТЕЛЯ ДЛЯ УВЕДОМЛЕНИЯ
// ========================================

bot.action(/notify_(.+)/, async (ctx) => {
    const userId = String(ctx.from.id);
    const user = await User.findOne({ where: { telegramId: userId } });
    const recipient = ctx.match[1];
    
    if (!user || !hasAccess(user, ['bot_admin', 'admin', 'boss', 'worker'])) {
        await ctx.answerCbQuery('❌ Нет прав');
        return;
    }
    
    if (recipient === 'cancel') {
        await ctx.deleteMessage();
        await ctx.answerCbQuery('❌ Отменено');
        return;
    }
    
    notificationState[userId] = { recipient };
    
    await ctx.deleteMessage();
    await sendDismissibleMessage(ctx, `
✏️ *Введите текст уведомления*

📌 Получатель: ${getRecipientName(recipient)}

Отправьте текст сообщения.
    `);
    
    await ctx.answerCbQuery('✅ Выберите получателя');
});

// ========================================
//  ОБРАБОТКА ВВОДА ТЕКСТА УВЕДОМЛЕНИЯ
// ========================================

bot.on('text', async (ctx, next) => {
    const userId = String(ctx.from.id);
    const state = notificationState[userId];
    
    if (!state) {
        return await next();
    }
    
    const text = ctx.message.text;
    
    if (text.startsWith('/')) {
        return await next();
    }
    
    const { recipient } = state;
    
    let users = [];
    let recipientName = '';
    
    switch (recipient) {
        case 'workers':
            users = await User.findAll({ where: { role: 'worker', telegramId: { [Op.not]: null } } });
            recipientName = 'вязальщикам';
            break;
        case 'admins':
            users = await User.findAll({ where: { role: 'admin', telegramId: { [Op.not]: null } } });
            recipientName = 'администраторам сайта';
            break;
        case 'bosses':
            users = await User.findAll({ where: { role: 'boss', telegramId: { [Op.not]: null } } });
            recipientName = 'начальству';
            break;
        case 'all':
            users = await User.findAll({ where: { telegramId: { [Op.not]: null } } });
            recipientName = 'всем пользователям';
            break;
        default:
            await sendDismissibleMessage(ctx, '❌ Неизвестный получатель');
            delete notificationState[userId];
            return;
    }
    
    if (!users || users.length === 0) {
        await sendDismissibleMessage(ctx, '❌ Нет пользователей для отправки.');
        delete notificationState[userId];
        return;
    }
    
    let sent = 0;
    for (const u of users) {
        try {
            await bot.telegram.sendMessage(u.telegramId, `📢 *Уведомление от администратора*\n\n${text}`, {
                parse_mode: 'Markdown'
            });
            sent++;
        } catch (e) {
            console.error(`❌ ${u.login}:`, e.message);
        }
    }
    
    await sendDismissibleMessage(ctx, `✅ Уведомление отправлено ${sent} ${recipientName}.`);
    delete notificationState[userId];
});

// ========================================
//  📊 ТЕСТ ОТЧЁТА
// ========================================

bot.hears('📊 Тест отчёта', async (ctx) => {
    const userId = String(ctx.from.id);
    const user = await User.findOne({ where: { telegramId: userId } });
    
    if (!user || !hasAccess(user, ['bot_admin'])) {
        await sendDismissibleMessage(ctx, '❌ У вас нет прав для этой команды.');
        return;
    }
    
    await sendDismissibleMessage(ctx, '⏳ Формирую отчёты за сегодня...');
    
    try {
        const date = new Date();
        
        const dayReport = await generateShiftReport(date, 'day');
        await ctx.reply(`📊 *ДНЕВНАЯ СМЕНА (ТЕСТ)*\n\n${dayReport}`, {
            parse_mode: 'Markdown'
        });
        
        const nightReport = await generateShiftReport(date, 'night');
        await ctx.reply(`📊 *НОЧНАЯ СМЕНА (ТЕСТ)*\n\n${nightReport}`, {
            parse_mode: 'Markdown'
        });
        
    } catch (err) {
        console.error('Ошибка теста отчёта:', err);
        await sendDismissibleMessage(ctx, '❌ Ошибка при формировании отчёта');
    }
});

// ========================================
//  РАСПИСАНИЕ ОТЧЁТОВ (cron)
// ========================================

cron.schedule('0 20 * * *', async () => {
    console.log('📊 Отправка дневного отчёта...');
    const date = new Date();
    const report = await generateShiftReport(date, 'day');
    await notifyBosses(report);
});

cron.schedule('0 8 * * *', async () => {
    console.log('📊 Отправка ночного отчёта...');
    const date = new Date();
    const report = await generateShiftReport(date, 'night');
    await notifyBosses(report);
});

// ========================================
//  ЗАПУСК БОТА (polling с ретраями)
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

// ========================================
//  ПОДКЛЮЧЕНИЕ К БД И ЗАПУСК
// ========================================

sequelize.authenticate()
    .then(() => {
        console.log('✅ База данных подключена');
        return sequelize.sync();
    })
    .then(() => {
        console.log('✅ Таблицы синхронизированы');
        launchWithRetry();
    })
    .catch(err => {
        console.error('❌ Ошибка подключения к БД:', err);
        process.exit(1);
    });

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