// modules/executeTradeAutomatically.js
const ccxt = require('ccxt');
const { exchangeConfigs, ccxtConfig, logger, portfolioData, emitPortfolio, updatePortfolio } = require('./utils'); // Импортируем необходимые константы и функции

// Модифицированная функция автоматического совершения сделки с использованием CCXT
async function executeTradeAutomatically(symbol, side, amount, price, exchange, options = {}) {
  try {
    const exchangeInstance = new ccxt[exchange]({
      apiKey: exchangeConfigs[exchange].apiKey,
      secret: exchangeConfigs[exchange].secret,
      enableRateLimit: true,
      options: {
        recvWindow: 60000,
        serverTime: () => Date.now(), // Автоматическая синхронизация времени с сервером
        ...options,
      },
    });

    
    // Отображение портфеля на клиенте
    emitPortfolio();

    const order = await exchangeInstance.createOrder(symbol, 'LIMIT', side, amount, price, {
      'agent': options.agent,
    });
    logger.info(`Подключение (Автоматическое выполнение сделки) - OK`);
    
    // Обновление портфеля после совершения сделки
    updatePortfolio(order);
    
    return order;
  } catch (error) {
    logger.error(`Подключение (Автоматическое выполнение сделки) - No`, error);
    throw error;
  }
}

module.exports = executeTradeAutomatically;