// modules/monitorPricesAndExecuteTrades.js
const ccxt = require('ccxt');
const { exchangeConfigs, ccxtConfig, logger, executeTradeAutomatically, portfolioData } = require('./utils'); // Импортируем необходимые константы

// Функция для мониторинга цен в реальном времени и выполнения сделок с использованием CCXT
async function monitorPricesAndExecuteTrades() {
  try {
    const exchangeInstances = {};
    for (const exchange in exchangeConfigs) {
      exchangeInstances[exchange] = new ccxt[exchange]({
        apiKey: exchangeConfigs[exchange].apiKey,
        secret: exchangeConfigs[exchange].secret,
        ...ccxtConfig,
        enableRateLimit: true,
        options: {
          recvWindow: 60000,
          serverTime: () => Date.now(), // Автоматическая синхронизация времени с сервером
        },
      });
    }

    while (true) {
      const activeExchange = portfolioData.activePortfolio === 'real' ? 'binance' : 'testExchange';
      const ticker = await exchangeInstances[activeExchange].fetchTicker('BTC/USDT');
      const bestBuyPrice = ticker.bid;
      const bestSellPrice = ticker.ask;

      const bestTrade = {
        buyExchange: activeExchange,
        buyPrice: bestBuyPrice,
        sellExchange: activeExchange,
        sellPrice: bestSellPrice,
        profit: bestSellPrice - bestBuyPrice
      };

      if (bestTrade.profit > 50) {
        await executeTradeAutomatically('BTC/USDT', 'buy', 0.01, bestBuyPrice, activeExchange);
        await executeTradeAutomatically('BTC/USDT', 'sell', 0.01, bestSellPrice, activeExchange);
        logger.info(`Подключение (Мониторинг цен и выполнение сделок) - OK`);
      }

      await new Promise(resolve => setTimeout(resolve, 60000)); // Ждать 1 минуту перед повторной проверкой
    }
  } catch (error) {
    logger.error(`Подключение (Мониторинг цен и выполнение сделок) - No`, error);
  }
}

module.exports = monitorPricesAndExecuteTrades;