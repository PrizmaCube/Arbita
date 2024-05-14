// app.js

// Разделение кода на части
// ТОМ 1 - Настройка
require('dotenv').config(); // Загрузка переменных окружения
const express = require('express'); // Загрузка express
const axios = require('axios'); // Загрузка axios
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs'); // Загрузка fs
const winston = require('winston'); // Загрузка winston
const TelegramBot = require('node-telegram-bot-api'); // Загрузка Telegram бота
const ccxt = require('ccxt'); // Загрузка ccxt
const NodeCache = require('node-cache'); // Загрузка кэша
const config = require('./config'); // Загрузка конфигурации
const cors = require('cors'); // Cors
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
app.use(express.json());


// Настройка логгера Winston
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' })
  ]
});

logger.info('Начало настройки приложения');

// Проверка наличия папки logs и создание ее при необходимости
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs');
  logger.info('Создана папка logs для хранения логов');
}

// Создание прокси-агента для всех запросов через axios
const proxyConfig = {
  host: '176.124.44.80',
  port: 8000,
  auth: {
    username: 'wdoSfr',
    password: 'G1zc4F'
  }
};

const proxyAgent = new HttpsProxyAgent(proxyConfig);

// Создание экземпляра axios с настройками прокси
const axiosInstance = axios.create({
  httpsAgent: proxyAgent
});

// Функция для получения внешнего IP-адреса через прокси
async function getExternalIP() {
  try {
    const response = await axiosInstance.get('https://api.ipify.org?format=json');
    const { ip } = response.data;
    return ip;
  } catch (error) {
    console.error('Ошибка при получении внешнего IP-адреса:', error);
    return null;
  }
}

// Используйте IIFE для асинхронного выполнения кода
(async () => {
  const externalIP = await getExternalIP();
  console.log(`Внешний IP-адрес: ${externalIP}`);
})();

// Пример использования axiosInstance для запроса внешнего IP-адреса
axiosInstance.get('https://api.ipify.org?format=json')
  .then(response => {
    // Теперь используем внешний IP как требуется
    const externalIP = response.data.ip;
    logger.info(`Внешний IP: ${externalIP}`);
    // Продолжаем дальше с использованием externalIP...
  })
  .catch(error => {
    logger.error('Ошибка при получении внешнего IP:', error);
  });

// Пример запроса через прокси
axiosInstance.get('https://api.ipify.org?format=json')
  .then(response => {
    console.log('Внешний IP:', response.data.ip);
  })
  .catch(error => {
    console.error('Ошибка при запросе внешнего IP:', error);
  });

module.exports = axiosInstance;

// Настройка Socket.IO
io.on('connection', (socket) => {
  logger.info(`Пользователь подключен: ${socket.id}`);

  // Отправляем тестовое сообщение новому клиенту
  const testTrade = {
    buyExchange: 'Тестовая биржа',
    buyPrice: 10000,
    sellExchange: 'Тестовая биржа 2',
    sellPrice: 10500,
    profit: 500
  };
  socket.emit('bestTrade', testTrade); // Отправляем тестовую карточку

  // Отправляем событие hideTrade через 1 минуту
  setTimeout(() => {
    socket.emit('hideTrade', testTrade);
  }, 60000); // 60000 миллисекунд = 1 минута

  // Обработчик события 'bestTrade'
  socket.on('bestTrade', (data) => {
    logger.info('Отправка данных о лучшей сделке клиенту:', JSON.stringify(data));
  });

  socket.on('disconnect', () => {
    logger.info(`Пользователь отключен: ${socket.id}`);
  });
});



// Настройка CORS с определенным источником
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false
}));

// Cors запрос
app.use((req, res, next) => {
  logger.info(`CORS-запрос с ${req.headers.origin}`);
  next();
});


// Обслуживание статических файлов из папки "public"
app.use(express.static('public'));

// Данные на подключения к биржам
const exchangeConfigs = {
  binance: {
    apiKey: 'tFzD8a5DX5NFX8x2Mcq9SqYRCOlslb1KfuwNyA1RwdINRPk3mAFroekGprfZDuRq',
    secret: 'y29wzBx9zBwNVGyiDk0u7dma6zTK1wrqpj5zkdIYPmrI7j8vtfni1AwJsrq9QKpF', 
    password: 'Isakovdanil94',
  },
  bybit: {
    apiKey: 'pkrjUSVFMGhmrRlCiz',
    secret: 'BZnAilrv0vwmIHPzKeUhYcMFRUNsiYd0iftH',
    password: 'Isakovdanil94',
  },
  okx: {
    apiKey: '71d51733-5607-4bbc-8809-f4759e19764b',
    secret: 'F7EE7855B0D88CEC6867A3073F1E9388',
    password: 'Isakovdanil94!',
  },
  mexc: {
    apiKey: 'mx0vgln5iYCD08d7Ru',
    secret: 'f898986c1d61477f875453a3738a22fc',
    password: 'Isakovdanil94',
  },
  gate: {
    apiKey: '2af35e1f00dccf162b041f8ba05c2e2e',
    secret: '91eb162eaceca4de98016811789eebefbd5771c89ffcdcfabe1a909ad992514a',
    password: 'Isakovdanil94',
  },
  kucoin: {
    apiKey: '66239ea9097e3e00018e4821',
    secret: '3fc1e3b4-5053-4af8-92d2-7928f8ba6b9f',
    password: 'Isakovdanil94',
  },
  bitget: {
    apiKey: 'bg_4e2205118ce863738c8e289485472310',
    secret: 'dfca599f07b87e28b3b49bd74ee28a0b132e6c16488e3ddfe428654fef9823d7',
    password: 'PrizmaArbita',
  },
  coinex: {
    apiKey: 'DB19E5E8B1AD420A9CAA14BE898473D0',
    secret: '429B158DF6F3C6F71F2F3FA8E7912CC3744C46C878C97E9B',
    password: 'Isakovdanil94',
  },
  phemex: {
    apiKey: '4c9bba75-7909-4329-acc8-9296163e2550',
    secret: 'vTftIONnDuOF0b275pnDpDNa43G1g8w7YJiErvy4KopmYjkzMzUxNy1kYjNjLTQ4NWEtYmY4ZC1hMDA3Yjk3ZThkZjc',
    password: 'Isakovdanil94',
  },
  bitmex: {
    apiKey: 'ENXpvzobWdD_HPt4eoKRq_CR',
    secret: 'Ox9BOnY-eIiwrkAsXH86JvJ21nb4338FZiShTW7EFJy4L50t',
    password: 'Isakovdanil94',
  },
};

const cache = new NodeCache({ stdTTL: 60 }); // Кэш с TTL 60 секунд


// Настройка Telegram бота
const telegramBot = new TelegramBot(config.botToken, { polling: false });

// Функция для отправки сообщения в Telegram
async function sendTelegramMessage(message) {
  try {
    await telegramBot.sendMessage(config.chatId, message);
    logger.info(`Сообщение отправлено в Telegram: ${message}`);
  } catch (error) {
    logger.error('Ошибка при отправке сообщения в Telegram:', error);
  }
}

const ccxtConfig = {
  enableRateLimit: true,
  options: {
    agent: proxyAgent,
  },
};

// Подключение к биржам
const exchanges = {};

for (const exchangeId in exchangeConfigs) {
  try {
    exchanges[exchangeId] = new ccxt[exchangeId]({
      apiKey: exchangeConfigs[exchangeId].apiKey,
      secret: exchangeConfigs[exchangeId].secret,
      ...ccxtConfig,
    });
    logger.info(`Экземпляр биржи ${exchangeId} создан успешно`);
  } catch (error) {
    logger.error(`Ошибка при создании экземпляра биржи ${exchangeId}:`, error);
  }
}

let progress = 0;
let intervalId = null;

logger.info('Настройка приложения завершена');



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
        agent: proxyAgent
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

// ТОМ 2 - ФУНКЦИИ

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

// Функция для отображения прогресса загрузки данных
function showLoadingProgress() {
  if (progress < 100) {
    progress += 10; // через каждый вызов увеличиваем на 10%
  }
  if (progress > 100) {
    progress = 100; // Ограничиваем прогресс 100%
  }
  logger.info(`Progress: ${progress}%`);
  io.emit('progress', { progress }); // Отправляем обновленный прогресс
  return progress;
}

// Изменение маршрута для отображения прогресса загрузки данных
app.get('/progress', (req, res) => {
  const currentProgress = showLoadingProgress();
  res.json({ progress: `Загружено ${currentProgress}%` }); // Отправка текущего прогресса в формате JSON
});

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

// Функция для установки стоп-лосса и тейк-профита
async function setStopLossAndTakeProfit(symbol, side, amount, price, stopLossPrice, takeProfitPrice, exchange) {
  try {
    const exchangeInstance = new ccxt[exchange]({
      apiKey: exchangeConfigs[exchange].apiKey,
      secret: exchangeConfigs[exchange].secret,
    });
    await exchangeInstance.createOrder(symbol, 'STOP_LOSS_LIMIT', side, amount, price, {
      'stopPrice': stopLossPrice
    });
    await exchangeInstance.createOrder(symbol, 'TAKE_PROFIT_LIMIT', side, amount, price, {
      'stopPrice': takeProfitPrice
    });
    logger.info(`Подключение (Установка стоп-лосса и тейк-профита) - OK`);
  } catch (error) {
    logger.error(`Подключение (Установка стоп-лосса и тейк-профита) - No`, error);
    throw error;
  }
}

// Дополнительная функция для синхронизации времени с сервером Binance
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

// Модифицированная функция автоматического совершения сделки с использованием CCXT
async function executeTradeAutomatically(symbol, side, amount, price, exchange) {
  try {
    const exchangeInstance = new ccxt[exchange]({
      apiKey: exchangeConfigs[exchange].apiKey,
      secret: exchangeConfigs[exchange].secret,
      enableRateLimit: true,
      options: {
        recvWindow: 60000,
        serverTime: () => Date.now(), // Автоматическая синхронизация времени с сервером
        ...options,
      },
    });

    
    // Отображение портфеля на клиенте
    emitPortfolio();

    const order = await exchangeInstance.createOrder(symbol, 'LIMIT', side, amount, price, {
      'agent': options.agent,
    });
    logger.info(`Подключение (Автоматическое выполнение сделки) - OK`);
    
    // Обновление портфеля после совершения сделки
    updatePortfolio(order);
    
    return order;
  } catch (error) {
    logger.error(`Подключение (Автоматическое выполнение сделки) - No`, error);
    throw error;
  }
}

// Добавление прогресса загрузки данных для конкретной биржи
let exchangeProgress = {};

// Получение данных о цене для указанной пары на бирже
async function fetchTicker(exchangeId, symbol) {
  try {
    const exchangeClass = ccxt[exchangeId];
    const exchange = new exchangeClass({
      apiKey: exchangeConfigs[exchangeId].apiKey,
      secret: exchangeConfigs[exchangeId].secret,
      ...ccxtConfig,
      enableRateLimit: true,
    });

    const ticker = await exchange.fetchTicker(symbol, {
      'agent': proxyAgent,
    });
    logger.info(`Данные о цене для пары ${symbol} на бирже ${exchangeId} получены успешно: ${JSON.stringify(ticker)}`);
    

    // Добавление специальной обработки для Coinex
    if (exchangeId.toLowerCase() === 'coinex') {
      logger.info(`Полный ответ API от Coinex для ${symbol}: ${JSON.stringify(ticker)}`);
      ticker.bid = ticker.info.last; // Пример использования последней цены как bid
      ticker.ask = ticker.info.last; // Пример использования последней цены как ask
    }

    saveToCsv(exchangeId, symbol, ticker);
    return ticker;
  } catch (error) {
    logger.error(`Ошибка при получении данных о цене для пары ${symbol} на бирже ${exchangeId}:`, error);
    return null;
  }
}

// Функция для получения цен с различных бирж
async function fetchAllPrices() {
  const allPrices = {};
  const symbol = 'BTC/USDT';

  const promises = Object.keys(exchangeConfigs).map(async (exchangeId) => {
    const exchange = new ccxt[exchangeId]({
      apiKey: exchangeConfigs[exchangeId].apiKey,
      secret: exchangeConfigs[exchangeId].secret,
      ...ccxtConfig,
      enableRateLimit: true,
    });

    try {
      logger.info(`Загрузка рынков для биржи ${exchangeId}`);
      await exchange.loadMarkets({
        'agent': proxyAgent,
      });
      if (exchangeInstance.symbols.includes(symbol)) {
        const ticker = await fetchTicker(exchangeId, symbol);
        if (ticker && ticker.bid && ticker.ask) {
          allPrices[exchangeId] = {
            [symbol]: {
              bid: ticker.bid,
              ask: ticker.ask,
            }
          };
        } else {
          logger.warn(`Не удалось получить цену для символа ${symbol} на бирже ${exchangeId}`);
        }
      }
      logger.info(`Данные с биржи ${exchangeId} получены успешно`);
    } catch (error) {
      logger.error(`Ошибка при получении данных с биржи ${exchangeId}:`, error);
    }
  });

  await Promise.all(promises);

  if (Object.keys(allPrices).length === 0) {
    logger.warn('Не удалось получить данные ни с одной биржи');
  }

  return allPrices;
}

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

// Сохранение данных в файл
async function saveDataToFile(data) {
  try {
    const fs = require('fs');
    const dataString = JSON.stringify(data, null, 2);
    fs.writeFileSync('data.json', dataString);
    logger.info('Данные успешно сохранены в файл data.json');
  } catch (error) {
    logger.error('Ошибка при сохранении данных в файл:', error);
  }
}

// Главная функция для получения и сохранения данных
async function main() {
  try {
    await startMonitoring(); // Запуск мониторинга
    await createExchangeFolders(); // Создание папок для бирж
    await createPortfolioFiles(); // Создание файлов портфелей для бирж и общего портфеля
  } catch (error) {
    console.error('Ошибка при выполнении программы:', error);
  }
}

main();

// ТОМ 3 - ВСЕ НЕОБХОДИМОЕ ДЛЯ ПОЛУЧЕНИЯ ДАННЫХ С БИРЖ, РАСЧЕТА ПРИБЫЛИ И АНАЛИЗА

// Функция для расчета прибыли
function calculateProfit(buyPrice, sellPrice, amount = 0.01) {
  const profit = (sellPrice - buyPrice) * amount;
  return profit;
}

// Функция для расчета общего объема
function calculateTotalVolume(prices) {
  const totalVolume = Object.values(prices).reduce((sum, price) => sum + price, 0);
  return totalVolume;
}

// Функция для расчета волатильности
function calculateVolatility(prices) {
  const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  const variance = prices.reduce((sum, price) => sum + Math.pow(price - avg, 2), 0) / prices.length;
  const volatility = Math.sqrt(variance);
  return volatility;
}

// Функция для мониторинга цен в реальном времени и выполнения сделок с использованием CCXT
async function monitorPricesAndExecuteTrades() {
  try {
    await synchronizeTimeWithBinance(); // Синхронизация времени перед выполнением запросов

    const exchangeInstances = {};
    for (const exchange in exchangeConfigs) {
      exchangeInstances[exchange] = new ccxt[exchange]({
        apiKey: exchangeConfigs[exchange].apiKey,
        secret: exchangeConfigs[exchange].secret,
        ...ccxtConfig,
        enableRateLimit: true,
        options: {
          recvWindow: 60000,
          serverTime: () => Date.now(), // Автоматическая синхронизация времени с сервером
          'agent': proxyAgent, 
        },
      });
    }

    while (true) {
      const activeExchange = portfolioData.activePortfolio === 'real' ? 'binance' : 'testExchange';
      const ticker = await exchangeInstances[activeExchange].fetchTicker('BTC/USDT', {
        'agent': proxyAgent, // Добавьте опцию 'agent' здесь
      });
      const bestBuyPrice = ticker.bid;
      const bestSellPrice = ticker.ask;

      const bestTrade = {
        buyExchange: activeExchange,
        buyPrice: bestBuyPrice,
        sellExchange: activeExchange,
        sellPrice: bestSellPrice,
        profit: bestSellPrice - bestBuyPrice
      };

      if (bestTrade.profit > 50) {
        await executeTradeAutomatically('BTC/USDT', 'buy', 0.01, bestBuyPrice, activeExchange, {
          'agent': proxyAgent,
        });
        await executeTradeAutomatically('BTC/USDT', 'sell', 0.01, bestSellPrice, activeExchange, {
          'agent': proxyAgent,
        });
        logger.info(`Подключение (Мониторинг цен и выполнение сделок) - OK`);
      }

      await new Promise(resolve => setTimeout(resolve, 60000)); // Ждать 1 минуту перед повторной проверкой
    }
  } catch (error) {
    logger.error(`Подключение (Мониторинг цен и выполнение сделок) - No`, error);
  }
}

// Функция для получения текущих открытых позиций
async function getCurrentOpenPositions() {
  try {
    const positions = [];

    for (const exchangeId in exchangeConfigs) {
      const exchange = new ccxt[exchangeId]({
        apiKey: exchangeConfigs[exchangeId].apiKey,
        secret: exchangeConfigs[exchangeId].secret,
        password: exchangeConfigs[exchangeId].password,
        ...ccxtConfig,
        agent: proxyAgent
      });

      try {
        const openOrders = await exchange.fetchOpenOrders('BTC/USDT');
        const exchangePositions = openOrders.map(order => ({
          'agent': proxyAgent,
          exchange: exchangeId,
          symbol: order.symbol,
          side: order.side,
          amount: order.amount,
          price: order.price
        }));
        positions.push(...exchangePositions);
        logger.info(`Подключение (Получение текущих открытых позиций) - OK для биржи ${exchangeId}`);
      } catch (error) {
        logger.error(`Подключение (Получение текущих открытых позиций) - No для биржи ${exchangeId}`, error);
      }
    }

    io.emit('positions', positions); // Отправка текущих открытых позиций всем подключенным клиентам через Socket.IO
    return positions;
  } catch (error) {
    logger.error(`Подключение (Получение текущих открытых позиций) - No`, error);
    throw error;
  }
}

// Функция для поиска лучших сделок с использованием CCXT и анализа данных
async function findBestTrades() {
  try {
    logger.info('Поиск лучших сделок начат');
    const prices = await fetchAllPrices();  // Получение цен со всех бирж

    if (Object.keys(prices).length === 0) {
      logger.warn('Не удалось получить цены для поиска лучших сделок');
      return;
    }

    // Поиск наименьшей цены покупки и наибольшей цены продажи среди всех бирж
    const buyPrices = Object.values(prices).map(price => price.bid);
    const sellPrices = Object.values(prices).map(price => price.ask);
    const bestBuyPrice = Math.min(...buyPrices);
    const bestSellPrice = Math.max(...sellPrices);


    // Расчет спреда между лучшей ценой покупки и продажи
    const spread = bestSellPrice - bestBuyPrice;
    logger.info(`Рассчитанная разница между лучшей ценой покупки и продажи: ${spread}`);

    if (spread > 50) {
      // Расчет потенциальной прибыли от арбитражной сделки
      const profit = calculateProfit(bestBuyPrice, bestSellPrice);

      logger.info(`Обнаружена арбитражная возможность с потенциальной прибылью: $${profit.toFixed(2)}`);
      
      // Формирование объекта с информацией о лучшей сделке
      const bestTrade = {
        buyExchange: Object.keys(prices).find(exchange => prices[exchange].bid === bestBuyPrice),
        buyPrice: bestBuyPrice,
        sellExchange: Object.keys(prices).find(exchange => prices[exchange].ask === bestSellPrice),
        sellPrice: bestSellPrice,
        profit: profit
      };

      // Отправка лучшей сделки клиенту через Socket.IO
      io.emit('bestTrade', bestTrade);
      logger.info('Информация о лучшей сделке отправлена клиенту через Socket.IO');

      // Автоматическое выполнение сделок на основе лучших цен
      await executeTradeAutomatically('BTC/USDT', 'buy', 0.01, bestBuyPrice, bestTrade.buyExchange);
      await executeTradeAutomatically('BTC/USDT', 'sell', 0.01, bestSellPrice, bestTrade.sellExchange);
    }
  } catch (error) {
    logger.error('Ошибка при поиске лучших сделок:', error);
  }
}
            

// ТОМ 4 - ВСЕ ЧТО СВЯЗАННО С ПОРТФЕЛЕМ И ЕГО ФУНКЦИОНАЛОМ

// Функция для получения текущих балансов пользователя
const filePath = 'portfolio.json'; // Путь к файлу портфеля

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

// Загрузка данных портфеля при запуске сервера
let portfolioData = null;

async function initPortfolioData() {
  portfolioData = await loadPortfolioData();
}

initPortfolioData();


// Функция для загрузки данных портфеля из файла
async function loadPortfolioData() {
  try {
    const portfolioBalances = await fetchPortfolioBalances();
    const portfolioData = {
      realPortfolio: {
        totalValue: 0,
        coins: {},
        tradeHistory: [],
      },
      testPortfolio: {
        totalValue: 0,
        coins: {},
        tradeHistory: [],
      },
      activePortfolio: 'real',
    };

    for (const exchangeId in portfolioBalances) {
      const balances = portfolioBalances[exchangeId];
      for (const coin in balances) {
        if (balances[coin] && (balances[coin].free > 0 || balances[coin].used > 0)) {
          const amount = balances[coin].free + balances[coin].used;
          const ticker = await fetchTicker(exchangeId, `${coin}/USDT`);
          if (ticker) {
            const value = amount * ticker.last;
            portfolioData.realPortfolio.coins[coin] = { amount, value };
            portfolioData.realPortfolio.totalValue += value;
          }
        }
      }
    }

    return portfolioData;
  } catch (error) {
    logger.error('Ошибка при загрузке данных портфеля:', error);
    return {
      realPortfolio: {
        totalValue: 0,
        coins: {},
        tradeHistory: [],
      },
      testPortfolio: {
        totalValue: 0,
        coins: {},
        tradeHistory: [],
      },
      activePortfolio: 'real',
    };
  }
}

// Функция для получения общего портфеля
function getConsolidatedPortfolio(portfolioBalances) {
  const consolidatedPortfolio = {
    totalValue: 0,
    coins: {},
  };

  for (const exchangeId in portfolioBalances) {
    const balances = portfolioBalances[exchangeId];
    for (const coin in balances) {
      if (balances[coin]) {
        const balance = balances[coin].total || (balances[coin].free + balances[coin].used);
        if (balance > 0) {
          if (!consolidatedPortfolio.coins[coin]) {
            consolidatedPortfolio.coins[coin] = 0;
          }
          consolidatedPortfolio.coins[coin] += balance;
          consolidatedPortfolio.totalValue += balance;
        }
      }
    }
  }

  return consolidatedPortfolio;
}

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

// Функция для обновления портфеля после сделки
function updatePortfolio(order) {
  if (!portfolioData) {
    logger.error('Данные портфеля не загружены');
    return;
  }

  const { symbol, side, amount, price } = order;
  const portfolioType = portfolioData.activePortfolio;
  const portfolio = portfolioData[portfolioType === 'real' ? 'realPortfolio' : 'testPortfolio'];
  
  if (!portfolio.coins[symbol]) {
    portfolio.coins[symbol] = { amount: 0, value: 0 };
  }
  
  const coin = portfolio.coins[symbol];

  if (side === 'buy') {
    coin.amount += amount;
    coin.value += amount * price;
  } else if (side === 'sell') {
    coin.amount -= amount;
    coin.value -= amount * price;
  }

  portfolio.coins[symbol] = coin;
  portfolio.totalValue += (side === 'buy' ? 1 : -1) * amount * price;

  portfolio.tradeHistory.unshift(order);
  if (portfolio.tradeHistory.length > 20) {
    portfolio.tradeHistory.pop();
  }

  // Обновление общего портфеля
  const consolidatedPortfolio = getConsolidatedPortfolio();
  portfolioData.consolidatedPortfolio = consolidatedPortfolio;

  savePortfolioData(portfolioData);
}

// Маршрут для получения данных с общего портфеля
app.get('/consolidated-portfolio', async (req, res) => {
  try {
    const portfolioBalances = await fetchPortfolioBalances();
    const consolidatedPortfolio = getConsolidatedPortfolio(portfolioBalances);
    res.json(consolidatedPortfolio);
  } catch (error) {
    logger.error('Ошибка при получении общего портфеля:', error);
    res.status(500).json({ error: 'Произошла ошибка при получении общего портфеля' });
  }
});



// Функция для сохранения общего портфеля в файл
async function saveConsolidatedPortfolio(consolidatedPortfolio) {
  try {
    // Создание папки для общего портфеля, если она не существует
    const consolidatedFolder = path.join(__dirname, 'ALL_Portfolio');
    await fs.promises.mkdir(consolidatedFolder, { recursive: true });

    // Сохранение общего портфеля в файл
    const consolidatedPortfolioFileName = path.join(consolidatedFolder, 'consolidated_portfolio.json');
    await fs.promises.writeFile(consolidatedPortfolioFileName, JSON.stringify(consolidatedPortfolio, null, 2));

    // Отправка уведомления в Telegram о сохранении общего портфеля
    await sendTelegramMessage(`Общий портфель сохранен в файл: ${consolidatedPortfolioFileName}`);

    logger.info(`Общий портфель сохранен в файл: ${consolidatedPortfolioFileName}`);
  } catch (error) {
    logger.error('Ошибка при сохранении общего портфеля:', error);
    throw error;
  }
}


// Функция для обновления общего портфеля по запросу
async function updateConsolidatedPortfolioOnRequest() {
  try {
    const consolidatedPortfolio = getConsolidatedPortfolio();
    await saveConsolidatedPortfolio(consolidatedPortfolio);
    console.log('Общий портфель обновлен по запросу');
  } catch (error) {
    console.error('Ошибка при обновлении общего портфеля по запросу:', error);
  }
}

// Функция для обработки запроса на обновление общего портфеля
app.post('/update-consolidated-portfolio', (req, res) => {
  updateConsolidatedPortfolioOnRequest()
    .then(() => {
      res.status(200).json({ message: 'Общий портфель обновлен' });
    })
    .catch((error) => {
      console.error('Ошибка при обработке запроса на обновление общего портфеля:', error);
      res.status(500).json({ error: 'Ошибка при обновлении общего портфеля' });
    });
});

// Функция для получения баланса портфеля
async function fetchPortfolioBalances() {
  const portfolioBalances = {};

  for (const exchangeId in exchangeConfigs) {
    const exchangeConfig = exchangeConfigs[exchangeId];
    const exchange = new ccxt[exchangeId]({
      apiKey: exchangeConfig.apiKey,
      secret: exchangeConfig.secret,
      password: exchangeConfig.password,
      ...ccxtConfig,
    });

    try {
      const balances = await exchange.fetchBalance();
      portfolioBalances[exchangeId] = balances;

      // Создание папки для биржи, если она не существует
      const exchangeFolder = path.join(__dirname, 'data', exchangeId);
      if (!fs.existsSync(exchangeFolder)) {
        fs.mkdirSync(exchangeFolder, { recursive: true });
      }

      // Логирование подключения к портфелю в отдельный файл для каждой биржи
      const portfolioLogFileName = path.join(exchangeFolder, `portfolio.log`);
      const portfolioLogMessage = `Подключение к портфелю биржи ${exchangeId} - OK`;
      fs.appendFileSync(portfolioLogFileName, `${new Date().toISOString()} ${portfolioLogMessage}\n`);

      // Сохранение данных портфеля в отдельный файл для каждой биржи
      const portfolioDataFileName = path.join(exchangeFolder, `portfolio.json`);
      fs.writeFileSync(portfolioDataFileName, JSON.stringify(balances, null, 2));
    } catch (error) {
      logger.error(`Ошибка при получении баланса портфеля с биржи ${exchangeId}:`, error);

      // Создание папки для биржи, если она не существует
      const exchangeFolder = path.join(__dirname, 'data', exchangeId);
      if (!fs.existsSync(exchangeFolder)) {
        fs.mkdirSync(exchangeFolder, { recursive: true });
      }

      // Логирование ошибки подключения к портфелю в отдельный файл для каждой биржи
      const portfolioLogFileName = path.join(exchangeFolder, `portfolio.log`);
      const portfolioLogMessage = `Ошибка при получении баланса портфеля с биржи ${exchangeId}: ${error.message}`;
      fs.appendFileSync(portfolioLogFileName, `${new Date().toISOString()} ${portfolioLogMessage}\n`);
    }
  }

  return portfolioBalances;
}

// Функция для получения общего портфеля
function getConsolidatedPortfolio(portfolioBalances) {
  const consolidatedPortfolio = {
    totalValue: 0,
    coins: {},
  };

  for (const exchangeId in portfolioBalances) {
    const balances = portfolioBalances[exchangeId];
    for (const coin in balances) {
      if (balances[coin] && balances[coin].total > 0) {
        if (!consolidatedPortfolio.coins[coin]) {
          consolidatedPortfolio.coins[coin] = 0;
        }
        consolidatedPortfolio.coins[coin] += balances[coin].total;
        consolidatedPortfolio.totalValue += balances[coin].total;
      }
    }
  }

  return consolidatedPortfolio;
}

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

// Функция для торговли с общего портфеля на всех биржах
async function tradeFromConsolidatedPortfolio(symbol, side, amount, price) {
  const consolidatedPortfolio = getConsolidatedPortfolio();
  const coin = symbol.split('/')[0];

  if (!consolidatedPortfolio.coins[coin]) {
    logger.error(`Монета ${coin} отсутствует в общем портфеле`);
    return;
  }

  // Проверка наличия достаточного количества монет в общем портфеле
  if (side === 'sell' && consolidatedPortfolio.coins[coin] < amount) {
    logger.error(`Недостаточное количество ${coin} в общем портфеле для продажи`);
    return;
  }

  for (const exchangeId in exchangeConfigs) {
    try {
      const exchangeInstance = new ccxt[exchangeId]({
        apiKey: exchangeConfigs[exchangeId].apiKey,
        secret: exchangeConfigs[exchangeId].secret,
        enableRateLimit: true,
        options: {
          recvWindow: 60000,
          serverTime: () => Date.now(),
        },
      });

      const order = await exchangeInstance.createOrder(symbol, 'LIMIT', side, amount, price);

      logger.info(`Подключение (Торговля с общего портфеля на бирже ${exchangeId}) - OK`);

      // Обновление общего портфеля после выполнения сделки
      if (side === 'buy') {
        consolidatedPortfolio.coins[coin] += amount;
        consolidatedPortfolio.totalValue += amount * price;
      } else if (side === 'sell') {
        consolidatedPortfolio.coins[coin] -= amount;
        consolidatedPortfolio.totalValue -= amount * price;
      }
    } catch (error) {
      logger.error(`Подключение (Торговля с общего портфеля на бирже ${exchangeId}) - No`, error);
    }
  }

  // Сохранение обновленного общего портфеля
  saveConsolidatedPortfolio(consolidatedPortfolio);
}

// Маршрут для пополнения общего портфеля
app.post('/consolidatedPortfolio/deposit', (req, res) => {
  try {
    const { coin, amount } = req.body;
    depositToConsolidatedPortfolio(coin, amount);
    res.json({ message: `Пополнение ${amount} ${coin} в общий портфель выполнено` });
  } catch (error) {
    logger.error('Ошибка при пополнении общего портфеля:', error);
    res.status(500).json({ error: 'Произошла ошибка при пополнении общего портфеля' });
  }
});

// Маршрут для торговли с общего портфеля
app.post('/consolidatedPortfolio/trade', async (req, res) => {
  try {
    const { symbol, side, amount, price } = req.body;
    await tradeFromConsolidatedPortfolio(symbol, side, amount, price);
    res.json({ message: `Сделка ${side} ${amount} ${symbol} по цене ${price} с общего портфеля выполнена` });
  } catch (error) {
    logger.error('Ошибка при торговле с общего портфеля:', error);
    res.status(500).json({ error: 'Произошла ошибка при торговле с общего портфеля' });
  }
});

// Маршрут для переключения между реальным и тестовым портфелем
app.post('/portfolio/switch', async (req, res) => {
  try {
    logger.info('Получен запрос на переключение режима работы:', req.body);
    const { portfolioType } = req.body;
    if (portfolioType === 'real' || portfolioType === 'test') {
      portfolioData.activePortfolio = portfolioType;
      savePortfolioData(portfolioData);
      res.json({ message: `Switched to ${portfolioType} portfolio` });
    } else {
      res.status(400).json({ error: 'Invalid portfolio type' });
    }
  } catch (error) {
    logger.error('Ошибка при переключении режима работы:', error);
    res.status(500).json({ error: 'Произошла ошибка при переключении режима работы' });
  }
});


// Обновление портфеля после выполнения сделки
async function executeTradeAutomatically(symbol, side, amount, price, exchange) {
  try {
    const exchangeInstance = new ccxt[exchange]({
      apiKey: exchangeConfigs[exchange].apiKey,
      secret: exchangeConfigs[exchange].secret,
      enableRateLimit: true,
      options: {
        recvWindow: 60000,
        serverTime: () => Date.now(),
      },
    });

    const order = await exchangeInstance.createOrder(symbol, 'LIMIT', side, amount, price);

    const portfolioType = portfolioData.activePortfolio;
    updatePortfolio({ symbol, side, amount, price }, portfolioType);

    logger.info(`Подключение (Автоматическое выполнение сделки) - OK`);
    return order;
  } catch (error) {
    logger.error(`Подключение (Автоматическое выполнение сделки) - No`, error);
    throw error;
  }
}

// Обновление портфеля на клиенте после совершения сделок
function updateClientPortfolio(portfolioType, trade) {
  const { symbol, exchange, side, amount, price } = trade;
  const portfolio = portfolioData[portfolioType];
  const coin = portfolio.coins[symbol] || { amount: 0, value: 0 };

  if (side === 'buy') {
    coin.amount += amount;
    coin.value += amount * price;
  } else if (side === 'sell') {
    coin.amount -= amount;
    coin.value -= amount * price;
  }

  portfolio.coins[symbol] = coin;
  portfolio.totalValue += (side === 'buy' ? 1 : -1) * amount * price;

  portfolio.tradeHistory.unshift(trade);
  if (portfolio.tradeHistory.length > 20) {
    portfolio.tradeHistory.pop();
  }

  // Обновление общего портфеля
  const consolidatedPortfolio = getConsolidatedPortfolio();
  portfolioData.consolidatedPortfolio = consolidatedPortfolio;

  savePortfolioData(portfolioData);

  // Отправка обновленного портфеля клиенту через Socket.IO
  io.emit('portfolioUpdate', portfolioData);
}

// Маршрут для переключения режима торговли
app.post('/switch-trading-mode', async (req, res) => {
  try {
    const { mode } = req.body;
    await switchTradingMode(mode);
    res.json({ message: `Режим торговли переключен на ${mode}` });
  } catch (error) {
    logger.error('Ошибка при переключении режима торговли:', error);
    res.status(500).json({ error: 'Произошла ошибка при переключении режима торговли' });
  }
});

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

// Функция для обновления пользовательского интерфейса с текущим режимом торговли
function updateTradingModeUI(mode) {
  const tradingModeElement = document.getElementById('trading-mode');
  tradingModeElement.textContent = `Current Trading Mode: ${mode}`;
}

// ТОМ 5 - ПОЛУЧЕНИЕ ОРДЕРОВ И МАРШРУТЫ

// Получение ордеров с бирж
async function fetchOrdersBySymbol(exchange, symbol) {
  try {
    const orders = await exchange.fetchOrders(symbol, undefined, undefined, {
      'agent': proxyAgent,
    });
    return orders;
  } catch (error) {
    logger.error(`Ошибка при получении ордеров для символа ${symbol} на бирже ${exchange.id}:`, error);
    return [];
  }
}

// Добавление метода получения открытых ордеров
async function fetchOpenOrders(exchange, symbol) {
  try {
    const openOrders = await exchange.fetchOpenOrders(symbol, undefined, undefined, {
      'agent': proxyAgent,
    });
    return openOrders;
  } catch (error) {
    logger.error(`Ошибка при получении открытых ордеров для символа ${symbol} на бирже ${exchange.id}:`, error);
    return [];
  }
}

// Функция на получение всех ордеров
async function fetchAllOrdersForExchange(exchangeId) {
  const exchangeConfig = exchangeConfigs[exchangeId];
  const exchange = new ccxt[exchangeId]({
    apiKey: exchangeConfig.apiKey,
    secret: exchangeConfig.secret,
    password: exchangeConfig.password,
  });

  const allOrders = {};

  if (exchangeConfig.symbols) {
    for (const symbol of exchangeConfig.symbols) {
      const orders = await fetchOrdersBySymbol(exchange, symbol);
      const openOrders = await fetchOpenOrders(exchange, symbol);

      allOrders[symbol] = {
        orders,
        openOrders,
      };
    }
  }

  return allOrders;
}

// Маршрут для получения всех ордеров для каждой биржи
app.get('/orders', async (req, res) => {
  try {
    const allExchangeOrders = {};

    for (const exchangeId in exchangeConfigs) {
      const exchangeOrders = await fetchAllOrdersForExchange(exchangeId);
      allExchangeOrders[exchangeId] = exchangeOrders;
    }

    res.json(allExchangeOrders);
  } catch (error) {
    logger.error('Ошибка при получении ордеров:', error);
    res.status(500).json({ error: 'Произошла ошибка при получении ордеров' });
  }
});

// Маршрут для отображения прогресса загрузки данных
app.get('/progress', (req, res) => {
  try {
    const progress = showLoadingProgress(50);
    res.json({ progress });
  } catch (error) {
    logger.error('Ошибка при получении прогресса загрузки данных', error);
    res.status(500).json({ error: 'Произошла ошибка при получении прогресса загрузки данных' });
  }
});

// Маршрут для получения данных из всех внешних источников
app.get('/data', async (req, res) => {
  try {
    const data = await fetchAllPrices();
    logger.info('Подключение (Получение данных из внешних источников) - OK');
    res.json(data);
  } catch (error) {
    logger.error('Подключение (Получение данных из внешних источников) - No', error);
    res.status(500).json({ error: 'Произошла ошибка при получении данных' });
  }
});

// Маршрут для сохранения данных в локальный файл
app.post('/save', async (req, res) => {
  try {
    const data = await fetchAllPrices();
    const result = saveDataToFile(data);
    logger.info(`Данные сохранены в файл: ${result}`);
    res.json({ message: result });
  } catch (error) {
    logger.error('Подключение (Сохранение данных в файл) - No', error);
    res.status(500).json({ error: 'Произошла ошибка при сохранении данных' });
  }
});

// Маршрут для поиска лучших сделок
app.post('/trades', async (req, res) => {
  try {
    await findBestTrades();
    logger.info('Поиск лучших сделок выполнен');
    res.json({ message: 'Поиск лучших сделок выполнен' });
  } catch (error) {
    logger.error('Подключение (Поиск лучших сделок) - No', error);
    res.status(500).json({ error: 'Произошла ошибка при поиске лучших сделок' });
  }
});

// Маршрут для получения текущих открытых позиций
app.get("/positions", async (req, res) => {
  try {
    const positions = await getCurrentOpenPositions();
    logger.info('Текущие открытые позиции:', positions);
    res.json(positions);
  } catch (error) {
    logger.error('Подключение (Получение текущих открытых позиций) - No', error);
    res.status(500).json({ error: 'Произошла ошибка при получении текущих открытых позиций' });
  }
});

// Маршрут для получения данных с общего портфеля
app.get('/consolidated-portfolio', async (req, res) => {
  try {
    const portfolioBalances = await fetchPortfolioBalances();
    const consolidatedPortfolio = getConsolidatedPortfolio(portfolioBalances);
    res.json(consolidatedPortfolio);
  } catch (error) {
    logger.error('Ошибка при получении общего портфеля:', error);
    res.status(500).json({ error: 'Произошла ошибка при получении общего портфеля' });
  }
});


// Функция для получения внешнего IP-адреса
async function getExternalIP() {
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    const { ip } = response.data;
    return ip;
  } catch (error) {
    logger.error('Ошибка при получении внешнего IP-адреса:', error);
    return null;
  }
}

// Использование IIFE (Immediately Invoked Function Expression) для вызова асинхронной функции
(async () => {
  const externalIP = await getExternalIP();
  console.log(`Внешний IP-адрес: ${externalIP}`);

  // Дальше ваш код, который зависит от externalIP
  const IP_ADDRESS = '192.168.0.106';
  const PORT = 8000;

  http.listen(PORT, IP_ADDRESS, async () => {
    const startTime = new Date().toLocaleString();
    let message = `Порт: ${PORT}\n`;
    message += `IP-адрес: ${IP_ADDRESS}\n`;
    message += `Время запуска: ${startTime}\n`;
    message += `\nВнешний IP-адрес: ${externalIP}\n`;
    
    await sendTelegramMessage(message);
  });
})();