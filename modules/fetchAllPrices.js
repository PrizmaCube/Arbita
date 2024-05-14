// modules/fetchAllPrices.js
const ccxt = require('ccxt');
const { exchangeConfigs, ccxtConfig, logger, fetchTicker } = require('./utils'); // Импортируем необходимые константы

// Функция для получения цен с различных бирж
async function fetchAllPrices() {
  const allPrices = {};
  const symbol = 'BTC/USDT';

  const promises = Object.keys(exchangeConfigs).map(async (exchangeId) => {
    const exchange = new ccxt[exchangeId]({
      apiKey: exchangeConfigs[exchangeId].apiKey,
      secret: exchangeConfigs[exchangeId].secret,
      ...ccxtConfig,
      enableRateLimit: true,
    });

    try {
      logger.info(`Загрузка рынков для биржи ${exchangeId}`);
      await exchange.loadMarkets();
      if (exchange.symbols.includes(symbol)) {
        const ticker = await fetchTicker(exchangeId, symbol);
        if (ticker && ticker.bid && ticker.ask) {
          allPrices[exchangeId] = {
            [symbol]: {
              bid: ticker.bid,
              ask: ticker.ask,
            }
          };
        } else {
          logger.warn(`Не удалось получить цену для символа ${symbol} на бирже ${exchangeId}`);
        }
      }
      logger.info(`Данные с биржи ${exchangeId} получены успешно`);
    } catch (error) {
      logger.error(`Ошибка при получении данных с биржи ${exchangeId}:`, error);
    }
  });

  await Promise.all(promises);

  if (Object.keys(allPrices).length === 0) {
    logger.warn('Не удалось получить данные ни с одной биржи');
  }

  return allPrices;
}

module.exports = fetchAllPrices;