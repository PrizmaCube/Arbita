// modules/fetchOpenOrders.js
const { logger } = require('./utils'); // Импортируем logger

// Добавление метода получения открытых ордеров
async function fetchOpenOrders(exchange, symbol) {
  try {
    const openOrders = await exchange.fetchOpenOrders(symbol, undefined, undefined, {
      'agent': proxyAgent,
    });
    return openOrders;
  } catch (error) {
    logger.error(`Ошибка при получении открытых ордеров для символа ${symbol} на бирже ${exchange.id}:`, error);
    return [];
  }
}

module.exports = fetchOpenOrders;