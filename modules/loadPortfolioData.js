// modules/loadPortfolioData.js
const { fetchPortfolioBalances, fetchTicker, logger } = require('./index'); // Импортируем необходимые функции

// Функция для загрузки данных портфеля из файла
async function loadPortfolioData() {
  try {
    const portfolioBalances = await fetchPortfolioBalances();
    const portfolioData = {
      realPortfolio: {
        totalValue: 0,
        coins: {},
        tradeHistory: [],
      },
      testPortfolio: {
        totalValue: 0,
        coins: {},
        tradeHistory: [],
      },
      activePortfolio: 'real',
    };

    for (const exchangeId in portfolioBalances) {
      const balances = portfolioBalances[exchangeId];
      for (const coin in balances) {
        if (balances[coin] && (balances[coin].free > 0 || balances[coin].used > 0)) {
          const amount = balances[coin].free + balances[coin].used;
          const ticker = await fetchTicker(exchangeId, `${coin}/USDT`);
          if (ticker) {
            const value = amount * ticker.last;
            portfolioData.realPortfolio.coins[coin] = { amount, value };
            portfolioData.realPortfolio.totalValue += value;
          }
        }
      }
    }

    return portfolioData;
  } catch (error) {
    logger.error('Ошибка при загрузке данных портфеля:', error);
    return {
      realPortfolio: {
        totalValue: 0,
        coins: {},
        tradeHistory: [],
      },
      testPortfolio: {
        totalValue: 0,
        coins: {},
        tradeHistory: [],
      },
      activePortfolio: 'real',
    };
  }
}

module.exports = loadPortfolioData;