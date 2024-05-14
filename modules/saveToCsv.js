// modules/saveToCsv.js
const fs = require('fs');
const path = require('path');
const { logger } = require('./utils'); // Импортируем logger

// Сохранение потока данных в CSV 
function saveToCsv(exchangeId, symbol, ticker) {
  const dirPath = path.join(__dirname, 'data');
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }

  const filePath = path.join(dirPath, `${exchangeId}.csv`);

  fs.access(filePath, fs.constants.F_OK, (err) => {
    const headers = 'Symbol,Bid,Ask\n';
    const data = `${symbol},${ticker.bid},${ticker.ask}\n`;

    if (err) {
      // Файл не существует, создаем новый файл с заголовками и данными
      fs.writeFile(filePath, headers + data, (err) => {
        if (err) {
          logger.error(`Ошибка при создании файла ${filePath}:`, err);
        } else {
          logger.info(`Файл ${filePath} создан и данные сохранены`);
        }
      });
    } else {
      // Файл существует, проверяем наличие заголовков
      fs.readFile(filePath, 'utf8', (err, fileData) => {
        if (err) {
          logger.error(`Ошибка при чтении файла ${filePath}:`, err);
          return;
        }

        const lines = fileData.split('\n');
        const existingData = lines.slice(1).map(line => line.trim()).filter(line => line !== '');

        if (!fileData.includes(headers)) {
          // Заголовки отсутствуют, добавляем заголовки и данные
          fs.writeFile(filePath, headers + existingData.join('\n') + '\n' + data, (err) => {
            if (err) {
              logger.error(`Ошибка при добавлении заголовков и данных в файл ${filePath}:`, err);
            } else {
              logger.info(`Заголовки и данные добавлены в файл ${filePath}`);
            }
          });
        } else {
          // Заголовки присутствуют, проверяем наличие данных
          if (!existingData.includes(`${symbol},${ticker.bid},${ticker.ask}`)) {
            // Данные отсутствуют, добавляем данные
            fs.appendFile(filePath, data, (err) => {
              if (err) {
                logger.error(`Ошибка при добавлении данных в файл ${filePath}:`, err);
              } else {
                logger.info(`Данные добавлены в файл ${filePath}`);
              }
            });
          } else {
            logger.info(`Данные для пары ${symbol} уже существуют в файле ${filePath}`);
          }
        }
      });
    }
  });
}

module.exports = saveToCsv;