// modules/getCurrentOpenPositions.js
const ccxt = require('ccxt');
const { exchangeConfigs, ccxtConfig, logger, io } = require('./utils'); // Импортируем необходимые константы

// Функция для получения текущих открытых позиций
async function getCurrentOpenPositions() {
  try {
    const positions = [];

    for (const exchangeId in exchangeConfigs) {
      const exchange = new ccxt[exchangeId]({
        apiKey: exchangeConfigs[exchangeId].apiKey,
        secret: exchangeConfigs[exchangeId].secret,
        password: exchangeConfigs[exchangeId].password,
        ...ccxtConfig,
      });

      try {
        const openOrders = await exchange.fetchOpenOrders('BTC/USDT');
        const exchangePositions = openOrders.map(order => ({
          exchange: exchangeId,
          symbol: order.symbol,
          side: order.side,
          amount: order.amount,
          price: order.price
        }));
        positions.push(...exchangePositions);
        logger.info(`Подключение (Получение текущих открытых позиций) - OK для биржи ${exchangeId}`);
      } catch (error) {
        logger.error(`Подключение (Получение текущих открытых позиций) - No для биржи ${exchangeId}`, error);
      }
    }

    io.emit('positions', positions); // Отправка текущих открытых позиций всем подключенным клиентам через Socket.IO
    return positions;
  } catch (error) {
    logger.error(`Подключение (Получение текущих открытых позиций) - No`, error);
    throw error;
  }
}

module.exports = getCurrentOpenPositions;