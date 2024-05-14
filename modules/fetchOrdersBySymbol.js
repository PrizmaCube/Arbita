// modules/fetchOrdersBySymbol.js
const { logger } = require('./utils'); // Импортируем logger

// Получение ордеров с бирж
async function fetchOrdersBySymbol(exchange, symbol) {
  try {
    const orders = await exchange.fetchOrders(symbol, undefined, undefined, {
      'agent': proxyAgent,
    });
    return orders;
  } catch (error) {
    logger.error(`Ошибка при получении ордеров для символа ${symbol} на бирже ${exchange.id}:`, error);
    return [];
  }
}

module.exports = fetchOrdersBySymbol;