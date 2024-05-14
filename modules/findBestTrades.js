// modules/findBestTrades.js
const { fetchAllPrices, calculateProfit, executeTradeAutomatically, io, logger } = require('./index'); // Импортируем необходимые функции

// Функция для поиска лучших сделок с использованием CCXT и анализа данных
async function findBestTrades() {
  try {
    logger.info('Поиск лучших сделок начат');
    const prices = await fetchAllPrices();  // Получение цен со всех бирж

    if (Object.keys(prices).length === 0) {
      logger.warn('Не удалось получить цены для поиска лучших сделок');
      return;
    }

    // Поиск наименьшей цены покупки и наибольшей цены продажи среди всех бирж
    const buyPrices = Object.values(prices).map(price => price.bid);
    const sellPrices = Object.values(prices).map(price => price.ask);
    const bestBuyPrice = Math.min(...buyPrices);
    const bestSellPrice = Math.max(...sellPrices);


    // Расчет спреда между лучшей ценой покупки и продажи
    const spread = bestSellPrice - bestBuyPrice;
    logger.info(`Рассчитанная разница между лучшей ценой покупки и продажи: ${spread}`);

    if (spread > 50) {
      // Расчет потенциальной прибыли от арбитражной сделки
      const profit = calculateProfit(bestBuyPrice, bestSellPrice);

      logger.info(`Обнаружена арбитражная возможность с потенциальной прибылью: $${profit.toFixed(2)}`);
      
      // Формирование объекта с информацией о лучшей сделке
      const bestTrade = {
        buyExchange: Object.keys(prices).find(exchange => prices[exchange].bid === bestBuyPrice),
        buyPrice: bestBuyPrice,
        sellExchange: Object.keys(prices).find(exchange => prices[exchange].ask === bestSellPrice),
        sellPrice: bestSellPrice,
        profit: profit
      };

      // Отправка лучшей сделки клиенту через Socket.IO
      io.emit('bestTrade', bestTrade);
      logger.info('Информация о лучшей сделке отправлена клиенту через Socket.IO');

      // Автоматическое выполнение сделок на основе лучших цен
      await executeTradeAutomatically('BTC/USDT', 'buy', 0.01, bestBuyPrice, bestTrade.buyExchange);
      await executeTradeAutomatically('BTC/USDT', 'sell', 0.01, bestSellPrice, bestTrade.sellExchange);
    }
  } catch (error) {
    logger.error('Ошибка при поиске лучших сделок:', error);
  }
}

module.exports = findBestTrades;