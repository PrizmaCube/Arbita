// modules/saveDataToFile.js
const fs = require('fs');
const { logger } = require('./utils'); // Импортируем logger

// Функция для сохранения данных в локальный файл
function saveDataToFile(data) {
  try {
    fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
    logger.info(`Подключение (Сохранение данных в файл) - OK`);
    return 'Данные сохранены в локальный файл';
  } catch (error) {
    logger.error(`Подключение (Сохранение данных в файл) - No`, error);
    throw error;
  }
}

module.exports = saveDataToFile;