// modules/createExchangeFolders.js
const fs = require('fs');
const path = require('path');
const { exchangeConfigs, logger } = require('./utils'); // Импортируем необходимые константы

// Функция для создания папки для каждой биржи
async function createExchangeFolders() {
  try {
    for (const exchangeId in exchangeConfigs) {
      const exchangeFolder = path.join(__dirname, 'data', exchangeId);
      await fs.promises.mkdir(exchangeFolder, { recursive: true });
      logger.info(`Папка для биржи ${exchangeId} создана: ${exchangeFolder}`);
    }
  } catch (error) {
    logger.error('Ошибка при создании папок для бирж:', error);
  }
}

module.exports = createExchangeFolders;