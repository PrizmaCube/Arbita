// modules/depositToConsolidatedPortfolio.js
const { getConsolidatedPortfolio, saveConsolidatedPortfolio, logger } = require('./index'); // Импортируем необходимые функции

// Функция для пополнения общего портфеля
function depositToConsolidatedPortfolio(coin, amount) {
  const consolidatedPortfolio = getConsolidatedPortfolio();

  if (!consolidatedPortfolio.coins[coin]) {
    consolidatedPortfolio.coins[coin] = { amount: 0, value: 0 };
  }

  consolidatedPortfolio.coins[coin].amount += amount;

  // Сохранение обновленного общего портфеля
  saveConsolidatedPortfolio(consolidatedPortfolio);
}

module.exports = depositToConsolidatedPortfolio;