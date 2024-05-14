// modules/createPortfolioFiles.js
const fs = require('fs');
const path = require('path');
const { exchangeConfigs, logger } = require('./utils'); // Импортируем необходимые константы

// Функция для создания файла портфеля для каждой биржи и общего портфеля
async function createPortfolioFiles() {
  try {
    for (const exchangeId in exchangeConfigs) {
      const exchangeFolder = path.join(__dirname, 'data', exchangeId);
      const portfolioFileName = path.join(exchangeFolder, 'portfolio.json');
      
      // Проверяем, существует ли файл портфеля для биржи
      if (!fs.existsSync(portfolioFileName)) {
        await fs.promises.writeFile(portfolioFileName, JSON.stringify({}, null, 2));
        logger.info(`Файл портфеля для биржи ${exchangeId} создан: ${portfolioFileName}`);
      }
    }

    const consolidatedFolder = path.join(__dirname, 'ALL_Portfolio');
    if (!fs.existsSync(consolidatedFolder)) {
      await fs.promises.mkdir(consolidatedFolder, { recursive: true });
    }
    const consolidatedPortfolioFileName = path.join(consolidatedFolder, 'consolidated_portfolio.json');
    
    // Проверяем, существует ли файл общего портфеля
    if (!fs.existsSync(consolidatedPortfolioFileName)) {
      await fs.promises.writeFile(consolidatedPortfolioFileName, JSON.stringify({}, null, 2));
      logger.info(`Файл общего портфеля создан: ${consolidatedPortfolioFileName}`);
    }
  } catch (error) {
    logger.error('Ошибка при создании файлов портфелей:', error);
  }
}

module.exports = createPortfolioFiles;