// modules/connectToExchanges.js
const ccxt = require('ccxt');
const { exchangeConfigs, ccxtConfig, logger } = require('./utils'); // Импортируем необходимые константы

// Функция для синхронизации времени с сервером Binance
async function synchronizeTimeWithBinance() {
  const binance = new ccxt.binance({
    apiKey: exchangeConfigs.binance.apiKey,
    secret: exchangeConfigs.binance.secret,
    'options': {
      'adjustForTimeDifference': true // Автоматическая корректировка времени
    }
  });

  try {
    await binance.loadMarkets();
    const serverTime = await binance.fetchTime();
    const timeDifference = serverTime - Date.now();
    console.log(`Разница времени с сервером Binance: ${timeDifference} мс`);
    return timeDifference;
  } catch (error) {
    console.error(`Ошибка при синхронизации времени с Binance: ${error}`);
    return 0; // В случае ошибки возвращаем 0, чтобы не вносить корректировки во временные метки
  }
}

// Синхронизация времени
async function connectToExchanges() {
  const timeDifference = await synchronizeTimeWithBinance(); // Получаем время синхронизации

  for (const exchangeId in exchangeConfigs) {
    // Пропуск некоторых бирж, реализуйте, если нужно
    if (exchangeId === 'bittrue') continue;
    if (exchangeId === 'Bybit') continue;
    if (exchangeId === 'BingX') continue;
    if (exchangeId === 'HTX') continue;

    try {
      const exchangeClass = ccxt[exchangeId];
      const exchangeInstance = new exchangeClass({
        apiKey: exchangeConfigs[exchangeId].apiKey,
        secret: exchangeConfigs[exchangeId].secret,
        ...ccxtConfig,
      });
      
      // Используем timeDifference, если требуется для синхронизации времени
      if (exchangeId.toLowerCase() === 'binance') {
        exchangeInstance.options['recvWindow'] = 10000;
        exchangeInstance.options['serverTime'] = () => Date.now() + timeDifference;
      }

      await exchangeInstance.loadMarkets();
      logger.info(`Подключение к бирже ${exchangeId} - OK`);
    } catch (error) {
      logger.error(`Подключение к бирже ${exchangeId} - No`, error);
    }
  }
}

module.exports = connectToExchanges;