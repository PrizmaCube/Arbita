// modules/tradeFromConsolidatedPortfolio.js
const ccxt = require('ccxt');
const { getConsolidatedPortfolio, saveConsolidatedPortfolio, exchangeConfigs, logger } = require('./utils'); // Импортируем необходимые константы

// Функция для торговли с общего портфеля на всех биржах
async function tradeFromConsolidatedPortfolio(symbol, side, amount, price) {
  const consolidatedPortfolio = getConsolidatedPortfolio();
  const coin = symbol.split('/')[0];

  if (!consolidatedPortfolio.coins[coin]) {
    logger.error(`Монета ${coin} отсутствует в общем портфеле`);
    return;
  }

  // Проверка наличия достаточного количества монет в общем портфеле
  if (side === 'sell' && consolidatedPortfolio.coins[coin] < amount) {
    logger.error(`Недостаточное количество ${coin} в общем портфеле для продажи`);
    return;
  }

  for (const exchangeId in exchangeConfigs) {
    try {
      const exchangeInstance = new ccxt[exchangeId]({
        apiKey: exchangeConfigs[exchangeId].apiKey,
        secret: exchangeConfigs[exchangeId].secret,
        enableRateLimit: true,
        options: {
          recvWindow: 60000,
          serverTime: () => Date.now(),
        },
      });

      const order = await exchangeInstance.createOrder(symbol, 'LIMIT', side, amount, price);

      logger.info(`Подключение (Торговля с общего портфеля на бирже ${exchangeId}) - OK`);

      // Обновление общего портфеля после выполнения сделки
      if (side === 'buy') {
        consolidatedPortfolio.coins[coin] += amount;
        consolidatedPortfolio.totalValue += amount * price;
      } else if (side === 'sell') {
        consolidatedPortfolio.coins[coin] -= amount;
        consolidatedPortfolio.totalValue -= amount * price;
      }
    } catch (error) {
      logger.error(`Подключение (Торговля с общего портфеля на бирже ${exchangeId}) - No`, error);
    }
  }

  // Сохранение обновленного общего портфеля
  saveConsolidatedPortfolio(consolidatedPortfolio);
}

module.exports = tradeFromConsolidatedPortfolio;