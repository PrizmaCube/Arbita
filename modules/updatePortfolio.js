// modules/updatePortfolio.js
const { portfolioData, getConsolidatedPortfolio, savePortfolioData, logger } = require('./utils'); // Импортируем необходимые константы

// Функция для обновления портфеля после сделки
function updatePortfolio(order) {
  if (!portfolioData) {
    logger.error('Данные портфеля не загружены');
    return;
  }

  const { symbol, side, amount, price } = order;
  const portfolioType = portfolioData.activePortfolio;
  const portfolio = portfolioData[portfolioType === 'real' ? 'realPortfolio' : 'testPortfolio'];
  
  if (!portfolio.coins[symbol]) {
    portfolio.coins[symbol] = { amount: 0, value: 0 };
  }
  
  const coin = portfolio.coins[symbol];

  if (side === 'buy') {
    coin.amount += amount;
    coin.value += amount * price;
  } else if (side === 'sell') {
    coin.amount -= amount;
    coin.value -= amount * price;
  }

  portfolio.coins[symbol] = coin;
  portfolio.totalValue += (side === 'buy' ? 1 : -1) * amount * price;

  portfolio.tradeHistory.unshift(order);
  if (portfolio.tradeHistory.length > 20) {
    portfolio.tradeHistory.pop();
  }

  // Обновление общего портфеля
  const consolidatedPortfolio = getConsolidatedPortfolio();
  portfolioData.consolidatedPortfolio = consolidatedPortfolio;

  savePortfolioData(portfolioData);
}

module.exports = updatePortfolio;