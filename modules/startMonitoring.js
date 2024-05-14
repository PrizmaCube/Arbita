// modules/startMonitoring.js
const { connectToExchanges, fetchAllPrices, saveDataToFile, findBestTrades, monitorPricesAndExecuteTrades, logger } = require('./index'); // Импортируем необходимые функции

// Функция для запуска мониторинга
async function startMonitoring() {
  try {
    await connectToExchanges(); // Подключение к биржам
    const allPrices = await fetchAllPrices(); // Получение цен
    saveDataToFile(allPrices); // Сохранение данных в файл
    await findBestTrades(); // Поиск лучших сделок
    monitorPricesAndExecuteTrades(); // Мониторинг цен и выполнение сделок
    logger.info('Мониторинг запущен');
  } catch (error) {
    logger.error('Ошибка при запуске мониторинга', error);
  }
}

module.exports = startMonitoring;