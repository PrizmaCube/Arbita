// modules/fetchTicker.js
const ccxt = require('ccxt');
const { exchangeConfigs, ccxtConfig, logger, saveToCsv } = require('./utils'); // Импортируем необходимые константы

// Получение данных о цене для указанной пары на бирже
async function fetchTicker(exchangeId, symbol) {
  try {
    const exchangeClass = ccxt[exchangeId];
    const exchange = new exchangeClass({
      apiKey: exchangeConfigs[exchangeId].apiKey,
      secret: exchangeConfigs[exchangeId].secret,
      ...ccxtConfig,
      enableRateLimit: true,
    });

    const ticker = await exchange.fetchTicker(symbol);
    logger.info(`Данные о цене для пары ${symbol} на бирже ${exchangeId} получены успешно: ${JSON.stringify(ticker)}`);
    

    // Добавление специальной обработки для Coinex
    if (exchangeId.toLowerCase() === 'coinex') {
      logger.info(`Полный ответ API от Coinex для ${symbol}: ${JSON.stringify(ticker)}`);
      ticker.bid = ticker.info.last; // Пример использования последней цены как bid
      ticker.ask = ticker.info.last; // Пример использования последней цены как ask
    }

    saveToCsv(exchangeId, symbol, ticker);
    return ticker;
  } catch (error) {
    logger.error(`Ошибка при получении данных о цене для пары ${symbol} на бирже ${exchangeId}:`, error);
    return null;
  }
}

module.exports = fetchTicker;