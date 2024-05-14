// modules/initPortfolioData.js
const { loadPortfolioData, logger } = require('./index'); // Импортируем необходимые функции

// Загрузка данных портфеля при запуске сервера
let portfolioData = null;

async function initPortfolioData() {
  portfolioData = await loadPortfolioData();
  logger.info('Данные портфеля загружены');
}

module.exports = initPortfolioData;