// modules/getConsolidatedPortfolio.js

// Функция для получения общего портфеля
function getConsolidatedPortfolio(portfolioBalances) {
    const consolidatedPortfolio = {
      totalValue: 0,
      coins: {},
    };
  
    for (const exchangeId in portfolioBalances) {
      const balances = portfolioBalances[exchangeId];
      for (const coin in balances) {
        if (balances[coin]) {
          const balance = balances[coin].total || (balances[coin].free + balances[coin].used);
          if (balance > 0) {
            if (!consolidatedPortfolio.coins[coin]) {
              consolidatedPortfolio.coins[coin] = 0;
            }
            consolidatedPortfolio.coins[coin] += balance;
            consolidatedPortfolio.totalValue += balance;
          }
        }
      }
    }
  
    return consolidatedPortfolio;
  }
  
  module.exports = getConsolidatedPortfolio;