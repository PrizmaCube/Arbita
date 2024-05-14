// modules/switchTradingMode.js
const { portfolioData, savePortfolioData, logger } = require('./utils'); // Импортируем необходимые константы

// Функция для переключения режима торговли
async function switchTradingMode(mode) {
  try {
    if (mode === 'real' || mode === 'test') {
      portfolioData.activePortfolio = mode;
      savePortfolioData(portfolioData);
      logger.info(`Режим торговли переключен на ${mode}`);
    } else {
      throw new Error('Неверный режим торговли');
    }
  } catch (error) {
    logger.error('Ошибка при переключении режима торговли:', error);
    throw error;
  }
}

module.exports = switchTradingMode;