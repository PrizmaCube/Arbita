// modules/setStopLossAndTakeProfit.js
const ccxt = require('ccxt');
const { exchangeConfigs, logger } = require('./utils'); // Импортируем необходимые константы

// Функция для установки стоп-лосса и тейк-профита
async function setStopLossAndTakeProfit(symbol, side, amount, price, stopLossPrice, takeProfitPrice, exchange) {
  try {
    const exchangeInstance = new ccxt[exchange]({
      apiKey: exchangeConfigs[exchange].apiKey,
      secret: exchangeConfigs[exchange].secret,
    });
    await exchangeInstance.createOrder(symbol, 'STOP_LOSS_LIMIT', side, amount, price, {
      'stopPrice': stopLossPrice
    });
    await exchangeInstance.createOrder(symbol, 'TAKE_PROFIT_LIMIT', side, amount, price, {
      'stopPrice': takeProfitPrice
    });
    logger.info(`Подключение (Установка стоп-лосса и тейк-профита) - OK`);
  } catch (error) {
    logger.error(`Подключение (Установка стоп-лосса и тейк-профита) - No`, error);
    throw error;
  }
}

module.exports = setStopLossAndTakeProfit;