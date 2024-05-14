// modules/sendTelegramMessage.js
const TelegramBot = require('node-telegram-bot-api');
const { config, logger } = require('./utils'); // Импортируем необходимые константы

// Настройка Telegram бота
const telegramBot = new TelegramBot(config.botToken, { polling: false });

// Функция для отправки сообщения в Telegram
async function sendTelegramMessage(message) {
  try {
    await telegramBot.sendMessage(config.chatId, message);
    logger.info(`Сообщение отправлено в Telegram: ${message}`);
  } catch (error) {
    logger.error('Ошибка при отправке сообщения в Telegram:', error);
  }
}

module.exports = sendTelegramMessage;