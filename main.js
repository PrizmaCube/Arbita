const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');
const winston = require('winston');
const cors = require('cors');
const { HttpsProxyAgent } = require('https-proxy-agent');
const modules = require('./modules');

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

// Проверка наличия папки logs и создание ее при необходимости
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs');
  logger.info('Создана папка logs для хранения логов');
}

// Создание прокси-агента
const proxyConfig = {
  host: '176.124.44.80',
  port: 8000,
  auth: {
    username: 'wdoSfr',
    password: 'G1zc4F'
  }
};

const proxyAgent = new HttpsProxyAgent(proxyConfig);

// Настройки CCXT
const ccxtConfig = {
  enableRateLimit: true,
  options: {
    agent: proxyAgent
  }
};

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

async function initializeApp() {
  try {
    // Создание экземпляра приложения Express
    const app = express();
    const server = http.createServer(app);
    const io = socketIO(server);

    // Настройка приложения Express
    app.use(express.json());
    app.use(express.static('public'));
    app.use(cors({
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
      preflightContinue: false
    }));

    app.use((req, res, next) => {
      logger.info(`CORS-запрос с ${req.headers.origin}`);
      next();
    });

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
      }, 20000); // 20000 миллисекунд = 20 секунд

      // Обработчик события 'bestTrade'
      socket.on('bestTrade', (data) => {
        logger.info('Отправка данных о лучшей сделке клиенту:', JSON.stringify(data));
      });

      socket.on('disconnect', () => {
        logger.info(`Пользователь отключен: ${socket.id}`);
      });
    });

    // ======================================================================
    // =========================== Маршруты ================================
    // ======================================================================

    // Маршрут для отображения прогресса загрузки данных
    app.get('/progress', (req, res) => {
      try {
        const progress = modules.showLoadingProgress(io);
        res.json({ progress });
      } catch (error) {
        logger.error('Ошибка при получении прогресса загрузки данных', error);
        res.status(500).json({ error: 'Произошла ошибка при получении прогресса загрузки данных' });
      }
    });

    // Маршрут для получения данных из всех внешних источников
    app.get('/data', async (req, res) => {
      try {
        const data = await modules.fetchAllPrices(exchangeConfigs, ccxtConfig, logger);
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
        const data = await modules.fetchAllPrices(exchangeConfigs, ccxtConfig, logger);
        const result = modules.saveDataToFile(data, logger);
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
        await modules.findBestTrades(exchangeConfigs, ccxtConfig, logger, io);
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
        const positions = await modules.getCurrentOpenPositions(exchangeConfigs, ccxtConfig, logger, io);
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
        const portfolioBalances = await modules.fetchPortfolioBalances(exchangeConfigs, ccxtConfig, logger);
        const consolidatedPortfolio = modules.getConsolidatedPortfolio(portfolioBalances);
        res.json(consolidatedPortfolio);
      } catch (error) {
        logger.error('Ошибка при получении общего портфеля:', error);
        res.status(500).json({ error: 'Произошла ошибка при получении общего портфеля' });
      }
    });

    // Маршрут для пополнения общего портфеля
    app.post('/consolidatedPortfolio/deposit', (req, res) => {
      try {
        const { coin, amount } = req.body;
        modules.depositToConsolidatedPortfolio(coin, amount, logger);
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
        await modules.tradeFromConsolidatedPortfolio(symbol, side, amount, price, exchangeConfigs, logger);
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
          modules.savePortfolioData(portfolioData, logger);
          res.json({ message: `Switched to ${portfolioType} portfolio` });
        } else {
          res.status(400).json({ error: 'Invalid portfolio type' });
        }
      } catch (error) {
        logger.error('Ошибка при переключении режима работы:', error);
        res.status(500).json({ error: 'Произошла ошибка при переключении режима работы' });
      }
    });

    // Маршрут для переключения режима торговли
    app.post('/switch-trading-mode', async (req, res) => {
      try {
        const { mode } = req.body;
        await modules.switchTradingMode(mode, portfolioData, logger);
        res.json({ message: `Режим торговли переключен на ${mode}` });
      } catch (error) {
        logger.error('Ошибка при переключении режима торговли:', error);
        res.status(500).json({ error: 'Произошла ошибка при переключении режима торговли' });
      }
    });

    // Маршрут для получения всех ордеров для каждой биржи
    app.get('/orders', async (req, res) => {
      try {
        const allExchangeOrders = {};

        for (const exchangeId in exchangeConfigs) {
          const exchangeOrders = await modules.fetchAllOrdersForExchange(exchangeId, exchangeConfigs, logger);
          allExchangeOrders[exchangeId] = exchangeOrders;
        }

        res.json(allExchangeOrders);
      } catch (error) {
        logger.error('Ошибка при получении ордеров:', error);
        res.status(500).json({ error: 'Произошла ошибка при получении ордеров' });
      }
    });

    // ========================= Запуск приложения =======================

    // Загрузка данных портфеля
    let portfolioData = await modules.initPortfolioData(exchangeConfigs, ccxtConfig, logger);

    // Подключение к биржам и запуск мониторинга
    await modules.connectToExchanges(exchangeConfigs, ccxtConfig, logger);
    await modules.startMonitoring(exchangeConfigs, ccxtConfig, logger, portfolioData, io);

    const IP_ADDRESS = '192.168.0.106';
    const PORT = 8000;

    server.listen(PORT, IP_ADDRESS, async () => {
      const startTime = new Date().toLocaleString();
      let message = `Порт: ${PORT}\n`;
      message += `IP-адрес: ${IP_ADDRESS}\n`;
      message += `Время запуска: ${startTime}\n`;

      const externalIPAddress = await modules.getExternalIP(logger);
      message += `\nВнешний IP-адрес: ${externalIPAddress}\n`;

      await modules.sendTelegramMessage(message, logger);
      console.log(`Сервер запущен на ${IP_ADDRESS}:${PORT}`);
    });

    console.log('Приложение запущено!');
  } catch (error) {
    console.error('Ошибка при запуске приложения:', error);
    process.exit(1);
  }
}

initializeApp();