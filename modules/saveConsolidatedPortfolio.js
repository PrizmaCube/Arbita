// modules/saveConsolidatedPortfolio.js
const fs = require('fs');
const path = require('path');
const { logger } = require('./utils'); // Импортируем logger

  // Сохранение Consolidated Portfolio 
async function saveConsolidatedPortfolio(consolidatedPortfolio) {
  try {
    const consolidatedFolder = path.join(__dirname, 'ALL_Portfolio');
    await fs.promises.mkdir(consolidatedFolder, { recursive: true });

    const consolidatedPortfolioFileName = path.join(consolidatedFolder, 'consolidated_portfolio.json');
    await fs.promises.writeFile(consolidatedPortfolioFileName, JSON.stringify(consolidatedPortfolio, null, 2));

    logger.info(`Общий портфель сохранен в файл: ${consolidatedPortfolioFileName}`);
  } catch (error) {
    logger.error('Ошибка при сохранении общего портфеля:', error);
    throw error;
  }
}

module.exports = saveConsolidatedPortfolio;