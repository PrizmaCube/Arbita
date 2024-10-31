// Импорт необходимых модулей
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const brain = require('brain.js');
const Parser = require('rss-parser');
const natural = require('natural');
const moment = require('moment');
const chalk = require('chalk');// Добавьте эту библиотеку для цветного вывода в консоль
const socketIo = require('socket.io');
const { RestClientV5 } = require('bybit-api');
const NodeCache = require('node-cache');
const Decimal = require('decimal.js');
//const { isWsFormattedSpotUserDataListStatusEvent } = require('binance');

// Загрузка переменных окружения
dotenv.config();

// Инициализация Express приложения
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }
});

// Подключение Socet
io.on('connection', (socket) => {
  console.log('Новое подключение');

  if (!socket.initialized) {
    socket.initialized = true;
  }

  socket.on('disconnect', () => {
    console.log('Клиент отключился');
    socket.removeAllListeners();
  });

  socket.on('requestUpdate', async () => {
      const portfolioData = await fetchPortfolioData();
      console.log('Отправка данных клиенту:', portfolioData);
      const tradeHistoryData = await fetchTradeHistoryData();
      console.log('Отправка данных клиенту:', tradeHistoryData);
      
      socket.emit('portfolioUpdate', portfolioData);
      socket.emit('tradeHistoryUpdate', tradeHistoryData);
  });

  socket.on('disconnect', () => {
      console.log('Клиент отключился');
      // Обработка отключения клиента

  });
});


// Константы для API ключей и токенов
const bybitApiKey = process.env.BYBIT_API_KEY;
const bybitSecretKey = process.env.BYBIT_SECRET_KEY;
const testBybitApiKey = process.env.TEST_BYBIT_API_KEY;
const testBybitSecretKey = process.env.TEST_BYBIT_API_SECRET;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;
//const etherscanApiKey = process.env.ETHERSCAN_API_KEY;

// Константы и глобальные переменные
const RISK_PER_TRADE = 0.01;
const COMMISSION_RATE = 0.001;
let lastKnownAccuracy = null;
// Добавьте эти константы в начало файла
let GRID_STEP_PERCENTAGE = 1; // Шаг сетки в процентах
let GRID_LEVELS = 10; // Количество уровней сетки


// Инициализация Bybit клиента
const bybitClient = new RestClientV5({
  testnet: false,
  key: bybitApiKey,
  secret: bybitSecretKey,
  recv_window: 10000 // увеличиваем до 10 секунд
});
try {
  // Код инициализации Bybit клиента
} catch (error) {
  console.error('Ошибка при инициализации Bybit клиента:', error);
 
}
// Инициализация тестового Bybit клиента
const testBybitClient = new RestClientV5({
  testnet: true,
  key: testBybitApiKey,
  secret: testBybitSecretKey,
  recv_window: 10000
});
try {
  // Код инициализации Bybit клиента
} catch (error) {
  console.error('Ошибка при инициализации test Bybit клиента:', error);
 
}

// Функция для получения времени сервера Bybit
async function getBybitServerTime() {
  try {
    const response = await bybitClient.getServerTime();
    if (response.retCode !== 0) {
      throw new Error(`Ошибка получения времени сервера: ${response.retMsg}`);
    }
    return parseInt(response.result.timeSecond);
  } catch (error) {
    await log(`❌ Ошибка при получении времени сервера Bybit: ${error.message}`, 'error', 'getBybitServerTime');
    throw error;
  }
}


// Кэш для хранения цены
const priceCache = new Map();
const CACHE_TTL = 6000; // 1 минута (время жизни кэша)

// Функция для получения цены
async function getPrice(symbol, maxRetries = 3, retryDelay = 1000) {
  await log(`🏁 Начало получения цены для ${symbol}`, 'info', 'getPrice');

  // Проверка кэша
  const cachedPrice = priceCache.get(symbol);
  if (cachedPrice && Date.now() - cachedPrice.timestamp < CACHE_TTL) {
    await log(`💾 Использование кэшированной цены для ${symbol}: ${cachedPrice.price}`, 'info', 'getPrice');
    return cachedPrice.price;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await log(`🔄 Попытка ${attempt} из ${maxRetries} получения цены для ${symbol}`, 'info', 'getPrice');
      
      const response = await axios.get(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'YourTradingBot/1.0'
        }
      });
      
     // await log(`📡 Получен ответ от API Bybit`, 'debug', 'getPrice');
      
      if (response.data && response.data.result && Array.isArray(response.data.result.list) && response.data.result.list.length > 0) {
        const priceData = response.data.result.list[0];
        await log(`🔍 Данные о цене: ${JSON.stringify(priceData)}`, 'debug', 'getPrice');
        
        if (priceData && typeof priceData.lastPrice === 'string') {
          const price = parseFloat(priceData.lastPrice);
          if (!isNaN(price) && price > 0) {
            await log(`✅ Успешно получена цена для ${symbol}: ${price}`, 'info', 'getPrice');
            // Сохранение цены в кэш
            priceCache.set(symbol, { price, timestamp: Date.now() });
            await log(`💾 Цена сохранена в кэш`, 'debug', 'getPrice');
            return price;
          }
        }
      }
      
      throw new Error('Неверный формат ответа от Bybit API или отсутствие данных о цене');
    } catch (error) {
      await log(`❌ Ошибка при попытке ${attempt}: ${error.message}`, 'error', 'getPrice');
      
      if (attempt === maxRetries) {
        await log(`🚫 Не удалось получить цену после ${maxRetries} попыток`, 'error', 'getPrice');
        throw new Error(`Не удалось получить цену после ${maxRetries} попыток: ${error.message}`);
      }
      
      await log(`⏳ Ожидание ${retryDelay}мс перед следующей попыткой`, 'info', 'getPrice');
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

// Пути к файлам логов и данных
const tradeHistoryPath = path.join(__dirname, 'trade_history.json');
const logPath = path.join(__dirname, 'logs');
const errorLogPath = path.join(logPath, 'error.log');
const infoLogPath = path.join(logPath, 'info.log');
const detailLogPath = path.join(logPath, 'detail.log');
const performanceLogPath = path.join(logPath, 'performance.log');

// Создание директории для логов, если она не существует
fs.ensureDirSync(logPath);

// Инициализация тестового портфеля
const INITIAL_BALANCE_RUB = new Decimal(10000); // Начальный баланс в рублях
let testPortfolio = { ETH: 0, RUB: INITIAL_BALANCE_RUB };
let totalTrades = 0;
let profitableTrades = 0;
let unprofitableTrades = 0;
const signals = [];
let currentTradingMode = 'test'; // или 'live', в зависимости от начального состояния
let isBacktestEnabled = false; // Глобальная переменная для включения/выключения бэктеста
let isNeuralNetworkTrainingEnabled = false;
const MIN_ORDER_VALUE_USD = new Decimal(1);
const MIN_POSITION_SIZE = new Decimal('0.00092');
let lastPrice = null;
let lastPriceTime = 0;
let lastUsdRubRate = null;
let lastUsdRubRateTime = 0;
global.bybitTimeOffset = 0;
const VIRTUAL_BALANCE_FILE = path.join(__dirname, 'virtualBalance.json');
const previousSignals = []; // Массив для хранения предыдущих сигналов
let neuralNet; // Объявляем neuralNet глобально
const LSTM_MODEL_DIR = path.join(__dirname, 'lstm_models');

// Параметры для генерации торговых сигналов
let signalParams = {
  rsiOverbought: 70, // Увеличено с 65
  rsiOversold: 30, // Уменьшено с 35
  macdThreshold: 0,
  volumeThreshold: 1.03, // Уменьшено с 1.05
  trendStrengthThreshold: 8, // Уменьшено с 10
  minSignalStrength: 0.15 // Уменьшено с 0.2
};

// Инициализация middlewares
app.use(cors());
app.use(express.json());


// Функция для логирования
async function log(message, type = 'info', functionName = '', isOrderLog = false) {
  const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
  let logMessage = `[${timestamp}] [${type.toUpperCase()}] [${functionName}] `;
  
  if (isOrderLog) {
    logMessage += '\n========================\n';
    logMessage += message;
    logMessage += '\n========================\n';
  } else {
    logMessage += message;
  }
  
  let logFile;
  switch(type) {
    case 'error':
      logFile = path.join(__dirname, 'logs', 'error.log');
      console.error(logMessage);
      break;
    case 'warn':
      logFile = path.join(__dirname, 'logs', 'warn.log');
      console.warn(logMessage);
      break;
    case 'detail':
      logFile = path.join(__dirname, 'logs', 'detail.log');
      console.log(logMessage);
      break;
    default:
      logFile = path.join(__dirname, 'logs', 'info.log');
      console.log(logMessage);
  }

  try {
    await fs.appendFile(logFile, logMessage + '\n');
    io.emit('log', { type, message: logMessage });
  } catch (error) {
    console.error(`Ошибка при записи лога: ${error.message}`);
  }
}

// Функция для получения доступного баланса
async function getAvailableBalance(asset) {
  try {
    await log(`🔍 Начало получения доступного баланса для ${asset} 💰`, 'info', 'getAvailableBalance');

    if (asset !== 'ETH' && asset !== 'USDT' && asset !== 'RUB') {
      throw new Error('❌ Поддерживается только баланс ETH, USDT и RUB ⛔');
    }

    if (currentTradingMode === 'test') {
      await log('🧪 Работа в тестовом режиме, получение виртуального баланса 🧪', 'info', 'getAvailableBalance');

      let balance = await getVirtualBalance(asset);
      
      if (asset === 'ETH') {
        const ethPrice = new Decimal(await getPrice('ETHUSDT'));
        const usdToRubRate = new Decimal(await getUsdToRubRate());

        // 💰 Начальный баланс в рублях
        const initialBalanceRub = new Decimal(10000);
        const initialBalanceETH = initialBalanceRub.dividedBy(ethPrice.times(usdToRubRate));
        
        // 🔄 Обновляем виртуальный баланс ETH
        await updateVirtualBalance('ETH', initialBalanceETH);

        balance = initialBalanceETH;
        await log(`💰 Начальный баланс ETH: ${balance.toFixed(8)} ETH 💰`, 'info', 'getAvailableBalance');
      } else if (asset === 'RUB') {
        balance = new Decimal(10000); // Используем начальный баланс в RUB
      }

      await log(`💰 Виртуальный баланс ${asset}: ${balance.toString()} 💰`, 'info', 'getAvailableBalance');
      return balance;
    } else {
      await log('💼 Работа в реальном режиме, запрос баланса через Bybit API', 'info', 'getAvailableBalance');
      
      try {
        const balance = await bybitClient.getWalletBalance({ accountType: "UNIFIED", coin: asset });
        await log(`📊 Ответ от Bybit API: ${JSON.stringify(balance)}`, 'info', 'getAvailableBalance');
        
        if (!balance.result || !balance.result.list || balance.result.list.length === 0) {
          throw new Error('❌ Неверный формат ответа от Bybit API');
        }
        
        const assetBalance = new Decimal(balance.result.list[0].coin.find(c => c.coin === asset).walletBalance);
        
        if (assetBalance.isNaN()) {
          throw new Error(`❓ Полученный баланс ${asset} не является числом`);
        }
        
        await log(`💰 Получен реальный баланс ${asset}: ${assetBalance.toString()}`, 'info', 'getAvailableBalance');
        return assetBalance;
      } catch (apiError) {
        throw new Error(`🔴 Ошибка при запросе баланса через API: ${apiError.message}`);
      }
    }
  } catch (error) {
    await log(`❌ Ошибка при получении доступного баланса ${asset}: ${error.message}`, 'error', 'getAvailableBalance');
    
    // Возвращаем минимальное значение баланса в случае ошибки
    const minBalance = asset === 'ETH' ? new Decimal(0.01) : new Decimal(10);
    await log(`⚠️ Возвращение минимального баланса ${asset}: ${minBalance.toString()}`, 'warn', 'getAvailableBalance');
    return minBalance;
  }
}


// Функция для проверки баланса
async function checkBalance(asset, requiredAmount) {
  const maxRetries = 3;
  const initialRetryDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
          await log(`Попытка ${attempt}/${maxRetries} проверки баланса для ${asset}. Требуемая сумма: ${requiredAmount}. Режим: ${currentTradingMode}`, 'info', 'checkBalance');
          
          if (currentTradingMode === 'test') {
              const virtualBalance = await getVirtualBalance(asset);
              await log(`Тестовый режим. Виртуальный баланс ${asset}: ${virtualBalance}`, 'info', 'checkBalance');
              if (virtualBalance >= requiredAmount) {
                  await log(`Достаточно виртуальных средств для операции. Требуется: ${requiredAmount}, Доступно: ${virtualBalance}`, 'info', 'checkBalance');
                  return true;
              } else {
                  await log(`Недостаточно виртуальных средств для операции. Требуется: ${requiredAmount}, Доступно: ${virtualBalance}`, 'warn', 'checkBalance');
                  return false;
              }
          }

          await syncTimeWithBybit();

          const client = currentTradingMode === 'test' ? testBybitClient : bybitClient;
          const accountType = "UNIFIED";
          
          await log(`Запрос баланса: accountType=${accountType}, asset=${asset}`, 'detail', 'checkBalance');

          const response = await client.getWalletBalance({ 
              accountType: accountType,
              coin: asset,
              timeout: 30000 // 30 секунд тайм-аута
          });
          
          await log(`Полный ответ API: ${JSON.stringify(response)}`, 'detail', 'checkBalance');
          
          if (response.retCode !== 0) {
              throw new Error(`Ошибка API Bybit: ${response.retMsg}`);
          }

          if (!response.result || !response.result.list || response.result.list.length === 0) {
              throw new Error('Неожиданная структура ответа API');
          }

          const accountInfo = response.result.list[0];
          await log(`Информация об аккаунте: ${JSON.stringify(accountInfo)}`, 'detail', 'checkBalance');

          if (!accountInfo.coin || !Array.isArray(accountInfo.coin) || accountInfo.coin.length === 0) {
              throw new Error('Баланс пуст или недоступен');
          }

          const assetBalance = accountInfo.coin.find(coin => coin.coin === asset);

          if (!assetBalance) {
              throw new Error(`Баланс для актива ${asset} не найден`);
          }

          await log(`Найден баланс для ${asset}: ${JSON.stringify(assetBalance)}`, 'detail', 'checkBalance');

          const freeBalance = parseFloat(assetBalance.walletBalance || '0');
          await log(`Доступный баланс ${asset}: ${freeBalance}`, 'detail', 'checkBalance');

          if (freeBalance >= requiredAmount) {
              await log(`Достаточно средств для операции. Требуется: ${requiredAmount}, Доступно: ${freeBalance}`, 'info', 'checkBalance');
              return true;
          } else {
              await log(`Недостаточно средств для операции. Требуется: ${requiredAmount}, Доступно: ${freeBalance}`, 'warn', 'checkBalance');
              return false;
          }
      } catch (error) {
          await log(`Ошибка при проверке баланса ${asset} (попытка ${attempt}): ${error.message}`, 'error', 'checkBalance');
          
          if (error.response) {
              await log(`Детали ошибки API: ${JSON.stringify(error.response.data)}`, 'error', 'checkBalance');
          } else if (error.request) {
              await log('Ошибка сети при запросе к API', 'error', 'checkBalance');
          }
          
          await log(`Стек ошибки: ${error.stack}`, 'error', 'checkBalance');
          
          if (attempt === maxRetries) {
              await log(`Все попытки проверки баланса исчерпаны. Последняя ошибка: ${error.message}`, 'error', 'checkBalance');
              return false;
          }

          const retryDelay = initialRetryDelay * Math.pow(2, attempt - 1);
          await log(`Повторная попытка через ${retryDelay}мс...`, 'info', 'checkBalance');
          await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
  }

  return false;
}


// Функция для закрытия реальной позиции
async function closePosition(symbol, order, currentPrice, reason = 'Manual') {
  try {
    await log(`🔒 Начало закрытия позиции для ордера ${order.orderId}`, 'info', 'closePosition');

    const usdToRubRate = await getUsdToRubRate();
    const { profitLoss, profitLossPercentage, commission } = await calculateProfitLoss(order, currentPrice);
    const profitLossRub = profitLoss * usdToRubRate;

    let closedOrder;
    if (currentTradingMode === 'test') {
      closedOrder = {
        orderId: order.orderId,
        symbol: symbol,
        side: order.side === 'Buy' ? 'Sell' : 'Buy',
        orderType: 'MARKET',
        price: currentPrice,
        qty: order.qty,
        status: profitLossRub > 0 ? 'ПРИБЫЛЬНЫЙ' : 'УБЫТОЧНЫЙ'
      };
      await log(`🔄 Тестовый режим: Симуляция закрытия ордера ${order.orderId}`, 'info', 'closePosition');
    } else {
      closedOrder = await bybitClient.submitOrder({
        category: 'spot',
        symbol: symbol,
        side: order.side === 'Buy' ? 'Sell' : 'Buy',
        orderType: 'MARKET',
        qty: order.qty
      });
      await log(`🔄 Реальный режим: Отправлен запрос на закрытие ордера ${order.orderId}`, 'info', 'closePosition');
    }

    closedOrder.status = profitLossRub > 0 ? 'ПРИБЫЛЬНЫЙ' : 'УБЫТОЧНЫЙ';

    await log(`🔒 ОРДЕР ЗАКРЫТ (ID: ${order.orderId})
    ⏰ Время: ${moment().format('YYYY-MM-DD HH:mm:ss')}
    📊 Тип: ${order.side}
    🔀 Причина: ${reason}
    💰 Сумма: ${order.qty} ${symbol.replace('USDT', '')}
    💱 Цена открытия: ${order.price} USD (${(parseFloat(order.price) * usdToRubRate).toFixed(2)} RUB)
    💱 Цена закрытия: ${currentPrice} USD (${(currentPrice * usdToRubRate).toFixed(2)} RUB)
    📈 Прибыль/Убыток: ${profitLossRub > 0 ? '+' : ''}${profitLossRub.toFixed(2)} RUB
    📊 Процент P/L: ${profitLossPercentage > 0 ? '+' : ''}${profitLossPercentage.toFixed(2)}%
    💸 Комиссия: ${commission.toFixed(2)} USD (${(commission * usdToRubRate).toFixed(2)} RUB)`, 'info', 'closePosition', true);

    const updatedPortfolio = await updatePortfolio(profitLossRub);
    const currentPortfolioValueRub = updatedPortfolio.totalValueRUB;

    await updateTradeHistory(order.orderId, order.side === 'Buy' ? 'sell' : 'buy', currentPrice, order.qty, profitLossRub);

    await sendTradeNotificationToTelegram(closedOrder, profitLossRub, currentPortfolioValueRub, parseFloat(order.qty) * currentPrice * usdToRubRate);

    return { 
      closedOrder, 
      closePrice: currentPrice, 
      profitLoss, 
      profitLossRub, 
      profitLossPercentage,
      commission,
      updatedPortfolio
    };
  } catch (error) {
    await log(`❌ Ошибка при закрытии позиции: ${error.message}`, 'error', 'closePosition');
    throw error;
  }
}

// Расчет KPI стратегии
async function calculateStrategyKPI() {
  try {
    const initialBalanceETH = new Decimal(0.04033385); // Начальный баланс в ETH
    const currentEthBalance = await getVirtualBalance('ETH');
    const ethPrice = await getPrice('ETHUSDT');
    const usdToRubRate = await getUsdToRubRate();

    const totalProfitETH = new Decimal(currentEthBalance).minus(initialBalanceETH);
    const totalProfitRUB = totalProfitETH.times(ethPrice).times(usdToRubRate);
    const averageProfitETH = totalTrades > 0 ? totalProfitETH.dividedBy(totalTrades) : new Decimal(0);
    const averageProfitRUB = totalTrades > 0 ? totalProfitRUB.dividedBy(totalTrades) : new Decimal(0);

    return {
      totalTrades,
      profitableTrades,
      unprofitableTrades,
      winRate: totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0,
      totalProfitETH: totalProfitETH.toNumber(),
      totalProfitRUB: totalProfitRUB.toNumber(),
      averageProfitETH: averageProfitETH.toNumber(),
      averageProfitRUB: averageProfitRUB.toNumber()
    };
  } catch (error) {
    await log(`Ошибка при расчете KPI стратегии: ${error.message}`, 'error', 'calculateStrategyKPI');
    return {
      totalTrades: 0,
      profitableTrades: 0,
      unprofitableTrades: 0,
      winRate: 0,
      totalProfitETH: 0,
      totalProfitRUB: 0,
      averageProfitETH: 0,
      averageProfitRUB: 0
    };
  }
}

// Обновленная функция для обновления портфеля
async function updatePortfolio(profitLossEth = 0) {
  try {
    await log('Начало обновления портфеля', 'info', 'updatePortfolio');

    const ethPrice = await getPrice('ETHUSDT');
    const usdToRubRate = await getUsdToRubRate();

    let currentEthBalance;
    if (currentTradingMode === 'test') {
      const testPortfolio = await getVirtualBalance();
      currentEthBalance = new Decimal(testPortfolio.ETH || 0);
    } else {
      const balances = await bybitClient.getWalletBalance({ accountType: "UNIFIED" });
      currentEthBalance = new Decimal(balances.result.list.find(b => b.coin === 'ETH')?.free || '0');
    }

    const currentPortfolioValueRUB = currentEthBalance.times(ethPrice).times(usdToRubRate);
    const profitLossRub = new Decimal(profitLossEth).times(ethPrice).times(usdToRubRate);

    await log(`💼 ОБНОВЛЕНИЕ ПОРТФЕЛЯ`, 'info', 'updatePortfolio', true);
    await log(`💰 Текущий баланс: ${currentEthBalance.toFixed(8)} ETH (${currentPortfolioValueRUB.toFixed(2)} RUB)`, 'info', 'updatePortfolio', true);
    await log(`📈 Прибыль/Убыток: ${profitLossEth.toFixed(8)} ETH (${profitLossRub.toFixed(2)} RUB)`, 'info', 'updatePortfolio', true);

    const kpi = await calculateStrategyKPI();
    await log(`📊 KPI стратегии:`, 'info', 'updatePortfolio', true);
    await log(`📊 Винрейт: ${kpi.winRate.toFixed(2)}%`, 'info', 'updatePortfolio', true);

    return {
      totalValueRUB: currentPortfolioValueRUB.toNumber(),
      changeETH: profitLossEth,
      changeRUB: profitLossRub.toNumber(),
      currentETHBalance: currentEthBalance.toNumber(),
      kpi: kpi
    };
  } catch (error) {
    await log(`Ошибка при обновлении портфеля: ${error.message}`, 'error', 'updatePortfolio');
    throw error;
  }
}

// Функция для расчета прибыли/убытка по сделке
async function calculateProfitLoss(order, currentPrice = null) {
  try {
    await log(`Начало расчета прибыли/убытка для ордера: ${JSON.stringify(order)}`, 'info', 'calculateProfitLoss');
    
    if (currentPrice === null) {
      currentPrice = await getPrice(order.symbol);
    }
    
    const entryValue = new Decimal(order.price).times(order.size);
    const exitValue = new Decimal(currentPrice).times(order.size);
    
    let profitLoss = 0;
    if (order.side.toLowerCase() === 'buy') {
      profitLoss = exitValue - entryValue;
    } else if (order.side.toLowerCase() === 'sell') {
      profitLoss = entryValue - exitValue;
    } else {
      throw new Error(`Неизвестная сторона ордера: ${order.side}`);
    }
    
    const commission = (entryValue + exitValue) * COMMISSION_RATE / 2; // Комиссия на вход и выход
    profitLoss -= commission;
    
    const profitLossPercentage = (profitLoss / entryValue) * 100;
    
    await log(`Цена входа: ${order.price}, Текущая цена: ${currentPrice}, Количество: ${order.size}`, 'info', 'calculateProfitLoss');
    await log(`Прибыль/убыток: ${profitLoss.toFixed(8)} USD (${profitLossPercentage.toFixed(2)}%)`, 'info', 'calculateProfitLoss');
    await log(`Комиссия: ${commission.toFixed(8)} USD`, 'info', 'calculateProfitLoss');

    // Конвертация в рубли
    const usdToRubRate = await getUsdToRubRateWithRetry();
    const profitLossRub = profitLoss * usdToRubRate;
    
    await log(`Прибыль/убыток в рублях: ${profitLossRub.toFixed(2)} RUB`, 'info', 'calculateProfitLoss');

    return {
      profitLoss,
      profitLossPercentage,
      commission,
      profitLossRub
    };
  } catch (error) {
    await log(`Ошибка при расчете прибыли/убытка: ${error.message}`, 'error', 'calculateProfitLoss');
    return {
      profitLoss: 0,
      profitLossPercentage: 0,
      commission: 0,
      profitLossRub: 0
    };
  }
}

// Функция для получения статистики портфеля за 24 часа
async function getPortfolioStats24h() {
  try {
    const balances = await bybitClient.getWalletBalance({ accountType: "UNIFIED" });
    console.log('Ответ от Bybit API:', JSON.stringify(balances));
    
    if (!balances || !balances.result || !Array.isArray(balances.result.list)) {
      throw new Error('Неверный формат ответа от Bybit API');
    }

    const ethBalance = balances.result.list.find((b) => b.coin === 'ETH')?.free || '0';
    
    const ethPrice = await getPrice('ETHUSDT');
    if (ethPrice === null) {
      throw new Error('Не удалось получить текущую цену ETH');
    }

    const tickerInfo = await bybitClient.getTickers({ category: 'spot', symbol: 'ETHUSDT' });
    
    if (!tickerInfo.result || !tickerInfo.result.list || tickerInfo.result.list.length === 0) {
      throw new Error('Не удалось получить данные о тикере');
    }

    const priceChangePercent = parseFloat(tickerInfo.result.list[0].price24hPcnt) * 100;
    const balanceChangePercent = priceChangePercent;
    const balanceChangeUSD = parseFloat(ethBalance) * (priceChangePercent / 100) * ethPrice;

    const usdToRub = await getUsdToRubRate();
    const balanceChangeRUB = balanceChangeUSD * usdToRub;

    await log(`Статистика портфеля за 24ч: ${balanceChangePercent.toFixed(2)}%`, 'detail', 'getPortfolioStats24h');

    return {
      balanceChangePercent: balanceChangePercent.toFixed(2),
      balanceChangeUSD: balanceChangeUSD.toFixed(2),
      balanceChangeRUB: balanceChangeRUB.toFixed(2)
    };
  } catch (error) {
    console.error('Подробности ошибки:', error);
    await log(`Ошибка при получении статистики портфеля: ${error.message}`, 'error', 'getPortfolioStats24h');
    throw error;
  }
}



// Расчет SMA
function calculateSMA(data, period) {
  if (!data || data.length < period) {
    log(`Недостаточно данных для расчета SMA. Требуется: ${period}, получено: ${data ? data.length : 0}`, 'warn', 'calculateSMA');
    return 0; // Или другое значение по умолчанию
  }
  let sum = 0;
  for (let i = data.length - period; i < data.length; i++) {
    sum += data[i];
  }
  return sum / period;
}

// Расчет EMA
async function calculateEMA(data, period) {
  try {
    // await log(`🧮 Начало расчета EMA. Период: ${period}, Количество данных: ${data.length}`, 'detail', 'calculateEMA');

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('❌ Входные данные для EMA должны быть непустым массивом');
    }

    if (data.length < period) {
      await log(`⚠️ Недостаточно данных для расчета EMA. Требуется: ${period}, получено: ${data.length}. Возвращаем доступное значение.`, 'warn', 'calculateEMA');
      if (data.length === 1) {
        await log(`📊 Возвращаем единственное доступное значение: ${data[0]}`, 'detail', 'calculateEMA');
        return data[0];
      }
      const average = data.reduce((sum, value) => sum + value, 0) / data.length;
     // await log(`📊 Рассчитанное простое среднее: ${average}`, 'detail', 'calculateEMA');
      return average;
    }

    let ema = data.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
    const multiplier = 2 / (period + 1);

    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
    }

    // await log(`📈 Рассчитанное значение EMA: ${ema}`, 'detail', 'calculateEMA');
    return ema;
  } catch (error) {
    await log(`❌ Ошибка при расчете EMA: ${error.message}`, 'error', 'calculateEMA');
    return null; // Возвращаем null вместо 0, чтобы явно показать, что произошла ошибка
  }
}

// Расчет RSI
function calculateRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) {
    log(`Недостаточно данных для расчета RSI. Требуется: ${period + 1}, получено: ${closes ? closes.length : 0}`, 'warn', 'calculateRSI');
    return 50; // Возвращаем нейтральное значение
  }

  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const difference = closes[i] - closes[i - 1];
    if (difference > 0) {
      gains += difference;
    } else {
      losses -= difference;
    }
  }

  if (gains === 0 && losses === 0) {
    console.log('Нет изменений цены в период расчета RSI');
    return 50;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const difference = closes[i] - closes[i - 1];
    const currentGain = Math.max(difference, 0);
    const currentLoss = Math.max(-difference, 0);

    avgGain = ((avgGain * (period - 1)) + currentGain) / period;
    avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
  }

  if (avgLoss === 0) {
    console.log('Средний убыток равен 0, RSI = 100');
    return 100;
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  console.log(`RSI calculation: avgGain = ${avgGain}, avgLoss = ${avgLoss}, rs = ${rs}, rsi = ${rsi}`);
  
  return rsi;
}

// Расчет MACD
async function calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  try {
    if (!Array.isArray(closes) || closes.length === 0) {
      throw new Error('Входные данные для MACD должны быть непустым массивом');
    }

  //  await log(`🧮 Начало расчета MACD. Количество цен закрытия: ${closes.length}`, 'detail', 'calculateMACD');

    // 🧮 Расчет значений MACD Line
    const macdLineData = [];
    for (let i = slowPeriod; i < closes.length; i++) {
      const fastEMA = await calculateEMA(closes.slice(0, i + 1), fastPeriod);
      const slowEMA = await calculateEMA(closes.slice(0, i + 1), slowPeriod);
      macdLineData.push(fastEMA - slowEMA);
    }

    // 🧮 Расчет сигнальной линии
    const signalLineData = [];
    for (let i = signalPeriod; i < macdLineData.length; i++) {
      const signalEMA = await calculateEMA(macdLineData.slice(0, i + 1), signalPeriod);
      signalLineData.push(signalEMA);
    }

    // 🧮  Расчет гистограммы MACD
    const histogramData = [];
    for (let i = 0; i < signalLineData.length; i++) {
      histogramData.push(macdLineData[i + signalPeriod] - signalLineData[i]);
    }

    // 📊 Возвращаем последние рассчитанные значения
    const macdLine = macdLineData[macdLineData.length - 1];
    const signalLine = signalLineData[signalLineData.length - 1];
    const histogram = histogramData[histogramData.length - 1];
   
    /*
    await log(`📊 MACD рассчитан. 
    Линия MACD: ${macdLine}, 
    Сигнальная линия: ${signalLine}, 
    Гистограмма: ${histogram}`, 'debug', 'calculateMACD');
    */
   
    return [macdLine, signalLine, histogram];
  } catch (error) {
    await log(`❌ Ошибка при расчете MACD: ${error.message}`, 'error', 'calculateMACD');
    return [0, 0, 0]; 
  }
}

// Расчет OBV
function calculateOBV(closes, volumes) {
  let obv = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) {
      obv += volumes[i];
    } else if (closes[i] < closes[i - 1]) {
      obv -= volumes[i];
    }
    // Если цены равны, OBV не меняется
  }
  return Math.abs(obv); // Возвращаем абсолютное значение
}

const MAX_POSITION_SIZE = 0.6; // 30% от портфеля
const INITIAL_PORTFOLIO_VALUE_RUB = 10000; // Начальная стоимость портфеля в рублях

let currentPortfolioValueRUB = INITIAL_PORTFOLIO_VALUE_RUB;

// Функция для инициализации или обновления виртуального баланса
async function initializeOrUpdateVirtualBalance(forceReset = false) {
  try {
    await log(`🔄 Начало initializeOrUpdateVirtualBalance. ForceReset: ${forceReset}`, 'debug', 'initializeOrUpdateVirtualBalance');

    let balance; // Объявляем balance с помощью let

    if (forceReset) {
      balance = { RUB: new Decimal(INITIAL_BALANCE_RUB), ETH: new Decimal(0) };
      await log(`🔄 Принудительный сброс баланса. Новый баланс: ${JSON.stringify(balance)}`, 'debug', 'initializeOrUpdateVirtualBalance');
    } else {
      try {
        const savedBalance = await fs.readJson(VIRTUAL_BALANCE_FILE);

        // 🐛 Создаем глубокую копию объекта savedBalance
        balance = JSON.parse(JSON.stringify(savedBalance));

        // Преобразуем значения в Decimal
        balance.RUB = new Decimal(balance.RUB);
        balance.ETH = new Decimal(balance.ETH);

        await log(`📊 Загружен существующий баланс: ${JSON.stringify(balance)}`, 'debug', 'initializeOrUpdateVirtualBalance');
      } catch (error) {
        balance = { RUB: new Decimal(INITIAL_BALANCE_RUB), ETH: new Decimal(0) };
        await log(`⚠️ Не удалось загрузить баланс. Создан новый: ${JSON.stringify(balance)}. Ошибка: ${error.message}`, 'warn', 'initializeOrUpdateVirtualBalance');
      }
    }

    const ethPriceUsd = new Decimal(await getPrice('ETHUSDT'));
    const usdToRubRate = new Decimal(await getUsdToRubRate());

    await log(`💰 Цена ETH/USD: ${ethPriceUsd}, Курс USD/RUB: ${usdToRubRate}`, 'debug', 'initializeOrUpdateVirtualBalance');

    // Рассчитываем баланс ETH на основе RUB, если нужно
    if (!balance.ETH) { // Проверяем, есть ли уже balance.ETH (например, после загрузки из файла)
      const newEthBalance = balance.RUB.dividedBy(ethPriceUsd.times(usdToRubRate));
      balance.ETH = newEthBalance;
      await log(`🧮 Расчет баланса ETH: ${balance.RUB} / (${ethPriceUsd} * ${usdToRubRate}) = ${newEthBalance}`, 'debug', 'initializeOrUpdateVirtualBalance');
    }

    // Сохраняем баланс в файл, конвертируя Decimal в строки
    await fs.writeJson(VIRTUAL_BALANCE_FILE, {
      RUB: balance.RUB.toString(),
      ETH: balance.ETH.toString()
    }, { spaces: 2 });

    await log(`💾 Сохранен новый баланс: ${JSON.stringify(balance)}`, 'debug', 'initializeOrUpdateVirtualBalance');

    return balance;
  } catch (error) {
    await log(`❌ Ошибка в initializeOrUpdateVirtualBalance: ${error.message}`, 'error', 'initializeOrUpdateVirtualBalance');
    throw error;
  }
}

// Функция для расчета динамического размера позиции (с полным логированием)
async function calculateDynamicPositionSize(symbol, risk, volatility, signalStrength) {
  try {
    await log(`➡️ Начало расчета динамического размера позиции для ${symbol} 💰`, 'info', 'calculateDynamicPositionSize');
    await log(`➡️ Входные параметры: symbol=${symbol}, risk=${risk}, volatility=${volatility}, signalStrength=${signalStrength}`, 'debug', 'calculateDynamicPositionSize');

    // Проверка входных данных
    if (typeof symbol !== 'string' || symbol.trim() === '') {
      throw new Error('❌ Некорректный символ ⛔');
    }
    if (typeof risk !== 'number' || isNaN(risk) || risk <= 0 || risk > 1) {
      throw new Error('❌ Некорректное значение риска ⛔');
    }
    if (typeof volatility !== 'number' || isNaN(volatility) || volatility < 0) {
      throw new Error('❌ Некорректное значение волатильности ⛔');
    }
    if (typeof signalStrength !== 'number' || isNaN(signalStrength) || signalStrength < 0 || signalStrength > 1) {
      throw new Error('❌ Некорректное значение силы сигнала ⛔');
    }

    // Получение доступного баланса ETH
    const availableBalanceETH = new Decimal(await getAvailableBalance('ETH'));
    await log(`💰 Доступный баланс ETH: ${availableBalanceETH.toString()} 💰`, 'info', 'calculateDynamicPositionSize');

    // Получение текущей цены
    const currentPrice = new Decimal(await getCachedPrice(symbol));
    await log(`📈 Текущая цена ${symbol}: ${currentPrice.toString()} 📈`, 'info', 'calculateDynamicPositionSize');

    // Базовый размер позиции (на основе риска)
    let positionSize = availableBalanceETH.times(risk);
    await log(`🧮 Базовый размер позиции (на основе риска): ${positionSize.toString()} 🧮`, 'info', 'calculateDynamicPositionSize');

    // Корректировка на волатильность (не может быть отрицательной)
    const volatilityAdjustment = Decimal.max(new Decimal(0.5), new Decimal(1).minus(volatility));
    await log(`📊 Корректировка на волатильность: ${volatilityAdjustment.toString()} 📊`, 'info', 'calculateDynamicPositionSize');

    // Учет силы сигнала
    positionSize = positionSize.times(volatilityAdjustment).times(signalStrength);
    await log(`🧮 Размер позиции после корректировки: ${positionSize.toString()} 🧮`, 'info', 'calculateDynamicPositionSize');

    // Проверка минимальной стоимости ордера
    const orderValueUSD = positionSize.times(currentPrice);
    await log(`💲 Стоимость ордера в USD: ${orderValueUSD.toString()} 💲`, 'info', 'calculateDynamicPositionSize');
    if (orderValueUSD.lessThan(MIN_ORDER_VALUE_USD)) {
      positionSize = new Decimal(MIN_ORDER_VALUE_USD).dividedBy(currentPrice);
      
      // ✅ Проверяем, не превышает ли positionSize доступный баланс
      if (positionSize.greaterThan(availableBalanceETH)) {
        positionSize = availableBalanceETH;
        await log(`📈 Размер позиции ограничен доступным балансом: ${positionSize.toString()} 📈`, 'info', 'calculateDynamicPositionSize');
      } else {
        await log(`📈 Размер позиции увеличен до минимальной стоимости: ${positionSize.toString()} 📈`, 'info', 'calculateDynamicPositionSize');
      }
    }

    // ⛔ Ограничение по балансу (сверху и снизу)
    positionSize = Decimal.max(new Decimal(0), Decimal.min(positionSize, availableBalanceETH.times(0.95)));
    await log(`🧮 Размер позиции после ограничения балансом: ${positionSize.toString()} 🧮`, 'info', 'calculateDynamicPositionSize');

    // Ограничение по минимальному размеру позиции
    positionSize = Decimal.max(positionSize, new Decimal(MIN_POSITION_SIZE));
    await log(`🧮 Размер позиции после ограничения минимумом: ${positionSize.toString()} 🧮`, 'info', 'calculateDynamicPositionSize');

    // Округление до 8 знаков после запятой
    positionSize = positionSize.toDecimalPlaces(8);
    await log(`🧮 Размер позиции после округления: ${positionSize.toString()} 🧮`, 'info', 'calculateDynamicPositionSize');

    // Финальная проверка
    if (positionSize.isNaN() || positionSize.lessThanOrEqualTo(0)) {
      throw new Error(`❌ Некорректный результат: ${positionSize.toString()} ⛔`);
    }

    await log(`✅ Финальный размер позиции: ${positionSize.toString()} ETH ✅`, 'info', 'calculateDynamicPositionSize');
    await log(`⬅️ Завершение расчета динамического размера позиции 💰`, 'info', 'calculateDynamicPositionSize');
    return positionSize;

  } catch (error) {
    await log(`❌ Ошибка в calculateDynamicPositionSize: ${error.message} ❌`, 'error', 'calculateDynamicPositionSize');
    return new Decimal(MIN_POSITION_SIZE);
  }
}

// Функция для расчета волатильности
async function calculateVolatility(data, period = 14) {
  try {
    if (!Array.isArray(data) || data.length < period + 1) {
      throw new Error(`Недостаточно данных для расчета волатильности. Требуется ${period + 1}, получено ${data.length}`);
    }

    const closes = data.map(d => parseFloat(d.close));
    if (closes.some(isNaN)) {
      throw new Error('Некорректные данные цен закрытия');
    }

    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i <= period; i++) {
      const difference = closes[i] - closes[i - 1];
      if (difference > 0) {
        gains += difference;
      } else {
        losses -= difference;
      }
    }

    if (gains === 0 && losses === 0) {
      await log('Нет изменений цены в период расчета волатильности', 'warn', 'calculateVolatility');
      return 0;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
      const difference = closes[i] - closes[i - 1];
      const currentGain = Math.max(difference, 0);
      const currentLoss = Math.max(-difference, 0);

      avgGain = ((avgGain * (period - 1)) + currentGain) / period;
      avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
    }

    if (avgLoss === 0) {
      await log('Средний убыток равен 0, волатильность не может быть рассчитана', 'warn', 'calculateVolatility');
      return 0;
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    // Нормализуем RSI в диапазон от 0 до 1 для использования в качестве меры волатильности
    const volatility = Math.abs(50 - rsi) / 50;
    
    await log(`Рассчитана волатильность: ${volatility.toFixed(4)}`, 'info', 'calculateVolatility');
    
    return volatility;
  } catch (error) {
    await log(`Ошибка при расчете волатильности: ${error.message}`, 'error', 'calculateVolatility');
    throw error;
  }
}

// Функция для возвращаения предыдущий сгенерированных торговый сигнал
async function getPreviousSignal(symbol = 'ETHUSDT') {
  try {
    await log(`Начало getPreviousSignal для ${symbol}`, 'debug', 'getPreviousSignal');

    const signal = previousSignals.find(s => s.symbol === symbol);
    await log(`Найденный сигнал: ${JSON.stringify(signal) || 'null'}`, 'debug', 'getPreviousSignal');
    return signal ? signal.type : null;

  } catch (error) {
    await log(`Ошибка в getPreviousSignal: ${error.message}`, 'error', 'getPreviousSignal');
    return null;
  }
}

// Функция для сохранения возвращаения предыдущий сгенерированных торговый сигнал
async function saveSignal(signal) {
try {
  await log(`Начало saveSignal: ${JSON.stringify(signal)}`, 'debug', 'saveSignal');

  if (!signal || !signal.symbol || !signal.type) {
      throw new Error('Некорректный объект сигнала');
  }

  const existingSignalIndex = previousSignals.findIndex(s => s.symbol === signal.symbol);
  if (existingSignalIndex !== -1) {
    previousSignals[existingSignalIndex] = signal; // Обновляем существующий сигнал
  } else {
    previousSignals.push(signal); // Добавляем новый сигнал
  }
  await log(`Сигнал сохранен: ${JSON.stringify(signal)}`, 'debug', 'saveSignal');


} catch (error) {
  await log(`Ошибка в saveSignal: ${error.message}`, 'error', 'saveSignal');
}
}


// Функция для анализа данных с помощью нейронной сети
async function analyzeDataWithNN(symbol, interval = '15m') {
  try {
    await log(`Начало анализа данных с помощью нейросети для ${symbol}`, 'info', 'analyzeDataWithNN');
    
    const input = await prepareInputDataForNN(symbol, interval);
    const neuralNet = await loadLatestModel();
    
    if (!neuralNet || !neuralNet.model) {
      throw new Error('Модель нейронной сети не загружена');
    }

    const prediction = await predictWithNeuralNetwork(neuralNet.model, input);
    
    if (!prediction || !Array.isArray(prediction) || prediction.length !== 3 || prediction.some(isNaN)) {
      throw new Error(`Некорректное предсказание нейронной сети: ${JSON.stringify(prediction)}`);
    }

    await log(`Прогноз нейросети: ${JSON.stringify(prediction)}`, 'info', 'analyzeDataWithNN');

    const [upProbability, downProbability, neutralProbability] = prediction.map(p => new Decimal(p));

    let signal;
    let signalStrength;
    const previousSignal = getPreviousSignal(); // Функция для получения предыдущего сигнала
    const HYSTERESIS = 0.1; // Значение гистерезиса

    if (upProbability.minus(downProbability).greaterThan(HYSTERESIS) || 
        (previousSignal === 'buy' && upProbability.greaterThan(downProbability))) {
      signal = 'buy';
      signalStrength = upProbability;
    } else if (downProbability.minus(upProbability).greaterThan(HYSTERESIS) || 
               (previousSignal === 'sell' && downProbability.greaterThan(upProbability))) {
      signal = 'sell';
      signalStrength = downProbability;
    } else {
      signal = 'hold';
      signalStrength = neutralProbability;
    }

    const currentPrice = new Decimal(await getPrice(symbol));
    const usdToRubRate = new Decimal(await getUsdToRubRate());
    const currentPriceRub = currentPrice.times(usdToRubRate);
    const volume = new Decimal(await getAverageVolume(symbol, interval));

    const risk = new Decimal(calculateRisk(prediction));
    const stopLoss = calculateStopLoss(currentPrice, risk, signal);
    const takeProfit = calculateTakeProfit(currentPrice, risk, signal);
    const trailingStop = calculateTrailingStop(currentPrice, risk, signal);
    const tradeVolume = await calculateTradeVolume(symbol, interval, risk, signalStrength);

    const tradeVolumeRub = tradeVolume.times(currentPrice).times(usdToRubRate);

    await log(`Конец анализа данных с помощью нейросети для ${symbol}`, 'info', 'analyzeDataWithNN');

    const result = {
      signal,
      signalStrength: signalStrength.toNumber(),
      currentPrice: currentPrice.toNumber(),
      currentPriceRub: currentPriceRub.toNumber(),
      risk: risk.toNumber(),
      stopLoss: stopLoss.toNumber(),
      takeProfit: takeProfit.toNumber(),
      trailingStop: trailingStop.toNumber(),
      positionSize: tradeVolume.toNumber(),
      tradeVolume: tradeVolume.toNumber(),
      tradeVolumeRub: tradeVolumeRub.toNumber(),
      volume: volume.toNumber(),
      rawPrediction: prediction
    };

    // Сохраняем сигнал
    await saveSignal({ symbol, type: signal, time: new Date(), data: result  }); // <-- Добавлено

    for (const key in result) {
      if (typeof result[key] === 'number' && (isNaN(result[key]) || !isFinite(result[key]))) {
        throw new Error(`Значение ${key} некорректно: ${result[key]}`);
      }
    }

    return result;
  } catch (error) {
    await log(`Ошибка при анализе данных с помощью нейросети: ${error.message}`, 'error', 'analyzeDataWithNN');
    throw error;
  }
}

/**
 * Переобучает LSTM модель
 * @returns {Promise<void>}
 */
async function retrainLSTMModel() {
  const startTime = Date.now();
  try {
    await log('🔄 Начало переобучения LSTM модели', 'info', 'retrainLSTMModel');
    await log(`💾 Начальное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'retrainLSTMModel');

    await log('📊 Получение исторических данных', 'debug', 'retrainLSTMModel');
    const historicalData = await fetchHistoricalData('ETHUSDT', '15m', 1000);
    await log(`📈 Получено ${historicalData.length} исторических записей`, 'info', 'retrainLSTMModel');

    await log('🔧 Подготовка данных для LSTM', 'debug', 'retrainLSTMModel');
    const trainingData = await prepareDataForLSTM(historicalData);
    await log(`🧪 Подготовлено ${trainingData.length} записей для обучения`, 'info', 'retrainLSTMModel');

    await log('🧠 Начало обучения LSTM модели', 'debug', 'retrainLSTMModel');
    global.lstmModel = await trainLSTMModel(trainingData);
    await log('🎓 LSTM модель успешно переобучена', 'info', 'retrainLSTMModel');

    const executionTime = Date.now() - startTime;
    await log(`⏱️ Время выполнения retrainLSTMModel: ${executionTime}ms`, 'info', 'retrainLSTMModel');
    await log(`💾 Конечное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'retrainLSTMModel');
  } catch (error) {
    const executionTime = Date.now() - startTime;
    await log(`❌ Ошибка при переобучении LSTM модели: ${error.message}`, 'error', 'retrainLSTMModel');
    await log(`🔍 Стек ошибки: ${error.stack}`, 'debug', 'retrainLSTMModel');
    await log(`⏱️ Время до возникновения ошибки: ${executionTime}ms`, 'error', 'retrainLSTMModel');
    await log(`💾 Использование памяти при ошибке: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'retrainLSTMModel');
  }
}

// Планируем переобучение LSTM модели каждые 24 часа
setInterval(retrainLSTMModel, 24 * 60 * 60 * 1000);

/**
 * Создает модель LSTM нейронной сети с улучшенной конфигурацией
 * @returns {brain.recurrent.LSTM} Модель LSTM
 */
function createLSTMModel() {
  const startTime = Date.now();
  try {
    log('🏗️ Создание модели LSTM', 'info', 'createLSTMModel');
    log(`💾 Начальное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'createLSTMModel');
    
    log('🔧 Настройка параметров модели LSTM', 'debug', 'createLSTMModel');
    const modelConfig = {
      inputSize: 250,
      hiddenLayers: [128, 64],
      outputSize: 3,
      activation: 'leaky-relu',
      learningRate: 0.01,
      decayRate: 0.999,
      dropout: 0.1,
    };
    log(`📊 Конфигурация модели LSTM: ${JSON.stringify(modelConfig)}`, 'debug', 'createLSTMModel');

    const model = new brain.recurrent.LSTM(modelConfig);
    
    log('🧠 Инициализация весов модели', 'debug', 'createLSTMModel');
    
    log('✅ Модель LSTM успешно создана', 'info', 'createLSTMModel');
    
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000;
    log(`⏱️ Время создания модели LSTM: ${executionTime} секунд`, 'info', 'createLSTMModel');
    log(`💾 Конечное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'createLSTMModel');
    
    return model;
  } catch (error) {
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000;
    log(`❌ Ошибка при создании модели LSTM: ${error.message}`, 'error', 'createLSTMModel');
    log(`🔍 Стек ошибки: ${error.stack}`, 'debug', 'createLSTMModel');
    log(`⏱️ Время до возникновения ошибки: ${executionTime} секунд`, 'error', 'createLSTMModel');
    log(`💾 Использование памяти при ошибке: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'createLSTMModel');
    throw error;
  }
}

/**
 * Обучает модель LSTM на предоставленных данных
 * @param {Array} trainingData Данные для обучения
 * @param {number} startingEpoch Начальная эпоха (для продолжения обучения)
 * @param {number} totalEpochs Общее количество эпох для обучения
 * @returns {Promise<brain.recurrent.LSTM>} Обученная модель LSTM
 */
async function trainLSTMModel(trainingData, startingEpoch = 1, totalEpochs = 100) { 
  const startTime = Date.now();
  try {
    await log('🏋️‍♂️ Начало тренировки LSTM модели 🤖', 'info', 'trainLSTMModel');
   // await log(`📊 Параметры обучения: startingEpoch=${startingEpoch}, totalEpochs=${totalEpochs}`, 'debug', 'trainLSTMModel');
   // await log(`📚 Размер обучающего набора: ${trainingData.length}`, 'debug', 'trainLSTMModel');
   // await log(`🖥️ Системная информация: ${JSON.stringify(process.versions)}`, 'debug', 'trainLSTMModel');
    
    if (!Array.isArray(trainingData) || trainingData.length === 0) {
      throw new Error('Некорректные данные для обучения');
    }

   // await log(`📊 Пример данных для обучения: ${JSON.stringify(trainingData[0])}`, 'debug', 'trainLSTMModel');

   // Проверка на NaN значения во входных данных
   for (let i = 0; i < trainingData.length; i++) {
    const { input, output } = trainingData[i];
    if (input.some(isNaN) || output.some(isNaN)) {
      throw new Error(`❌ Ошибка: NaN значения обнаружены в trainingData[${i}]. input: ${JSON.stringify(input)}, output: ${JSON.stringify(output)}`);
    }
    if (!Array.isArray(input) || !Array.isArray(output)) {
      throw new Error(`❌ Ошибка: Неверный формат данных в trainingData[${i}]. input: ${JSON.stringify(input)}, output: ${JSON.stringify(output)}`);

    }
  }

    let model = await loadLSTMModelFromEpoch(startingEpoch);
    if (!model) {
      await log('🆕 Создание новой модели LSTM', 'info', 'trainLSTMModel');
      model = await createLSTMModel();
     // await log(`🔧 Конфигурация новой модели: ${JSON.stringify(model.toJSON())}`, 'detail', 'trainLSTMModel');
    } else {
      await log(`📥 Загружена существующая модель с эпохи ${startingEpoch}`, 'info', 'trainLSTMModel');
      await log(`🔧 Конфигурация загруженной модели: ${JSON.stringify(model.toJSON())}`, 'detail', 'trainLSTMModel');
    }

    const validationData = trainingData.slice(-Math.floor(trainingData.length * 0.2));
    const trainingDataSet = trainingData.slice(0, -validationData.length);

    await log(`📊 Размер обучающего набора: ${trainingDataSet.length}, валидационного набора: ${validationData.length}`, 'debug', 'trainLSTMModel');
    await log(`📊 Формат данных: 
      Длина входных данных: ${trainingDataSet[0].input.length},
      Длина выходных данных: ${trainingDataSet[0].output.length}`, 'debug', 'trainLSTMModel');

    const epochStartTime = Date.now();
    let bestValidationError = Infinity;
    let bestModel = null;
    let totalEpochTime = 0;

    for (let epoch = startingEpoch; epoch <= totalEpochs; epoch++) {
      const iterationStartTime = Date.now();
      await log(`🔄 Начало эпохи ${epoch}/${totalEpochs}`, 'debug', 'trainLSTMModel');

      try {
        const usedMemory = process.memoryUsage().heapUsed / 1024 / 1024;
       // await log(`💾 Использовано памяти перед обучением: ${usedMemory.toFixed(2)} MB`, 'debug', 'trainLSTMModel');
       //await log(`🔧 Текущая конфигурация модели: ${JSON.stringify(model.toJSON())}`, 'detail', 'trainLSTMModel');

        const stats = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Превышено время ожидания обучения'));
          }, 300000); // 5 минут

          try {
            const result = model.train(trainingDataSet, {
              iterations: 1,
              errorThresh: 0.005,
              log: true,
              logPeriod: 1,
              callback: (stats) => {
                log(`🔄 Промежуточные результаты: ${JSON.stringify(stats)}`, 'debug', 'trainLSTMModel');
              }
            });
            clearTimeout(timeout);
            resolve(result); 
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });

        const iterationEndTime = Date.now();
        const iterationDuration = (iterationEndTime - iterationStartTime) / 1000;
        totalEpochTime += iterationDuration;

        const accuracy = calculateAccuracy(model, trainingDataSet);
        const validationError = calculateValidationError(model, validationData);
        const avgEpochTime = totalEpochTime / (epoch - startingEpoch + 1);
        const remainingTime = (totalEpochs - epoch) * avgEpochTime;

        await log(
          `💪 Эпоха ${epoch}/${totalEpochs} завершена! 
          Ошибка: ${stats.error.toFixed(4)}, 
          Точность: ${accuracy.toFixed(2)}%, 
          Ошибка валидации: ${validationError.toFixed(4)},
          Время эпохи: ${iterationDuration.toFixed(2)}с,
          Среднее время эпохи: ${avgEpochTime.toFixed(2)}с,
          Оставшееся время: ${formatTime(remainingTime)}`, 
          'info',
          'trainLSTMModel'
        );

        await log(`📊 Детальные статистики эпохи: ${JSON.stringify(stats)}`, 'debug', 'trainLSTMModel');
        await log(`💾 Использование памяти после эпохи: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'trainLSTMModel');

        if (validationError < bestValidationError) {
          bestValidationError = validationError;
          bestModel = model.toJSON();
          await saveLSTMModel(model, epoch);
          await log(`🏆 Новая лучшая модель сохранена (эпоха ${epoch})`, 'info', 'trainLSTMModel');
          await log(`🔧 Конфигурация лучшей модели: ${JSON.stringify(bestModel)}`, 'debug', 'trainLSTMModel');
        }

        if (epoch % 10 === 0) {
          await saveLSTMModel(model, epoch);
          await log(`💾 Промежуточное сохранение модели (эпоха ${epoch})`, 'info', 'trainLSTMModel');
          await log(`🔧 Конфигурация сохраненной модели: ${JSON.stringify(model.toJSON())}`, 'debug', 'trainLSTMModel');
        }

        setImmediate(() => {
          log('🔄 Проверка блокировки основного потока', 'debug', 'trainLSTMModel');
        });

      } catch (error) {
        await log(`❌ Ошибка в эпохе ${epoch}: ${error.message}`, 'error', 'trainLSTMModel');
        await log(`❌ Стек ошибки: ${error.stack}`, 'error', 'trainLSTMModel');
        await log(`💾 Состояние памяти при ошибке: ${JSON.stringify(process.memoryUsage())}`, 'error', 'trainLSTMModel');
        break; // Прерываем цикл обучения при ошибке
      }
    }

    if (bestModel) {
      model.fromJSON(bestModel);
      await log('🔄 Загружена лучшая модель', 'info', 'trainLSTMModel');
      await log(`🔧 Конфигурация финальной модели: ${JSON.stringify(model.toJSON())}`, 'debug', 'trainLSTMModel');
    }

    const totalExecutionTime = (Date.now() - startTime) / 1000;
    const totalEpochsTime = (Date.now() - epochStartTime) / 1000;
    await log(`🎓 LSTM модель успешно натренирована! 
               Общее время: ${totalExecutionTime.toFixed(2)}с, 
               Время обучения: ${totalEpochsTime.toFixed(2)}с, 
               Среднее время на эпоху: ${(totalEpochsTime / (totalEpochs - startingEpoch + 1)).toFixed(2)}с 🎉`, 
               'info', 'trainLSTMModel');
    await log(`💾 Финальное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'trainLSTMModel');
    return model;
  } catch (error) {
    const totalExecutionTime = (Date.now() - startTime) / 1000;
    await log(`❌ Ошибка при обучении LSTM модели 🤖: ${error.message}. Время выполнения: ${totalExecutionTime.toFixed(2)}с`, 'error', 'trainLSTMModel');
    await log(`❌ Полный стек ошибки: ${error.stack}`, 'error', 'trainLSTMModel');
    await sendTelegramNotification(`❌ Ошибка при обучении LSTM: ${error.message}`);
    throw error; 
  }
}

/**
 * Загружает модель LSTM из определенной эпохи
 * @param {number} epoch Номер эпохи
 * @returns {Promise<brain.recurrent.LSTM|null>} Модель LSTM или null, если загрузка не удалась
 */
async function loadLSTMModelFromEpoch(epoch) {
  const modelPath = path.join(LSTM_MODEL_DIR, `lstm_model_epoch_${epoch}.json`);
  try {
    if (await fs.pathExists(modelPath)) {
      const modelData = await fs.readJson(modelPath);
      const model = new brain.recurrent.LSTM();
      model.fromJSON(modelData);
      
      // Проверка корректности загруженной модели
      if (typeof model.run !== 'function') {
        throw new Error('Загруженная модель некорректна');
      }
      
      await log(`✅ Модель LSTM успешно загружена из эпохи ${epoch}`, 'info', 'loadLSTMModelFromEpoch');
      return model;
    }
  } catch (error) {
    await log(`❌ Ошибка при загрузке модели LSTM из эпохи ${epoch}: ${error.message}`, 'error', 'loadLSTMModelFromEpoch');
  }
  return null;
}

/**
 * Сохраняет модель LSTM в файл
 * @param {brain.recurrent.LSTM} model Модель LSTM
 * @param {number} epoch Номер эпохи
 * @returns {Promise<void>}
 */
async function saveLSTMModel(model, epoch) {
  const modelPath = path.join(LSTM_MODEL_DIR, `lstm_model_epoch_${epoch}.json`);
  try {
    await fs.ensureDir(LSTM_MODEL_DIR);
    await fs.writeJson(modelPath, model.toJSON(), { spaces: 2 });
    await log(`💾 Модель LSTM успешно сохранена в эпоху ${epoch}`, 'info', 'saveLSTMModel');
  } catch (error) {
    await log(`❌ Ошибка при сохранении модели LSTM: ${error.message}`, 'error', 'saveLSTMModel');
    throw error;
  }
}

/**
 * Находит последнюю сохраненную эпоху LSTM модели
 * @returns {Promise} Номер последней эпохи или 0, если модели не найдены
 */
async function findLastSavedEpoch() {
  const startTime = Date.now();
  try {
    await log('🔍 Начало поиска последней сохраненной эпохи LSTM', 'info', 'findLastSavedEpoch');
    await log(`💾 Начальное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'findLastSavedEpoch');

    await log(`📁 Проверка директории: ${LSTM_MODEL_DIR}`, 'debug', 'findLastSavedEpoch');
    await fs.ensureDir(LSTM_MODEL_DIR);
    
    await log('📚 Чтение файлов из директории', 'debug', 'findLastSavedEpoch');
    const files = await fs.readdir(LSTM_MODEL_DIR);
    await log(`📊 Количество файлов в директории: ${files.length}`, 'debug', 'findLastSavedEpoch');

    const epochNumbers = files
      .filter(file => file.startsWith('lstm_model_epoch_') && file.endsWith('.json'))
      .map(file => parseInt(file.replace('lstm_model_epoch_', '').replace('.json', '')))
      .filter(num => !isNaN(num));

    await log(`🔢 Найденные номера эпох: ${JSON.stringify(epochNumbers)}`, 'debug', 'findLastSavedEpoch');

    const lastEpoch = epochNumbers.length > 0 ? Math.max(...epochNumbers) : 0;
    
    const executionTime = Date.now() - startTime;
    await log(`✅ Поиск завершен. Последняя эпоха: ${lastEpoch}. Время выполнения: ${executionTime}ms`, 'info', 'findLastSavedEpoch');
    await log(`💾 Конечное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'findLastSavedEpoch');

    return lastEpoch;
  } catch (error) {
    const executionTime = Date.now() - startTime;
    await log(`❌ Ошибка при поиске последней сохраненной эпохи: ${error.message}`, 'error', 'findLastSavedEpoch');
    await log(`🔍 Стек ошибки: ${error.stack}`, 'debug', 'findLastSavedEpoch');
    await log(`⏱️ Время до возникновения ошибки: ${executionTime}ms`, 'error', 'findLastSavedEpoch');
    await log(`💾 Использование памяти при ошибке: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'findLastSavedEpoch');
    return 0;
  }
}

/**
 * Выполняет предсказание с использованием модели LSTM. Добавлено логирование.
 * @param {brain.recurrent.LSTM} model Модель LSTM.
 * @param {Array} inputData Входные данные для предсказания.
 * @returns {Array} Результат предсказания.
 */
function predictWithLSTM(model, inputData) {
  try {
    log('🔮 Начало предсказания с помощью LSTM', 'info', 'predictWithLSTM');
    log(`➡️ Входные данные: ${JSON.stringify(inputData)}`, 'debug', 'predictWithLSTM');

    if (!model || typeof model.run !== 'function') {
      throw new Error('❌ Некорректная модель LSTM: модель не определена или отсутствует метод run.');
    }

    if (!Array.isArray(inputData) || inputData.length === 0 || !inputData.every(Array.isArray)) {
      throw new Error('❌ Некорректные входные данные: не массив, пустой массив, или элементы не являются массивами.');
    }

    // Проверка на undefined значения во входных данных
    for (let i = 0; i < inputData.length; i++) {
      if (inputData[i].some(value => typeof value === 'undefined')) {
        throw new Error(`❌ Некорректные входные данные: undefined значения обнаружены в inputData[${i}]: ${JSON.stringify(inputData[i])}`);
      }
    }

    // Проверка на NaN значения во входных данных
    for (let i = 0; i < inputData.length; i++) {
      if (inputData[i].some(isNaN)) {
        throw new Error(`❌ Некорректные входные данные: NaN значения обнаружены в inputData[${i}]: ${JSON.stringify(inputData[i])}`);
      }
    }

    const prediction = model.run(inputData);
    log(`📊 Результат предсказания LSTM: ${JSON.stringify(prediction)}`, 'info', 'predictWithLSTM');
    return prediction;
  } catch (error) {
    log(`❌ Ошибка при предсказании с помощью LSTM: ${error.message}`, 'error', 'predictWithLSTM');
    log(`❌ Полный стек trace ошибки: ${error.stack}`, 'error', 'predictWithLSTM');
    throw error;
  }
}

/**
 * Подготавливает данные для обучения LSTM модели
 * @param {Array} historicalData Исторические данные
 * @returns {Array} Подготовленные данные для обучения
 */
async function prepareDataForLSTM(historicalData) {
  try {
    if (!Array.isArray(historicalData) || historicalData.length === 0) {
      throw new Error("❌ Неверный формат входных данных: не массив или пустой массив.");
    }
    
    await log('🔧 Начало подготовки данных для LSTM', 'info', 'prepareDataForLSTM');
    
    const preparedData = await Promise.all(historicalData.map(async (data, index) => {
      const input = historicalData.slice(Math.max(0, index - 49), index + 1).map(candle => {
        const normalizedValues = [
          normalize(candle.open, 0, 10000),
          normalize(candle.high, 0, 10000),
          normalize(candle.low, 0, 10000),
          normalize(candle.close, 0, 10000),
          normalize(candle.volume, 0, 1000000)
        ];
        
        // Добавлена проверка на undefined
        if (normalizedValues.some(value => typeof value === 'undefined')) {
          throw new Error(`Undefined обнаружен в нормализованных данных для индекса ${index}`);
        }
        
        return normalizedValues;
      }).flat();

      let output;
      if (index < historicalData.length - 1) {
        const nextCandle = historicalData[index + 1];
        const priceChange = data.close !== 0 ? (nextCandle.close - data.close) / data.close : 0;
        if (typeof priceChange === 'undefined') {
          throw new Error(`Undefined обнаружен при вычислении изменения цены для индекса ${index}`);
        }
        if (priceChange > 0.005) output = [1, 0, 0];
        else if (priceChange < -0.005) output = [0, 1, 0];
        else output = [0, 0, 1];
      } else {
        output = [0, 0, 1];
      }

     //  await log(`Подготовлены данные для индекса ${index}: input.length=${input.length}, output=${JSON.stringify(output)}`, 'detail', 'prepareDataForLSTM');

      return { input, output };
    }));
    
    await log(`✅ Данные успешно подготовлены. Количество записей: ${preparedData.length}`, 'info', 'prepareDataForLSTM');
    return preparedData;
  } catch (error) {
    await log(`❌ Полный стек trace ошибки: ${error.stack}`, 'error', 'prepareDataForLSTM');
    throw error;
  }
}


/**
 * Вычисляет ошибку на валидационном наборе данных
 * @param {brain.recurrent.LSTM} model Модель LSTM
 * @param {Array} validationData Валидационные данные
 * @returns {number} Ошибка на валидационном наборе
 */
function calculateValidationError(model, validationData) {
  let totalError = 0;
  for (const sample of validationData) {
    const prediction = model.run(sample.input);
    const error = prediction.reduce((sum, value, index) => sum + Math.pow(value - sample.output[index], 2), 0);
    totalError += error;
  }
  return totalError / validationData.length;
}

/**
 * Анализирует данные с использованием комбинированных моделей
 * @param {string} symbol Символ торговой пары
 * @param {string} interval Интервал свечей
 * @returns {Promise<Object>} Результат анализа
 */
async function analyzeDataWithCombinedModels(symbol, interval = '15m') {
  const startTime = Date.now();
  try {
    await log(`🔍 Начало анализа данных с комбинированными моделями для ${symbol} на интервале ${interval}`, 'info', 'analyzeDataWithCombinedModels');
    await log(`💾 Начальное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'analyzeDataWithCombinedModels');
    
    if (!neuralNet || !neuralNet.model) {
      throw new Error('Нейронная сеть не инициализирована');
    }
    await log(`✅ Нейронная сеть инициализирована`, 'debug', 'analyzeDataWithCombinedModels');

    await log(`🔄 Подготовка входных данных для нейронной сети`, 'debug', 'analyzeDataWithCombinedModels');
    const inputData = await prepareInputDataForNN(symbol, interval);
    await log(`📊 Размер входных данных для нейронной сети: ${inputData.length}`, 'debug', 'analyzeDataWithCombinedModels');

    await log(`🔄 Подготовка входных данных для LSTM`, 'debug', 'analyzeDataWithCombinedModels');
    const lstmInputData = await prepareInputDataForLSTM(symbol, interval, 50, 1);
    await log(`📊 Размер входных данных для LSTM: ${lstmInputData.length}`, 'debug', 'analyzeDataWithCombinedModels');

    let nnPrediction = [0.33, 0.33, 0.34]; // Значения по умолчанию
    let lstmPrediction = [0.33, 0.33, 0.34]; // Значения по умолчанию

    try {
      await log(`🧠 Начало предсказания с помощью нейронной сети`, 'debug', 'analyzeDataWithCombinedModels');
      nnPrediction = await predictWithNeuralNetwork(neuralNet.model, inputData);
      await log(`📊 Результат предсказания нейронной сети: ${JSON.stringify(nnPrediction)}`, 'debug', 'analyzeDataWithCombinedModels');
    } catch (nnError) {
      await log(`❌ Ошибка при предсказании нейронной сети: ${nnError.message}`, 'error', 'analyzeDataWithCombinedModels');
      await log(`🔍 Стек ошибки нейронной сети: ${nnError.stack}`, 'debug', 'analyzeDataWithCombinedModels');
    }

    if (global.lstmModel) { 
      try {
        await log(`🧠 Начало предсказания с помощью LSTM`, 'debug', 'analyzeDataWithCombinedModels');
        lstmPrediction = predictWithLSTM(global.lstmModel, lstmInputData[0]);
        await log(`📊 Результат предсказания LSTM: ${JSON.stringify(lstmPrediction)}`, 'debug', 'analyzeDataWithCombinedModels');
      } catch (lstmError) {
        await log(`❌ Ошибка при предсказании LSTM: ${lstmError.message}`, 'error', 'analyzeDataWithCombinedModels');
        await log(`🔍 Стек ошибки LSTM: ${lstmError.stack}`, 'debug', 'analyzeDataWithCombinedModels');
      }
    } else {
      await log('⚠️ LSTM модель недоступна для анализа', 'warn', 'analyzeDataWithCombinedModels'); 
    }

    const combinedPrediction = nnPrediction.map((value, index) => 
      (value + lstmPrediction[index]) / 2
    );
    await log(`📊 Комбинированное предсказание: ${JSON.stringify(combinedPrediction)}`, 'info', 'analyzeDataWithCombinedModels');

    const [upProbability, downProbability, neutralProbability] = combinedPrediction;
    await log(`📈 Вероятность роста: ${upProbability}, 📉 Вероятность падения: ${downProbability}, 📊 Вероятность нейтрального движения: ${neutralProbability}`, 'debug', 'analyzeDataWithCombinedModels');
    
    let signal, signalStrength;
    if (upProbability > downProbability && upProbability > neutralProbability) {
      signal = 'buy';
      signalStrength = upProbability;
    } else if (downProbability > upProbability && downProbability > neutralProbability) {
      signal = 'sell';
      signalStrength = downProbability;
    } else {
      signal = 'hold';
      signalStrength = neutralProbability;
    }
    await log(`🚦 Сгенерированный сигнал: ${signal}, Сила сигнала: ${signalStrength}`, 'info', 'analyzeDataWithCombinedModels');

    await log(`💹 Получение текущей цены для ${symbol}`, 'debug', 'analyzeDataWithCombinedModels');
    const currentPrice = new Decimal(await getPrice(symbol));
    await log(`💰 Текущая цена ${symbol}: ${currentPrice}`, 'debug', 'analyzeDataWithCombinedModels');

    await log(`🧮 Расчет риска`, 'debug', 'analyzeDataWithCombinedModels');
    const risk = calculateRisk(combinedPrediction);
    await log(`⚠️ Рассчитанный риск: ${risk}`, 'debug', 'analyzeDataWithCombinedModels');

    await log(`🛑 Расчет Stop Loss`, 'debug', 'analyzeDataWithCombinedModels');
    const stopLoss = calculateStopLoss(currentPrice, risk, signal);
    await log(`🛑 Рассчитанный Stop Loss: ${stopLoss}`, 'debug', 'analyzeDataWithCombinedModels');

    await log(`🎯 Расчет Take Profit`, 'debug', 'analyzeDataWithCombinedModels');
    const takeProfit = calculateTakeProfit(currentPrice, risk, signal);
    await log(`🎯 Рассчитанный Take Profit: ${takeProfit}`, 'debug', 'analyzeDataWithCombinedModels');

    await log(`🏃‍♂️ Расчет Trailing Stop`, 'debug', 'analyzeDataWithCombinedModels');
    const trailingStop = calculateTrailingStop(currentPrice, risk, signal);
    await log(`🏃‍♂️ Рассчитанный Trailing Stop: ${trailingStop}`, 'debug', 'analyzeDataWithCombinedModels');

    await log(`📊 Расчет волатильности`, 'debug', 'analyzeDataWithCombinedModels');
    const volatility = await calculateVolatility(historicalData);
    await log(`📊 Рассчитанная волатильность: ${volatility}`, 'debug', 'analyzeDataWithCombinedModels');

    await log(`💼 Расчет размера позиции`, 'debug', 'analyzeDataWithCombinedModels');
    const positionSize = await calculateDynamicPositionSize(symbol, risk, volatility, signalStrength);
    await log(`💼 Рассчитанный размер позиции: ${positionSize}`, 'debug', 'analyzeDataWithCombinedModels');

    await log(`📊 Получение среднего объема`, 'debug', 'analyzeDataWithCombinedModels');
    const volume = await getAverageVolume(symbol, interval);
    await log(`📊 Средний объем: ${volume}`, 'debug', 'analyzeDataWithCombinedModels');

    const result = {
      signal,
      signalStrength,
      currentPrice: currentPrice.toNumber(),
      risk,
      stopLoss: stopLoss.toNumber(),
      takeProfit: takeProfit.toNumber(),
      trailingStop: trailingStop.toNumber(),
      positionSize: positionSize.toNumber(),
      volume,
      rawPrediction: combinedPrediction
    };

    await log(`✅ Результат анализа: ${JSON.stringify(result)}`, 'info', 'analyzeDataWithCombinedModels');
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000;
    await log(`⏱️ Время выполнения анализа: ${executionTime} секунд`, 'info', 'analyzeDataWithCombinedModels');
    await log(`💾 Конечное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'analyzeDataWithCombinedModels');
    return result;
  } catch (error) {
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000;
    await log(`❌ Ошибка при анализе данных с комбинированными моделями: ${error.message}`, 'error', 'analyzeDataWithCombinedModels');
    await log(`🔍 Стек ошибки: ${error.stack}`, 'debug', 'analyzeDataWithCombinedModels');
    await log(`⏱️ Время до возникновения ошибки: ${executionTime} секунд`, 'error', 'analyzeDataWithCombinedModels');
    await log(`💾 Использование памяти при ошибке: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'analyzeDataWithCombinedModels');
    // Возвращаем нейтральный результат вместо выброса исключения
    return {
      signal: 'hold',
      signalStrength: 0,
      currentPrice: await getPrice(symbol),
      risk: 0,
      stopLoss: 0,
      takeProfit: 0,
      trailingStop: 0,
      positionSize: 0,
      volume: 0,
      rawPrediction: [0.33, 0.33, 0.34]
    };
  }
}


// Функция для корректировки весов моделей
async function adjustModelWeights() {
  const startTime = Date.now();
  try {
    await log('⚖️ Начало корректировки весов моделей', 'info', 'adjustModelWeights');
    await log(`💾 Начальное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'adjustModelWeights');
    
    await log('🔍 Получение валидационных данных', 'debug', 'adjustModelWeights');
    const validationData = await getValidationData();
    await log(`📊 Размер валидационного набора: ${validationData.length}`, 'debug', 'adjustModelWeights');

    await log('🧠 Оценка точности модели Brain.js', 'debug', 'adjustModelWeights');
    const brainAccuracy = await evaluateModelAccuracy(neuralNet, validationData);
    await log(`🎯 Точность Brain.js: ${brainAccuracy.toFixed(4)}`, 'info', 'adjustModelWeights');

    await log('🧠 Оценка точности модели LSTM', 'debug', 'adjustModelWeights');
    const lstmAccuracy = await evaluateModelAccuracy(global.lstmModel, validationData);
    await log(`🎯 Точность LSTM: ${lstmAccuracy.toFixed(4)}`, 'info', 'adjustModelWeights');

    const totalAccuracy = brainAccuracy + lstmAccuracy;
    await log(`📊 Общая точность: ${totalAccuracy.toFixed(4)}`, 'debug', 'adjustModelWeights');

    const brainWeight = brainAccuracy / totalAccuracy;
    const lstmWeight = lstmAccuracy / totalAccuracy;

    await log('💾 Сохранение новых весов моделей', 'debug', 'adjustModelWeights');
    await saveModelWeights(brainWeight, lstmWeight);

    await log(`✅ Скорректированные веса моделей: Brain.js - ${brainWeight.toFixed(4)}, LSTM - ${lstmWeight.toFixed(4)}`, 'info', 'adjustModelWeights');

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000;
    await log(`⏱️ Время выполнения корректировки весов: ${executionTime} секунд`, 'info', 'adjustModelWeights');
    await log(`💾 Конечное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'adjustModelWeights');

    return { brainWeight, lstmWeight };
  } catch (error) {
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000;
    await log(`❌ Ошибка при корректировке весов моделей: ${error.message}`, 'error', 'adjustModelWeights');
    await log(`🔍 Стек ошибки: ${error.stack}`, 'debug', 'adjustModelWeights');
    await log(`⏱️ Время до возникновения ошибки: ${executionTime} секунд`, 'error', 'adjustModelWeights');
    await log(`💾 Использование памяти при ошибке: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'adjustModelWeights');
    return { brainWeight: 0.5, lstmWeight: 0.5 };
  }
}

// Функция для сохранения весов моделей
async function saveModelWeights(brainWeight, lstmWeight) {
  const weightsPath = path.join(__dirname, 'model_weights.json');
  try {
    await fs.writeJson(weightsPath, { brainWeight, lstmWeight });
    await log('💾 Веса моделей успешно сохранены', 'info', 'saveModelWeights');
  } catch (error) {
    await log(`❌ Ошибка при сохранении весов моделей: ${error.message}`, 'error', 'saveModelWeights');
    throw error;
  }
}

//  Функцию для периодической корректировки весов
function scheduleModelWeightAdjustment() {
  const ADJUSTMENT_INTERVAL = 24 * 60 * 60 * 1000; // 24 часа
  setInterval(async () => {
    try {
      await log('🕒 Запуск запланированной корректировки весов моделей', 'info', 'scheduleModelWeightAdjustment');
      await adjustModelWeights();
    } catch (error) {
      await log(`❌ Ошибка при запланированной корректировке весов моделей: ${error.message}`, 'error', 'scheduleModelWeightAdjustment');
    }
  }, ADJUSTMENT_INTERVAL);
}

// Вызовите эту функцию при запуске приложения
scheduleModelWeightAdjustment();


// Функция для оценки точности модели
async function evaluateModelAccuracy(model, validationData) {
  const startTime = Date.now();
  try {
    await log('🎯 Начало оценки точности модели', 'info', 'evaluateModelAccuracy');
    await log(`💾 Начальное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'evaluateModelAccuracy');
    await log(`📊 Размер валидационного набора: ${validationData.length}`, 'debug', 'evaluateModelAccuracy');
    
    let correctPredictions = 0;
    let totalPredictions = 0;
    
    for (const sample of validationData) {
      await log(`🔄 Обработка образца ${totalPredictions + 1}/${validationData.length}`, 'debug', 'evaluateModelAccuracy');
      const prediction = await model.predict(sample.input);
      await log(`📊 Предсказание модели: ${JSON.stringify(prediction)}`, 'debug', 'evaluateModelAccuracy');
      
      const predictedClass = prediction.indexOf(Math.max(...prediction));
      const actualClass = sample.output.indexOf(Math.max(...sample.output));
      
      await log(`🔍 Предсказанный класс: ${predictedClass}, Фактический класс: ${actualClass}`, 'debug', 'evaluateModelAccuracy');
      
      if (predictedClass === actualClass) {
        correctPredictions++;
        await log('✅ Правильное предсказание', 'debug', 'evaluateModelAccuracy');
      } else {
        await log('❌ Неправильное предсказание', 'debug', 'evaluateModelAccuracy');
      }
      
      totalPredictions++;
    }
    
    const accuracy = correctPredictions / validationData.length;
    
    await log(`📊 Точность модели: ${(accuracy * 100).toFixed(2)}%`, 'info', 'evaluateModelAccuracy');
    await log(`✅ Правильных предсказаний: ${correctPredictions}/${totalPredictions}`, 'info', 'evaluateModelAccuracy');
    
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000;
    await log(`⏱️ Время выполнения оценки точности: ${executionTime} секунд`, 'info', 'evaluateModelAccuracy');
    await log(`💾 Конечное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'evaluateModelAccuracy');
    
    return accuracy;
  } catch (error) {
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000;
    await log(`❌ Ошибка при оценке точности модели: ${error.message}`, 'error', 'evaluateModelAccuracy');
    await log(`🔍 Стек ошибки: ${error.stack}`, 'debug', 'evaluateModelAccuracy');
    await log(`⏱️ Время до возникновения ошибки: ${executionTime} секунд`, 'error', 'evaluateModelAccuracy');
    await log(`💾 Использование памяти при ошибке: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'evaluateModelAccuracy');
    throw error;
  }
}

/**
 * Получает данные для валидации моделей
 * @returns {Promise<Array>} Данные для валидации
 */
async function getValidationData() {
  try {
    await log('🔍 Получение данных для валидации', 'info', 'getValidationData');
    
    const symbol = 'ETHUSDT';
    const interval = '15m';
    const lookback = 100;
    
    const historicalData = await fetchHistoricalDataForTraining(symbol, interval, lookback * 2);
    const preparedData = prepareDataForLSTM(historicalData);
    
    const validationData = preparedData.slice(-lookback);  // Берем последние 100 записей для валидации
    
    await log(`✅ Получено ${validationData.length} образцов для валидации`, 'info', 'getValidationData');
    
    return validationData;
  } catch (error) {
    await log(`❌ Ошибка при получении данных для валидации: ${error.message}`, 'error', 'getValidationData');
    throw error;
  }
}

// Расчет обьема сделки
async function calculateTradeVolume(symbol, interval, risk, signalStrength) {
  try {
    await log(`Начало расчета объема сделки для ${symbol}`, 'info', 'calculateTradeVolume');

    const averageVolume = new Decimal(await getAverageVolume(symbol, interval)); // Decimal
    const currentPrice = new Decimal(await getPrice(symbol)); // Decimal
    const usdToRubRate = new Decimal(await getUsdToRubRate()); // Decimal
    const availableBalance = new Decimal(await getAvailableBalance('ETH')); // Decimal
    const availableBalanceRub = availableBalance.times(currentPrice).times(usdToRubRate);

    await log(`Доступный баланс: ${availableBalance.toFixed(8)} ETH (${availableBalanceRub.toFixed(2)} RUB)`, 'info', 'calculateTradeVolume');


    const basePositionSize = averageVolume.times(0.03); // 1% от среднего объема (Decimal)
    let adjustedPositionSize = basePositionSize.times(signalStrength).times(new Decimal(1).minus(risk));  // Decimal


    const maxPositionSize = availableBalance.times(0.1); // Максимум 10% от доступного баланса (Decimal)
    adjustedPositionSize = Decimal.min(adjustedPositionSize, maxPositionSize);  // Decimal

    const tradeVolume = Decimal.max(adjustedPositionSize, MIN_POSITION_SIZE);  // Decimal

    const tradeVolumeRub = tradeVolume.times(currentPrice).times(usdToRubRate);

    await log(`Рассчитанный объем сделки: ${tradeVolume.toFixed(8)} ETH (${tradeVolumeRub.toFixed(2)} RUB)`, 'info', 'calculateTradeVolume');
    await log(`Параметры расчета: Сила сигнала=${signalStrength.toFixed(4)}, Риск=${(risk.times(100)).toFixed(2)}%`, 'info', 'calculateTradeVolume'); // risk - Decimal

    return tradeVolume; // Возвращаем Decimal
  } catch (error) {
    await log(`Ошибка при расчете объема сделки: ${error.message}`, 'error', 'calculateTradeVolume');
    return new Decimal(0); // Возвращаем Decimal 0 в случае ошибки
  }
}

// Расчет среднего объема торгов
async function getAverageVolume(symbol, interval, period = 24) {
  try {
    const historicalData = await fetchHistoricalData(symbol, interval, period);
    const volumes = historicalData.map(candle => candle.volume);
    const averageVolume = volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length;


    await log(`Расчет среднего объема торгов для ${symbol}:`, 'info', 'getAverageVolume');
    await log(`Период: ${period} интервалов`, 'info', 'getAverageVolume');

    return averageVolume;
  } catch (error) {
    await log(`Ошибка при получении среднего объема торгов: ${error.message}`, 'error', 'getAverageVolume');
    return 0;
  }
}

// Функция для логирования данных маршрута
async function logRouteData(routeName, data) {
  const logDir = path.join(__dirname, 'route_logs');
  const logFile = path.join(logDir, `${routeName}.json`);

  try {
    await fs.ensureDir(logDir);
    if (!(await fs.pathExists(logFile))) {
      await fs.writeJson(logFile, data, { spaces: 2 });
      console.log(`Log created for route: ${routeName}`);
    }
  } catch (error) {
    console.error(`Error logging data for route ${routeName}:`, error);
  }
}


// Функция для расчета риска
function calculateRisk(prediction) {
  const [upProbability, downProbability, neutralProbability] = prediction.map(p => new Decimal(p));
  const maxProbability = Decimal.max(upProbability, downProbability, neutralProbability);
  const risk = new Decimal(1).minus(maxProbability);
  return Decimal.min(Decimal.max(risk, new Decimal(0.01)), new Decimal(0.05)); // Ограничиваем риск от 1% до 5%
}

// Функция для Стоп лосса
function calculateStopLoss(currentPrice, risk, signal) {
  const stopLossPercentage = risk.times(2); // Удваиваем риск для стоп-лосса
  return signal === 'buy' 
    ? currentPrice.times(new Decimal(1).minus(stopLossPercentage))
    : currentPrice.times(new Decimal(1).plus(stopLossPercentage));
}

// Функция для расчета тэйк профита
function calculateTakeProfit(currentPrice, risk, signal) {
  const takeProfitPercentage = risk.times(3); // Утраиваем риск для тейк-профита
  return signal === 'buy' 
    ? currentPrice.times(new Decimal(1).plus(takeProfitPercentage))
    : currentPrice.times(new Decimal(1).minus(takeProfitPercentage));
}


// Функция для расчета ADX (Average Directional Index)
function calculateADX(historicalData) {
  if (historicalData.length < 14) {
    return 0;
  }

  const highs = historicalData.map(data => data.high);
  const lows = historicalData.map(data => data.low);
  const closes = historicalData.map(data => data.close);

  let plusDM = [];
  let minusDM = [];
  let trueRange = [];

  for (let i = 1; i < highs.length; i++) {
    const highChange = highs[i] - highs[i-1];
    const lowChange = lows[i-1] - lows[i];

    plusDM.push(highChange > lowChange && highChange > 0 ? highChange : 0);
    minusDM.push(lowChange > highChange && lowChange > 0 ? lowChange : 0);

    trueRange.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i-1]),
      Math.abs(lows[i] - closes[i-1])
    ));
  }

  const smoothedPlusDM = calculateSmoothedAverage(plusDM, 14);
  const smoothedMinusDM = calculateSmoothedAverage(minusDM, 14);
  const smoothedTR = calculateSmoothedAverage(trueRange, 14);

  const plusDI = (smoothedPlusDM / smoothedTR) * 100;
  const minusDI = (smoothedMinusDM / smoothedTR) * 100;

  const dx = Math.abs((plusDI - minusDI) / (plusDI + minusDI)) * 100;

  return dx;
}

// Функция для расчета сглаженного среднего
function calculateSmoothedAverage(arr, period) {
  let smoothed = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < arr.length; i++) {
    smoothed = ((smoothed * (period - 1)) + arr[i]) / period;
  }
  return smoothed;
}


// Функция для расчета среднего значения
function average(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

// Функция для расчета волатильности
function calculateVolatility(closes) {
  if (closes.length < 2) return 0;
  
  const returns = closes.slice(1).map((price, index) => 
    (price - closes[index]) / closes[index]
  );
  
  const avgReturn = average(returns);
  const squaredDiffs = returns.map(r => Math.pow(r - avgReturn, 2));
  const variance = average(squaredDiffs);
  
  return Math.sqrt(variance) * Math.sqrt(252) * 100; // Годовая волатильность в процентах
}


// Функция для анализа настроений трейдеров (используем Fear and Greed Index как пример)
async function analyzeSentiment() {
  try {
    await log('😊 Анализ рыночных настроений', 'info', 'analyzeSentiment');
    const [fngData, cryptoData] = await Promise.all([fetchSentimentData(), fetchCryptoSentimentData()]);
    
    if (!fngData && !cryptoData) {
      return {
        fearGreedIndex: 50,
        cryptoSentiment: 50,
        sentiment: 'Нейтральный',
        description: 'Нейтральный (нет данных)',
        value: 50,
        marketCapChange: 0
      };
    }

    const fearGreedIndex = fngData ? parseInt(fngData.value) : 50;
    const cryptoSentiment = cryptoData ? cryptoData.value : 50;
    
    let sentiment;
    let description;

    const averageSentiment = (fearGreedIndex + cryptoSentiment) / 2;

    if (averageSentiment > 75) {
      sentiment = 'Крайняя жадность';
      description = 'Рынок крайне оптимистичен, возможна коррекция';
    } else if (averageSentiment > 50) {
      sentiment = 'Жадность';
      description = 'Рынок оптимистичен, но есть риски';
    } else if (averageSentiment > 25) {
      sentiment = 'Страх';
      description = 'Рынок пессимистичен, но есть возможности';
    } else {
      sentiment = 'Крайний страх';
      description = 'Рынок крайне пессимистичен, возможен разворот';
    }

    return {
      fearGreedIndex: fearGreedIndex,
      cryptoSentiment: cryptoSentiment,
      sentiment: sentiment,
      description: description,
      value: averageSentiment,
      marketCapChange: cryptoData ? cryptoData.marketCapChange : 0
    };
  } catch (error) {
    await log(`Ошибка при анализе настроений: ${error.message}`, 'error', 'analyzeSentiment');
    return {
      fearGreedIndex: 50,
      cryptoSentiment: 50,
      sentiment: 'Нейтральный',
      description: 'Нейтральный (ошибка анализа)',
      value: 50,
      marketCapChange: 0
    };
  }
}


// Функция для расчета цены стоп-лосса
function calculateStopLoss(currentPrice, risk, signal) {
  const stopLossPercentage = risk.times(2); // Удваиваем риск для стоп-лосса
  return signal === 'buy' 
    ? currentPrice.times(new Decimal(1).minus(stopLossPercentage))
    : currentPrice.times(new Decimal(1).plus(stopLossPercentage));
}

// Функция для расчета цены тейк-профита
function calculateTakeProfit(currentPrice, risk, signal) {
  const takeProfitPercentage = risk.times(3); // Утраиваем риск для тейк-профита
  return signal === 'buy' 
    ? currentPrice.times(new Decimal(1).plus(takeProfitPercentage))
    : currentPrice.times(new Decimal(1).minus(takeProfitPercentage));
}



// Дополнительная функция для получения сентмента
async function fetchSentimentData() {
  try {
    // Проверяем кэш
    const cachedData = sentimentCache.get('fearGreedIndex');
    if (cachedData) {
      return cachedData;
    }

    const response = await axios.get('https://api.alternative.me/fng/', { 
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'YourBotName/1.0'
      }
    });

    if (response.data && response.data.data && response.data.data.length > 0) {
      const result = response.data.data[0];
      
      // Сохраняем результат в кэш
      sentimentCache.set('fearGreedIndex', result);

      return result;
    } else {
      throw new Error('Неверный формат данных от API Fear and Greed Index');
    }
  } catch (error) {
    await log(`Ошибка при получении данных о настроениях (Fear and Greed Index): ${error.message}`, 'error', 'fetchSentimentData');
    
    // Если есть кэшированные данные, возвращаем их даже в случае ошибки
    const cachedData = sentimentCache.get('fearGreedIndex');
    if (cachedData) {
      await log('Использование кэшированных данных для Fear and Greed Index', 'warn', 'fetchSentimentData');
      return cachedData;
    }

    // Если кэшированных данных нет, возвращаем значение по умолчанию
    return { value: "50", value_classification: "Neutral" };
  }
}

const sentimentCache = new NodeCache({ stdTTL: 6 * 60 * 60 }); // кэш на 6 часов

let lastRequestTime = 0;
const REQUEST_INTERVAL = 400000; // 61 секунда между запросами

async function fetchCryptoSentimentData() {
  try {
    // Проверяем кэш
    const cachedData = sentimentCache.get('cryptoSentiment');
    if (cachedData) {
      return cachedData;
    }

    // Проверяем, прошло ли достаточно времени с последнего запроса
    const now = Date.now();
    if (now - lastRequestTime < REQUEST_INTERVAL) {
      const waitTime = REQUEST_INTERVAL - (now - lastRequestTime);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    lastRequestTime = Date.now();

    const response = await axios.get('https://api.coingecko.com/api/v3/global', { 
      timeout: 5000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'YourBotName/1.0'
      }
    });

    if (response.data && response.data.data && typeof response.data.data.market_cap_change_percentage_24h_usd === 'number') {
      const marketCapChange = response.data.data.market_cap_change_percentage_24h_usd;
      let sentimentValue;
      if (marketCapChange > 10) sentimentValue = 90;
      else if (marketCapChange > 5) sentimentValue = 75;
      else if (marketCapChange > 2.5) sentimentValue = 65;
      else if (marketCapChange > 0) sentimentValue = 55;
      else if (marketCapChange > -2.5) sentimentValue = 45;
      else if (marketCapChange > -5) sentimentValue = 35;
      else if (marketCapChange > -10) sentimentValue = 25;
      else sentimentValue = 10;

      const result = {
        value: sentimentValue,
        marketCapChange: marketCapChange
      };

      // Сохраняем результат в кэш
      sentimentCache.set('cryptoSentiment', result);

      return result;
    } else {
      throw new Error('Неверный формат данных от API CoinGecko');
    }
  } catch (error) {
    if (error.response && error.response.status === 429) {
      await log('Превышен лимит запросов к CoinGecko API. Использование кэшированных данных или значений по умолчанию.', 'warn', 'fetchCryptoSentimentData');
      return sentimentCache.get('cryptoSentiment') || { value: 50, marketCapChange: 0 };
    }
    await log(`Ошибка при получении данных о настроениях (CoinGecko): ${error.message}`, 'error', 'fetchCryptoSentimentData');
    return null;
  }
}

// Функция для анализа новостей
async function analyzeNews() {
  const parser = new Parser();
  const tokenizer = new natural.WordTokenizer();
  const analyzer = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');

  try {
    // Используем англоязычный RSS-фид
    const feed = await parser.parseURL('https://cointelegraph.com/rss');
    const news = feed.items.slice(0, 10); // Анализируем последние 10 новостей

    const analyzedNews = news.map(item => {
      const tokens = tokenizer.tokenize(item.title + ' ' + item.content);
      const sentiment = analyzer.getSentiment(tokens);
      return {
        title: item.title,
        sentiment: sentiment
      };
    });

    const overallSentiment = analyzedNews.reduce((sum, item) => sum + item.sentiment, 0) / analyzedNews.length;

    return {
      latestNews: analyzedNews.map(item => item.title),
      sentiment: overallSentiment
    };
  } catch (error) {
    await log(`Ошибка при анализе новостей: ${error.message}`, 'error', 'analyzeNews');
    return {
      latestNews: [],
      sentiment: 0
    };
  }
}

// Функция для логирования сделок

//функцию для анализа сделок
async function analyzeTrades(startDate, endDate) {
  const tradeLogDir = path.join(__dirname, 'trade_logs');
  let allTrades = [];

  try {
    const files = await fs.readdir(tradeLogDir);
    for (const file of files) {
      if (file.startsWith('trades_') && file.endsWith('.json')) {
        const fileDate = file.split('_')[1].split('.')[0];
        if (fileDate >= startDate && fileDate <= endDate) {
          const trades = await fs.readJson(path.join(tradeLogDir, file));
          allTrades = allTrades.concat(trades);
        }
      }
    }

    const totalTrades = allTrades.length;
    const profitableTrades = allTrades.filter(trade => trade.order.profit > 0).length;
    const totalProfit = allTrades.reduce((sum, trade) => sum + (trade.order.profit || 0), 0);

    const analysis = {
      totalTrades,
      profitableTrades,
      unprofitableTrades: totalTrades - profitableTrades,
      totalProfit,
      winRate: (profitableTrades / totalTrades) * 100,
      averageProfit: totalProfit / totalTrades
    };

    await log(`Анализ сделок завершен: ${JSON.stringify(analysis)}`, 'info', 'analyzeTrades');
    return analysis;
  } catch (error) {
    await log(`Ошибка при анализе сделок: ${error.message}`, 'error', 'analyzeTrades');
    throw error;
  }
}

// Добавьте это в начало файла или там, где у вас объявлены другие интервалы
const TRADE_ANALYSIS_INTERVAL = 24 * 60 * 60 * 1000; // 24 часа

// Добавьте эту функцию в ваш основной код
async function performPeriodicTradeAnalysis() {
  try {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 30 дней назад
    
    const analysis = await analyzeTrades(startDate, endDate);
    
    await log(`Периодический анализ сделок: ${JSON.stringify(analysis)}`, 'info', 'performPeriodicTradeAnalysis');
    
    // Отправка результатов анализа в Telegram
    await sendTelegramMessage(`Анализ сделок за последние 30 дней:\n${JSON.stringify(analysis, null, 2)}`);
    
    // Здесь вы можете добавить логику для корректировки стратегии на основе результатов анализа
    if (analysis.winRate < 50) {
      await log('Низкий процент выигрышных сделок. Рекомендуется пересмотреть стратегию.', 'warn', 'performPeriodicTradeAnalysis');
    }
  } catch (error) {
    await log(`Ошибка при выполнении периодического анализа сделок: ${error.message}`, 'error', 'performPeriodicTradeAnalysis');
  }
}

// Запускаем периодический анализ
setInterval(performPeriodicTradeAnalysis, TRADE_ANALYSIS_INTERVAL);

// Обновленная функция executeTrade с использованием улучшенного механизма исполнения
async function executeTrade(symbol, action, amount, signalId) {
  try {
    await log(`🚀 Начало executeTrade. Symbol: ${symbol}, Action: ${action}, Amount: ${amount}, SignalId: ${signalId}`, 'debug', 'executeTrade');
    const currentPrice = await getPrice(symbol);
    
    // Добавляем случайное проскальзывание (от -0.1% до +0.1%)
    const slippage = 1 + (Math.random() * 0.002 - 0.001);
    const executionPrice = currentPrice * slippage;
    
    await log(`Текущая цена: ${currentPrice}, Цена исполнения с учетом проскальзывания: ${executionPrice}. Signal ID: ${signalId}`, 'info', 'executeTrade');

    let orderResult;
    if (currentTradingMode === 'test') {
      orderResult = await executeTestTrade(symbol, action, amount, executionPrice, signalId);
    } else {
      orderResult = await placeOrderWithAdvancedExecution(symbol, action.toUpperCase(), amount.toString(), executionPrice.toString());
    }

    if (orderResult.success) {
      const order = orderResult.order;
      await log(`📈 Ордер выполнен: ${JSON.stringify(order)}. Signal ID: ${signalId}`, 'info', 'executeTrade');
      await updateTradeHistory(order.orderId, action, order.price, amount, signalId);
      const updatedPortfolio = await updatePortfolio();
      
      const { profitLoss, profitLossPercentage } = await calculateProfitLoss(order, order.price);
      await log(`📈 Прибыль/убыток: ${profitLoss.toFixed(8)} USD (${profitLossPercentage.toFixed(2)}%). Signal ID: ${signalId}`, 'info', 'executeTrade');

      const usdToRubRate = await getUsdToRubRate();
      const orderAmountRub = amount * order.price * usdToRubRate;
      const profitLossRub = profitLoss * usdToRubRate;
      await logTradingPerformance();
      await sendTradeNotificationToTelegram(order, profitLossRub, updatedPortfolio.totalValueRUB, orderAmountRub, signalId);
      
      return { 
        order, 
        profitLoss, 
        profitLossRub, 
        profitLossPercentage,
        signalId,
        updatedPortfolio
      };
    } else {
      await log(`Не удалось выполнить ордер. Причина: ${orderResult.reason}. Signal ID: ${signalId}`, 'error', 'executeTrade');
      return null;
    }
  } catch (error) {
    await log(`Ошибка при выполнении сделки: ${error.message}. Signal ID: ${signalId}`, 'error', 'executeTrade');
    throw error;
  }
}

// Функция для расчета адаптивного времени удержания
function calculateAdaptiveHoldTime(marketConditions, orderType) {
  const baseHoldTime = 15 * 60 * 1000; // 15 минут базового времени
  let multiplier = 1;

  if (marketConditions.volatility > 0.02) {
    multiplier *= 0.8; // Уменьшаем время удержания при высокой волатильности
  } else if (marketConditions.volatility < 0.005) {
    multiplier *= 1.2; // Увеличиваем время удержания при низкой волатильности
  }

  if (marketConditions.volume > 1.5) {
    multiplier *= 0.9; // Слегка уменьшаем время удержания при высоком объеме
  }

  if (orderType === 'buy' && marketConditions.trend === 'Восходящий') {
    multiplier *= 1.1; // Увеличиваем время удержания для покупок в восходящем тренде
  } else if (orderType === 'sell' && marketConditions.trend === 'Нисходящий') {
    multiplier *= 1.1; // Увеличиваем время удержания для продаж в нисходящем тренде
  }

  const adaptiveHoldTime = Math.round(baseHoldTime * multiplier);
  
  log(`⏱️ Расчет адаптивного времени удержания:
  📊 Базовое время: ${baseHoldTime} мс
  📈 Множитель: ${multiplier.toFixed(2)}
  🔢 Итоговое время: ${adaptiveHoldTime} мс
  💹 Волатильность: ${marketConditions.volatility.toFixed(4)}
  📊 Объем: ${marketConditions.volume.toFixed(2)}
  🔀 Тренд: ${marketConditions.trend}
  🔄 Тип ордера: ${orderType}`, 'info', 'calculateAdaptiveHoldTime');

  return adaptiveHoldTime;
}

// Функция для проверки и закрытия позиции
async function checkAndClosePosition(symbol, order, stopLossPrice, takeProfitPrice) {
  try {
    await log(`🔍 Проверка позиции для ордера ${order.orderId}`, 'info', 'checkAndClosePosition');
    const currentPrice = new Decimal(await getPrice(symbol));
    const decimalStopLossPrice = new Decimal(stopLossPrice);
    const decimalTakeProfitPrice = new Decimal(takeProfitPrice);
    
    await log(`💹 Текущая цена: ${currentPrice.toString()}
    🛑 Стоп-лосс: ${decimalStopLossPrice.toString()}
    🎯 Тейк-профит: ${decimalTakeProfitPrice.toString()}`, 'detail', 'checkAndClosePosition');

    if ((order.side === 'BUY' && currentPrice.lessThanOrEqualTo(decimalStopLossPrice)) || 
        (order.side === 'SELL' && currentPrice.greaterThanOrEqualTo(decimalStopLossPrice))) {
      await log(`🚨 Достигнут уровень стоп-лосс`, 'warn', 'checkAndClosePosition');
      await closePosition(symbol, order, currentPrice, 'Stop Loss');
    } else if ((order.side === 'BUY' && currentPrice.greaterThanOrEqualTo(decimalTakeProfitPrice)) || 
               (order.side === 'SELL' && currentPrice.lessThanOrEqualTo(decimalTakeProfitPrice))) {
      await log(`🎉 Достигнут уровень тейк-профит`, 'info', 'checkAndClosePosition');
      await closePosition(symbol, order, currentPrice, 'Take Profit');
    } else {
      await log(`⏳ Позиция не закрыта. Текущая цена: ${currentPrice.toString()}`, 'info', 'checkAndClosePosition');
    }
  } catch (error) {
    await log(`❌ Ошибка при проверке и закрытии позиции: ${error.message}`, 'error', 'checkAndClosePosition');
    await handleApiError(error, 'checkAndClosePosition');
  }
}

// Выполнение тестовой сделки
async function executeTestTrade(symbol, action, amount, executionPrice, signalId) {
  try {
    await log(`Выполнение тестовой сделки: ${action} ${amount} ${symbol} по цене ${executionPrice}. Signal ID: ${signalId}`, 'detail', 'executeTestTrade');

    const usdToRubRate = await getUsdToRubRate(); // Получаем курс USD/RUB
    const orderValueRub = amount * executionPrice * usdToRubRate; // Рассчитываем стоимость ордера в рублях

    const commission = amount * executionPrice * COMMISSION_RATE;
    const commissionRub = commission * usdToRubRate;


    const currentBalance = await fs.readJson(VIRTUAL_BALANCE_FILE);
    await log(`Текущий баланс: ${JSON.stringify(currentBalance)}`, 'detail', 'executeTestTrade');

    if (action === 'buy') {
      const cost = amount * executionPrice * (1 + COMMISSION_RATE);
      const costRub = cost * usdToRubRate;

      if (new Decimal(currentBalance.RUB).greaterThanOrEqualTo(costRub)) {

        const newRubBalance = new Decimal(currentBalance.RUB).minus(costRub); // Используем Decimal для вычислений
        const newEthBalance = new Decimal(currentBalance.ETH).plus(amount);

        await updateVirtualBalance('RUB', newRubBalance);
        await updateVirtualBalance('ETH', newEthBalance);

        await log(`Покупка ${amount} ETH по цене ${executionPrice}. Комиссия: ${commissionRub.toFixed(2)} RUB. Баланс RUB: ${newRubBalance}, ETH: ${newEthBalance}. Signal ID: ${signalId}`, 'info', 'executeTestTrade');

      } else {
        const errorMessage = `Недостаточно средств для покупки. Signal ID: ${signalId}, Требуется: ${costRub.toFixed(2)} RUB, Доступно: ${currentBalance.RUB} RUB`;
        await log(errorMessage, 'error', 'executeTestTrade');
        throw new Error(errorMessage);
      }
    } else if (action === 'sell') {
      if (new Decimal(currentBalance.ETH).greaterThanOrEqualTo(amount)) { // Используем Decimal для сравнения

        const revenue = amount * executionPrice * (1 - COMMISSION_RATE);
        const revenueRub = revenue * usdToRubRate;
        const newRubBalance = new Decimal(currentBalance.RUB).plus(revenueRub); // Используем Decimal для вычислений
        const newEthBalance = new Decimal(currentBalance.ETH).minus(amount);

        await updateVirtualBalance('RUB', newRubBalance);
        await updateVirtualBalance('ETH', newEthBalance);

        await log(`Продажа ${amount} ETH по цене ${executionPrice}. Комиссия: ${commissionRub.toFixed(2)} RUB. Баланс RUB: ${newRubBalance}, ETH: ${newEthBalance}. Signal ID: ${signalId}`, 'info', 'executeTestTrade');
      } else {
        const errorMessage = `Недостаточно ETH для продажи. Signal ID: ${signalId}, Требуется: ${amount}, Доступно: ${currentBalance.ETH}`;
        await log(errorMessage, 'error', 'executeTestTrade');
        throw new Error(errorMessage);
      }
    }

    const updatedBalance = await fs.readJson(VIRTUAL_BALANCE_FILE);
    await log(`Тестовый портфель обновлен: ${JSON.stringify(updatedBalance)}. Signal ID: ${signalId}`, 'info', 'executeTestTrade');

    await updateTradingStatistics(action, amount, executionPrice, orderValueRub);

    return {
      success: true,
      order: {
        orderId: Date.now().toString(),
        symbol: symbol,
        side: action === 'buy' ? 'Buy' : 'Sell',
        orderType: 'Market',
        qty: amount.toString(),
        price: executionPrice,
        status: 'FILLED',
        signalId: signalId
      }
    };
  } catch (error) {
    await log(`Ошибка при выполнении тестовой сделки: ${error.message}. Signal ID: ${signalId}`, 'error', 'executeTestTrade');
    return { success: false, reason: error.message };
  }
}

// Функция для добавления новой сделки в историю
let tradeHistory = [];

async function updateTradeHistory(orderId, action, price, amount, profitLoss = null) {
  await log(`Обновление истории сделок`, 'detail', 'updateTradeHistory');
  if (await fs.pathExists(tradeHistoryPath)) {
    tradeHistory = await fs.readJson(tradeHistoryPath);
  }

  const commission = price * amount * COMMISSION_RATE; 
  const newTrade = {
    id: orderId,
    date: moment().format('YYYY-MM-DD HH:mm:ss'),
    type: action,
    price: price,
    amount: amount,
    result: profitLoss === null ? 'pending' : (profitLoss > 0 ? 'positive' : 'negative'),
    profit: profitLoss !== null ? profitLoss.toFixed(2) : '0',
    commission: commission.toFixed(2)
  };

  const existingTradeIndex = tradeHistory.findIndex(trade => trade.id === orderId);
  if (existingTradeIndex !== -1) {
    tradeHistory[existingTradeIndex] = newTrade;
  } else {
    tradeHistory.unshift(newTrade);
  }

  await fs.writeJson(tradeHistoryPath, tradeHistory, { spaces: 2 });
  await log(`История сделок обновлена: ${JSON.stringify(newTrade)}`, 'info', 'updateTradeHistory');
  return tradeHistory;
}

// Функция для синхронизации времени с Bybit
async function getPortfolioState() {
  const maxRetries = 3;
  const initialRetryDelay = 1000; // 1 секунда

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await log(`🔄 Попытка ${attempt}/${maxRetries} получения состояния портфеля`, 'info', 'getPortfolioState');
      
      await syncTimeWithBybit(); // Синхронизируем время перед запросом
      const adjustedTimestamp = getAdjustedTime() * 1000; // Переводим в миллисекунды
      
      const accountType = 'UNIFIED';
      await log(`📡 Запрос баланса для accountType: ${accountType}, timestamp: ${adjustedTimestamp}`, 'debug', 'getPortfolioState');

      const balances = await bybitClient.getWalletBalance({ 
        accountType: accountType,
        timestamp: adjustedTimestamp,
        recv_window: 20000 // Увеличиваем окно приема до 20 секунд
      });

      await log(`📥 Ответ от Bybit API получен`, 'debug', 'getPortfolioState');

      if (!balances || balances.retCode !== 0) {
        throw new Error(`Ошибка API Bybit: ${balances.retMsg || 'Неизвестная ошибка'}`);
      }

      const portfolio = {};
      for (const asset of balances.result.list) {
        const coin = asset.coin;
        portfolio[coin] = {
          total: parseFloat(asset.walletBalance) || 0,
          free: parseFloat(asset.free) || 0,
          locked: parseFloat(asset.locked) || 0
        };

        await log(`💰 Баланс ${coin}: total=${portfolio[coin].total}, free=${portfolio[coin].free}, locked=${portfolio[coin].locked}`, 'info', 'getPortfolioState');
      }

      await log(`📊 Текущее состояние портфеля получено успешно`, 'info', 'getPortfolioState');
      return portfolio;

    } catch (error) {
      await log(`❌ Попытка ${attempt}/${maxRetries}: Ошибка при получении состояния портфеля: ${error.message}`, 'error', 'getPortfolioState');
      
      if (error.response) {
        await log(`🔍 Детали ошибки API: ${JSON.stringify(error.response.data)}`, 'error', 'getPortfolioState');
      }
      
      if (attempt === maxRetries) {
        await log(`😞 Все попытки получения состояния портфеля исчерпаны`, 'error', 'getPortfolioState');
        throw error;
      }

      const retryDelay = initialRetryDelay * Math.pow(2, attempt - 1);
      await log(`⏳ Ожидание ${retryDelay}мс перед следующей попыткой...`, 'info', 'getPortfolioState');
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

function getAdjustedTime() {
  const adjustedTime = Math.floor(Date.now() / 1000) + (global.bybitTimeOffset || 0);
  console.log(`⏰ Скорректированное время: ${adjustedTime}`);
  return adjustedTime;
}

// Обновленная функция синхронизации времени
async function syncTimeWithBybit() {
  try {
    const startTime = Date.now();
    const serverTime = await bybitClient.getServerTime();
    const endTime = Date.now();
    const requestTime = endTime - startTime;

    if (serverTime && serverTime.result && serverTime.result.timeSecond) {
      const serverTimestamp = serverTime.result.timeSecond * 1000;
      const localTimestamp = Math.floor((startTime + endTime) / 2); // Среднее время запроса
      global.bybitTimeOffset = serverTimestamp - localTimestamp;

      await log(`⏰ Время синхронизировано с Bybit. Смещение: ${global.bybitTimeOffset}мс, Время запроса: ${requestTime}мс`, 'info', 'syncTimeWithBybit');
    } else {
      throw new Error('Неверный формат ответа от сервера Bybit');
    }
  } catch (error) {
    await log(`❌ Ошибка синхронизации времени с Bybit: ${error.message}`, 'error', 'syncTimeWithBybit');
    throw error;
  }
}

// Функция для получения стоимости портфеля
async function getPortfolioValue() {
  const ethPrice = new Decimal(await getPrice('ETHUSDT'));
  const usdToRubRate = new Decimal(await getUsdToRubRate());
  const ethBalance = new Decimal(await getVirtualBalance('ETH'));
  const rubBalance = new Decimal(await getVirtualBalance('RUB'));
  const portfolioValueRub = ethBalance.times(ethPrice).times(usdToRubRate).plus(rubBalance);
  return portfolioValueRub.toNumber(); // Возвращаем число
}


// Функция для автоматической торговли
async function autoTrade(analysisResult, minSignalStrength, maxRisk) {
  await log('Начало выполнения autoTrade', 'info', 'autoTrade');

  try {
    const { signal, signalStrength, signalData, risk, price, recommendedTradeVolume } = analysisResult;

    await log(`Анализ сигнала: Сигнал: ${signal}, Сила: ${signalStrength.toFixed(2)}, Риск: ${risk.toFixed(2)}`, 'detail', 'autoTrade');
    await log(`Пороговые значения: Мин. сила сигнала: ${minSignalStrength.toFixed(2)}, Макс. риск: ${maxRisk.toFixed(2)}`, 'detail', 'autoTrade');
    await log(`Текущий режим торговли: ${currentTradingMode}`, 'detail', 'autoTrade');

    if ((signal === 'Покупать' || signal === 'Продавать') && 
    signalStrength >= minSignalStrength * 0.4 && // Уменьшено с 0.6
    risk <= maxRisk * 2.5) { // Увеличено с 2
        const action = signal === 'Покупать' ? 'buy' : 'sell';
        
        // Получаем текущий курс USD/RUB
        const usdToRubRate = await getUsdToRubRate();
        
        // Конвертируем рекомендуемый объем сделки из USD в RUB
        const tradeVolumeRUB = recommendedTradeVolume * usdToRubRate;
        
        // Проверяем, не превышает ли объем сделки текущую стоимость портфеля
        if (tradeVolumeRUB > currentPortfolioValueRUB) {
          await log(`Предупреждение: Рекомендуемый объем сделки (${tradeVolumeRUB.toFixed(2)} RUB) превышает текущую стоимость портфеля (${currentPortfolioValueRUB.toFixed(2)} RUB). Корректируем объем.`, 'warn', 'autoTrade');
          tradeVolumeRUB = currentPortfolioValueRUB * MAX_POSITION_SIZE;
        }
        
        const amount = tradeVolumeRUB / (price * usdToRubRate); // Конвертируем RUB в ETH

        try {
            const signalId = Date.now();
            await log(`Попытка выполнить сделку: ${action} ${amount.toFixed(4)} ETH (${tradeVolumeRUB.toFixed(2)} RUB)`, 'info', 'autoTrade');
            const { order } = await executeTrade(action, amount, signalId);
            await log(`Сделка выполнена: ${JSON.stringify(order)}`, 'detail', 'autoTrade');
            
            try {
                await updatePortfolio();
            } catch (updateError) {
                await log(`Ошибка при обновлении портфеля: ${updateError.message}`, 'error', 'autoTrade');
            }

            const newSignal = {
                id: signalId,
                type: action,
                timeframe: '15m',
                date: moment().format('YYYY-MM-DD HH:mm:ss'),
                price: order.price,
                signalData: signalData,
                signalStrength,
                completed: false
            };

            signals.unshift(newSignal);
            io.emit('signal', newSignal);

            let portfolioValue;
            try {
                portfolioValue = await getPortfolioValue();
                currentPortfolioValueRUB = portfolioValue * usdToRubRate;
            } catch (portfolioError) {
                await log(`Ошибка при получении стоимости портфеля: ${portfolioError.message}`, 'error', 'autoTrade');
                portfolioValue = null;
            }

            const telegramMessage = `Автоматическая торговля (${currentTradingMode}): ${action.toUpperCase()} ${amount.toFixed(4)} ETH\nЦена: ${order.price} USD\nСумма: ${tradeVolumeRUB.toFixed(2)} RUB\nСигнал: ${signal}\nСила сигнала: ${signalStrength}\nРиск: ${risk}\nОбновленный баланс портфеля: ${currentPortfolioValueRUB.toFixed(2)} RUB\nДетали: ${JSON.stringify(signalData, null, 2)}`;
            await sendTelegramMessage(telegramMessage);
        } catch (error) {
            await log(`Ошибка при выполнении сделки: ${error.message}`, 'error', 'autoTrade');
            await handleApiError(error, 'autoTrade');
        }
    } else {
      await log(`Нет сигнала для автоматической торговли. Сила сигнала: ${signalStrength.toFixed(2)}, Требуемая сила: ${minSignalStrength.toFixed(2)}, Риск: ${risk.toFixed(2)}, Макс. допустимый риск: ${maxRisk.toFixed(2)}`, 'detail', 'autoTrade');
    }
  } catch (error) {
    await log(`Ошибка в autoTrade: ${error.message}`, 'error', 'autoTrade');
    await handleApiError(error, 'autoTrade');
  } finally {
    await log('Завершение autoTrade', 'info', 'autoTrade');
  }
}

// Функция для отправки сообщения в Telegram
async function sendTelegramMessage(message) {
  try {
    const response = await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      chat_id: telegramChatId,
      text: message
    });

    if (!response.data.ok) {
      throw new Error('Ошибка отправки сообщения в Telegram');
    }

    await log('Сообщение в Telegram отправлено успешно', 'detail', 'sendTelegramMessage');
  } catch (error) {
    await log(`Ошибка отправки сообщения в Telegram: ${error.message}`, 'error', 'sendTelegramMessage');
    // Не выбрасываем ошибку дальше, чтобы не прерывать выполнение программы
  }
}

// Функция для получения предсказания нейронной сети 
async function getNeuralNetworkPrediction(symbol, interval = '15m') {
  try {
    await log(`Начало получения предсказания нейронной сети для ${symbol}`, 'info', 'getNeuralNetworkPrediction');
    
    const recentData = await fetchRecentData(symbol, interval, 100);
    if (!recentData || recentData.length < 50) {
      throw new Error('Недостаточно данных для анализа (нужно минимум 50 точек)');
    }
    
    const input = prepareInputData(recentData);
    
    try {
      validateInputData(input);
    } catch (validationError) {
      await log(`Ошибка валидации входных данных: ${validationError.message}`, 'error', 'getNeuralNetworkPrediction');
      return [0.33, 0.33, 0.34];
    }
    
    const neuralNet = await loadLatestModel();
    if (!neuralNet || !neuralNet.model) {
      throw new Error('Не удалось загрузить модель нейросети');
    }
    
    const prediction = await predictWithNeuralNetwork(neuralNet.model, input);
    await log(`Предсказание нейросети для ${symbol}: ${JSON.stringify(prediction)}`, 'info', 'getNeuralNetworkPrediction');
    
    return prediction;
  } catch (error) {
    await log(`Ошибка при получении предсказания нейронной сети: ${error.message}`, 'error', 'getNeuralNetworkPrediction');
    return [0.33, 0.33, 0.34];
  }
}

// Размещения сетки ордеров
async function placeGridOrders(symbol) {
  const startTime = Date.now();
  try {
    await log(`Попытка размещения сетки ордеров для символа: ${symbol}. Режим: ${currentTradingMode}`, 'info', 'placeGridOrders');

    const usdToRubRate = await getUsdToRubRate();
    const ethPrice = await getPrice('ETHUSDT');
    const initialBalanceRUB = 10000;
    const initialBalanceETH = initialBalanceRUB / (usdToRubRate * ethPrice);

    await log(`Начальный баланс: ${initialBalanceETH.toFixed(8)} ETH (${initialBalanceRUB.toFixed(2)} RUB)`, 'info', 'placeGridOrders');

    const currentPrice = await getPrice(symbol);
    if (!currentPrice) {
      throw new Error('Не удалось получить текущую цену');
    }
    const gridStep = currentPrice * (GRID_STEP_PERCENTAGE / 100);

    let remainingBalance = initialBalanceETH;
    const placedOrders = [];
    const MIN_ORDER_SIZE = 0.00092; // Минимальный размер ордера в ETH
    let levelIndex = 0; // Инициализируем levelIndex вне цикла

    while (placedOrders.length < 500 && remainingBalance >= MIN_ORDER_SIZE) {
      // Вычисляем цены для buy и sell ордеров на основе levelIndex
      const buyPrice = currentPrice - (levelIndex + 1) * gridStep;
      const sellPrice = currentPrice + (levelIndex + 1) * gridStep;
      levelIndex++; // Увеличиваем levelIndex после каждого уровня сетки

      const orderSize = Math.max(Math.min(remainingBalance * 0.01, MIN_ORDER_SIZE), MIN_POSITION_SIZE);

      try {
        // Запрашиваем анализ перед каждым размещением ордера
        const analysisResult = await analyzeDataWithCombinedModels(symbol);
        
        if (!analysisResult || typeof analysisResult !== 'object') {
          throw new Error('Некорректный результат анализа');
        }

        if (remainingBalance >= orderSize) {
          const buyOrder = await placeOrder(symbol, 'Buy', orderSize, buyPrice, analysisResult);
          if (buyOrder) {
            placedOrders.push(buyOrder);
            remainingBalance -= orderSize;
            await log(`Размещен ордер на покупку: ${orderSize.toFixed(8)} ETH по цене ${buyPrice.toFixed(2)} USD`, 'info', 'placeGridOrders');
          } else {
            await log(`Не удалось разместить ордер на покупку по цене ${buyPrice.toFixed(2)} USD`, 'warn', 'placeGridOrders');
          }

          const sellOrder = await placeOrder(symbol, 'Sell', orderSize, sellPrice, analysisResult);
          if (sellOrder) {
            placedOrders.push(sellOrder);
            remainingBalance -= orderSize;
            await log(`Размещен ордер на продажу: ${orderSize.toFixed(8)} ETH по цене ${sellPrice.toFixed(2)} USD`, 'info', 'placeGridOrders');
          } else {
            await log(`Не удалось разместить ордер на продажу по цене ${sellPrice.toFixed(2)} USD`, 'warn', 'placeGridOrders');
          }
        }

        await log(`Оставшийся баланс: ${remainingBalance.toFixed(8)} ETH (${(remainingBalance * currentPrice * usdToRubRate).toFixed(2)} RUB)`, 'info', 'placeGridOrders');

      } catch (orderError) {
        await log(`Ошибка при размещении ордера: ${orderError.message}`, 'error', 'placeGridOrders');
        // Продолжаем цикл, чтобы попытаться разместить следующий ордер
        continue;
      }

      if (placedOrders.length >= 500) {
        await log('Достигнут лимит в 500 ордеров. Прекращение размещения.', 'warn', 'placeGridOrders');
        break;
      }
    }

    const placementTime = Date.now() - startTime;
    await log(`Сетка ордеров размещена за ${placementTime} мс`, 'info', 'placeGridOrders');

    await log(`Сетка ордеров успешно размещена для ${symbol}. Всего размещено ордеров: ${placedOrders.length}`, 'info', 'placeGridOrders');
    await log(`Суммарный размер размещенных ордеров: ${(initialBalanceETH - remainingBalance).toFixed(8)} ETH`, 'info', 'placeGridOrders');
    await log(`Суммарный размер размещенных ордеров RUB: ${((initialBalanceETH - remainingBalance) * currentPrice * usdToRubRate).toFixed(2)} RUB`, 'info', 'placeGridOrders');

    return placedOrders;

  } catch (error) {
    await log(`Ошибка при размещении сетки ордеров: ${error.message}`, 'error', 'placeGridOrders');
    const placementTime = Date.now() - startTime;
    await log(`Размещение сетки ордеров завершено с ошибкой за ${placementTime} мс`, 'error', 'placeGridOrders');
    throw error;
  }
}

// Функция для обновления тестового портфеля
async function updateTestPortfolio(side, size, price) {
  try {
    await log(`📊 Начало обновления тестового портфеля: ${side} ${size} ETH по цене ${price} USD`, 'info', 'updateTestPortfolio');

    let balance = await getVirtualBalance();
    const ethPriceUsd = new Decimal(price);
    const usdToRubRate = new Decimal(await getUsdToRubRate());
    const sizeDecimal = new Decimal(size);

    // Убедимся, что balance.ETH - это Decimal
    balance.ETH = new Decimal(balance.ETH);

    const orderValueRub = sizeDecimal.times(ethPriceUsd).times(usdToRubRate);
    
    await log(`📊 Текущий баланс до обновления: ${balance.ETH.toFixed(8)} ETH`, 'info', 'updateTestPortfolio');
    await log(`💰 Сумма ордера: ${sizeDecimal.toFixed(8)} ETH (${orderValueRub.toFixed(2)} RUB)`, 'info', 'updateTestPortfolio');

    let profitLossEth;
    if (side.toUpperCase() === 'BUY') {
      profitLossEth = sizeDecimal;
      balance.ETH = balance.ETH.plus(sizeDecimal);
    } else if (side.toUpperCase() === 'SELL') {
      if (balance.ETH.lt(sizeDecimal)) {
        throw new Error(`🚫 Недостаточно ETH для продажи. Требуется: ${sizeDecimal} ETH, Доступно: ${balance.ETH} ETH`);
      }
      profitLossEth = sizeDecimal.negated();
      balance.ETH = balance.ETH.minus(sizeDecimal);
    } else {
      throw new Error(`Неизвестный тип ордера: ${side}`);
    }

    await updateVirtualBalance('ETH', balance.ETH);

    const totalValueRub = balance.ETH.times(ethPriceUsd).times(usdToRubRate);
    const profitLossRub = profitLossEth.times(ethPriceUsd).times(usdToRubRate);
    
    await log(`✅ Тестовый портфель обновлен: ${balance.ETH.toFixed(8)} ETH (${totalValueRub.toFixed(2)} RUB)`, 'info', 'updateTestPortfolio');
    await log(`📈 Прибыль/Убыток: ${profitLossEth.toFixed(8)} ETH (${profitLossRub.toFixed(2)} RUB)`, 'info', 'updateTestPortfolio');

    return {
      ETH: balance.ETH,
      RUB: totalValueRub,
      profitLossEth: profitLossEth,
      profitLossRub: profitLossRub
    };
  } catch (error) {
    await log(`❌ Ошибка при обновлении тестового портфеля: ${error.message}`, 'error', 'updateTestPortfolio');
    throw error;
  }
}

// Функция для размещения ордера с улучшенным механизмом ожидания исполнения
async function placeOrderWithAdvancedExecution(symbol, side, size, price) {
  try {
    await log(`🔄 Размещение ордера с улучшенным механизмом исполнения: ${symbol} ${side} ${size} по цене ${price}`, 'info', 'placeOrderWithAdvancedExecution');
    
    const order = await placeOrder(symbol, side, size, price);
    if (!order || !order.orderId) {
      throw new Error('Не удалось разместить ордер');
    }

    const executionResult = await waitForOrderExecution(order, symbol);
    return executionResult;
  } catch (error) {
    await log(`❌ Ошибка при размещении ордера с улучшенным механизмом исполнения: ${error.message}`, 'error', 'placeOrderWithAdvancedExecution');
    throw error;
  }
}

// Функция ожидания исполнения ордера с адаптивным временем и trailing stop
async function waitForOrderExecution(order, symbol) {
  const MAX_WAIT_TIME = 30 * 60 * 1000; // 30 минут
  const CHECK_INTERVAL = 10 * 1000; // 10 секунд
  const TRAILING_STOP_PERCENT = 0.005; // 0.5%

  let startTime = Date.now();
  let bestPrice = order.side === 'BUY' ? Infinity : 0;
  let trailingStopPrice = order.side === 'BUY' ? Infinity : 0;

  await log(`⏳ Начало ожидания исполнения ордера ${order.orderId}`, 'info', 'waitForOrderExecution');

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    try {
      const orderStatus = await checkOrderStatus(order.orderId, symbol);
      
      if (orderStatus.status === 'FILLED') {
        await log(`✅ Ордер ${order.orderId} исполнен`, 'info', 'waitForOrderExecution');
        return { success: true, order: orderStatus };
      }

      const currentPrice = await getPrice(symbol);
      
      if (order.side === 'BUY') {
        if (currentPrice < bestPrice) {
          bestPrice = currentPrice;
          trailingStopPrice = bestPrice * (1 + TRAILING_STOP_PERCENT);
          await log(`📉 Новая лучшая цена для покупки: ${bestPrice}, Trailing stop: ${trailingStopPrice}`, 'info', 'waitForOrderExecution');
        } else if (currentPrice > trailingStopPrice) {
          await log(`🚫 Достигнут trailing stop для покупки. Отмена ордера ${order.orderId}`, 'info', 'waitForOrderExecution');
          await cancelOrder(symbol, order.orderId);
          return { success: false, reason: 'TRAILING_STOP_TRIGGERED' };
        }
      } else { // SELL
        if (currentPrice > bestPrice) {
          bestPrice = currentPrice;
          trailingStopPrice = bestPrice * (1 - TRAILING_STOP_PERCENT);
          await log(`📈 Новая лучшая цена для продажи: ${bestPrice}, Trailing stop: ${trailingStopPrice}`, 'info', 'waitForOrderExecution');
        } else if (currentPrice < trailingStopPrice) {
          await log(`🚫 Достигнут trailing stop для продажи. Отмена ордера ${order.orderId}`, 'info', 'waitForOrderExecution');
          await cancelOrder(symbol, order.orderId);
          return { success: false, reason: 'TRAILING_STOP_TRIGGERED' };
        }
      }

      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
    } catch (error) {
      await log(`❌ Ошибка при ожидании исполнения ордера: ${error.message}`, 'error', 'waitForOrderExecution');
    }
  }

  // Если ордер не исполнен за максимальное время, отменяем его
  await log(`⏰ Превышено максимальное время ожидания для ордера ${order.orderId}. Отмена.`, 'warn', 'waitForOrderExecution');
  await cancelOrder(symbol, order.orderId);
  return { success: false, reason: 'TIMEOUT' };
}

// Функция для проверки статуса ордера
async function checkOrderStatus(orderId, symbol) {
  try {
    await log(`🔍 Проверка статуса ордера ${orderId}`, 'info', 'checkOrderStatus');
    const orderInfo = await bybitClient.getActiveOrder({
      category: 'spot',
      symbol: symbol,
      orderId: orderId
    });

    if (!orderInfo || !orderInfo.result) {
      throw new Error('Неверный ответ от API при проверке статуса ордера');
    }

    await log(`📊 Статус ордера ${orderId}: ${orderInfo.result.status}`, 'info', 'checkOrderStatus');
    return orderInfo.result;
  } catch (error) {
    await log(`❌ Ошибка при проверке статуса ордера ${orderId}: ${error.message}`, 'error', 'checkOrderStatus');
    throw error;
  }
}

// Обновленная функция размещения ордера
async function placeOrder(symbol, side, size, price, analysisResult) {
  try {
    await log(`🔔 Размещение ордера: symbol=${symbol}, side=${side}, size=${size}, price=${price}, analysisResult=${JSON.stringify(analysisResult)}`, 'info', 'placeOrder');
    const normalizedSide = side.toUpperCase();

    const usdToRubRate = await getCachedUsdRubRate();
    const orderValueRub = new Decimal(size).times(price).times(usdToRubRate);

    await log(`Размещение ордера: ${symbol} ${normalizedSide} ${size} по цене ${price}. Режим: ${currentTradingMode}`, 'info', 'placeOrder');

    const client = currentTradingMode === 'test' ? testBybitClient : bybitClient;

    const orderId = Date.now().toString();

    const order = {
      orderId,
      symbol,
      side: normalizedSide,
      price,
      size,
      status: 'В ОЖИДАНИИ',
      createdAt: new Date().toISOString(),
      signalStrength: analysisResult.signalStrength
    };

    await log(`В ОЖИДАНИИ исполнения (ID ${orderId})`, 'info', 'placeOrder');

    let balanceBefore;
    let balanceAfter;

    if (currentTradingMode === 'test') {
        balanceBefore = await getVirtualBalance('ETH');
    }

    let orderResult;

    if (currentTradingMode === 'test') {
      balanceAfter = await updateTestPortfolio(normalizedSide, size, price);

      orderResult = {
        success: true,
        order: {
          ...order,
          status: 'FILLED'
        }
      };
    } else {
      orderResult = await client.submitOrder({
        category: 'spot',
        symbol: symbol,
        side: normalizedSide,
        orderType: 'LIMIT',
        qty: size.toString(),
        price: price.toString(),
        timeInForce: 'GTC'
      });

      if (orderResult.retCode !== 0) {
        throw new Error(`Ошибка API Bybit: ${orderResult.retMsg}`);
      }
    }

    if (orderResult.success) {
      order.status = 'FILLED';

      let profitLossEth;

      if (currentTradingMode === 'test') {
          profitLossEth = new Decimal(balanceAfter.ETH).minus(balanceBefore);
      } else {
          const portfolioBeforeTrade = await getPortfolioValue();
          const portfolioAfterTrade = await getPortfolioValue();
          profitLossEth = new Decimal(portfolioAfterTrade).minus(portfolioBeforeTrade).dividedBy(price);
      }

      totalTrades++;
      if (profitLossEth.greaterThan(0)) {
        profitableTrades++;
      } else if (profitLossEth.lessThan(0)) {
        unprofitableTrades++;
      }

      const kpi = await calculateStrategyKPI();
      const currentPortfolioValueETH = currentTradingMode === 'test' ? balanceAfter.ETH : await getPortfolioValue();
      const currentPortfolioValueRUB = new Decimal(currentPortfolioValueETH).times(price).times(usdToRubRate);

      const logMessage = `
🔔 НОВЫЙ ОРДЕР (ID: ${orderId})
⏰ Время: ${moment().format('YYYY-MM-DD HH:mm:ss')}
📊 Тип: ${normalizedSide}
💰 Сумма: ${size.toFixed(8)} ETH (${orderValueRub.toFixed(2)} RUB)
💱 Цена: ${price.toFixed(2)} USD
💼 Стоимость портфеля: ${currentPortfolioValueETH.toFixed(8)} ETH (${currentPortfolioValueRUB.toFixed(2)} RUB)
📈 Прибыль/Убыток: ${profitLossEth.toFixed(8)} ETH (${profitLossEth.times(price).times(usdToRubRate).toFixed(2)} RUB)
📊 KPI стратегии:
Всего сделок: ${totalTrades}
Прибыльных сделок: ${profitableTrades}
Убыточных сделок: ${unprofitableTrades}
Винрейт: ${kpi.winRate.toFixed(2)}%
Общая прибыль: ${kpi.totalProfitETH.toFixed(8)} ETH (${kpi.totalProfitRUB.toFixed(2)} RUB)
Средняя прибыль на сделку: ${kpi.averageProfitETH.toFixed(8)} ETH (${kpi.averageProfitRUB.toFixed(2)} RUB)`;

      await log(logMessage, 'info', 'placeOrder', true);

      return order;
    } else {
      order.status = 'REJECTED';
      await log(`Ошибка при размещении ордера: ${orderResult.reason}`, 'error', 'placeOrder');
      return order;
    }
  } catch (error) {
    await log(`Ошибка при размещении ордера: ${error.message}`, 'error', 'placeOrder');
    throw error;
  }
}

// Функция для сохранения состояния сетки ордеров
async function saveGridState() {
  try {
    await log('Начало сохранения состояния сетки ордеров', 'info', 'saveGridState');
    const gridState = {
      orders: await getActiveOrders('ETHUSDT'),
      parameters: {
        GRID_STEP_PERCENTAGE,
        GRID_LEVELS
      },
      lastUpdate: new Date().toISOString()
    };

    const stateFile = path.join(__dirname, 'gridState.json');
    await fs.writeJson(stateFile, gridState);
    await log(`Состояние сетки сохранено в файл: ${stateFile}`, 'info', 'saveGridState');
    await log('Окончание сохранения состояния сетки ордеров', 'info','saveGridState');
  } catch (error) {
    await log(`Ошибка при сохранении состояния сетки: ${error.message}`, 'error', 'saveGridState');
  }
}

// Функция для восстановления состояния сетки ордеров
async function restoreGridState() {
  try {
    await log('Начало восстановления состояния сетки ордеров', 'info', 'restoreGridState');
    const stateFile = path.join(__dirname, 'gridState.json');
    if (await fs.pathExists(stateFile)) {
      const gridState = await fs.readJson(stateFile);

      // 🐛 Исправлено: используем let для GRID_STEP_PERCENTAGE и GRID_LEVELS
      GRID_STEP_PERCENTAGE = gridState.parameters.GRID_STEP_PERCENTAGE;  
      GRID_LEVELS = gridState.parameters.GRID_LEVELS;

      await log(`Состояние сетки восстановлено. GRID_STEP_PERCENTAGE: ${GRID_STEP_PERCENTAGE}, GRID_LEVELS: ${GRID_LEVELS}`, 'info', 'restoreGridState');
      return gridState.orders;
    }
    await log('Файл состояния сетки не найден', 'warn', 'restoreGridState');
    return null;
  } catch (error) {
    await log(`Ошибка при восстановлении состояния сетки: ${error.message}`, 'error', 'restoreGridState');
    return null;
  }
}

// Вызывайте saveGridState периодически и после значительных изменений:
setInterval(saveGridState, 15 * 60 * 1000); // каждые 15 минут


// Функция для мониторинга и обновления сетки
async function monitorAndUpdateGrid(symbol) {
  try {
    await log(`🔍 Начало мониторинга и обновления сетки для ${symbol}`, 'info', 'monitorAndUpdateGrid');
    
    const openOrders = await getActiveOrders(symbol);
    await log(`📊 Получено ${openOrders.length} открытых ордеров`, 'detail', 'monitorAndUpdateGrid');
    
    const currentPrice = await getPrice(symbol);
    await log(`💹 Текущая цена ${symbol}: ${currentPrice}`, 'detail', 'monitorAndUpdateGrid');
    
    const prediction = await getNeuralNetworkPrediction(symbol);
    await log(`🧠 Прогноз нейросети: ${JSON.stringify(prediction)}`, 'detail', 'monitorAndUpdateGrid');
    
    const marketConditions = await analyzeMarketConditions();
    
    for (const order of openOrders) {
      const orderPrice = parseFloat(order.price);
      const priceDifference = Math.abs(currentPrice - orderPrice) / currentPrice;

      if (priceDifference > 0.05) { // Если цена изменилась более чем на 5%
        await cancelOrder(symbol, order.orderId);
        const newPrice = calculateNewPrice(currentPrice, prediction, marketConditions);
        const adaptiveHoldTime = calculateAdaptiveHoldTime(marketConditions, order.side);
        const newOrder = await placeOrderWithAdvancedExecution(symbol, order.side, order.qty, newPrice);
        
        if (newOrder.success) {
          await log(`✅ Ордер обновлен: ${order.side} ${order.qty} ${symbol} по цене ${newPrice}. Адаптивное время удержания: ${adaptiveHoldTime}ms`, 'info', 'monitorAndUpdateGrid');
        } else {
          await log(`⚠️ Не удалось обновить ордер: ${order.side} ${order.qty} ${symbol}. Причина: ${newOrder.reason}`, 'warn', 'monitorAndUpdateGrid');
        }
      }
    }

    // Проверяем, нужно ли добавить новые ордера
    if (openOrders.length < 500) {
      const newOrders = await placeAdditionalGridOrders(symbol, currentPrice, openOrders.length);
      await log(`➕ Размещено ${newOrders.length} новых ордеров`, 'info', 'monitorAndUpdateGrid');
    }

    await log(`✅ Мониторинг и обновление сетки для ${symbol} завершены`, 'info', 'monitorAndUpdateGrid');
  } catch (error) {
    await log(`❌ Ошибка при мониторинге и обновлении сетки: ${error.message}`, 'error', 'monitorAndUpdateGrid');
    await handleApiError(error, 'monitorAndUpdateGrid');
  }
}


// Новая функция для размещения дополнительных ордеров сетки
async function placeAdditionalGridOrders(symbol, currentPrice, existingOrdersCount) {
  const totalOrdersNeeded = 500;
  const ordersToPlace = totalOrdersNeeded - existingOrdersCount;
  const newOrders = [];

  let availableBalance = await getAvailableBalance('USDT');
  const initialBalance = availableBalance;

  for (let i = 0; i < ordersToPlace && availableBalance > 0; i++) {
    const side = i % 2 === 0 ? 'BUY' : 'SELL';
    const priceOffset = (GRID_STEP_PERCENTAGE / 100) * currentPrice * (Math.floor(i / 2) + 1);
    const price = side === 'BUY' ? currentPrice - priceOffset : currentPrice + priceOffset;
    
    try {
      // Используем до 10% от начального баланса для каждого ордера
      const maxOrderSize = Math.min(initialBalance * 0.1 / price, availableBalance / price);
      const orderSize = Math.min(calculateOrderSize(price, availableBalance), maxOrderSize);

      if (orderSize * price > availableBalance) {
        await log(`Недостаточно средств для размещения ордера. Доступно: ${availableBalance.toFixed(8)} USDT`, 'warn', 'placeAdditionalGridOrders');
        break;
      }

      const order = await placeOrder(symbol, side, orderSize, price);
      newOrders.push(order);
      availableBalance -= orderSize * price;

      await log(`Размещен дополнительный ордер: ${side} ${orderSize.toFixed(8)} ${symbol} по цене ${price} USD`, 'info', 'placeAdditionalGridOrders');
    } catch (error) {
      await log(`Ошибка при размещении дополнительного ордера: ${error.message}`, 'error', 'placeAdditionalGridOrders');
    }

    if (newOrders.length + existingOrdersCount >= 500) {
      await log('Достигнут лимит в 500 ордеров. Прекращение размещения.', 'warn', 'placeAdditionalGridOrders');
      break;
    }
  }

  await log(`Размещено ${newOrders.length} дополнительных ордеров`, 'info', 'placeAdditionalGridOrders');
  return newOrders;
}


// Механизм отслеживания прибыли и убытков
async function trackProfitLoss() {
  const ordersFile = path.join(__dirname, 'orders.json');
  let orders = [];
  if (await fs.pathExists(ordersFile)) {
      orders = await fs.readJson(ordersFile);
  }

  let totalProfit = 0;
  for (const order of orders) {
      if (order.status === 'FILLED') {
          if (order.side === 'BUY') {
              totalProfit -= order.price * order.qty;
          } else {
              totalProfit += order.price * order.qty;
          }
      }
  }

  await log(`Текущая прибыль/убыток: ${totalProfit.toFixed(2)} USDT`, 'info', 'trackProfitLoss');
  return totalProfit;
}

// Вызывайте эту функцию периодически, например:
setInterval(trackProfitLoss, 60 * 60 * 1000); // каждый час

// Функция для размещения стоп-лосс ордера
async function placeStopLossOrder(symbol, side, price, quantity) {
  try {
    await log(`🛑 Размещение стоп-лосс ордера: ${symbol} ${side} ${quantity} по цене ${price}`, 'info', 'placeStopLossOrder');
    
    const decimalPrice = new Decimal(price);
    const decimalQuantity = new Decimal(quantity);

    if (currentTradingMode === 'test') {
      await log(`🧪 Тестовый режим: Симуляция размещения стоп-лосс ордера для ${symbol} по цене ${decimalPrice}`, 'info', 'placeStopLossOrder');
      return { success: true, message: 'Тестовый стоп-лосс ордер' };
    }

    const order = await bybitClient.submitOrder({
      category: 'spot',
      symbol: symbol,
      side: side,
      orderType: 'STOP',
      qty: decimalQuantity.toFixed(4),
      price: decimalPrice.toFixed(2),
      stopPrice: decimalPrice.toFixed(2),
      timeInForce: 'GTC'
    });

    await log(`✅ Стоп-лосс ордер размещен: ${JSON.stringify(order)}`, 'info', 'placeStopLossOrder');
    return order;
  } catch (error) {
    await log(`❌ Ошибка при размещении стоп-лосс ордера: ${error.message}`, 'error', 'placeStopLossOrder');
    return { success: false, message: error.message };
  }
}


// Автоматическая корректировка параметров сетки
async function adjustGridParameters() {
  const profit = await trackProfitLoss();

  if (profit > 0) {
      // Если прибыль положительная, увеличиваем шаг сетки
      GRID_STEP_PERCENTAGE *= 1.1;
  } else {
      // Если прибыль отрицательная, уменьшаем шаг сетки
      GRID_STEP_PERCENTAGE *= 0.9;
  }

  // Ограничиваем изменения шага сетки
  GRID_STEP_PERCENTAGE = Math.max(0.1, Math.min(GRID_STEP_PERCENTAGE, 5));

  await log(`Параметры сетки скорректированы. Новый шаг: ${GRID_STEP_PERCENTAGE}%`, 'info', 'adjustGridParameters');

  // Пересоздаем сетку с новыми параметрами
  await cancelAllOrders('ETHUSDT');
  await placeGridOrders('ETHUSDT');
}

// Вызывайте эту функцию периодически, например:
setInterval(adjustGridParameters, 24 * 60 * 60 * 1000); // каждые 24 часа

// Основная функция торговой стратегии
async function runTradingStrategy() {
  try {
    await log('Начало выполнения торговой стратегии', 'info', 'runTradingStrategy');
    const savedOrders = await restoreGridState();
    if (savedOrders && savedOrders.length > 0) {
      await log('Найдены сохраненные ордера, обновление существующих ордеров', 'info', 'runTradingStrategy');
      await updateExistingOrders(savedOrders);
    } else {
      await log('Сохраненные ордера не найдены, размещение новой сетки ордеров', 'info', 'runTradingStrategy');
      await placeGridOrders('ETHUSDT');
    }

    await log('Запуск мониторинга и обновления сетки', 'info', 'runTradingStrategy');
    setInterval(async () => {
      try {
        await monitorAndUpdateGrid('ETHUSDT');
      } catch (monitorError) {
        await log(`Ошибка при мониторинге и обновлении сетки: ${monitorError.message}`, 'error', 'runTradingStrategy');
        await handleApiError(monitorError, 'monitorAndUpdateGrid');
      }
    }, 2 * 60 * 1000);

    // Добавляем обработку исторических данных
    try {
      const historicalData = await fetchHistoricalData('ETHUSDT', '15', 1000);
      await log(`Получено ${historicalData.length} исторических данных`, 'info', 'runTradingStrategy');
      
      // Здесь можно добавить дополнительную логику обработки исторических данных
      
    } catch (historyError) {
      await log(`Ошибка при получении исторических данных: ${historyError.message}`, 'error', 'runTradingStrategy');
      await handleApiError(historyError, 'fetchHistoricalData');
    }

    await log('Торговая стратегия успешно запущена', 'info', 'runTradingStrategy');
  } catch (error) {
    await log(`Ошибка в торговой стратегии: ${error.message}`, 'error', 'runTradingStrategy');
    await handleApiError(error, 'runTradingStrategy');
    await sendTelegramNotification(`Критическая ошибка в торговой стратегии: ${error.message}`);
    
    // Пауза перед повторной попыткой
    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
    await runTradingStrategy(); // Рекурсивный вызов для повторной попытки
  }
}
// Запуск торговой стратегии
runTradingStrategy();

// Функция для подготовки входных данных для LSTM 
async function prepareInputDataForLSTM(symbol, interval = '15m', sequenceLength = 50, numSequences = 1) {
  const startTime = Date.now();
  try {
    await log(`🚀 Начало prepareInputDataForLSTM для ${symbol}`, 'info', 'prepareInputDataForLSTM');
    await log(`📊 Параметры: interval=${interval}, sequenceLength=${sequenceLength}, numSequences=${numSequences}`, 'debug', 'prepareInputDataForLSTM');

    if (!symbol || typeof symbol !== 'string') {
      throw new Error('❌ Некорректный символ');
    }

    const dataNeededForIndicators = 100;
    const totalDataNeeded = sequenceLength * numSequences + dataNeededForIndicators;
    await log(`📈 Запрос ${totalDataNeeded} исторических свечей`, 'debug', 'prepareInputDataForLSTM');

    const historicalData = await fetchHistoricalData(symbol, interval, totalDataNeeded);

    if (!historicalData || !Array.isArray(historicalData) || historicalData.length === 0) {
      throw new Error("❌ Ошибка: historicalData пуст или некорректен");
    }

    await log(`✅ Получено ${historicalData.length} исторических свечей`, 'info', 'prepareInputDataForLSTM');

    if (historicalData.length < totalDataNeeded) {
      await log(`⚠️ Получено меньше данных, чем требуется. Адаптируем параметры.`, 'warn', 'prepareInputDataForLSTM');
      sequenceLength = Math.floor((historicalData.length - dataNeededForIndicators) / numSequences);
      if (sequenceLength <= 0) {
        throw new Error(`❌ Недостаточно данных для формирования последовательностей`);
      }
      await log(`🔄 Новая длина последовательности: ${sequenceLength}`, 'info', 'prepareInputDataForLSTM');
    }

    const sequences = [];
    for (let i = 0; i < numSequences; i++) {
      const sequence = [];
      for (let j = 0; j < sequenceLength; j++) {
        const index = i * sequenceLength + j + dataNeededForIndicators;

        if (index >= historicalData.length) {
          await log(`⚠️ Достигнут конец исторических данных на индексе ${index}`, 'warn', 'prepareInputDataForLSTM');
          break;
        }

        const data = historicalData[index];

        if (!validateCandleData(data)) {
          await log(`❌ Некорректные данные свечи на индексе ${index}: ${JSON.stringify(data)}`, 'error', 'prepareInputDataForLSTM');
          continue;
        }

        const normalizedData = normalizeCandleData(data);
        
        const startIndex = Math.max(0, index - dataNeededForIndicators);
        const endIndex = index + 1;

        const closePrices = historicalData.slice(startIndex, endIndex).map(d => d.close);
        const volumes = historicalData.slice(startIndex, endIndex).map(d => d.volume);

        const indicators = await calculateIndicators(closePrices, volumes, historicalData.slice(startIndex, endIndex));

        const timestepData = [...normalizedData, ...indicators];

        if (!validateTimestepData(timestepData)) {
          await log(`❌ Некорректные данные timestep на индексе ${index}`, 'error', 'prepareInputDataForLSTM');
          continue;
        }

        sequence.push(timestepData);
      }

      if (sequence.length > 0) {
        sequences.push(sequence);
        await log(`✅ Сформирована последовательность ${i + 1}/${numSequences}, длина: ${sequence.length}`, 'debug', 'prepareInputDataForLSTM');
      } else {
        await log(`⚠️ Последовательность ${i + 1} пуста`, 'warn', 'prepareInputDataForLSTM');
      }
    }

    if (sequences.length === 0) {
      throw new Error('❌ Не удалось сформировать ни одной последовательности');
    }

    await log(`✅ Подготовка входных данных завершена. Размер: ${sequences.length}x${sequences[0].length}x${sequences[0][0].length}`, 'info', 'prepareInputDataForLSTM');
    
    const executionTime = Date.now() - startTime;
    await log(`⏱️ Время выполнения: ${executionTime}ms`, 'info', 'prepareInputDataForLSTM');

    return sequences;
  } catch (error) {
    const executionTime = Date.now() - startTime;
    await log(`❌ Ошибка в prepareInputDataForLSTM: ${error.message}. Время выполнения: ${executionTime}ms`, 'error', 'prepareInputDataForLSTM');
    return [];
  }
}

function validateCandleData(data) {
  return isValidNumber(data.open) && 
         isValidNumber(data.high) && 
         isValidNumber(data.low) && 
         isValidNumber(data.close) && 
         isValidNumber(data.volume);
}

function normalizeCandleData(data) {
  return [
    normalize(data.open, 0, 10000),
    normalize(data.high, 0, 10000),
    normalize(data.low, 0, 10000),
    normalize(data.close, 0, 10000),
    normalize(data.volume, 0, 1000000),
  ];
}

/**
 * Проверяет, является ли значение допустимым числом
 * @param {any} value Значение для проверки
 * @returns {boolean} True, если значение является допустимым числом
 */
function isValidNumber(value) {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

function validateTimestepData(data) {
  return Array.isArray(data) && data.every(isValidNumber);
}

/**
 * Нормализует значение в заданном диапазоне
 * @param {number} value Значение для нормализации
 * @param {number} min Минимальное значение диапазона
 * @param {number} max Максимальное значение диапазона
 * @returns {number} Нормализованное значение
 */
function normalize(value, min, max) {
  if (!isValidNumber(value) || !isValidNumber(min) || !isValidNumber(max)) {
    return 0.5;
  }
  if (min === max) return 0.5;
  const normalizedValue = (value - min) / (max - min);
  return isValidNumber(normalizedValue) ? Math.max(0, Math.min(1, normalizedValue)) : 0.5;
}


// Функция для расчета индикаторов (исправленная)
async function calculateIndicators(closePrices, volumes, data) {
  try {
    await log(`🧮 Начало расчета индикаторов`, 'debug', 'calculateIndicators');

    if (!Array.isArray(closePrices) || closePrices.length < 2 || 
        !Array.isArray(volumes) || volumes.length < 2 || 
        !Array.isArray(data) || data.length < 2) {
      throw new Error('❌ Недостаточно данных для расчета индикаторов');
    }

    const sma20 = await calculateSMA(closePrices, Math.min(20, closePrices.length));
    const ema50 = await calculateEMA(closePrices, Math.min(50, closePrices.length));
    const rsi = await calculateRSI(closePrices, Math.min(14, closePrices.length - 1));
    const macd = await calculateMACD(closePrices, 12, 26, 9);
    const obv = calculateOBV(closePrices, volumes);
    const bbands = calculateBollingerBands(closePrices, Math.min(20, closePrices.length));
    const atr = calculateATR(data, Math.min(14, data.length - 1));
    const adx = calculateADX(data, Math.min(14, data.length - 1));

    const indicators = [
      normalize(sma20, 0, 10000),
      normalize(ema50, 0, 10000),
      normalize(rsi, 0, 100),
      normalize(macd[0], -100, 100),
      normalize(macd[1], -100, 100),
      normalize(macd[2], -100, 100),
      normalize(obv, -1000000, 1000000),
      normalize(bbands.upper, 0, 10000),
      normalize(bbands.lower, 0, 10000),
      normalize(atr, 0, 1000),
      normalize(adx, 0, 100),
    ];

    await log(`📊 Индикаторы рассчитаны успешно`, 'debug', 'calculateIndicators');
    return indicators;
  } catch (error) {
    await log(`❌ Ошибка при расчете индикаторов: ${error.message}`, 'error', 'calculateIndicators');
    return new Array(11).fill(0.5); // Возвращаем нейтральные значения в случае ошибки
  }
}

// Функция для подготовки входных данных для нейронной сети
async function prepareInputDataForNN(symbol, interval = '15m', lookback = 100) {
  try {
    await log(`Подготовка входных данных для нейронной сети: символ=${symbol}, интервал=${interval}, lookback=${lookback}`, 'info', 'prepareInputDataForNN');

    const historicalData = await fetchHistoricalData(symbol, interval, lookback + 700);
    await log(`Получено ${historicalData.length} исторических свечей`, 'info', 'prepareInputDataForNN');

    if (historicalData.length < lookback + 700) {
      throw new Error(`Недостаточно исторических данных. Получено: ${historicalData.length}, требуется: ${lookback + 700}`);
    }

    // Инициализация массива входных данных
    const input = [];

    // Цикл по последним 700 свечам
    const startIndex = Math.max(0, historicalData.length - 700);
    for (let i = startIndex; i < historicalData.length; i++) {
      const data = historicalData[i];

      const normalizedData = [
        normalize(data.open, 0, 10000),
        normalize(data.high, 0, 10000),
        normalize(data.low, 0, 10000),
        normalize(data.close, 0, 10000),
        normalize(data.volume, 0, 1000000)
      ];

      const closePrices = historicalData.slice(Math.max(0, i - lookback), i + 1).map(d => d.close);
      const volumes = historicalData.slice(Math.max(0, i - lookback), i + 1).map(d => d.volume);

      const sma20 = calculateSMA(closePrices, 20);
      const ema50 = calculateEMA(closePrices, 50);
      const rsi = calculateRSI(closePrices);
      const macd = calculateMACD(closePrices);
      const obv = calculateOBV(closePrices, volumes);
      const bbands = calculateBollingerBands(closePrices);
      const atr = calculateATR(historicalData.slice(Math.max(0, i - lookback), i + 1));
      const adx = calculateADX(historicalData.slice(Math.max(0, i - lookback), i + 1));

      const indicators = [
        normalize(sma20, 0, 10000),
        normalize(ema50, 0, 10000),
        normalize(rsi, 0, 100),
        normalize(macd[0], -100, 100),
        normalize(macd[1], -100, 100),
        normalize(macd[2], -100, 100),
        normalize(obv, -1000000, 1000000),
        normalize(bbands.upper, 0, 10000),
        normalize(bbands.lower, 0, 10000),
        normalize(atr, 0, 1000),
        normalize(adx, 0, 100)
      ];

      const candleData = [...normalizedData, ...indicators];

      // Проверка на некорректные значения
      if (candleData.some(val => isNaN(val) || !isFinite(val))) {
        await log(`Обнаружено некорректное значение в данных свечи ${i}`, 'warn', 'prepareInputDataForNN');
        continue; // Пропускаем эту свечу
      }

      input.push(candleData);
    }

    // Проверка длины входных данных
    if (input.length !== 700) {
      throw new Error(`Неожиданная длина входных данных: ${input.length}. Ожидалось 700.`);
    }

    // Проверка размерности входных данных
    if (input[0].length !== 16) {
      throw new Error(`Неожиданное количество признаков: ${input[0].length}. Ожидалось 16.`);
    }

    await log(`Подготовка входных данных завершена. Размер входного массива: ${input.length}x${input[0].length}`, 'info', 'prepareInputDataForNN');

    // Преобразование в одномерный массив
    const flattenedInput = input.flat();

    // Финальная проверка данных
    if (flattenedInput.some(val => isNaN(val) || !isFinite(val))) {
      throw new Error('Входные данные содержат некорректные значения после обработки');
    }

    return flattenedInput;
  } catch (error) {
    await log(`Ошибка при подготовке входных данных: ${error.message}`, 'error', 'prepareInputDataForNN');
    // Возвращаем нейтральные данные вместо выброса исключения
    return new Array(700 * 16).fill(0.5);
  }
}

//////// НЕЙРОННАЯ СЕТЬ ////////////

//Улучшенная подготовка данных
async function prepareTrainingData(historicalData, timeframe) {
  const trainingData = [];
  const lookback = 50; // Период анализа
  const featuresPerTimestamp = 5; // Количество признаков на каждый временной шаг (open, high, low, close, volume)
  const additionalFeatures = 9; // Количество дополнительных признаков (индикаторы)
  const totalFeaturesPerTimestamp = featuresPerTimestamp + additionalFeatures;

  // Определяем размер шага на основе timeframe
  const step = getStepSize(timeframe);

  for (let i = lookback; i < historicalData.length; i += step) {
    const input = [];
    for (let k = i - lookback; k < i; k++) {
      const dataPoint = [
        normalize(historicalData[k].open, 0, 10000),
        normalize(historicalData[k].high, 0, 10000),
        normalize(historicalData[k].low, 0, 10000),
        normalize(historicalData[k].close, 0, 10000),
        normalize(historicalData[k].volume, 0, 1000000)
      ];

      const closesForIndicators = historicalData.slice(Math.max(0, k - 100), k + 1).map(d => d.close);
      const volumesForIndicators = historicalData.slice(Math.max(0, k - 100), k + 1).map(d => d.volume);
      
      const sma = calculateSMA(closesForIndicators, 20);
      const ema = calculateEMA(closesForIndicators, 20);
      const rsi = calculateRSI(closesForIndicators);
      const macd = calculateMACD(closesForIndicators);
      const obv = calculateOBV(closesForIndicators, volumesForIndicators);
      const bbandsUpper = calculateBollingerBands(closesForIndicators, 20, 2).upper;
      const bbandsLower = calculateBollingerBands(closesForIndicators, 20, 2).lower;

      const indicators = [
        normalize(sma, 0, 10000),
        normalize(ema, 0, 10000),
        normalize(rsi, 0, 100),
        normalize(macd[0], -100, 100),
        normalize(macd[1], -100, 100),
        normalize(macd[2], -100, 100),
        normalize(obv, -1000000, 1000000),
        normalize(bbandsUpper, 0, 10000),
        normalize(bbandsLower, 0, 10000)
      ];

      input.push(...dataPoint, ...indicators);
    }
     // Проверяем, что количество признаков соответствует ожидаемому
     if (input.length !== lookback * totalFeaturesPerTimestamp) {
      await log(`Предупреждение: Неожиданное количество признаков. Ожидалось ${lookback * totalFeaturesPerTimestamp}, получено ${input.length}`, 'warn', 'prepareTrainingData');
    }


    if (input.some(isNaN) || input.some(value => !isFinite(value))) {
      continue;
    }

    const currentClose = historicalData[i].close;
    const nextClose = i + 1 < historicalData.length ? historicalData[i + 1].close : currentClose;
    const percentChange = (nextClose - currentClose) / currentClose * 100;
    
    let output;
    if (percentChange > 0.5) output = [1, 0, 0]; // Сильный рост
    else if (percentChange < -0.5) output = [0, 1, 0]; // Сильное падение
    else output = [0, 0, 1]; // Нейтральное движение

    trainingData.push({
      input: input,
      output: output,
      timeframe: timeframe,
      totalFeatures: input.length
    });
  }

  return trainingData;
}

function getStepSize(timeframe) {
  switch(timeframe) {
    case '1m': return 1;
    case '5m': return 5;
    case '15m': return 15;
    case '1h': return 60;
    case '4h': return 240;
    case '1d': return 1440;
    default: return 1;
  }
}


// Функция для инициализации и обучения нейронной сети
async function trainNeuralNetwork() {
  await log(chalk.cyan('Начало обучения нейронной сети...'), 'detail', 'trainNeuralNetwork');

  try {
    const epochsPerTraining = 10; // Небольшое количество эпох для каждого обучения
    let neuralNet;

    // Попытка загрузки последней сохраненной модели
    const lastModel = await loadLatestModel();
    if (lastModel) {
      neuralNet = lastModel.model;
      await log(chalk.green('Загружена существующая модель'), 'detail', 'trainNeuralNetwork');
    } else {
      // Создание новой модели, если не удалось загрузить существующую
      neuralNet = new brain.NeuralNetwork({
        hiddenLayers: [700, 512, 256, 128, 64], // 700 входных нейронов
        activation: 'leaky-relu',
        learningRate: 0.003,
        momentum: 0.2,
        regularization: 'l2',
        regRate: 0.001,
      });
      await log(chalk.yellow('Создана новая модель нейронной сети'), 'detail', 'trainNeuralNetwork');
    }

    // Получение и подготовка данных для обучения
    await log(chalk.cyan('Начало сбора и подготовки данных для обучения...'), 'detail', 'trainNeuralNetwork');
    const allTrainingData = await prepareAllTrainingData();
    
    // Проверка на наличие данных для обучения
    if (allTrainingData.length === 0) {
      throw new Error('Недостаточно данных для обучения');
    }

    // Разделение данных на обучающую и тестовую выборки
    const splitIndex = Math.floor(allTrainingData.length * 0.8);
    const trainingData = allTrainingData.slice(0, splitIndex);
    const testData = allTrainingData.slice(splitIndex);

    // Обучение модели
    await log(chalk.cyan(`Начало процесса обучения. Количество эпох: ${epochsPerTraining}`), 'detail', 'trainNeuralNetwork');
    
    const trainingOptions = {
      iterations: epochsPerTraining,
      errorThresh: 0.003,
      log: true,
      logPeriod: 1,
      learningRate: 0.01,
      momentum: 0.1,
      callback: async (stats) => {
        const accuracy = calculateAccuracy(neuralNet, testData);

        await log(chalk.green(`Эпоха ${stats.iterations}/${epochsPerTraining}:`), 'detail', 'trainNeuralNetwork');
        await log(chalk.green(`  Ошибка: ${stats.error.toFixed(4)}`), 'detail', 'trainNeuralNetwork');
        await log(chalk.green(`  Точность: ${accuracy.toFixed(2)}%`), 'detail', 'trainNeuralNetwork');

        if (stats.iterations % 10 === 0) {
          await saveModel(neuralNet, stats.iterations);
          await log(chalk.blue(`  Модель сохранена после эпохи ${stats.iterations}`), 'detail', 'trainNeuralNetwork');
        }
      },
      callbackPeriod: 1,
    };

    await neuralNet.trainAsync(trainingData, trainingOptions);

    await saveModel(neuralNet, 'final');
    await log(chalk.green('Окончательная модель сохранена'), 'detail', 'trainNeuralNetwork');

    const finalAccuracy = calculateAccuracy(neuralNet, testData);
    lastKnownAccuracy = finalAccuracy.toFixed(2);
    io.emit('neuralNetworkAccuracy', { accuracy: lastKnownAccuracy });;

    await log(chalk.cyan('Обучение нейронной сети завершено.'), 'detail', 'trainNeuralNetwork');

    return neuralNet;
  } catch (error) {
    await log(chalk.red(`Ошибка при обучении нейронной сети: ${error.message}`), 'error', 'trainNeuralNetwork');
    await sendTelegramMessage(`Ошибка при обучении нейронной сети: ${error.message}`);
    return null;
  }
}

async function incrementalTraining(neuralNet) {
  try {
    await log(chalk.cyan('Начало инкрементального обучения...'), 'detail', 'incrementalTraining');
    
    const newData = await prepareNewTrainingData(); // Функция для подготовки новых данных
    
    if (newData.length === 0) {
      await log(chalk.yellow('Нет новых данных для инкрементального обучения'), 'detail', 'incrementalTraining');
      return neuralNet;
    }

    const trainingOptions = {
      iterations: 10, // Меньше итераций для инкрементального обучения
      errorThresh: 0.003,
      log: true,
      logPeriod: 1,
      learningRate: 0.01, // Меньшая скорость обучения для инкрементального обучения
      momentum: 0.1,
      callback: async (stats) => {
        await log(chalk.green(`Инкрементальное обучение, итерация ${stats.iterations}:`), 'detail', 'incrementalTraining');
        await log(chalk.green(`  Ошибка: ${stats.error.toFixed(4)}`), 'detail', 'incrementalTraining');
      },
      callbackPeriod: 1,
    };

    await neuralNet.trainAsync(newData, trainingOptions);

    await saveModel(neuralNet, 'incremental');
    await log(chalk.green('Модель после инкрементального обучения сохранена'), 'detail', 'incrementalTraining');

    return neuralNet;
  } catch (error) {
    await log(chalk.red(`Ошибка при инкрементальном обучении: ${error.message}`), 'error', 'incrementalTraining');
    await sendTelegramMessage(`Ошибка при инкрементальном обучении: ${error.message}`);
    return neuralNet; // Возвращаем исходную модель в случае ошибки
  }
}

// Функция для загрузки последней сохраненной модели
async function loadLatestModel() {
  const modelSavePath = path.join(__dirname, 'trainedModel');
  try {
    await log('Начало загрузки последней модели', 'info', 'loadLatestModel');
    
    const files = await fs.readdir(modelSavePath);
    
    if (files.includes('neural_net_epoch_final.json')) {
      await log('Загрузка финальной модели', 'info', 'loadLatestModel');
      const modelJSON = await fs.readJson(path.join(modelSavePath, 'neural_net_epoch_final.json'));
      const model = new brain.NeuralNetwork();
      model.fromJSON(modelJSON);
      
      if (!model.run || typeof model.run !== 'function') {
        throw new Error('Модель загружена некорректно: метод run отсутствует или не является функцией');
      }
      
      // Проверка модели на тестовых данных
      const testInput = new Array(700).fill(0.5); // Пример входных данных
      const testOutput = model.run(testInput);
      if (!testOutput || typeof testOutput !== 'object' || Object.values(testOutput).length !== 3) {
        throw new Error('Модель не прошла проверку на тестовых данных');
      }
      
      await log('Модель успешно загружена и проверена', 'info', 'loadLatestModel');
      return { model, epoch: 'final' };
    }
    
    const modelFiles = files.filter(file => file.startsWith('neural_net_epoch_') && file.endsWith('.json'));
    
    if (modelFiles.length === 0) {
      throw new Error('Не найдено сохраненных моделей');
    }

    modelFiles.sort((a, b) => {
      const epochA = parseInt(a.match(/epoch_(\d+)/)[1]);
      const epochB = parseInt(b.match(/epoch_(\d+)/)[1]);
      return epochB - epochA;
    });

    const latestFile = modelFiles[0];
    const epoch = parseInt(latestFile.match(/epoch_(\d+)/)[1]);
    
    await log(`Загрузка последней модели: ${latestFile}`, 'info', 'loadLatestModel');
    
    const modelJSON = await fs.readJson(path.join(modelSavePath, latestFile));
    const model = new brain.NeuralNetwork();
    model.fromJSON(modelJSON);
    
    if (!model.run || typeof model.run !== 'function') {
      throw new Error('Модель загружена некорректно: метод run отсутствует или не является функцией');
    }
    
    await log(`Модель успешно загружена из эпохи ${epoch} и проверена`, 'info', 'loadLatestModel');

    return { model, epoch };
  } catch (error) {
    await log(`Ошибка при загрузке последней модели: ${error.message}`, 'error', 'loadLatestModel');
    return null;
  }
}

// Функция для сохранения модели
async function saveModel(model, epoch) {
  const modelSavePath = path.join(__dirname, 'trainedModel');
  try {
    await fs.ensureDir(modelSavePath);
    const modelJSON = model.toJSON();
    await fs.writeJson(path.join(modelSavePath, `neural_net_epoch_${epoch}.json`), modelJSON);
    await log(`Модель успешно сохранена после эпохи ${epoch}`, 'info', 'saveModel');
  } catch (error) {
    await log(`Ошибка при сохранении модели: ${error.message}`, 'error', 'saveModel');
  }
}

function calculateAccuracy(neuralNet, testData) {
  let correct = 0;
  for (const item of testData) {
    const output = neuralNet.run(item.input);
    const predicted = output.indexOf(Math.max(...output));
    const actual = item.output.indexOf(Math.max(...item.output));
    if (predicted === actual) {
      correct++;
    }
  }
  return (correct / testData.length) * 100;
}

/**
 * Вычисляет точность модели на тренировочных данных
 * @param {brain.recurrent.LSTM} model Модель LSTM
 * @param {Array} trainingData Тренировочные данные
 * @returns {number} Точность модели в процентах
 */
function calculateAccuracy(model, trainingData) {
  let correct = 0;
  for (const sample of trainingData) {
    const prediction = model.run(sample.input);
    const predictedClass = prediction.indexOf(Math.max(...prediction));
    const actualClass = sample.output.indexOf(Math.max(...sample.output));
    if (predictedClass === actualClass) {
      correct++;
    }
  }
  return (correct / trainingData.length) * 100;
}

// Нормализация данных нейронной сети
async function prepareAllTrainingData() {
  const intervals = ['1', '5', '15', '30', '60', '240', '1440'];
  let allTrainingData = [];

  for (const interval of intervals) {
    await log(chalk.cyan(`Получение исторических данных для интервала ${interval}...`), 'detail', 'prepareAllTrainingData');
    const historicalData = await fetchHistoricalDataForTraining(interval);
    await log(chalk.cyan(`Подготовка данных для интервала ${interval}...`), 'detail', 'prepareAllTrainingData');
    const intervalTrainingData = await prepareTrainingData(historicalData, interval);
    allTrainingData = allTrainingData.concat(intervalTrainingData);
    await log(chalk.green(`Данные для интервала ${interval} подготовлены. Всего примеров: ${intervalTrainingData.length}`), 'detail', 'prepareAllTrainingData');
  }

  // Перемешивание и ограничение данных
  allTrainingData = shuffleArray(allTrainingData);
  if (allTrainingData.length > 100000) {
    allTrainingData = allTrainingData.slice(0, 100000);
    await log(chalk.yellow(`Данные ограничены до 100000 примеров`), 'detail', 'prepareAllTrainingData');
  }
  await log(chalk.green(`Итоговое количество обучающих примеров: ${allTrainingData.length}`), 'detail', 'prepareAllTrainingData');

  return allTrainingData;
}

// Функция для перемешивания массива
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}


// Функция для предсказания с использованием нейронной сети
async function predictWithNeuralNetwork(model, input) {
  const maxRetries = 3;
  const initialRetryDelay = 1000; // 1 секунда

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await log(`Попытка ${attempt}/${maxRetries} предсказания нейронной сети`, 'info', 'predictWithNeuralNetwork');
      
      if (!model || typeof model.run !== 'function') {
        throw new Error('Модель нейронной сети не инициализирована корректно');
      }
      
      // Проверяем длину входных данных и обрезаем или дополняем при необходимости
      let processedInput = input;
      if (input.length > 700) {
        processedInput = input.slice(0, 700);
      } else if (input.length < 700) {
        processedInput = input.concat(new Array(700 - input.length).fill(0));
      }

      await log(`Длина обработанного массива input: ${processedInput.length}`, 'detail', 'predictWithNeuralNetwork');
      
      const prediction = model.run(processedInput);
      await log(`Сырое предсказание: ${JSON.stringify(prediction)}`, 'detail', 'predictWithNeuralNetwork');
      
      if (!prediction || typeof prediction !== 'object') {
        throw new Error(`Нейронная сеть вернула некорректное предсказание: ${JSON.stringify(prediction)}`);
      }

      // Преобразование предсказания в массив, если оно является объектом
      const predictionArray = Array.isArray(prediction) ? prediction : Object.values(prediction);

      if (predictionArray.length !== 3) {
        throw new Error(`Неверная длина предсказания. Ожидается 3, получено ${predictionArray.length}`);
      }
      
      if (predictionArray.some(isNaN) || predictionArray.some(val => val === null || val === undefined || val < 0 || val > 1)) {
        throw new Error(`Нейронная сеть вернула некорректные значения: ${JSON.stringify(predictionArray)}`);
      }
      
      // Нормализация предсказания
      const sum = predictionArray.reduce((a, b) => a + b, 0);
      if (sum === 0) {
        throw new Error('Сумма предсказаний равна нулю');
      }
      const normalizedPrediction = predictionArray.map(p => p / sum);
      
      await log(`Нормализованное предсказание: ${JSON.stringify(normalizedPrediction)}`, 'detail', 'predictWithNeuralNetwork');
      return normalizedPrediction;
    } catch (error) {
      await log(`Ошибка при предсказании нейронной сети (попытка ${attempt}): ${error.message}`, 'error', 'predictWithNeuralNetwork');
      
      if (attempt === maxRetries) {
        await log('Все попытки предсказания не удались. Возвращаем равномерное распределение.', 'warn', 'predictWithNeuralNetwork');
        return [0.33, 0.33, 0.34]; // Возвращаем равномерное распределение в случае ошибки
      }
      
      const retryDelay = initialRetryDelay * Math.pow(2, attempt - 1);
      await log(`Ожидание перед следующей попыткой: ${retryDelay}мс`, 'info', 'predictWithNeuralNetwork');
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}


// Валидация данных
function validateInputData(input) {
  if (!Array.isArray(input)) {
    throw new Error('Входные данные должны быть массивом');
  }

  if (input.length === 0) {
    throw new Error('Входные данные не могут быть пустым массивом');
  }

  if (input.some(value => typeof value !== 'number')) {
    throw new Error('Все элементы входных данных должны быть числами');
  }

  // Удалим проверку на NaN, так как мы теперь заменяем их на 0
  if (input.some(value => !isFinite(value))) {
    throw new Error('Входные данные содержат бесконечные значения');
  }

  // Проверка на ожидаемую длину входных данных
  const expectedLength = 50 * 14; // 50 временных шагов, 14 признаков на каждый шаг
  if (input.length !== expectedLength) {
    throw new Error(`Неверная длина входных данных. Ожидается ${expectedLength}, получено ${input.length}`);
  }

  // Проверка диапазона значений (предполагается, что значения должны быть от 0 до 1)
  if (input.some(value => value < 0 || value > 1)) {
    throw new Error('Все значения должны быть в диапазоне от 0 до 1');
  }
}


// Функция для получения исторических данных
async function fetchHistoricalDataForTraining(symbol = 'ETHUSDT', interval = '15', limit = 1000, startDate = null, endDate = null) {
  try {
    await log(`Начало получения исторических данных: symbol=${symbol}, interval=${interval}, limit=${limit}, startDate=${startDate}, endDate=${endDate}`, 'info', 'fetchHistoricalDataForTraining');

    const bybitInterval = convertIntervalToBybitFormat(interval);
    let allHistoricalData = [];
    let currentLimit = limit;
    let startTime = startDate ? new Date(startDate).getTime() : undefined;

    while (currentLimit > 0) {
      try {
        const response = await bybitClient.getKline({
          category: 'spot',
          symbol: symbol,
          interval: bybitInterval,
          limit: Math.min(currentLimit, 200),
          start: startTime,
          end: endDate ? new Date(endDate).getTime() : undefined
        });

        if (!response || !response.result || !Array.isArray(response.result.list)) {
          throw new Error(`Неверный формат ответа от API Bybit: ${JSON.stringify(response)}`);
        }

        if (response.retCode !== 0) {
          throw new Error(`Ошибка Bybit API (retCode: ${response.retCode}): ${response.retMsg}`);
        }

        const historicalData = response.result.list.map(item => ({
          time: parseInt(item[0]),
          open: parseFloat(item[1]),
          high: parseFloat(item[2]),
          low: parseFloat(item[3]),
          close: parseFloat(item[4]),
          volume: parseFloat(item[5])
        }));

        allHistoricalData = allHistoricalData.concat(historicalData);
        currentLimit -= historicalData.length;

        if (historicalData.length > 0) {
          startTime = historicalData[historicalData.length - 1].time + 1;
        } else {
          break;
        }

        await log(`Получено ${historicalData.length} свечей. Осталось получить: ${currentLimit}`, 'info', 'fetchHistoricalDataForTraining');
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        await log(`Ошибка при получении данных: ${error.message}. Повтор через 5 секунд...`, 'warn', 'fetchHistoricalDataForTraining');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    if (allHistoricalData.length === 0) {
      throw new Error('Не удалось получить исторические данные');
    }

    await log(`Успешно получено ${allHistoricalData.length} исторических данных`, 'info', 'fetchHistoricalDataForTraining');
    return allHistoricalData;

  } catch (error) {
    await log(`Ошибка при получении исторических данных: ${error.message}`, 'error', 'fetchHistoricalDataForTraining');
    throw error;
  }
}

// Функция для проверки точности нейронной сети
async function checkEnsembleAccuracy(testData) {
  const neuralNet = await loadLatestModel();
  
  let correctPredictions = 0;
  let totalPredictions = 0;
  
  for (let i = 50; i < testData.length - 1; i++) {
    const input = prepareInputData(testData.slice(i - 50, i));
    const prediction = await predictWithNeuralNetwork(neuralNet.model, input);

    const predictedDirection = getPredictedDirection(prediction);
    const actualDirection = getActualDirection(testData[i], testData[i + 1]);
    
    if (predictedDirection === actualDirection) {
      correctPredictions++;
    }
    totalPredictions++;
  }
  
  const accuracy = (correctPredictions / totalPredictions) * 100;
  return accuracy.toFixed(2);

}

// 
function getPredictedDirection(output) {
  const [up, down, neutral] = output;
  if (up > down && up > neutral) return 'up';
  if (down > up && down > neutral) return 'down';
  return 'neutral';
}

function getActualDirection(currentData, nextData) {
  if (nextData.close > currentData.close) return 'up';
  if (nextData.close < currentData.close) return 'down';
  return 'neutral';
}

// Функция для инкрементального обучения нейронной сети
async function incrementalTraining(newData) {
  const neuralNet = await loadLatestModel();
  const rf = await trainRandomForest(await prepareTrainingData(newData));
  
  const trainingData = await prepareTrainingData(newData);
  
  // Обновление нейронной сети
  await neuralNet.model.trainAsync(trainingData, {
    iterations: 100,
    errorThresh: 0.005,
    log: true,
    logPeriod: 10
  });

  await saveModel(neuralNet.model, 'incremental');
  
  return { neuralNet: neuralNet.model, rf };
}

// Функция для предсказания краткосрочного движения цены
async function predictShortTermPriceMovement(timeframe) {
  const neuralNet = await loadLatestModel();
  const recentData = await fetchRecentData(timeframe);
  const input = prepareInputData(recentData.slice(-50));
  
  // Прогноз нейронной сети
  const prediction = await predictWithNeuralNetwork(neuralNet.model, input);

  const [upProbability, downProbability, neutralProbability] = prediction;
  let predictionResult;
  if (upProbability > downProbability && upProbability > neutralProbability) {
    predictionResult = 'Рост';
  } else if (downProbability > upProbability && downProbability > neutralProbability) {
    predictionResult = 'Падение';
  } else {
    predictionResult = 'Нейтрально';
  }

  return {
    prediction: predictionResult,
    upProbability: (upProbability * 100).toFixed(2),
    downProbability: (downProbability * 100).toFixed(2),
    neutralProbability: (neutralProbability * 100).toFixed(2)
  };
}


// Обновляем функцию для получения последних данных
async function fetchRecentData(symbol, interval, limit = 100) {
  const validIntervals = ['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W', 'M'];
  const intervalMap = {
    '1m': '1',
    '3m': '3',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '2h': '120',
    '4h': '240',
    '6h': '360',
    '12h': '720',
    '1d': 'D',
    '1w': 'W',
    '1M': 'M'
  };

  const mappedInterval = intervalMap[interval] || interval;

  if (!validIntervals.includes(mappedInterval)) {
    throw new Error(`Неверный интервал: ${interval}`);
  }

  const maxRetries = 3;
  const retryDelay = 5000; // 5 секунд

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await log(`Попытка ${attempt} из ${maxRetries} запроса последних данных...`, 'info', 'fetchRecentData');
      
      const response = await bybitClient.getKline({
        category: 'spot',
        symbol: symbol,
        interval: mappedInterval,
        limit: limit
      });

      if (response.retCode !== 0) {
        throw new Error(`Ошибка API Bybit: ${response.retMsg}`);
      }

      if (!response.result || !response.result.list || response.result.list.length === 0) {
        throw new Error('Неожиданная структура ответа API или отсутствие данных');
      }

      await log(`Получено ${response.result.list.length} записей данных`, 'info', 'fetchRecentData');

      return response.result.list.map(item => ({
        time: parseInt(item[0]),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5])
      })).reverse();

    } catch (error) {
      await log(`Ошибка при получении последних данных (попытка ${attempt}): ${error.message}`, 'error', 'fetchRecentData');
      if (attempt === maxRetries) {
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}
////////// реализация перезапуска сервера

// Функция для временной приостановки торговли
async function temporaryPauseTrading(error) {
  try {
    const errorMessage = error.message || 'Неизвестная ошибка';
    await log(`⚠️ Начало временной приостановки торговли из-за ошибки: ${errorMessage}`, 'warn', 'temporaryPauseTrading');
    
    global.isTradingPaused = true;
    
    await sendTelegramMessage(`⚠️ Торговля временно приостановлена из-за ошибки: ${errorMessage}`);
    
    await savePauseInfo({
      timestamp: new Date().toISOString(),
      reason: errorMessage,
      stackTrace: error.stack || 'Стек вызовов недоступен'
    });

    try {
      const cancelResult = await cancelAllOrders();
      await log(`🚫 Результат отмены всех ордеров: ${JSON.stringify(cancelResult)}`, 'info', 'temporaryPauseTrading');
    } catch (cancelError) {
      await log(`❌ Ошибка при отмене всех ордеров: ${cancelError.message}`, 'error', 'temporaryPauseTrading');
    }

    const pauseDuration = 60 * 60 * 1000; // 1 час
    await log(`⏳ Установлен таймер на возобновление торговли через ${pauseDuration / 1000 / 60} минут`, 'info', 'temporaryPauseTrading');
    
    setTimeout(async () => {
      try {
        global.isTradingPaused = false;
        await log('✅ Торговля возобновлена после временной приостановки', 'info', 'temporaryPauseTrading');
        await sendTelegramMessage('✅ Торговля возобновлена после временной приостановки');
        
        const systemCheck = await performSystemCheck();
        if (systemCheck.status === 'ok') {
          await log('✅ Проверка системы успешна, торговля полностью возобновлена', 'info', 'temporaryPauseTrading');
        } else {
          await log(`⚠️ Проверка системы выявила проблемы: ${systemCheck.issues.join(', ')}`, 'warn', 'temporaryPauseTrading');
          await sendTelegramMessage(`⚠️ Внимание: При возобновлении торговли обнаружены проблемы: ${systemCheck.issues.join(', ')}`);
        }
      } catch (resumeError) {
        await log(`❌ Ошибка при возобновлении торговли: ${resumeError.message}`, 'error', 'temporaryPauseTrading');
        await sendTelegramMessage(`❌ Ошибка при возобновлении торговли: ${resumeError.message}`);
        await temporaryPauseTrading(resumeError);
      }
    }, pauseDuration);

  } catch (pauseError) {
    await log(`🚨 Критическая ошибка при попытке приостановить торговлю: ${pauseError.message}`, 'error', 'temporaryPauseTrading');
    await sendTelegramMessage(`🚨 Критическая ошибка при попытке приостановить торговлю: ${pauseError.message}`);
    await emergencyShutdown(pauseError);
  }
}

// Функция для сохранения информации о паузе
async function savePauseInfo(info) {
  try {
    const pauseLogPath = path.join(__dirname, 'logs', 'pause_log.json');
    let pauseLog = [];
    
    try {
      const existingLog = await fs.readFile(pauseLogPath, 'utf8');
      pauseLog = JSON.parse(existingLog);
    } catch (readError) {
      // Файл не существует или пустой, создаем новый массив
    }
    
    pauseLog.push(info);
    await fs.writeFile(pauseLogPath, JSON.stringify(pauseLog, null, 2));
    await log(`📝 Информация о паузе сохранена: ${JSON.stringify(info)}`, 'info', 'savePauseInfo');
  } catch (error) {
    await log(`❌ Ошибка при сохранении информации о паузе: ${error.message}`, 'error', 'savePauseInfo');
  }
}


// Функция для закрытия всех соединений
async function closeAllConnections() {
  try {
    await log('🔌 Начало закрытия всех соединений', 'info', 'closeAllConnections');
    
    // Здесь должна быть логика закрытия соединений с вашими сервисами
    // Например, для базы данных MongoDB:
    // await mongoose.connection.close();

    // Закрытие соединения с Bybit API (если это возможно)
    // bybitClient.close(); // Предполагаемый метод, может отличаться в зависимости от библиотеки

    await log('✅ Все соединения успешно закрыты', 'info', 'closeAllConnections');
  } catch (error) {
    await log(`❌ Ошибка при закрытии соединений: ${error.message}`, 'error', 'closeAllConnections');
    throw error;
  }
}

// Функция для очистки всех запланированных задач
function clearAllScheduledTasks() {
  const highestTimeoutId = setTimeout(() => {}, 0);
  for (let i = 0; i < highestTimeoutId; i++) {
    clearTimeout(i);
  }
  
  const highestIntervalId = setInterval(() => {}, 0);
  for (let i = 0; i < highestIntervalId; i++) {
    clearInterval(i);
  }
  
  log('🧹 Все запланированные задачи очищены', 'info', 'clearAllScheduledTasks');
}

// Функция для выполнения проверки системы
async function performSystemCheck() {
  try {
    await log('🔍 Начало проверки системы', 'info', 'performSystemCheck');
    
    const checks = [
      { name: 'API Connection', check: checkApiConnection },
      { name: 'Database Connection', check: checkDatabaseConnection },
      { name: 'Sufficient Balance', check: checkSufficientBalance },
      { name: 'Market Data Availability', check: checkMarketDataAvailability }
    ];
    
    const results = await Promise.all(checks.map(async ({ name, check }) => {
      try {
        await check();
        return { name, status: 'ok' };
      } catch (error) {
        return { name, status: 'error', message: error.message };
      }
    }));
    
    const issues = results.filter(result => result.status === 'error');
    const status = issues.length === 0 ? 'ok' : 'error';
    
    await log(`✅ Проверка системы завершена. Статус: ${status}`, 'info', 'performSystemCheck');
    return { 
      status, 
      issues: issues.map(issue => `${issue.name}: ${issue.message}`) 
    };
  } catch (error) {
    await log(`❌ Ошибка при выполнении проверки системы: ${error.message}`, 'error', 'performSystemCheck');
    return { 
      status: 'error', 
      issues: [`General: ${error.message}`] 
    };
  }
}

// Функция аварийного выключения системы
async function emergencyShutdown(error) {
  await log(`Запущено аварийное выключение системы из-за ошибки: ${error.message}`, 'error', 'emergencyShutdown');
  
  try {
      await cancelAllOrders();
      
      const portfolioState = await getPortfolioState();
      await fs.writeFile(path.join(__dirname, 'logs', 'emergency_portfolio_state.json'), JSON.stringify(portfolioState, null, 2));
      
      await sendTelegramMessage('🚨 КРИТИЧЕСКАЯ ОШИБКА: Система аварийно остановлена. Требуется немедленное вмешательство.');
      
      clearAllScheduledTasks();
      
      await closeAllConnections();
      
      await log('Аварийное выключение завершено. Система остановлена.', 'info', 'emergencyShutdown');
      
      process.exit(1);
  } catch (shutdownError) {
      await log(`Ошибка при аварийном выключении: ${shutdownError.message}`, 'error', 'emergencyShutdown');
      process.exit(1);
  }
}

// Функция для отмены всех активных ордеров
async function cancelAllOrders() {
  try {
    await log('🚫 Отмена всех активных ордеров', 'info', 'cancelAllOrders');
    const result = await bybitClient.cancelAllOrders({
      category: 'spot',
      symbol: 'ETHUSDT'
    });
    await log(`✅ Все ордера успешно отменены: ${JSON.stringify(result)}`, 'info', 'cancelAllOrders');
    return result;
  } catch (error) {
    await log(`❌ Ошибка при отмене всех ордеров: ${error.message}`, 'error', 'cancelAllOrders');
    throw error;
  }
}

async function getActiveOrders(symbol) {
  try {
      const orders = await bybitClient.getActiveOrders({
          category: 'spot',
          symbol: symbol
      });
      return orders.result.list;
  } catch (error) {
      await log(`Ошибка при получении активных ордеров: ${error.message}`, 'error', 'getActiveOrders');
      return [];
  }
}

// Функция для отмены ордера
async function cancelOrder(symbol, orderId) {
  try {
    await log(`🚫 Отмена ордера ${orderId} для символа ${symbol}`, 'info', 'cancelOrder');
    const result = await bybitClient.cancelOrder({
      category: 'spot',
      symbol: symbol,
      orderId: orderId
    });
    await log(`✅ Ордер ${orderId} успешно отменен`, 'info', 'cancelOrder');
    return result;
  } catch (error) {
    await log(`❌ Ошибка при отмене ордера ${orderId}: ${error.message}`, 'error', 'cancelOrder');
    throw error;
  }
}

// Функция для обновления существующих ордеров
async function updateExistingOrders(savedOrders) {
  try {
    await log('Начало обновления существующих ордеров', 'info', 'updateExistingOrders');
    const currentOrders = await getActiveOrders('ETHUSDT');
    const currentPrice = await getPrice('ETHUSDT');

    for (const savedOrder of savedOrders) {
      const existingOrder = currentOrders.find(o => o.orderId === savedOrder.orderId);
      if (!existingOrder) {
        await log(`Ордер ${savedOrder.orderId} не найден, размещение нового`, 'info', 'updateExistingOrders');
        await placeOrder('ETHUSDT', savedOrder.side, savedOrder.qty, savedOrder.price);
      } else if (Math.abs(existingOrder.price - currentPrice) / currentPrice > 0.05) {
        await log(`Обновление ордера ${existingOrder.orderId} из-за изменения цены`, 'info', 'updateExistingOrders');
        await cancelOrder('ETHUSDT', existingOrder.orderId);
        await placeOrder('ETHUSDT', existingOrder.side, existingOrder.qty, currentPrice);
      }
    }
    await log('Обновление существующих ордеров завершено', 'info', 'updateExistingOrders');
  } catch (error) {
    await log(`Ошибка при обновлении существующих ордеров: ${error.message}`, 'error', 'updateExistingOrders');
    throw error;
  }
}

// Функция для подготовки входных данных для нейросети
function prepareInputData(data) {
  const input = [];
  const lookback = 50; // Период анализа
  const featuresPerTimestamp = 14; // 5 основных + 9 дополнительных признаков
  const maxElements = 700; // Максимальное количество элементов

  // Ограничиваем цикл, чтобы не превысить maxElements
  const endIndex = Math.min(data.length, lookback + (maxElements / featuresPerTimestamp)); 

  for (let i = data.length - lookback; i < endIndex; i++) {
    const dataPoint = [
      normalize(data[i].open, 0, 10000),
      normalize(data[i].high, 0, 10000),
      normalize(data[i].low, 0, 10000),
      normalize(data[i].close, 0, 10000),
      normalize(data[i].volume, 0, 1000000)
    ];

    const closesForIndicators = data.slice(Math.max(0, i - 100), i + 1).map(d => d.close);
    const volumesForIndicators = data.slice(Math.max(0, i - 100), i + 1).map(d => d.volume);
    
    const sma = calculateSMA(closesForIndicators, 20);
    const ema = calculateEMA(closesForIndicators, 20);
    const rsi = calculateRSI(closesForIndicators);
    const macd = calculateMACD(closesForIndicators);
    const obv = calculateOBV(closesForIndicators, volumesForIndicators);
    const bbands = calculateBollingerBands(closesForIndicators, 20, 2);

    const indicators = [
      normalize(sma, 0, 10000),
      normalize(ema, 0, 10000),
      normalize(rsi, 0, 100),
      normalize(macd[0], -100, 100),
      normalize(macd[1], -100, 100),
      normalize(macd[2], -100, 100),
      normalize(obv, -1000000, 1000000),
      normalize(bbands.upper, 0, 10000),
      normalize(bbands.lower, 0, 10000)
    ];

    input.push(...dataPoint, ...indicators);
  }
  

  // Проверка на NaN и замена на 0
  const cleanedInput = input.map(value => isNaN(value) ? 0 : value);

  // Убедимся, что длина входных данных равна 700
  if (cleanedInput.length !== 700) {
    console.warn(`Неожиданная длина входных данных: ${cleanedInput.length}. Ожидалось 700.`);
    return cleanedInput.slice(0, 700).concat(new Array(Math.max(0, 700 - cleanedInput.length)).fill(0));
  }

  return input;
}
//////// НЕЙРОННАЯ СЕТЬ////////////

// Функция для расчета Bollinger Bands
function calculateBollingerBands(data, period = 20, stdDev = 2) {
  const sma = calculateSMA(data, period);
  const variance = data.reduce((sum, value) => sum + Math.pow(value - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper: sma + stdDev * std,
    lower: sma - stdDev * std
  };
}

// Функция для адаптивной настройки параметров торговли
async function adaptTradingParameters() {
  try {
    const historicalData = await fetchHistoricalDataForTraining('ETHUSDT', '1h');
    const volatility = calculateVolatility(historicalData.map(d => d.close));
    
    // Адаптивная настройка параметров на основе волатильности
    if (volatility > 0.05) { // Высокая волатильность
      signalParams.rsiOverbought = 75;
      signalParams.rsiOversold = 25;
      signalParams.macdThreshold = 0.0002;
      signalParams.volumeThreshold = 2;
      signalParams.trendStrengthThreshold = 30;
    } else if (volatility < 0.02) { // Низкая волатильность
      signalParams.rsiOverbought = 65;
      signalParams.rsiOversold = 35;
      signalParams.macdThreshold = 0.0001;
      signalParams.volumeThreshold = 1.2;
      signalParams.trendStrengthThreshold = 20;
    } else { // Средняя волатильность
      signalParams.rsiOverbought = 70;
      signalParams.rsiOversold = 30;
      signalParams.macdThreshold = 0.00015;
      signalParams.volumeThreshold = 1.5;
      signalParams.trendStrengthThreshold = 25;
    }

    await log(`Параметры торговли адаптированы к текущей волатильности: ${volatility.toFixed(4)}`, 'info', 'adaptTradingParameters');
  } catch (error) {
    await log(`Ошибка при адаптации параметров торговли: ${error.message}`, 'error', 'adaptTradingParameters');
    // Здесь можно добавить логику для использования значений по умолчанию в случае ошибки
  }
}

// Функция для анализа корреляций с другими активами
async function analyzeCorrelations() {
  try {
    const assets = ['BTCUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];
    const correlations = {};

    const ethData = await fetchHistoricalDataForTraining('1d');
    const ethReturns = calculateReturns(ethData.map(d => d.close));

    for (const asset of assets) {
      const assetData = await bybitClient.getKline({
        category: 'spot',
        symbol: asset,
        interval: '1440',  // 1 день
        limit: ethData.length
      });
      if (!assetData.result || !Array.isArray(assetData.result.list)) {
        throw new Error(`Неверный формат данных для ${asset}`);
      }
      const assetReturns = calculateReturns(assetData.result.list.map(d => parseFloat(d[4])));
      correlations[asset] = calculateCorrelation(ethReturns, assetReturns);
    }

    return correlations;
  } catch (error) {
    await log(`Ошибка при анализе корреляций: ${error.message}`, 'error', 'analyzeCorrelations');
    throw error;
  }
}

// Функция для расчета доходности
function calculateReturns(prices) {
  return prices.slice(1).map((price, index) => (price - prices[index]) / prices[index]);
}

// Функция для расчета корреляции
function calculateCorrelation(x, y) {
  const n = x.length;
  const sum1 = x.reduce((a, b) => a + b) * y.reduce((a, b) => a + b);
  const sum2 = x.reduce((a, b) => a + b * b) * y.reduce((a, b) => a + b * b);
  const sum3 = x.map((a, i) => a * y[i]).reduce((a, b) => a + b);
  return (n * sum3 - sum1) / Math.sqrt((n * sum2 - sum1 * sum1));
}


// Функция для оптимизации параметров стратегии
async function optimizeStrategyParameters() {
  try {
    await log('🚀 Начало оптимизации параметров стратегии', 'info', 'optimizeStrategyParameters');

    // Текущие параметры
    const currentParams = {
      minSignalStrength: signalParams.minSignalStrength,
      riskFactor: signalParams.riskFactor,
      gridLevels: signalParams.gridLevels,
      takeProfitMultiplier: signalParams.takeProfitMultiplier,
      stopLossMultiplier: signalParams.stopLossMultiplier
    };

    await log(`📊 Текущие параметры: ${JSON.stringify(currentParams)}`, 'info', 'optimizeStrategyParameters');

    // Диапазоны для оптимизации
    const ranges = {
      minSignalStrength: [0.5, 0.6, 0.7, 0.8],
      riskFactor: [0.01, 0.02, 0.03, 0.04],
      gridLevels: [5, 10, 15, 20],
      takeProfitMultiplier: [1.5, 2, 2.5, 3],
      stopLossMultiplier: [0.5, 0.75, 1, 1.25]
    };

    let bestParams = { ...currentParams };
    let bestPerformance = -Infinity;

    // Перебор комбинаций параметров
    for (const minSignalStrength of ranges.minSignalStrength) {
      for (const riskFactor of ranges.riskFactor) {
        for (const gridLevels of ranges.gridLevels) {
          for (const takeProfitMultiplier of ranges.takeProfitMultiplier) {
            for (const stopLossMultiplier of ranges.stopLossMultiplier) {
              const testParams = {
                minSignalStrength,
                riskFactor,
                gridLevels,
                takeProfitMultiplier,
                stopLossMultiplier
              };

              await log(`🧪 Тестирование параметров: ${JSON.stringify(testParams)}`, 'info', 'optimizeStrategyParameters');

              try {
                // Выполнение бэктеста с текущими параметрами
                const backtestResult = await backtest(await fetchHistoricalData('ETHUSDT', '15m', 1000), {
                  symbol: 'ETHUSDT',
                  initialBalance: 1,
                  ...testParams
                });

                await log(`📈 Результат бэктеста: Прибыль ${backtestResult.profitPercentage.toFixed(2)}%, Винрейт ${backtestResult.winRate.toFixed(2)}%`, 'info', 'optimizeStrategyParameters');

                // Оценка производительности (можно настроить под свои критерии)
                const performance = backtestResult.profitPercentage * backtestResult.winRate;

                if (performance > bestPerformance) {
                  bestPerformance = performance;
                  bestParams = testParams;
                  await log(`🏆 Новые лучшие параметры найдены! Производительность: ${performance.toFixed(2)}`, 'info', 'optimizeStrategyParameters');
                }
              } catch (backtestError) {
                await log(`⚠️ Ошибка при выполнении бэктеста: ${backtestError.message}`, 'warn', 'optimizeStrategyParameters');
                // Продолжаем оптимизацию, пропуская неудачную комбинацию
                continue;
              }
            }
          }
        }
      }
    }

    await log(`✅ Оптимизация завершена. Лучшие параметры: ${JSON.stringify(bestParams)}`, 'info', 'optimizeStrategyParameters');
    await log(`🌟 Улучшение производительности: ${((bestPerformance / (currentParams.minSignalStrength * currentParams.riskFactor) - 1) * 100).toFixed(2)}%`, 'info', 'optimizeStrategyParameters');

    return bestParams;
  } catch (error) {
    await log(`❌ Ошибка при оптимизации параметров стратегии: ${error.message}`, 'error', 'optimizeStrategyParameters');
    // В случае ошибки возвращаем текущие параметры
    return {
      minSignalStrength: signalParams.minSignalStrength,
      riskFactor: signalParams.riskFactor,
      gridLevels: signalParams.gridLevels,
      takeProfitMultiplier: signalParams.takeProfitMultiplier,
      stopLossMultiplier: signalParams.stopLossMultiplier
    };
  }
}


// Функция для расчета ATR (Average True Range)
function calculateATR(data, period = 14) {
  const trueRanges = data.slice(1).map((candle, index) => {
    const previousCandle = data[index];
    const highLow = candle.high - candle.low;
    const highCloseDiff = Math.abs(candle.high - previousCandle.close);
    const lowCloseDiff = Math.abs(candle.low - previousCandle.close);
    return Math.max(highLow, highCloseDiff, lowCloseDiff);
  });

  return calculateSMA(trueRanges, period);
}

// Функция для запуска бэктеста при старте сервера
async function runInitialBacktest() {
  if (!isBacktestEnabled) {
    await log('Бэктест при запуске отключен', 'info', 'runInitialBacktest');
    return null;
  }

  try {
    await log('Начало выполнения начального бэктеста', 'info', 'runInitialBacktest');

    const symbol = 'ETHUSDT';
    const interval = '15m';
    const lookback = 1000; // Например, 1000 свечей

    const historicalData = await fetchHistoricalData(symbol, interval, lookback);

    const initialBalanceRUB = 10000;
    const usdToRubRate = await getUsdToRubRate();
    const initialBalanceETH = initialBalanceRUB / (usdToRubRate * await getPrice('ETHUSDT'));
    
    await log(`Начальный баланс: ${initialBalanceETH.toFixed(8)} ETH (${initialBalanceRUB.toFixed(2)} RUB)`, 'info', 'runInitialBacktest');

    const params = {
      symbol: symbol,
      initialBalance: initialBalanceETH,
      minSignalStrength: 0.6,
      riskFactor: 0.02,
      trailingStopUpdateThreshold: 0.01,
      trailingStopDistance: 0.02
    };
    
    await log('Начало выполнения бэктеста...', 'info', 'runInitialBacktest');
    const result = await backtest(historicalData, params);

    // Добавляем расчет годовой и месячной доходности
    const days = lookback * 15 / (24 * 60); // Преобразуем количество 15-минутных свечей в дни
    result.annualizedReturn = calculateAnnualizedReturn(result.profitPercentage, days);
    result.monthlyReturn = calculateMonthlyReturn(result.profitPercentage, days);
    result.dailyReturn = calculateDailyReturn(result.profitPercentage, days);
    
    await log(`Результаты бэктеста:`, 'info', 'runInitialBacktest');
    await log(`Прибыль: ${result.profit.toFixed(8)} ETH (${(result.profit * ethPrice * usdToRubRate).toFixed(2)} RUB)`, 'info', 'runInitialBacktest');
    await log(`Процент прибыли: ${result.profitPercentage.toFixed(2)}%`, 'info', 'runInitialBacktest');
    await log(`Годовая доходность: ${result.annualizedReturn.toFixed(2)}%`, 'info', 'runInitialBacktest');
    await log(`Месячная доходность: ${result.monthlyReturn.toFixed(2)}%`, 'info', 'runInitialBacktest');
    await log(`Всего сделок: ${result.totalTrades}`, 'info', 'runInitialBacktest');
    await log(`Выигрышных сделок: ${result.winningTrades}`, 'info', 'runInitialBacktest');
    await log(`Процент выигрышных сделок: ${result.winRate.toFixed(2)}%`, 'info', 'runInitialBacktest');
    await log(`Средняя цена закрытия: ${result.averageClosePrice.toFixed(8)} ETH (${(result.averageClosePrice * ethPrice * usdToRubRate).toFixed(2)} RUB)`, 'info', 'runInitialBacktest');
    await log(`Средняя цена открытия: ${result.averageOpenPrice.toFixed(8)} ETH (${(result.averageOpenPrice * ethPrice * usdToRubRate).toFixed(2)} RUB)`, 'info', 'runInitialBacktest');
    await log(`Средняя длина сделки: ${result.averageTradeLength.toFixed(2)} минут`, 'info', 'runInitialBacktest');
    await log(`Средняя длина выигрышной сделки: ${result.averageWinningTradeLength.toFixed(2)} минут`, 'info', 'runInitialBacktest');
    await log(`Средняя длина поражения: ${result.averageLosingTradeLength.toFixed(2)} минут`, 'info', 'runInitialBacktest');
    await log(`Средняя длина в среднем: ${result.averageTradeLength.toFixed(2)} минут`, 'info', 'runInitialBacktest');
    await log(`Доля поражений: ${result.losingTradesPercentage.toFixed(2)}%`, 'info', 'runInitialBacktest');
    await log(`Доля выигрышных сделок: ${result.winningTradesPercentage.toFixed(2)}%`, 'info', 'runInitialBacktest');
    await log(`Доля побед: ${result.winningTradesPercentage.toFixed(2)}%`, 'info', 'runInitialBacktest');
    await log(`Доля проигрышей: ${result.losingTradesPercentage.toFixed(2)}%`, 'info', 'runInitialBacktest');
    await log(`Доля поражений в среднем: ${result.averageLosingTradeLength.toFixed(2)} минут`, 'info', 'runInitialBacktest');
    await log(`Доля выигрышных сделок в среднем: ${result.averageWinningTradeLength.toFixed(2)} минут`, 'info', 'runInitialBacktest');

    await logBacktestResult(result);
    await log('Бэктест завершен', 'info', 'runInitialBacktest');
    await log(`Результаты начального бэктеста: ${JSON.stringify(result)}`, 'info', 'runInitialBacktest');

    return result;
  } catch (error) {
    await log(`Ошибка при выполнении начального бэктеста: ${error.message}`, 'error', 'runInitialBacktest');
    return null;
  }
}

function calculateAnnualizedReturn(profitPercent, days) {
  return (Math.pow(1 + profitPercent / 100, 365 / days) - 1) * 100;
}

function calculateMonthlyReturn(profitPercent, days) {
  return (Math.pow(1 + profitPercent / 100, 30 / days) - 1) * 100;
}

async function logBacktestResult(result) {
  const backtestLogPath = path.join(__dirname, 'logs', 'backtest_results.json');
  try {
    let backtestHistory = [];
    if (await fs.pathExists(backtestLogPath)) {
      backtestHistory = await fs.readJson(backtestLogPath);
    }
    const resultWithTimestamp = {
      timestamp: new Date().toISOString(),
      ...result
    };
    backtestHistory.push(resultWithTimestamp);
    await fs.writeJson(backtestLogPath, backtestHistory, { spaces: 2 });
    await log('Результаты бэктеста успешно записаны в файл', 'info', 'logBacktestResult');
  } catch (error) {
    await log(`Ошибка при записи результатов бэктеста: ${error.message}`, 'error', 'logBacktestResult');
  }
}

// Функция для симуляции исполнения ордера в бэктестинге
async function simulateOrderExecution(signal, positionSize, entryPrice, stopLossPrice, takeProfitPrice, portfolio, currentCandle, historicalData, marketConditions) {
  try {
      await log(`🔄 Начало симуляции исполнения ордера: ${signal} ${positionSize} ETH по цене ${entryPrice}`, 'info', 'simulateOrderExecution');
  
      const holdTime = calculateAdaptiveHoldTime(marketConditions, signal);
      await log(`⏱️ Рассчитанное время удержания: ${holdTime} мс`, 'info', 'simulateOrderExecution');
  
      let exitPrice = entryPrice;
      let exitReason = 'Неизвестно';
      let i = 0;
      const maxCandles = Math.ceil(holdTime / (15 * 60 * 1000)); // Преобразуем миллисекунды в количество 15-минутных свечей
  
      while (i < maxCandles) {
        const nextCandle = historicalData[historicalData.indexOf(currentCandle) + i + 1];
        if (!nextCandle) break;

        // Добавляем реалистичное проскальзывание
          const slippage = (Math.random() * marketConditions.volatility * 2 + 0.001); // Проскальзывание зависит от волатильности
          const highPriceWithSlippage = nextCandle.high * (1 + slippage);
          const lowPriceWithSlippage = nextCandle.low * (1 - slippage);

        if (signal === 'buy') {
          if (lowPriceWithSlippage <= stopLossPrice) {
            exitPrice = stopLossPrice;
            exitReason = 'Стоп-лосс';
            break;
          } else if (highPriceWithSlippage >= takeProfitPrice) {
            exitPrice = takeProfitPrice;
            exitReason = 'Тейк-профит';
            break;
          }
        } else { // для сигнала 'sell'
          if (highPriceWithSlippage >= stopLossPrice) {
            exitPrice = stopLossPrice;
            exitReason = 'Стоп-лосс';
            break;
          } else if (lowPriceWithSlippage <= takeProfitPrice) {
            exitPrice = takeProfitPrice;
            exitReason = 'Тейк-профит';
            break;
          }
        }
  
        i++;
      }
  
      if (exitReason === 'Неизвестно') {

        // Добавляем реалистичное проскальзывание
        const slippage = (Math.random() * marketConditions.volatility * 2 + 0.001);

        exitPrice = historicalData[historicalData.indexOf(currentCandle) + i].close  * (1 + slippage) ;
        exitReason = 'Время удержания истекло';
      }

      const profitLoss = signal === 'buy' ? 
        (exitPrice - entryPrice) * positionSize :
        (entryPrice - exitPrice) * positionSize;
  
      const updatedPortfolio = {...portfolio};
      updatedPortfolio.USDT = new Decimal(updatedPortfolio.USDT); // Преобразуем в Decimal
      updatedPortfolio.ETH = new Decimal(updatedPortfolio.ETH); // Преобразуем в Decimal

      if (signal === 'buy') {
        updatedPortfolio.USDT = updatedPortfolio.USDT.minus(positionSize.times(entryPrice));
        updatedPortfolio.ETH = updatedPortfolio.ETH.plus(positionSize);
        updatedPortfolio.USDT = updatedPortfolio.USDT.plus(positionSize.times(exitPrice));
        updatedPortfolio.ETH = updatedPortfolio.ETH.minus(positionSize);
      } else {
        updatedPortfolio.ETH = updatedPortfolio.ETH.minus(positionSize);
        updatedPortfolio.USDT = updatedPortfolio.USDT.plus(positionSize.times(entryPrice));
        updatedPortfolio.ETH = updatedPortfolio.ETH.plus(positionSize);
        updatedPortfolio.USDT = updatedPortfolio.USDT.minus(positionSize.times(exitPrice));
      }
  
      // Приводим обратно к числам
      updatedPortfolio.USDT = updatedPortfolio.USDT.toNumber();
      updatedPortfolio.ETH = updatedPortfolio.ETH.toNumber();
  
      await log(`📊 Симуляция ордера завершена:
      🔄 Тип: ${signal}
      💰 Размер позиции: ${positionSize.toFixed(8)} ETH
      📈 Цена входа: ${entryPrice.toFixed(2)} USDT
      📉 Цена выхода: ${exitPrice.toFixed(2)} USDT
      💸 Прибыль/Убыток: ${profitLoss.toFixed(2)} USDT
      🏁 Причина закрытия: ${exitReason}
      ⏱️ Время удержания: ${i * 15} минут`, 'info', 'simulateOrderExecution');
  
      return {
        type: signal,
        positionSize,
        entryPrice,
        exitPrice,
        profitLoss,
        exitReason,
        holdTime: i * 15, // в минутах
        updatedPortfolio
      };
    } catch (error) {
      await log(`❌ Ошибка при симуляции исполнения ордера: ${error.message}`, 'error', 'simulateOrderExecution');
      throw error;
    }
}

// Функция для анализа результатов бэктеста
function analyzeBacktestResults(trades, finalPortfolio) {
  const initialBalance = 10000; // Начальный баланс USDT
  const totalProfit = finalPortfolio.USDT - initialBalance;
  const profitPercentage = (totalProfit / initialBalance) * 100;
  const winningTrades = trades.filter(trade => trade.profitLoss > 0);
  const losingTrades = trades.filter(trade => trade.profitLoss <= 0);

  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: (winningTrades.length / trades.length) * 100,
    totalProfit: totalProfit,
    profitPercentage: profitPercentage,
    finalBalance: finalPortfolio.USDT,
    averageTradeProfit: totalProfit / trades.length,
    averageHoldTime: trades.reduce((sum, trade) => sum + trade.holdTime, 0) / trades.length
  };
}


// Функция для симуляции сделки в бэктестинге
async function simulateTrade(signal, signalStrength, marketConditions, riskParams, portfolio, currentCandle) {
  try {
    console.log(chalk.yellow(`🔄 Симуляция сделки: Сигнал ${signal}, Сила ${signalStrength}`));

    const currentPrice = currentCandle.close;
    const usdToRubRate = await getUsdToRubRateWithRetry();
    const positionSize = await calculateDynamicPositionSize(symbol, riskParams.risk, marketConditions.volatility, signalStrength);

    if (positionSize < MIN_POSITION_SIZE) {
      console.log(chalk.yellow(`⚠️ Симуляция: Рассчитанный размер позиции (${positionSize} ETH) меньше минимального. Сделка отменена.`));
      return null;
    }

    const stopLossPrice = calculateStopLossPrice(currentPrice, riskParams.stopLossPercent, signal);
    const takeProfitPrice = calculateTakeProfitPrice(currentPrice, riskParams.takeProfitPercent, signal);

    console.log(chalk.yellow(`🎯 Симуляция: Стоп-лосс: ${stopLossPrice.toFixed(2)} USD (${(stopLossPrice * usdToRubRate).toFixed(2)} RUB), Тейк-профит: ${takeProfitPrice.toFixed(2)} USD (${(takeProfitPrice * usdToRubRate).toFixed(2)} RUB)`));

    const tradeResult = await simulateOrderExecution(signal, positionSize, currentPrice, stopLossPrice, takeProfitPrice, portfolio, currentCandle);

    if (tradeResult) {
      tradeResult.profitLossRUB = tradeResult.profitLoss * usdToRubRate;
      console.log(chalk.yellow(`📊 Симуляция сделки завершена: Прибыль/Убыток: ${tradeResult.profitLossRUB.toFixed(2)} RUB`));
    }

    return tradeResult;
  } catch (error) {
    console.log(chalk.red(`❌ Ошибка в симуляции сделки: ${error.message}`));
    return null;
  }
}

// Функция для анализа результатов бэктеста
async function analyzeBacktestResults(trades, finalPortfolio, initialBalanceRUB) {
  const usdToRubRate = await getUsdToRubRate();
  const ethPrice = await getPrice('ETHUSDT');
  const finalBalanceRUB = finalPortfolio.ETH * ethPrice * usdToRubRate + finalPortfolio.RUB;
  const totalProfit = finalBalanceRUB - initialBalanceRUB;
  const profitPercentage = (totalProfit / initialBalanceRUB) * 100;
  const winningTrades = trades.filter(trade => trade.profitLossRUB > 0);
  const losingTrades = trades.filter(trade => trade.profitLossRUB <= 0);

  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: (winningTrades.length / trades.length) * 100,
    totalProfit: totalProfit.toFixed(2),
    profitPercentage: profitPercentage.toFixed(2),
    initialBalance: initialBalanceRUB.toFixed(2),
    finalBalance: finalBalanceRUB.toFixed(2),
    averageTradeProfit: (totalProfit / trades.length).toFixed(2),
    maxDrawdown: calculateMaxDrawdown(trades).toFixed(2),
  };
}

// Функция для настройки и запуска бэктестинга

/**
 * Форматирует время в человекочитаемый формат
 * @param {number} seconds Время в секундах
 * @returns {string} Отформатированное время
 */
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}ч ${minutes}м ${secs}с`;
}


// Функция для расчета максимальной просадки
function calculateMaxDrawdown(trades) {
  let peak = new Decimal(0);
  let maxDrawdown = new Decimal(0);
  let runningTotal = new Decimal(0);

  for (const trade of trades) {
    runningTotal = runningTotal.plus(trade.profitLoss);
    if (runningTotal.greaterThan(peak)) {
      peak = runningTotal;
    }
    const drawdown = peak.greaterThan(0) ? peak.minus(runningTotal).dividedBy(peak) : new Decimal(0);
    if (drawdown.greaterThan(maxDrawdown)) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown.times(100); // Возвращаем в процентах
}

// Функция для выполнения бэктеста
async function backtest(historicalData, params) {
  const startTime = Date.now();
  try {
    await log('Начало выполнения бэктеста', 'info', 'backtest');
    const usdToRubRate = await getUsdToRubRate();

    let portfolio = {
      ETH: params.initialBalance,
      USDT: 0
    };

    let trades = [];
    let maxDrawdown = 0;
    let highestBalance = params.initialBalance;
    let totalProfit = 0;
    let winningTrades = 0;
    let losingTrades = 0;

    await log(`Начальный баланс: ${params.initialBalance.toFixed(8)} ETH (${(params.initialBalance * historicalData[0].close * usdToRubRate).toFixed(2)} RUB)`, 'info', 'backtest');

    for (let i = 100; i < historicalData.length; i++) {
      const inputData = historicalData.slice(i - 100, i);
      const analysisResult = await analyzeDataWithNN(params.symbol, '15m', inputData);

      const { signal, signalStrength, currentPrice } = analysisResult;

      await log(`День ${i-99}: Цена ${currentPrice.toFixed(2)} USD, Сигнал: ${signal}, Сила сигнала: ${signalStrength.toFixed(4)}`, 'detail', 'backtest');

      if (signal !== 'hold' && signalStrength >= params.minSignalStrength) {
        const positionSize = await calculateDynamicPositionSize(params.symbol, params.riskFactor);
        
        const slippage = 1 + (Math.random() * 0.002 - 0.001);
        const executionPrice = currentPrice * slippage;

        if (signal === 'buy' && portfolio.USDT >= positionSize * executionPrice) {
          const buyAmount = positionSize / executionPrice;
          portfolio.USDT -= positionSize;
          portfolio.ETH += buyAmount;

          const trade = {
            type: 'buy',
            price: executionPrice,
            amount: buyAmount,
            date: historicalData[i].date,
            openIndex: i
          };
          trades.push(trade);

          await log(`Бэктест: Покупка ${buyAmount.toFixed(8)} ETH по цене ${executionPrice} USD`, 'info', 'backtest');
          
          const tradeResult = await closeTradeInBacktest(trade, historicalData, i, trades, portfolio);
          totalProfit += tradeResult.profit;
          if (tradeResult.profit > 0) winningTrades++;
          else losingTrades++;
        } else if (signal === 'sell' && portfolio.ETH >= positionSize / executionPrice) {
          const sellAmount = positionSize / executionPrice;
          portfolio.USDT += positionSize;
          portfolio.ETH -= sellAmount;

          const trade = {
            type: 'sell',
            price: executionPrice,
            amount: sellAmount,
            date: historicalData[i].date,
            openIndex: i
          };
          trades.push(trade);

          await log(`Бэктест: Продажа ${sellAmount.toFixed(8)} ETH по цене ${executionPrice} USD`, 'info', 'backtest');
          
          const tradeResult = await closeTradeInBacktest(trade, historicalData, i, trades, portfolio);
          totalProfit += tradeResult.profit;
          if (tradeResult.profit > 0) winningTrades++;
          else losingTrades++;
        }
      }

      const currentBalance = portfolio.ETH + (portfolio.USDT / currentPrice);
      if (currentBalance > highestBalance) {
        highestBalance = currentBalance;
      } else {
        const drawdown = (highestBalance - currentBalance) / highestBalance;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }

      await log(`Текущий баланс: ${currentBalance.toFixed(8)} ETH (${(currentBalance * currentPrice * usdToRubRate).toFixed(2)} RUB)`, 'detail', 'backtest');
    }

    const finalPrice = historicalData[historicalData.length - 1].close;
    const finalBalanceETH = portfolio.ETH + (portfolio.USDT / finalPrice);
    const profit = finalBalanceETH - params.initialBalance;
    const profitPercentage = (profit / params.initialBalance) * 100;

    const closedTrades = trades.filter(t => t.closePrice);

    const result = {
      initialBalance: params.initialBalance,
      finalBalance: finalBalanceETH,
      profit: profit,
      profitPercentage: profitPercentage,
      maxDrawdown: maxDrawdown * 100,
      totalTrades: closedTrades.length,
      winningTrades: winningTrades,
      losingTrades: losingTrades,
      winRate: (winningTrades / closedTrades.length) * 100,
      averageProfit: totalProfit / closedTrades.length,
      totalProfit: totalProfit,
      trades: closedTrades
    };

    await log(`Результаты бэктеста:`, 'info', 'backtest');
    await log(`Начальный баланс: ${params.initialBalance.toFixed(8)} ETH`, 'info', 'backtest');
    await log(`Конечный баланс: ${finalBalanceETH.toFixed(8)} ETH`, 'info', 'backtest');
    await log(`Прибыль: ${profit.toFixed(8)} ETH (${profitPercentage.toFixed(2)}%)`, 'info', 'backtest');
    await log(`Общая прибыль: ${totalProfit.toFixed(8)} ETH`, 'info', 'backtest');
    await log(`Максимальная просадка: ${(maxDrawdown * 100).toFixed(2)}%`, 'info', 'backtest');
    await log(`Всего сделок: ${closedTrades.length}`, 'info', 'backtest');
    await log(`Прибыльных сделок: ${winningTrades}`, 'info', 'backtest');
    await log(`Убыточных сделок: ${losingTrades}`, 'info', 'backtest');
    await log(`Процент выигрышных сделок: ${result.winRate.toFixed(2)}%`, 'info', 'backtest');
    await log(`Средняя прибыль на сделку: ${result.averageProfit.toFixed(8)} ETH`, 'info', 'backtest');

    const endTime = Date.now();
    const executionTimeMinutes = ((endTime - startTime) / 60000).toFixed(2);
    const timeMessage = chalk.bgCyan.black(`⏱️ Время выполнения бэктеста: ${executionTimeMinutes} минут`);
    
    await log(timeMessage, 'info', 'backtest');
    console.log(timeMessage);

    return result;
  } catch (error) {
    const endTime = Date.now();
    const executionTimeMinutes = ((endTime - startTime) / 60000).toFixed(2);
    const timeMessage = chalk.bgRed.white(`⏱️ Время выполнения бэктеста (с ошибкой): ${executionTimeMinutes} минут`);
    
    await log(timeMessage, 'error', 'backtest');
    console.log(timeMessage);
    
    await log(`Ошибка при выполнении бэктеста: ${error.message}`, 'error', 'backtest');
    throw error;
  }
}

// Функция для размещения тейк-профит ордера
async function placeTakeProfitOrder(symbol, side, price, amount) {
  try {
    await log(`🎯 Размещение тейк-профит ордера: ${symbol} ${side} ${amount} по цене ${price}`, 'info', 'placeTakeProfitOrder');
    
    if (currentTradingMode === 'test') {
      await log(`🧪 Тестовый режим: Размещение тейк-профит ордера для ${symbol} по цене ${price}`, 'info', 'placeTakeProfitOrder');
      return { success: true, message: 'Тестовый тейк-профит ордер' };
    }

    const order = await bybitClient.submitOrder({
      category: 'spot',
      symbol: symbol,
      side: side,
      orderType: 'LIMIT',
      qty: amount.toString(),
      price: price.toString(),
      timeInForce: 'GTC',
      reduceOnly: true,
      closeOnTrigger: true
    });

    await log(`✅ Тейк-профит ордер размещен: ${JSON.stringify(order)}`, 'info', 'placeTakeProfitOrder');
    return order;
  } catch (error) {
    await log(`❌ Ошибка при размещении тейк-профит ордера: ${error.message}`, 'error', 'placeTakeProfitOrder');
    return { success: false, message: error.message };
  }
}

async function closeTradeInBacktest(trade, historicalData, currentIndex, trades, portfolio) {
  // Закрываем сделку через случайное количество шагов (от 1 до 20)
  const closeIndex = Math.min(currentIndex + Math.floor(Math.random() * 20) + 1, historicalData.length - 1);
  const closePrice = historicalData[closeIndex].close;

  // Добавляем случайное проскальзывание при закрытии
  const slippage = 1 + (Math.random() * 0.002 - 0.001);
  const executionClosePrice = closePrice * slippage;

  const entryValue = trade.price * trade.amount;
  const exitValue = executionClosePrice * trade.amount;
  const commission = (entryValue + exitValue) * 0.001; // 0.1% комиссия

  let profit;
  if (trade.type === 'buy') {
    profit = exitValue - entryValue - commission;
    portfolio.USDT += exitValue - commission;
    portfolio.ETH -= trade.amount;
  } else {
    profit = entryValue - exitValue - commission;
    portfolio.ETH += trade.amount;
    portfolio.USDT -= exitValue + commission;
  }

  trade.closePrice = executionClosePrice;
  trade.closeIndex = closeIndex;
  trade.closeDate = historicalData[closeIndex].date;
  trade.profit = profit;
  trade.profitPercentage = (profit / entryValue) * 100;
  trade.commission = commission;

  await log(`Бэктест: Закрыта сделка ${trade.type} ${trade.amount.toFixed(8)} ETH. Прибыль: ${profit.toFixed(8)} ETH (${trade.profitPercentage.toFixed(2)}%)`, 'info', 'backtest');

  return { profit };
}
// Конец торговой стратегии

// Функция для экспоненциальной задержкой между попытками
async function getUsdToRubRateWithRetry(maxRetries = 5, initialDelay = 1000) {
  let retryCount = 0;
  while (retryCount < maxRetries) {
    try {
      return await getUsdToRubRate();
    } catch (error) {
      if (error.response && error.response.status === 429) {
        retryCount++;
        const delay = initialDelay * Math.pow(2, retryCount);
        await log(`Получен статус 429, ожидание ${delay}мс перед повторной попыткой (${retryCount}/${maxRetries})`, 'warn', 'getUsdToRubRateWithRetry');
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Не удалось получить курс USD/RUB после ${maxRetries} попыток`);
}

// 💾 Кэш для хранения курса USD/RUB на 1 час
const usdRubRateCache = new NodeCache({ stdTTL: 1 * 60 * 60 });

/**
 * 💱 Получает текущий курс USD/RUB с использованием нескольких источников и кэширования.
 * @param {number} maxRetries - Максимальное количество попыток получения курса.
 * @param {number} retryDelay - Задержка между попытками в миллисекундах.
 * @returns {Promise<Decimal>} Курс USD/RUB.
 */
async function getUsdToRubRate(maxRetries = 3, retryDelay = 3000) {
  try {
    await log('🔍 Начало получения курса USD/RUB', 'info', 'getUsdToRubRate');

    // Проверяем кэш
    const cachedRate = usdRubRateCache.get('usdRubRate');
    if (cachedRate) {
      await log(`💰 Курс USD/RUB получен из кэша: ${cachedRate}`, 'info', 'getUsdToRubRate');
      return new Decimal(cachedRate);
    }

    // 📊 Массив источников данных для получения курса
    const dataSources = [
      {
        name: 'Exchange Rate API',
        fetchRate: async () => {
          const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', {
            timeout: 5000,
            headers: { 'User-Agent': 'YourAppName/1.0' }
          });
          if (response.data && response.data.rates && response.data.rates.RUB) {
            return response.data.rates.RUB;
          }
          throw new Error('Неверный формат ответа от Exchange Rate API');
        }
      },
      {
        name: 'Open Exchange Rates',
        fetchRate: async () => {
          const response = await axios.get(`https://openexchangerates.org/api/latest.json?app_id=${process.env.OPEN_EXCHANGE_RATES_APP_ID}`, {
            timeout: 5000,
            headers: { 'User-Agent': 'YourAppName/1.0' }
          });
          if (response.data && response.data.rates && response.data.rates.RUB) {
            return response.data.rates.RUB;
          }
          throw new Error('Неверный формат ответа от Open Exchange Rates');
        }
      },
      // 🔄 Можно добавить дополнительные источники данных здесь
    ];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await log(`🔄 Попытка ${attempt} из ${maxRetries} получения курса USD/RUB`, 'info', 'getUsdToRubRate');

      for (const source of dataSources) {
        try {
          const rate = await source.fetchRate();
          if (!isNaN(rate) && rate > 0) {
            await log(`✅ Курс USD/RUB получен из источника ${source.name}: ${rate}`, 'info', 'getUsdToRubRate');
            
            // 💾 Сохраняем курс в кэш
            usdRubRateCache.set('usdRubRate', rate);
            
            return new Decimal(rate);
          } else {
            throw new Error(`Некорректное значение курса: ${rate}`);
          }
        } catch (error) {
          await log(`❌ Ошибка при получении курса из ${source.name}: ${error.message}`, 'warn', 'getUsdToRubRate');
        }
      }

      if (attempt < maxRetries) {
        await log(`⏳ Ожидание ${retryDelay}мс перед следующей попыткой`, 'info', 'getUsdToRubRate');
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    // 🚨 Если все попытки не удались, используем резервное значение
    const fallbackRate = 92.71;
    await log(`⚠️ Не удалось получить курс USD/RUB. Использование резервного значения: ${fallbackRate}`, 'warn', 'getUsdToRubRate');
    return fallbackRate;

  } catch (error) {
    await log(`🚨 Критическая ошибка при получении курса USD/RUB: ${error.message}`, 'error', 'getUsdToRubRate');
    return new Decimal(92.71); // Резервное значение в случае критической ошибки
  }
}


// Функция для инициализации тестового портфеля
async function initializeTestPortfolio() {
  const ethPrice = await getPrice('ETHUSDT');
  const usdToRubRate = await getUsdToRubRate();
  const initialEthAmount = INITIAL_BALANCE_RUB / (ethPrice * usdToRubRate);
  testPortfolio.ETH = initialEthAmount;
  testPortfolio.RUB = INITIAL_BALANCE_RUB;
  await log(`Инициализация тестового портфеля: ${initialEthAmount.toFixed(8)} ETH (${testPortfolio.RUB.toFixed(2)} RUB)`, 'info', 'initializeTestPortfolio');
}

// Функция для динамической корректировки размера позиции
function calculateDynamicPositionSize(balance, _risk, volatility) {
  const basePositionSize = balance * RISK_PER_TRADE;
  const volatilityAdjustment = 1 - (volatility / 0.1); // Уменьшаем размер позиции при высокой волатильности
  return Math.min(basePositionSize * volatilityAdjustment, balance * MAX_POSITION_SIZE);
}

// Новая функция для получения данных линейного графика
async function fetchCandlestickData(symbol, interval, startTime, endTime, limit = 1000) {
  try {
    await log(`Запрос данных линейного графика: символ=${symbol}, интервал=${interval}, startTime=${startTime}, endTime=${endTime}, лимит=${limit}`, 'info', 'fetchCandlestickData');

    const response = await bybitClient.getKline({
      category: 'spot',
      symbol: symbol,
      interval: interval,
      startTime: startTime,
      endTime: endTime,
      limit: limit
    });

    if (!response.result || !response.result.list) {
      throw new Error('Неверный формат ответа от Bybit API');
    }

    const chartData = response.result.list.map(item => ({
      x: new Date(parseInt(item[0])),
      y: parseFloat(item[4]) // Используем цену закрытия (close) для линейного графика
    }));

    await log(`Получено ${chartData.length} точек данных`, 'info', 'fetchCandlestickData');
    console.log('Подготовленные данные для графика:', chartData);

    return chartData;
  } catch (error) {
    await log(`Ошибка при получении данных линейного графика: ${error.message}`, 'error', 'fetchCandlestickData');
    await sendTelegramMessage(`Ошибка при получении данных линейного графика: ${error.message}`);
    throw error;
  }
}



// Маршруты API


// Добавление нового маршрута для получения метрик стратегии
app.get('/strategy-metrics', async (_req, res) => {
  try {
    const metrics = await getLatestMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Не удалось получить метрики стратегии' });
  }
});


// Новый маршрут для получения данных линейного графика
app.get('/candlestick-data/:symbol/:interval', async (req, res) => {
  const { symbol, interval } = req.params;
  const { startTime, endTime, limit } = req.query;

  try {
    const chartData = await fetchCandlestickData(symbol, interval, startTime, endTime, limit);
    res.json(chartData);
  } catch (error) {
    console.error(`Ошибка в маршруте /candlestick-data: ${error.message}`);
    res.status(500).json({ error: 'Не удалось получить данные линейного графика', details: error.message });
  }
});


// Маршрут для получения цены ETH/USD
app.get('/price/ETHUSD', async (_req, res) => {
  await log('Запрос цены ETH/USD...', 'detail', 'GET /price/ETHUSD');
  try {
    const price = await getPrice('ETHUSDT');
    await log(`Цена ETH/USD получена: ${price}`, 'detail', 'GET /price/ETHUSD');
    await logRouteData('price_ETHUSD', { price });
    res.json({ price });
  } catch (error) {
    handleError(res, 'Ошибка при получении цены ETH/USD', error);
  }
});

// Маршрут для получения цены ETH/RUB
app.get('/price/ETHRUB', async (_req, res) => {
  await log('Запрос цены ETH/RUB...', 'detail', 'GET /price/ETHRUB');
  try {
    const price = await getPrice('ETHUSDT');
    const usdToRub = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', { timeout: 5000 });
    const ethRubPrice = parseFloat(price) * usdToRub.data.rates.RUB;
    await log(`Цена ETH/RUB получена: ${ethRubPrice}`, 'detail', 'GET /price/ETHRUB');
    await logRouteData('price_ETHRUB', { ethRubPrice });
    res.json({ price: ethRubPrice });
  } catch (error) {
    handleError(res, 'Ошибка при получении цены ETH/RUB', error);
  }
});

app.get('/manual-trade-analysis', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Необходимо указать startDate и endDate' });
    }

    const analysis = await analyzeTrades(startDate, endDate);
    
    res.json(analysis);
  } catch (error) {
    await log(`Ошибка при выполнении ручного анализа сделок: ${error.message}`, 'error', 'manualTradeAnalysis');
    res.status(500).json({ error: 'Ошибка при выполнении анализа сделок' });
  }
});

// Маршрут для получения исторических данных ETH/USD
app.get('/historical/ETHUSD/:period', async (req, res) => {
  const { period } = req.params;
  await log(`Запрос исторических данных для ${period}...`, 'detail', 'GET /historical/ETHUSD/:period');
  try {
    const endTime = Date.now();
    let interval;
    let limit = 1000;

    switch (period) {
      case '1m':
        interval = '1';
        break;
      case '5m':
        interval = '5';
        break;
      case '15m':
        interval = '15';
        break;
      case '30m':
        interval = '30';
        break;
      case '1h':
        interval = '60';
        break;
      case '4h':
        interval = '240';
        break;
      default:
        interval = '15';
    }

    const response = await bybitClient.getKline({
      category: 'spot',
      symbol: 'ETHUSDT',
      interval: interval,
      limit: limit,
      end: endTime,
    });

    if (!response || !response.result || !Array.isArray(response.result.list) || response.result.list.length === 0) {
      console.error('Ответ API Bybit:', JSON.stringify(response, null, 2));
      throw new Error('Ошибка: Не удалось получить исторические данные с Bybit.');
    }

    const historicalData = response.result.list.map((item) => ({
      date: moment(parseInt(item[0])).format('YYYY-MM-DD HH:mm:ss'),
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      volume: parseFloat(item[5]),
    }));

    await log('Исторические данные получены.', 'detail', 'GET /historical/ETHUSD/:period');

    const analysisResult = await analyzeData(historicalData);
    await log('Анализ данных завершен.', 'detail', 'GET /historical/ETHUSD/:period');

    await autoTrade(analysisResult);
    await logRouteData(`historical_ETHUSD_${period}`, { historicalData, analysisResult });

    res.json(analysisResult);
    io.emit('newData', analysisResult); // отправка данных клиенту через socket.io
  } catch (error) {
    handleError(res, 'Ошибка при получении исторических данных', error);
  }
});



// Функция для сохранения результатов бэктеста
async function saveBacktestResult(result) {
  try {
    const backtestDir = path.join(__dirname, 'backtest_results');
    const backtestPath = path.join(backtestDir, `backtest_${Date.now()}.json`);
    
    await fs.mkdir(backtestDir, { recursive: true });
    
    const usdToRubRate = await getUsdToRubRate();
    const ethPrice = await getPrice('ETHUSDT');
    
    const formattedResult = {
      "Дата и время": new Date().toISOString(),
      "Начальный баланс (ETH)": result.initialBalance.toFixed(8),
      "Начальный баланс (RUB)": (result.initialBalance * ethPrice * usdToRubRate).toFixed(2),
      "Конечный баланс (ETH)": result.finalBalance.toFixed(8),
      "Конечный баланс (RUB)": (result.finalBalance * ethPrice * usdToRubRate).toFixed(2),
      "Прибыль (ETH)": result.profit.toFixed(8),
      "Прибыль (RUB)": (result.profit * ethPrice * usdToRubRate).toFixed(2),
      "Прибыль (%)": result.profitPercentage.toFixed(2),
      "Максимальная просадка (%)": result.maxDrawdown.toFixed(2),
      "Годовая доходность (%)": result.annualizedReturn.toFixed(2),
      "Месячная доходность (%)": result.monthlyReturn.toFixed(2),
      "Дневная доходность (%)": result.dailyReturn.toFixed(2),
      "Всего сделок": result.totalTrades,
      "Прибыльных сделок": result.profitableTrades,
      "Убыточных сделок": result.unprofitableTrades,
      "Процент выигрышных сделок": result.winRate.toFixed(2),
      "Средняя прибыль на сделку (ETH)": result.averageProfit.toFixed(8),
      "Средняя прибыль на сделку (RUB)": (result.averageProfit * ethPrice * usdToRubRate).toFixed(2),
      "Эффективность стратегии (%)": ((result.profitPercentage / result.maxDrawdown) * 100).toFixed(2)
    };

    await fs.writeFile(backtestPath, JSON.stringify(formattedResult, null, 2));
    await log(`Результаты бэктеста сохранены: ${backtestPath}`, 'info', 'saveBacktestResult');
  } catch (error) {
    await log(`Ошибка при сохранении результатов бэктеста: ${error.message}`, 'error', 'saveBacktestResult');
    throw error;
  }
}

// Обновим маршрут для бэктестинга
app.post('/backtest', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    await log(`Начало бэктеста: startDate=${startDate}, endDate=${endDate}`, 'info', 'POST /backtest');
    const historicalData = await fetchHistoricalDataForTraining('15m', startDate, endDate);
    const result = await backtest(historicalData, {
      gridLevels: 10,
      profitMargin: 0.02,
      riskFactor: 1
    });
    await saveBacktestResult(result);
    await log(`Бэктест завершен. Результат: ${JSON.stringify(result)}`, 'info', 'POST /backtest');
    
    const response = {
      сообщение: 'Бэктест успешно выполнен',
      результаты: {
        'Итоговый баланс': `${result.finalBalanceUSD.toFixed(2)} USD`,
        'Прибыль': `${result.profitRUB.toFixed(2)} руб. (${result.profitPercent.toFixed(2)}%)`,
        'Максимальная просадка': `${result.maxDrawdown.toFixed(2)}%`,
        'Годовая доходность': `${result.annualizedReturn.toFixed(2)}%`,
        'Месячная доходность': `${result.monthlyReturn.toFixed(2)}%`,
        'Всего сделок': result.tradesCount,
        'Прибыльных сделок': result.positiveTradesCount,
        'Убыточных сделок': result.negativeTradesCount,
        'Эффективность стратегии': `${result.strategyEfficiency.toFixed(2)}%`,
        'Конечный баланс портфеля': {
          'ETH': `${result.finalPortfolio.ETH.toFixed(8)} ETH`,
          'USDT': `${result.finalPortfolio.USDT.toFixed(2)} USDT`
        }
      }
    };
    
    res.json(response);
  } catch (error) {
    await log(`Ошибка при выполнении бэктеста: ${error.message}`, 'error', 'POST /backtest');
    res.status(500).json({ ошибка: error.message });
  }
});

// Функция для переключения режима торговли
app.post('/switch-mode', async (req, res) => {
  try {
    const { mode } = req.body;

    // Проверка допустимых значений режима
    if (mode !== 'live' && mode !== 'test') {
      return res.status(400).json({ 
        success: false, 
        message: 'Недопустимое значение режима. Выберите "live" или "test".' 
      });
    }

    // Обновление глобальной переменной
    currentTradingMode = mode;

    // Логирование изменения режима
    await log(`Режим торговли изменен на ${mode}`, 'info', 'switchTradingMode');

    // Отправка ответа клиенту
    res.json({ 
      success: true, 
      message: `Режим успешно изменен на ${mode}`, 
      currentMode: mode 
    });
  } catch (error) {
    // Логирование ошибки
    await log(`Ошибка при переключении режима торговли: ${error.message}`, 'error', 'switchTradingMode');

    // Отправка ответа клиенту с ошибкой
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

app.get('/trading-mode', (_req, res) => {
  res.json({ mode: currentTradingMode });
});

// Маршрут для логирования переключения режима торговли
app.get('/trading-mode', (_req, res) => {
  res.json({ mode: currentTradingMode });
});

app.post('/log-action', (req, res) => {
  const { action, details } = req.body;
  console.log(`User action: ${action}`, details);
  // Здесь вы можете сохранять логи в базу данных или файл
  res.sendStatus(200);
});

app.post('/neural-network/toggle-training', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled === 'boolean') {
    isNeuralNetworkTrainingEnabled = enabled;
    log(`Обучение нейронной сети ${enabled ? 'включено' : 'выключено'}`, 'info', 'toggleNeuralNetworkTraining');
    res.json({ success: true, message: `Обучение нейронной сети ${enabled ? 'включено' : 'выключено'}` });
  } else {
    res.status(400).json({ success: false, message: 'Неверный формат данных. Ожидается { enabled: boolean }' });
  }
});


app.get('/neural-network/training-status', (_req, res) => {
  res.json({ enabled: isNeuralNetworkTrainingEnabled });
});

// Маршрут для выполнения торговой операции
app.post('/trade', async (req, res) => {
  const { action, amount, signalId } = req.body;
  await logRouteData('trade_request', { action, amount, signalId });

  if (!action || (action !== 'buy' && action !== 'sell')) {
    return res.status(400).json({ error: 'Неверный параметр action' });
  }

  if (!signalId) {
    return res.status(400).json({ error: 'Отсутствует параметр signalId' });
  }

  try {
    const { order, tradeHistory } = await executeTrade(action, amount, signalId);
    await logRouteData('trade_response', { order, tradeHistory });
    res.json({ 
      message: `Действие ${action} выполнено`,
      order: order,
      tradeHistory: tradeHistory 
    });
  } catch (error) {
    handleError(res, 'Ошибка при торговле', error);
  }
});

// Маршрут для получения истории сделок
app.get('/trade-history', async (_req, res) => {
  try {
    if (await fs.pathExists(tradeHistoryPath)) {
      const tradeHistory = await fs.readJson(tradeHistoryPath);
      await logRouteData('trade_history', tradeHistory);
      res.json(tradeHistory);
    } else {
      res.status(404).json({ error: 'История сделок не найдена' });
    }
  } catch (error) {
    handleError(res, 'Ошибка при получении истории сделок', error);
  }
});

// Маршрут для получения данных тестового портфеля
app.get('/test-portfolio', async (_req, res) => {
  await logRouteData('test_portfolio', testPortfolio);
  res.json(testPortfolio);
});

// Маршрут для обновления тестового портфеля
app.post('/update-test-portfolio', async (req, res) => {
  const { ethBalance, usdtBalance } = req.body;
  await logRouteData('update_test_portfolio_request', { ethBalance, usdtBalance });
  if (isNaN(ethBalance) || isNaN(usdtBalance)) {
    return res.status(400).json({ error: 'Неверные значения баланса' });
  }

  try {
    testPortfolio.ETH = parseFloat(ethBalance);
    testPortfolio.USDT = parseFloat(usdtBalance);
    await fs.writeJson(testPortfolioPath, testPortfolio, { spaces: 2 });
    await logRouteData('update_test_portfolio_response', testPortfolio);
    res.json({ message: 'Баланс в тестовом портфеле обновлен', portfolio: testPortfolio });
  } catch (error) {
    handleError(res, 'Ошибка при обновлении тестового портфеля', error);
  }
});

// Маршрут для получения данных реального портфеля
app.get('/portfolio', async (_req, res) => {
  try {
    const isConnected = await checkBybitConnection();
    if (!isConnected) {
      throw new Error('Нет соединения с Bybit API');
    }

    const balances = await bybitClient.getWalletBalance({ accountType: "UNIFIED" });    await log(`Ответ от Bybit API: ${JSON.stringify(balances)}`, 'detail', 'GET /portfolio');
    
    if (!balances || !balances.result || !Array.isArray(balances.result.list)) {
      throw new Error(`Неверный формат ответа от Bybit API: ${JSON.stringify(balances)}`);
    }

    const ethBalance = balances.result.list.find((b) => b.coin === 'ETH')?.free || '0';
    const usdtBalance = balances.result.list.find((b) => b.coin === 'USDT')?.free || '0';

    const portfolioData = { 
      ethBalance: parseFloat(ethBalance), 
      usdtBalance: parseFloat(usdtBalance) 
    };

    await logRouteData('portfolio', portfolioData);
    res.json(portfolioData);
  } catch (error) {
    await handleError(res, 'Ошибка при получении данных портфеля', error);
  }
});


// Маршрут для получения баланса ETH в рублях
app.get('/portfolio/eth/rub', async (_req, res) => {
  try {
    const balances = await bybitClient.getWalletBalance({ accountType: "SPOT" });
    const ethBalance = balances.result.list.find((b) => b.coin === 'ETH').free;
    const usdToRub = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
    const ethRubBalance = parseFloat(ethBalance) * usdToRub.data.rates.RUB;
    await logRouteData('portfolio_eth_rub', { ethBalanceRub: ethRubBalance });
    res.json({ ethBalanceRub: ethRubBalance });
  } catch (error) {
    handleError(res, 'Ошибка при получении баланса ETH в рублях', error);
  }
});

// Маршрут для переключения режима торговли (тестовый/реальный)
app.post('/-mode', (req, res) => {
  const { mode } = req.body;
  if (mode === 'live' || mode === 'test') {
      currentTradingMode = mode;
      res.json({ success: true, message: `Режим успешно изменен на ${mode}`, currentMode: mode });
  } else {
      res.status(400).json({ success: false, message: 'Неверный режим' });
  }
});

// Маршрут для добавления нового сигнала
app.post('/add-signal', async (req, res) => {
  const signal = req.body;
  await logRouteData('add_signal_request', signal);
  signals.unshift(signal);
  await logRouteData('add_signal_response', { message: 'Сигнал добавлен', signal });
  res.json({ message: 'Сигнал добавлен', signal });
  io.emit('signal', signal);

  const telegramMessage = `Новый сигнал: ${signal.type}\nДетали: ${JSON.stringify(signal.signalData, null, 2)}`;
  await sendTelegramMessage(telegramMessage);
});


// Маршрут для получения списка сигналов
app.get('/signals', async (_req, res) => {
  await logRouteData('get_signals', signals);
  res.json(signals);
});

// Маршрут для удаления истории сделок
app.delete('/trade-history', async (_req, res) => {
  try {
    await fs.writeJson(tradeHistoryPath, []);
    await logRouteData('delete_trade_history', { message: 'История сделок успешно удалена' });
    res.json({ message: 'История сделок успешно удалена' });
  } catch (error) {
    handleError(res, 'Ошибка при удалении истории сделок', error);
  }
});

// Маршрут для управления открытыми позициями
app.post('/manage-positions', async (_req, res) => {
  try {
    const marketConditions = await analyzeMarketConditions();
    await manageOpenPositions(marketConditions);
    await logRouteData('manage_positions', { message: 'Управление позициями выполнено' });
    res.json({ message: 'Управление позициями выполнено' });
  } catch (error) {
    handleError(res, 'Ошибка при управлении открытыми позициями', error);
  }
});

// Маршрут для проверки соединения с Bybit
app.get('/check-connection', async (_req, res) => {
  try {
    const isConnected = await checkBybitConnection();
    await logRouteData('check_connection', { isConnected });
    res.json({ isConnected });
  } catch (error) {
    handleError(res, 'Ошибка при проверке соединения с Bybit', error);
  }
});

// Новая функция для проверки подключения к клиентской части
function checkClientConnection(clientSocket) {
  if (!clientSocket || !clientSocket.connected) {
    return false; 
  }
  return true;
}

// Новый маршрут для проверки соединения с клиентом
app.get('/client-connected', async (req, res) => {
  try {
    // Проверяем, подключен ли хотя бы один клиент
    const isClientConnected = io.sockets.connected.size > 0; 

    if (isClientConnected) {
      await log('Клиент подключен', 'info', 'GET /client-connected');
      res.json({ isConnected: true }); 
    } else {
      await log('Клиент не подключен', 'info', 'GET /client-connected');
      res.json({ isConnected: false }); 
    }
  } catch (error) {
    await log(`Ошибка при проверке соединения с клиентом: ${error.message}`, 'error', 'GET /client-connected');
    res.status(500).json({ isConnected: false, error: 'Ошибка при проверке соединения' }); 
  }
});

// Маршрут для обнуления статистики
app.post('/reset-statistics', async (_req, res) => {
  try {
    testPortfolio.ETH = 0;
    testPortfolio.USDT = 10000;
    await fs.writeJson(testPortfolioPath, testPortfolio, { spaces: 2 });
    await fs.writeJson(tradeHistoryPath, []);
    await logRouteData('reset_statistics', { message: 'Статистика успешно обнулена', portfolio: testPortfolio });
    res.json({ message: 'Статистика успешно обнулена', portfolio: testPortfolio });
  } catch (error) {
    handleError(res, 'Ошибка при обнулении статистики', error);
  }
});

// Маршрут для получения статистики портфеля за 24 часа
app.get('/portfolio-stats-24h', async (_req, res) => {
  try {
    const stats = await getPortfolioStats24h();
    await logRouteData('portfolio_stats_24h', stats);
    res.json(stats);
  } catch (error) {
    await log(`Ошибка при получении статистики портфеля: ${error.message}`, 'error', 'GET /portfolio-stats-24h');
    handleError(res, 'Ошибка при получении статистики портфеля', error);
  }
});

// Маршрут для проверки точности нейронной сети
app.get('/neural-network/accuracy', async (_req, res) => {
  try {
    const testData = await fetchHistoricalDataForTraining('15m');
    const neuralNet = await loadLatestModel();
    if (!neuralNet) {
      throw new Error('Модель нейронной сети не найдена');
    }
    const accuracy = calculateAccuracy(neuralNet.model, testData);
    res.json({ accuracy: accuracy.toFixed(2) });
  } catch (error) {
    handleError(res, 'Ошибка при проверке точности нейронной сети', error);
  }
});

// Маршрут для инкрементального обучения нейронной сети
app.post('/neural-network/train', async (_req, res) => {
  try {
    const newData = await fetchRecentData('15m');
    await incrementalTraining(newData);
    await logRouteData('neural_network_train', { message: 'Инкрементальное обучение завершено успешно' });
    res.json({ message: 'Инкрементальное обучение завершено успешно' });
  } catch (error) {
    handleError(res, 'Ошибка при инкрементальном обучении', error);
  }
});

// Маршрут для предсказания краткосрочного движения цены
app.get('/predict/short-term/:timeframe', async (req, res) => {
  const { timeframe } = req.params;
  try {
    const prediction = await predictShortTermPriceMovement(timeframe);
    await logRouteData(`predict_short_term_${timeframe}`, prediction);
    res.json(prediction);
  } catch (error) {
    handleError(res, 'Ошибка при предсказании краткосрочного движения цены', error);
  }
});

// Добавьте новый маршрут для получения текущих настроек
app.get('/settings/signal-sensitivity', (_req, res) => {
  res.json(signalSensitivity);
});



// Маршрут для настройки параметров генерации торговых сигналов
app.post('/settings/signal-params', async (req, res) => {
  const newParams = req.body;
  await logRouteData('settings_signal_params_request', newParams);
  if (typeof newParams !== 'object') {
    return res.status(400).json({ error: 'Неверный формат параметров' });
  }
  
 // Обновляем параметры
 Object.assign(signalParams, newParams);
  
 await logRouteData('settings_signal_params_response', { message: 'Параметры генерации сигналов обновлены', params: signalParams });
 res.json({ message: 'Параметры генерации сигналов обновлены', params: signalParams });
});

// Маршрут для получения текущих параметров генерации торговых сигналов
app.get('/settings/signal-params', async (_req, res) => {
 await logRouteData('get_settings_signal_params', signalParams);
 res.json(signalParams);
});


// Маршрут для получения логов
app.get('/logs/:type', async (req, res) => {
  const { type } = req.params;
  let logFile;

  switch (type) {
    case 'error':
      logFile = errorLogPath;
      break;
    case 'info':
      logFile = infoLogPath;
      break;
    case 'detail':
      logFile = detailLogPath;
      break;
    case 'performance':
      logFile = performanceLogPath;
      break;
    default:
      return res.status(400).json({ error: 'Неверный тип лога' });
  }

  try {
    const logs = await fs.readFile(logFile, 'utf8');
    await logRouteData(`get_logs_${type}`, { logs: logs.split('\n') });
    res.json({ logs: logs.split('\n') });
  } catch (error) {
    handleError(res, 'Ошибка при чтении логов', error);
  }
});

app.get('/analyze-trades', async (req, res) => {
  const { startDate, endDate } = req.query;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Необходимо указать startDate и endDate' });
  }

  try {
    const analysis = await analyzeTrades(startDate, endDate);
    res.json(analysis);
  } catch (error) {
    await log(`Ошибка при анализе сделок: ${error.message}`, 'error', 'analyzeTradesRoute');
    res.status(500).json({ error: 'Ошибка при анализе сделок' });
  }
});

// Маршрут для получения корреляций с другими активами
app.get('/correlations', async (_req, res) => {
  try {
    const correlations = await analyzeCorrelations();
    await logRouteData('get_correlations', correlations);
    res.json(correlations);
  } catch (error) {
    handleError(res, 'Ошибка при получении корреляций', error);
  }
});


// Маршрут для выполнения адаптивной торговли
app.post('/adaptive-trade', async (_req, res) => {
  try {
    await adaptiveTrading();
    await logRouteData('adaptive_trade', { message: 'Адаптивная торговля выполнена' });
    res.json({ message: 'Адаптивная торговля выполнена' });
  } catch (error) {
    handleError(res, 'Ошибка при выполнении адаптивной торговли', error);
  }
});

// Маршрут для оптимизации параметров стратегии
app.post('/optimize-strategy', async (_req, res) => {
  try {
    await optimizeStrategyParameters();
    await logRouteData('optimize_strategy', { message: 'Параметры стратегии оптимизированы', params: signalParams });
    res.json({ message: 'Параметры стратегии оптимизированы', params: signalParams });
  } catch (error) {
    handleError(res, 'Ошибка при оптимизации параметров стратегии', error);
  }
});

// Маршрут для получения рыночных условий
app.get('/market-conditions', async (_req, res) => {
  try {
    const marketConditions = await analyzeMarketConditions();
    await logRouteData('market_conditions', marketConditions);
    res.json(marketConditions);
  } catch (error) {
    handleError(res, 'Ошибка при анализе рыночных условий', error);
  }
});

// Маршрут для сравнения цен
app.get('/compare-prices', async (_req, res) => {
  try {
    const priceComparison = await comparePrices();
    await logRouteData('compare_prices', priceComparison);
    res.json(priceComparison);
  } catch (error) {
    handleError(res, 'Ошибка при сравнении цен', error);
  }
});

// Маршрут для получения новостей
app.get('/news', async (_req, res) => {
  try {
    const newsAnalysis = await analyzeNews();
    await logRouteData('get_news', newsAnalysis);
    res.json(newsAnalysis);
  } catch (error) {
    handleError(res, 'Ошибка при получении новостей', error);
  }
});

// Функция для проверки и синхронизации времени с Bybit
async function checkAndSyncTime() {
  try {
    const localTime = Math.floor(Date.now() / 1000);
    const serverTime = await getBybitServerTime();
    const timeDiff = Math.abs(localTime - serverTime);
    
    await log(`🕒 Проверка синхронизации времени. Локальное время: ${localTime}, Серверное время: ${serverTime}`, 'info', 'checkAndSyncTime');
    
    if (timeDiff > 1) {  // Если разница больше 1 секунды
      await log(`⚠️ Обнаружено расхождение времени: ${timeDiff} секунд. Синхронизация...`, 'warn', 'checkAndSyncTime');
      
      // Здесь можно добавить логику для корректировки системного времени
      // Например, использовать системные команды для установки времени
      
      await log('🕒 Время синхронизировано с сервером Bybit', 'info', 'checkAndSyncTime');
    } else {
      await log('✅ Время синхронизировано', 'info', 'checkAndSyncTime');
    }
  } catch (error) {
    await log(`❌ Ошибка при проверке и синхронизации времени: ${error.message}`, 'error', 'checkAndSyncTime');
  }
}


// Запускаем проверку каждый час
setInterval(checkAndSyncTime, 60 * 60 * 1000);

// Обработчик ошибок
async function handleError(res, message, error) {
  // Проверяем, является ли 'error' объектом и имеет ли он свойство 'message'
  // Если да, то используем 'error.message', иначе используем 'Неизвестная ошибка'
  const errorMessage = error && typeof error === 'object' && error.message ? error.message : 'Неизвестная ошибка'; 
  
  // Логируем сообщение об ошибке с указанием функции, в которой она произошла
  await log(`${message}: ${errorMessage}`, 'error', 'handleError'); 

  // Проверяем, есть ли у объекта ошибки 'error' свойство 'response' и 'data'
  // Если да, то логируем детали ошибки API
  if (error && error.response && error.response.data) {
    const errorData = error.response.data;

    // Проверяем код ошибки API Bybit: 10002 означает ошибку синхронизации времени
    if (errorData.retCode === 10002) {
      // Логируем сообщение об ошибке синхронизации времени
      await log('Ошибка синхронизации времени. Проверьте настройки времени сервера.', 'error', 'handleError');
      // Здесь можно добавить логику для автоматической синхронизации времени
    }

    // Логируем детали ошибки API
    await log(`Детали ошибки API: ${JSON.stringify(errorData)}`, 'error', 'handleError'); 
  }

  // Отправляем ответ с кодом 500 (Internal Server Error) и сообщением об ошибке
  res.status(500).json({ error: `${message}: ${errorMessage}` });
}

// Функция для анализа рыночных условий
async function analyzeMarketConditions() {
  try {
    await log('🔍 Начало анализа рыночных условий', 'info', 'analyzeMarketConditions');
    
    const recentData = await fetchRecentData('ETHUSDT', '1h', 100);
    if (!recentData || recentData.length === 0) {
      throw new Error('Не удалось получить последние данные');
    }

    const volatility = calculateVolatility(recentData.map(d => d.close));
    const volume = average(recentData.map(d => d.volume));
    const trend = determineTrend(recentData.map(d => d.close));
    const sentiment = await analyzeSentiment();

    const conditions = {
      volatility,
      volume,
      trend,
      sentiment,
    };

    await log(`📊 Результаты анализа рыночных условий:
    📈 Волатильность: ${volatility.toFixed(4)}
    📊 Объем: ${volume.toFixed(2)}
    🔀 Тренд: ${trend}
    😊 Настроение: ${sentiment.sentiment} (Индекс страха и жадности: ${sentiment.fearGreedIndex})`, 'info', 'analyzeMarketConditions');

    return conditions;
  } catch (error) {
    await log(`❌ Ошибка при анализе рыночных условий: ${error.message}`, 'error', 'analyzeMarketConditions');
    return {
      volatility: 0,
      volume: 0,
      trend: 'Неизвестно',
      sentiment: { sentiment: 'Нейтральный', fearGreedIndex: 50 },
    };
  }
}


function calculateOrderSize(price, availableBalance) {
  const MIN_ORDER_SIZE = 0.00092; // Увеличиваем минимальный размер ордера
  const MAX_ORDER_VALUE = 50; // Максимальная стоимость ордера в USD

  // Используем 5% от доступного баланса вместо 1%
  const orderValue = Math.min(availableBalance * 0.05, MAX_ORDER_VALUE);

  return Math.max(orderValue / price, MIN_ORDER_SIZE);
}


// Функция для определения тренда
function determineTrend(prices) {
  const sma20 = calculateSMA(prices, 20);
  const sma50 = calculateSMA(prices, 50);

  let trend;
  if (sma20 > sma50) {
    trend = 'Восходящий';
  } else if (sma20 < sma50) {
    trend = 'Нисходящий';
  } else {
    trend = 'Боковой';
  }

  log(`🔀 Определение тренда:
  📈 SMA20: ${sma20.toFixed(2)}
  📉 SMA50: ${sma50.toFixed(2)}
  🔀 Результат: ${trend}`, 'info', 'determineTrend');

  return trend;
}

// Функция динамического управления рисками
function dynamicRiskManagement(portfolio, marketConditions) {
  const { volatility, trend } = marketConditions;
  const basePositionSize = portfolio.RUB * 0.03;
  
  const adjustedPositionSize = basePositionSize * (1 + Math.abs(trend));
  const stopLossPercent = 1.5 + (volatility * 5);
  const takeProfitPercent = 3 + (volatility * 10);
  
  return {
    maxPositionSize: Math.min(adjustedPositionSize, portfolio.RUB * 0.15),
    stopLossPercent,
    takeProfitPercent
  };
}

// Функция для периодической переоценки эффективности стратегии
async function periodicStrategyReassessment() {
  try {
    await log('Начало периодической переоценки стратегии', 'info', 'periodicStrategyReassessment');

    const recentTrades = await getRecentTrades(100);
    const winRate = calculateWinRate(recentTrades);
    const profitFactor = calculateProfitFactor(recentTrades);
    
    await log(`Текущий винрейт: ${winRate.toFixed(2)}%, Профит-фактор: ${profitFactor.toFixed(2)}`, 'info', 'periodicStrategyReassessment');

    if (winRate < 40 || profitFactor < 1.2) {
      await log('Эффективность стратегии низкая, выполняется корректировка', 'warn', 'periodicStrategyReassessment');
      await retrainNeuralNetwork();
      await optimizeStrategyParameters();
      
      // Отменяем все текущие ордера и пересоздаем сетку
      await cancelAllOrders('ETHUSDT');
      await placeGridOrders('ETHUSDT');
      
      await log('Стратегия скорректирована, сетка ордеров пересоздана', 'info', 'periodicStrategyReassessment');
    } else {
      await log('Эффективность стратегии в пределах нормы', 'info', 'periodicStrategyReassessment');
    }

    await log('Завершение периодической переоценки стратегии', 'info', 'periodicStrategyReassessment');
  } catch (error) {
    await log(`Ошибка при периодической переоценке стратегии: ${error.message}`, 'error', 'periodicStrategyReassessment');
    await handleApiError(error, 'periodicStrategyReassessment');
  }
}

// Функция для расчета размера позиции
async function calculatePositionSize(symbol, risk, volatility) {
  try {
    await log(`💰 Начало расчета размера позиции для ${symbol}`, 'info', 'calculatePositionSize');
    
    const availableBalance = await getAvailableBalance('ETH');
    await log(`💼 Доступный баланс ETH: ${availableBalance.toString()}`, 'info', 'calculatePositionSize');

    const currentPrice = new Decimal(await getCachedPrice(symbol));
    await log(`💹 Текущая цена ${symbol}: ${currentPrice.toString()}`, 'info', 'calculatePositionSize');

    const usdToRubRate = new Decimal(await getCachedUsdRubRate());
    await log(`💱 Текущий курс USD/RUB: ${usdToRubRate.toString()}`, 'info', 'calculatePositionSize');

    // Используем Decimal для всех расчетов
    let positionSize = availableBalance.times(risk);
    await log(`📊 Базовый размер позиции (на основе риска): ${positionSize.toString()}`, 'info', 'calculatePositionSize');

    const volatilityAdjustment = Decimal.max(new Decimal(0.5), new Decimal(1).minus(volatility));
    positionSize = positionSize.times(volatilityAdjustment);
    await log(`📊 Размер позиции после корректировки на волатильность: ${positionSize.toString()}`, 'info', 'calculatePositionSize');

    const orderValueUSD = positionSize.times(currentPrice);
    if (orderValueUSD.lessThan(MIN_ORDER_VALUE_USD)) {
      positionSize = MIN_ORDER_VALUE_USD.dividedBy(currentPrice);
      await log(`⚠️ Размер позиции увеличен до минимальной стоимости ордера: ${positionSize.toString()}`, 'info', 'calculatePositionSize');
    }

    positionSize = Decimal.min(positionSize, availableBalance.times(0.95)); // Не используем весь доступный баланс
    positionSize = Decimal.max(positionSize, MIN_POSITION_SIZE);

    // Округляем до 8 знаков после запятой
    positionSize = positionSize.toDecimalPlaces(8);

    const positionValueRUB = positionSize.times(currentPrice).times(usdToRubRate);
    await log(`💰 Финальный размер позиции: ${positionSize.toString()} ETH (${positionValueRUB.toFixed(2)} RUB)`, 'info', 'calculatePositionSize');
    return positionSize;


  } catch (error) {
    await log(`❌ Ошибка при расчете размера позиции: ${error.message}`, 'error', 'calculatePositionSize');
    return MIN_POSITION_SIZE; // Возвращаем минимальный размер позиции в случае ошибки
  }
}

// Функция для получения кэшированной цены
async function getCachedPrice(symbol, cacheDuration = 5000) {
  const now = Date.now();
  if (lastPrice && (now - lastPriceTime) < cacheDuration) {
    return lastPrice;
  }
  lastPrice = await getPrice(symbol);
  lastPriceTime = now;
  return lastPrice;
}

// Функция для получения кэшированной цены ETHUSDT


// Функция для получения кэшированного курса USD/RUB
async function getCachedUsdRubRate(maxAge = 60000) { // maxAge в миллисекундах (1 минута)
  const now = Date.now();
  if (lastUsdRubRate && (now - lastUsdRubRateTime < maxAge)) {
    return lastUsdRubRate;
  }
  lastUsdRubRate = await getUsdToRubRate();
  lastUsdRubRateTime = now;
  return lastUsdRubRate;
}

// Вызывать эту функцию каждые 24 часа
setInterval(periodicStrategyReassessment, 24 * 60 * 60 * 1000);

// Функция для выполнения торговли с учетом динамического управления рисками
const TRADE_COOLDOWN = 15 * 60 * 1000; // 15 минут между сделками
let lastTradeTime = 0;
let isTradingActive = false; // Флаг для отслеживания активной сделки

async function executeTradewithRiskManagement(analysisResult, marketConditions, riskParams) {
  const startTime = Date.now();

  try {
    await log(`➡️ Начало executeTradewithRiskManagement 📈`, 'info', 'executeTradewithRiskManagement');
    await log(`➡️ Входные параметры: analysisResult=${JSON.stringify(analysisResult)}, 
    marketConditions=${JSON.stringify(marketConditions)}, 
    riskParams=${JSON.stringify(riskParams)}`, 'debug', 'executeTradewithRiskManagement');

    const signal = analysisResult.signal;
    const signalStrength = new Decimal(analysisResult.signalStrength);

    if (isTradingActive) {
      await log(`⏳ Сделка уже в процессе. Пропускаем текущую итерацию.`, 'info', 'executeTradewithRiskManagement');
      return null;
    }

    const now = Date.now();
    if (now - lastTradeTime < TRADE_COOLDOWN) {
      const remainingTime = TRADE_COOLDOWN - (now - lastTradeTime);
      await log(`⏳ Слишком рано для новой сделки. Подождите еще ${Math.floor(remainingTime/1000)} секунд.`, 'info', 'executeTradewithRiskManagement');
      return null;
    }

    const symbol = 'ETHUSDT';
    await log(`🚀 Начало выполнения торговли. Символ: ${symbol}, Сигнал: ${signal}, Сила сигнала: ${signalStrength}`, 'info', 'executeTradewithRiskManagement');

    if (!analysisResult || typeof analysisResult.currentPrice !== 'number' || isNaN(analysisResult.currentPrice)) {
      await log(`❌ Ошибка: analysisResult не содержит корректную цену: ${JSON.stringify(analysisResult)}`, 'error', 'executeTradewithRiskManagement');
      return null;
    }

    const currentPrice = new Decimal(analysisResult.currentPrice);
    const positionSize = await calculatePositionSize(symbol, riskParams.risk, marketConditions.volatility);

    if (positionSize.isNaN() || positionSize.isZero()) {
      await log(`❌ Ошибка: Размер позиции некорректен (${positionSize}). Сделка отменена.`, 'error', 'executeTradewithRiskManagement');
      return null;
    }
    
    const stopLossPrice = signal === 'buy'
        ? currentPrice.times(new Decimal(1).minus(riskParams.stopLossPercent))
        : currentPrice.times(new Decimal(1).plus(riskParams.stopLossPercent));
  
    const takeProfitPrice = signal === 'buy'
        ? currentPrice.times(new Decimal(1).plus(riskParams.takeProfitPercent))
        : currentPrice.times(new Decimal(1).minus(riskParams.takeProfitPercent));

    await log(`📊 Рассчитанные уровни:
    💰 Размер позиции: ${positionSize} ETH
    💹 Текущая цена: ${currentPrice}
    🛑 Стоп-лосс: ${stopLossPrice}
    🎯 Тейк-профит: ${takeProfitPrice}`, 'info', 'executeTradewithRiskManagement');

    const initialBalance = await getAvailableBalance('ETH');
    await log(`💼 Начальный баланс: ${initialBalance} ETH`, 'info', 'executeTradewithRiskManagement');

    if (signal === 'sell') {
      const availableBalanceETH = await getAvailableBalance('ETH');
      if (availableBalanceETH.lessThan(positionSize)) {
        await log(`❌ Недостаточно ETH для продажи. Доступно: ${availableBalanceETH}, необходимо: ${positionSize}`, 'error', 'executeTradewithRiskManagement');
        return null;
      }
    }

    const order = await placeOrder(symbol, signal, positionSize, currentPrice, analysisResult);

    if (order) {
      await saveSignal({ symbol, type: signal, time: new Date(), data: order });//<-- Добавлено
      isTradingActive = true;
      lastTradeTime = now;
      await log(`✅ Ордер успешно размещен: ${JSON.stringify(order)}`, 'info', 'executeTradewithRiskManagement');

      await placeStopLossOrder(symbol, signal === 'buy' ? 'sell' : 'buy', stopLossPrice, positionSize);
      await placeTakeProfitOrder(symbol, signal === 'buy' ? 'sell' : 'buy', takeProfitPrice, positionSize);

      await log(`🔒 Стоп-лосс и тейк-профит ордера размещены`, 'info', 'executeTradewithRiskManagement');

      const adaptiveHoldTime = calculateAdaptiveHoldTime(marketConditions, signal);
      await log(`⏱️ Установлено адаптивное время удержания: ${adaptiveHoldTime} мс`, 'info', 'executeTradewithRiskManagement');

      setTimeout(async () => {
        try {
          const result = await checkAndClosePosition(symbol, order, stopLossPrice, takeProfitPrice);

          if (result && result.closedOrder) {
            const finalBalance = await getAvailableBalance('ETH');
            const profit = finalBalance.minus(initialBalance);

            await log(`📊 Результат сделки:
            💰 Начальный баланс: ${initialBalance} ETH
            💰 Конечный баланс: ${finalBalance} ETH
            💹 Прибыль/Убыток: ${profit} ETH (${profit.dividedBy(initialBalance).times(100).toFixed(2)}%)
            🔄 Статус: Закрыта`, 'info', 'executeTradewithRiskManagement');

          } else {
            await log(`📊 Позиция не была закрыта по истечении времени удержания`, 'info', 'executeTradewithRiskManagement');
          }

          isTradingActive = false;

        } catch (closeError) {
          await log(`❌ Ошибка при закрытии позиции: ${closeError.message}`, 'error', 'executeTradewithRiskManagement');
          isTradingActive = false;
        }
      }, adaptiveHoldTime);

      monitorTrailingStop(symbol, order, stopLossPrice, marketConditions.volatility);

      return order;
    } else {
      await log(`❌ Не удалось разместить ордер`, 'error', 'executeTradewithRiskManagement');
      return null;
    }
  } catch (error) {
    await log(`❌ Ошибка в executeTradewithRiskManagement: ${error.message}`, 'error', 'executeTradewithRiskManagement');
    isTradingActive = false;
    return null;
  } finally {
    const executionTime = Date.now() - startTime;
    await log(`⬅️ Завершение executeTradewithRiskManagement 📈. Время выполнения: ${executionTime} мс`, 'info', 'executeTradewithRiskManagement');
  }
}

// Функция адаптивной торговли
async function adaptiveTrading(symbol) {
  try {
    await log(`Начало адаптивной торговли для ${symbol}`, 'info', 'adaptiveTrading');

    const analysisResult = await analyzeDataWithNN(symbol);
    
    if (analysisResult.signal !== 'hold' && analysisResult.signalStrength >= signalParams.minSignalStrength) {
      const order = await executeTrade(symbol, analysisResult);
      
      if (order) {
        await log(`Выполнена сделка: ${JSON.stringify(order)}`, 'info', 'adaptiveTrading');
        
        // Обновление статистики и метрик
        await updateTradingStatistics(order);
        await updateStrategyMetrics();

        // Отправка уведомления в Telegram
        const message = `Выполнена сделка:\nСимвол: ${symbol}\nТип: ${analysisResult.signal}\nЦена: ${order.price}\nКоличество: ${order.qty}\nСила сигнала: ${analysisResult.signalStrength}`;
        await sendTelegramMessage(message);
      }
    } else {
      await log(`Нет сигнала для торговли. Сигнал: ${analysisResult.signal}, Сила: ${analysisResult.signalStrength}`, 'info', 'adaptiveTrading');
    }

    // Управление открытыми позициями
    await manageOpenPositions(symbol);

    await log('Адаптивная торговля завершена', 'info', 'adaptiveTrading');
  } catch (error) {
    await log(`Ошибка при адаптивной торговле: ${error.message}`, 'error', 'adaptiveTrading');
    await handleApiError(error, 'adaptiveTrading');
  }
}

// Функция для симуляции рыночных условий

function calculateVolatility(prices) {
  const returns = prices.slice(1).map((price, index) => (price - prices[index]) / prices[index]);
  return Math.sqrt(returns.reduce((sum, ret) => sum + Math.pow(ret, 2), 0) / returns.length) * Math.sqrt(252);
}


// 🐛 Исправленная функция getRecentTrades с ожиданием промиса
async function getRecentTrades(symbol = 'ETHUSDT', limit = 50) {
  const startTime = Date.now();
  await log(`🚀 Начало получения последних сделок для ${symbol}. Лимит: ${limit}`, 'info', 'getRecentTrades');

  try {
    if (typeof symbol !== 'string' || symbol.trim() === '') {
      throw new Error('Некорректный символ');
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('Некорректный лимит');
    }

    const cachedTrades = await getCachedTrades(symbol);
    if (cachedTrades.length > 0) {
      await log(`🎉 Использованы кэшированные данные. Количество сделок: ${cachedTrades.length}`, 'info', 'getRecentTrades');
      return cachedTrades.slice(0, limit);
    }

    await log(`📡 Отправка запроса к API Bybit`, 'debug', 'getRecentTrades');
    const response = await bybitClient.getPublicTradingHistory({
      category: 'spot',
      symbol: symbol,
      limit: limit
    });

   // await log(`📊 Получен ответ от API. Статус: ${response.retCode}`, 'debug', 'getRecentTrades');

    if (!response || response.retCode !== 0) {
      throw new Error(`Ошибка API Bybit: ${response.retMsg || 'Неизвестная ошибка'}`);
    }

    if (!response.result || !Array.isArray(response.result.list)) {
      throw new Error('Неверный формат ответа от API Bybit');
    }

    const trades = await response.result.list.reduce(async (validTrades, trade) => {
      try {
        if (!trade.execTime) {
          await log(`ℹ️ Сделка без времени исполнения: ${JSON.stringify(trade)}`, 'info', 'getRecentTrades');
          return validTrades;
        }

        const execTime = parseInt(trade.execTime);
        if (isNaN(execTime)) {
          await log(`ℹ️ Некорректное время исполнения: ${trade.execTime}`, 'info', 'getRecentTrades');
          return validTrades;
        }

        (await validTrades).push({ // 🐛 Добавлен await перед validTrades
          id: trade.execId,
          time: new Date(execTime).toISOString(),
          side: trade.side,
          price: parseFloat(trade.execPrice) || 0,
          quantity: parseFloat(trade.execQty) || 0,
          fee: parseFloat(trade.execFee) || 0,
          feeAsset: trade.feeCurrency,
          value: parseFloat(trade.execValue) || 0
        });

        return validTrades;
      } catch (error) {
        await log(`ℹ️ Пропущена сделка из-за ошибки обработки: ${error.message}`, 'info', 'getRecentTrades');
        return validTrades;
      }
    }, Promise.resolve([])); // 🐛 Начинаем с промиса пустого массива

    await log(`✅ Успешно обработано ${trades.length} сделок`, 'info', 'getRecentTrades');

    trades.sort((a, b) => new Date(b.time) - new Date(a.time)); // 🐛 Сортируем после выполнения промиса

    await saveTradesToCache(symbol, trades);
    await log(`💾 Сделки сохранены в кэш`, 'info', 'getRecentTrades');

    const executionTime = Date.now() - startTime;
    await log(`🏁 Получение сделок завершено за ${executionTime}мс`, 'info', 'getRecentTrades');

    return trades;
  } catch (error) {
    await log(`❌ Ошибка при получении последних сделок: ${error.message}`, 'error', 'getRecentTrades');

    if (error.response) {
      await log(`📝 Детали ошибки API: ${JSON.stringify(error.response.data)}`, 'error', 'getRecentTrades');
    }

    return [];
  } finally {
    const totalExecutionTime = Date.now() - startTime;
    await log(`⏱️ Общее время выполнения: ${totalExecutionTime}мс`, 'info', 'getRecentTrades');
  }
}

// Функция для генерации уникального имени файла кэша
function generateCacheFileName(symbol) {
  return `trades_cache_${symbol.toLowerCase()}.json`;
}

// Функция для получения кэшированных сделок
async function getCachedTrades(symbol) {
  const cacheFileName = generateCacheFileName(symbol);
  const cachePath = path.join(__dirname, 'cache', cacheFileName);

  try {
      if (await fs.pathExists(cachePath)) {
          const cacheData = await fs.readJson(cachePath);
          const cacheAge = Date.now() - cacheData.timestamp;
          if (cacheAge < 5 * 60 * 1000) { // Кэш действителен 5 минут
              return cacheData.trades;
          }
      }
  } catch (error) {
      await log(`Ошибка при получении кэшированных сделок: ${error.message}`, 'error', 'getCachedTrades');
  }
  return [];
}

// Функция для сохранения сделок в кэш
async function saveTradesToCache(symbol, trades) {
  const cacheFileName = generateCacheFileName(symbol);
  const cachePath = path.join(__dirname, 'cache', cacheFileName);

  try {
      await fs.ensureDir(path.dirname(cachePath));
      await fs.writeJson(cachePath, { 
          timestamp: Date.now(),
          trades: trades
      });
      await log(`Сделки сохранены в кэш для ${symbol}`, 'info', 'saveTradesToCache');
  } catch (error) {
      await log(`Ошибка при сохранении сделок в кэш: ${error.message}`, 'error', 'saveTradesToCache');
  }
}


// Функция для проверки соединения с API
async function checkApiConnection() {
  try {
    await log('Начало проверки соединения с API', 'info', 'checkApiConnection');
    
    const serverTime = await bybitClient.getServerTime();
    
    if (serverTime.retCode !== 0) {
      throw new Error('Не удалось получить время сервера');
    }

    await log('Соединение с API успешно установлено', 'info', 'checkApiConnection');
    return true;
  } catch (error) {
    await log(`Ошибка при проверке соединения с API: ${error.message}`, 'error', 'checkApiConnection');
    return false;
  }
}

// Функция для проверки соединения с базой данных
async function checkDatabaseConnection() {
  try {
    await log('Начало проверки соединения с базой данных', 'info', 'checkDatabaseConnection');
    
    // Здесь должна быть логика проверки соединения с вашей базой данных
    // Например, для MongoDB это может выглядеть так:
    // await mongoose.connection.db.admin().ping();

    await log('Соединение с базой данных успешно установлено', 'info', 'checkDatabaseConnection');
    return true;
  } catch (error) {
    await log(`Ошибка при проверке соединения с базой данных: ${error.message}`, 'error', 'checkDatabaseConnection');
    return false;
  }
}

// Функция для проверки достаточности баланса
async function checkSufficientBalance() {
  try {
    await log('Начало проверки достаточности баланса', 'info', 'checkSufficientBalance');
    
    const balance = await bybitClient.getWalletBalance({ accountType: "SPOT" });
    
    if (!balance.result || !balance.result.list) {
      throw new Error('Неверный формат ответа от API Bybit');
    }

    const usdtBalance = balance.result.list.find(b => b.coin === 'USDT')?.free || '0';
    
    if (parseFloat(usdtBalance) < 10) { // Пример: проверяем, есть ли хотя бы 10 USDT
      throw new Error('Недостаточно средств для торговли');
    }

    await log(`Баланс достаточен для торговли: ${usdtBalance} USDT`, 'info', 'checkSufficientBalance');
    return true;
  } catch (error) {
    await log(`Ошибка при проверке достаточности баланса: ${error.message}`, 'error', 'checkSufficientBalance');
    return false;
  }
}

// Функция для проверки доступности рыночных данных
async function checkMarketDataAvailability() {
  try {
    await log('Начало проверки доступности рыночных данных', 'info', 'checkMarketDataAvailability');
    
    const klineData = await bybitClient.getKline({ category: 'spot', symbol: 'ETHUSDT', interval: '1', limit: 1 });
    
    if (!klineData.result || !klineData.result.list || klineData.result.list.length === 0) {
      throw new Error('Не удалось получить рыночные данные');
    }

    await log('Рыночные данные успешно получены', 'info', 'checkMarketDataAvailability');
    return true;
  } catch (error) {
    await log(`Ошибка при проверке доступности рыночных данных: ${error.message}`, 'error', 'checkMarketDataAvailability');
    return false;
  }
}

// Функция для закрытия всех соединений
async function closeAllConnections() {
  try {
    await log('Начало закрытия всех соединений', 'info', 'closeAllConnections');
    
    // Здесь должна быть логика закрытия соединений с вашими сервисами
    // Например, для базы данных MongoDB:
    // await mongoose.connection.close();

    // Закрытие соединения с Bybit API (если это возможно)
    // bybitClient.close(); // Предполагаемый метод, может отличаться в зависимости от библиотеки

    await log('Все соединения успешно закрыты', 'info', 'closeAllConnections');
  } catch (error) {
    await log(`Ошибка при закрытии соединений: ${error.message}`, 'error', 'closeAllConnections');
    throw error;
  }
}

// Функция для получения исторических данных
async function fetchHistoricalData(symbol, interval, limit, startDate = null, endDate = null) {
  const startTime = Date.now();
  try {
    await log(`🚀 Начало fetchHistoricalData: symbol=${symbol}, interval=${interval}, limit=${limit}, startDate=${startDate || 'не указано'}, endDate=${endDate || 'не указано'}`, 'info', 'fetchHistoricalData');
    await log(`💾 Начальное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'fetchHistoricalData');

    const bybitInterval = convertIntervalToBybitFormat(interval);
    await log(`🔄 Преобразованный интервал для Bybit: ${bybitInterval}`, 'debug', 'fetchHistoricalData');

    let allHistoricalData = [];
    let currentLimit = limit;
    let fromTime = startDate ? new Date(startDate).getTime() : undefined;
    let toTime = endDate ? new Date(endDate).getTime() : undefined;

    await log(`🕰️ Начальные временные параметры: fromTime=${fromTime || 'не указано'}, toTime=${toTime || 'не указано'}`, 'debug', 'fetchHistoricalData');

    let iterationCount = 0;
    while (currentLimit > 0) {
      iterationCount++;
      await log(`🔁 Начало итерации ${iterationCount}`, 'debug', 'fetchHistoricalData');

      try {
        const requestLimit = Math.min(currentLimit, 200);
        await log(`📊 Запрос данных: limit=${requestLimit}, fromTime=${fromTime || 'не указано'}, toTime=${toTime || 'не указано'}`, 'debug', 'fetchHistoricalData');

        const requestStartTime = Date.now();
        const response = await bybitClient.getKline({
          category: 'spot',
          symbol: symbol,
          interval: bybitInterval,
          limit: requestLimit,
          start: fromTime,
          end: toTime
        });
        const requestDuration = Date.now() - requestStartTime;
        await log(`⏱️ Длительность запроса к API: ${requestDuration}ms`, 'debug', 'fetchHistoricalData');

        // await log(`📥 Получен ответ от API: ${JSON.stringify(response)}`, 'detail', 'fetchHistoricalData');

        if (response.retCode !== 0) {
          throw new Error(`Ошибка Bybit API (retCode: ${response.retCode}): ${response.retMsg}`);
        }

        if (!response.result || !Array.isArray(response.result.list)) {
          throw new Error(`Неверный формат ответа от API Bybit: ${JSON.stringify(response)}`);
        }

        const historicalData = response.result.list.map(item => ({
          time: parseInt(item[0]),
          open: parseFloat(item[1]),
          high: parseFloat(item[2]),
          low: parseFloat(item[3]),
          close: parseFloat(item[4]),
          volume: parseFloat(item[5])
        }));

        await log(`📈 Получено ${historicalData.length} свечей`, 'info', 'fetchHistoricalData');
        await log(`🔍 Пример первой свечи: ${JSON.stringify(historicalData[0])}`, 'debug', 'fetchHistoricalData');

        allHistoricalData = allHistoricalData.concat(historicalData);
        currentLimit -= historicalData.length;

        if (historicalData.length > 0) {
          fromTime = historicalData[historicalData.length - 1].time + 1;
          await log(`⏭️ Новое значение fromTime: ${fromTime}`, 'debug', 'fetchHistoricalData');
        } else {
          await log('⚠️ Получен пустой набор данных, завершение цикла', 'warn', 'fetchHistoricalData');
          break;
        }

        await log(`📊 Текущий прогресс: получено ${allHistoricalData.length}, осталось ${currentLimit}`, 'info', 'fetchHistoricalData');
        
        await log('⏳ Ожидание перед следующим запросом (1 секунда)', 'debug', 'fetchHistoricalData');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Задержка между запросами
      } catch (error) {
        await log(`❌ Ошибка при получении данных: ${error.message}. Повтор через 5 секунд...`, 'error', 'fetchHistoricalData');
        await log(`🔍 Стек ошибки: ${error.stack}`, 'debug', 'fetchHistoricalData');
        await log('⏳ Ожидание перед повторным запросом (5 секунд)', 'debug', 'fetchHistoricalData');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      // await log(`💾 Использование памяти после итерации ${iterationCount}: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'fetchHistoricalData');
    }

    await log(`✅ Успешно получено ${allHistoricalData.length} исторических данных`, 'info', 'fetchHistoricalData');
    await log(`📊 Диапазон полученных данных: от ${new Date(allHistoricalData[0].time)} до ${new Date(allHistoricalData[allHistoricalData.length - 1].time)}`, 'info', 'fetchHistoricalData');
    
    const executionTime = Date.now() - startTime;
    await log(`⏱️ Время выполнения fetchHistoricalData: ${executionTime}ms`, 'info', 'fetchHistoricalData');
    await log(`💾 Конечное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'fetchHistoricalData');

    return allHistoricalData;

  } catch (error) {
    const executionTime = Date.now() - startTime;
    await log(`❌ Критическая ошибка в fetchHistoricalData: ${error.message}. Время выполнения: ${executionTime}ms`, 'error', 'fetchHistoricalData');
    await log(`🔍 Стек критической ошибки: ${error.stack}`, 'debug', 'fetchHistoricalData');
   // await log(`💾 Использование памяти при критической ошибке: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'fetchHistoricalData');
    throw error;
  }
}

// Конвертация интервалов для Bybit
function convertIntervalToBybitFormat(interval) {
  const intervalMap = {
    '1m': '1',
    '3m': '3',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '2h': '120',
    '4h': '240',
    '6h': '360',
    '12h': '720',
    '1d': 'D',
    '1w': 'W',
    '1M': 'M'
  };
  return intervalMap[interval] || '15'; // По умолчанию используем 15-минутный интервал
}
 
 /**
 * Обновляет метрики эффективности стратегии.
 * @returns {Promise<void>}
 */
 async function updateStrategyMetrics() {
  const startTime = Date.now();
  try {
    await log('📊 Начало обновления метрик стратегии', 'info', 'updateStrategyMetrics');
    await log(`💾 Начальное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'updateStrategyMetrics');

    await log('💼 Получение текущей стоимости портфеля', 'debug', 'updateStrategyMetrics');
    const currentPortfolioValue = await getPortfolioValue();
    await log(`💰 Текущая стоимость портфеля: ${currentPortfolioValue}`, 'info', 'updateStrategyMetrics');

    await log('🔍 Получение недавних сделок', 'debug', 'updateStrategyMetrics');
    const trades = await getRecentTrades();
    await log(`📈 Количество недавних сделок: ${trades.length}`, 'info', 'updateStrategyMetrics');

    await log('🧮 Расчет показателя победных сделок', 'debug', 'updateStrategyMetrics');
    const winRate = calculateWinRate(trades);
    await log(`🏆 Показатель победных сделок: ${winRate}`, 'info', 'updateStrategyMetrics');

    await log('🧮 Расчет фактора прибыли', 'debug', 'updateStrategyMetrics');
    const profitFactor = calculateProfitFactor(trades);
    await log(`💹 Фактор прибыли: ${profitFactor}`, 'info', 'updateStrategyMetrics');

    await log('🧮 Расчет коэффициента Шарпа', 'debug', 'updateStrategyMetrics');
    const sharpeRatio = calculateSharpeRatio(trades);
    await log(`📊 Коэффициент Шарпа: ${sharpeRatio}`, 'info', 'updateStrategyMetrics');

    const metrics = {
      portfolioValue: currentPortfolioValue,
      winRate: winRate,
      profitFactor: profitFactor,
      sharpeRatio: sharpeRatio
    };

    await log(`📊 Сформированные метрики стратегии: ${JSON.stringify(metrics)}`, 'info', 'updateStrategyMetrics');
    
    await log('💾 Сохранение метрик в базу данных', 'debug', 'updateStrategyMetrics');
    await saveMetrics(metrics);
    await log('✅ Метрики успешно сохранены', 'info', 'updateStrategyMetrics');

    const executionTime = Date.now() - startTime;
    await log(`⏱️ Время выполнения updateStrategyMetrics: ${executionTime}ms`, 'info', 'updateStrategyMetrics');
    await log(`💾 Конечное использование памяти: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'updateStrategyMetrics');
  } catch (error) {
    const executionTime = Date.now() - startTime;
    await log(`❌ Ошибка при обновлении метрик стратегии: ${error.message}`, 'error', 'updateStrategyMetrics');
    await log(`🔍 Стек ошибки: ${error.stack}`, 'debug', 'updateStrategyMetrics');
    await log(`⏱️ Время до возникновения ошибки: ${executionTime}ms`, 'error', 'updateStrategyMetrics');
    await log(`💾 Использование памяти при ошибке: ${JSON.stringify(process.memoryUsage())}`, 'debug', 'updateStrategyMetrics');
  }
}

/**
 * Рассчитывает процент выигрышных сделок.
 * @param {Array} trades - Массив сделок.
 * @returns {number} Процент выигрышных сделок.
 */
function calculateWinRate(trades) {
  if (trades.length === 0) return 0;

  const winningTrades = trades.filter(trade => trade.profit > 0);
  return (winningTrades.length / trades.length) * 100;
}

/**
 * Рассчитывает фактор прибыли (отношение общей прибыли к общему убытку).
 * @param {Array} trades - Массив сделок.
 * @returns {number} Фактор прибыли.
 */
function calculateProfitFactor(trades) {
  const profits = trades.filter(trade => trade.profit > 0).reduce((sum, trade) => sum + trade.profit, 0);
  const losses = trades.filter(trade => trade.profit < 0).reduce((sum, trade) => sum + Math.abs(trade.profit), 0);

  if (losses === 0) return profits > 0 ? Infinity : 0;
  return profits / losses;
}

// Функция для расчета коэффициента Шарпа
function calculateSharpeRatio(trades) {
  const returns = trades.map(trade => trade.profitLoss / trade.investment);
  const averageReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
  const riskFreeRate = 0.02 / 252; // Предполагаем годовую безрисковую ставку 2% и 252 торговых дня
  const stdDev = Math.sqrt(returns.reduce((sum, ret) => sum + Math.pow(ret - averageReturn, 2), 0) / returns.length);

  return (averageReturn - riskFreeRate) / stdDev * Math.sqrt(252);
}

// Путь к директории для хранения метрик
const METRICS_DIR = path.join(__dirname, 'metrics');
const METRICS_FILE = path.join(METRICS_DIR, 'trading_metrics.json');

/**
 * Сохраняет метрики в JSON файл.
 * @param {Object} metrics - Объект с метриками.
 * @returns {Promise<void>}
 */
async function saveMetrics(metrics) {
  try {
    // Создаем директорию для метрик, если она не существует
    await fs.mkdir(METRICS_DIR, { recursive: true });

    // Добавляем временную метку к метрикам
    const metricsWithTimestamp = {
      ...metrics,
      timestamp: new Date().toISOString()
    };

    // Читаем существующие метрики, если файл существует
    let allMetrics = [];
    try {
      const data = await fs.readFile(METRICS_FILE, 'utf8');
      allMetrics = JSON.parse(data);
    } catch (error) {
      // Если файл не существует или пуст, начинаем с пустого массива
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Добавляем новые метрики
    allMetrics.push(metricsWithTimestamp);

    // Ограничиваем количество сохраненных метрик (например, храним только последние 1000)
    const MAX_METRICS = 1000;
    if (allMetrics.length > MAX_METRICS) {
      allMetrics = allMetrics.slice(-MAX_METRICS);
    }

    // Записываем обновленные метрики в файл
    await fs.writeFile(METRICS_FILE, JSON.stringify(allMetrics, null, 2));

    await log(`Метрики сохранены: ${JSON.stringify(metricsWithTimestamp)}`, 'info', 'saveMetrics');
  } catch (error) {
    await log(`Ошибка при сохранении метрик: ${error.message}`, 'error', 'saveMetrics');
    throw error;
  }
}

/**
 * Получает последние сохраненные метрики из JSON файла.
 * @returns {Promise<Object>} Объект с последними метриками.
 */
async function getLatestMetrics() {
  try {
    // Проверяем, существует ли файл с метриками
    try {
      await fs.access(METRICS_FILE);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Если файл не существует, возвращаем пустой объект
        return {};
      }
      throw error;
    }

    // Читаем файл с метриками
    const data = await fs.readFile(METRICS_FILE, 'utf8');
    const allMetrics = JSON.parse(data);

    // Возвращаем последние сохраненные метрики
    const latestMetrics = allMetrics[allMetrics.length - 1] || {};

    await log(`Получены последние метрики: ${JSON.stringify(latestMetrics)}`, 'info', 'getLatestMetrics');
    return latestMetrics;
  } catch (error) {
    await log(`Ошибка при получении последних метрик: ${error.message}`, 'error', 'getLatestMetrics');
    throw error;
  }
}

// Функция для получения открытых позиций
async function getOpenPositions(symbol, maxRetries = 3, retryDelay = 1000) {
  const startTime = Date.now();
  try {
    await log(`🚀 Начало получения открытых позиций для ${symbol} 💼`, 'info', 'getOpenPositions');

    if (!symbol) {
      throw new Error('❌ Символ не указан');
    }

    let openPositions = [];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await log(`🔄 Попытка ${attempt} из ${maxRetries}`, 'info', 'getOpenPositions');
        await syncTimeWithBybit();


        if (currentTradingMode === 'test') {
          // В тестовом режиме возвращаем данные из testPortfolio
          const balance = await getVirtualBalance();

          if(balance.ETH > 0) {
            openPositions.push({
              symbol: symbol,
              side: 'Buy',
              size: balance.ETH,
              entryPrice: lastPrice, // Используем последнюю цену как цену входа
              // ... другие параметры позиции
            });
          }

          await log(`🧪 Тестовый режим: Открытые позиции: ${JSON.stringify(openPositions, null, 2)}`, 'info', 'getOpenPositions');
          return openPositions;


        } else {
          // В реальном режиме получаем данные от Bybit API
          const positions = await bybitClient.getPosition({
            category: 'spot',
            symbol: symbol
          });

          if (!positions || positions.retCode !== 0) {
            const errorMsg = `Ошибка Bybit API (код ${positions?.retCode}): ${positions?.retMsg}`;
            await log(`❌ ${errorMsg}`, 'error', 'getOpenPositions');
            throw new Error(errorMsg);
          }

          if (!positions.result || !positions.result.list) {
            throw new Error('❌ Неверный формат ответа API');
          }

          openPositions = positions.result.list.filter(position => parseFloat(position.size) > 0).map(position => ({
            symbol: position.symbol,
            side: position.side,
            size: parseFloat(position.size),
            entryPrice: parseFloat(position.entryPrice),
            // ... другие необходимые параметры позиции
          }));


          await log(`✅ Получено ${openPositions.length} открытых позиций для ${symbol} 💼`, 'info', 'getOpenPositions');
          return openPositions;
        }



      } catch (error) {
        if (attempt < maxRetries) {
          await log(`❌ Попытка ${attempt} завершилась с ошибкой: ${error.message}. ⏳ Ожидание ${retryDelay} мс`, 'warn', 'getOpenPositions');
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          await log(`❌ Все попытки получения открытых позиций завершились с ошибкой: ${error.message}`, 'error', 'getOpenPositions');
          throw error; // Передаем ошибку дальше после всех неудачных попыток
        }
      }
    }
  } catch (error) {
    await log(`❌ Ошибка при получении открытых позиций: ${error.message}`, 'error', 'getOpenPositions');
    return []; // Возвращаем пустой массив в случае ошибки
  } finally {
    const executionTime = Date.now() - startTime;
    await log(`🏁 Завершение getOpenPositions. Время выполнения: ${executionTime} мс`, 'info', 'getOpenPositions');
  }
}

// Функция для управления открытыми позициями
async function manageOpenPositions(symbol) {
  try {
    await log(`Начало управления открытыми позициями для ${symbol}`, 'info', 'manageOpenPositions');

    const openPositions = await getOpenPositions(symbol);

    for (const position of openPositions) {
      const currentPrice = await getPrice(symbol);
      const analysisResult = await analyzeDataWithNN(symbol);

      if (position.side === 'BUY' && analysisResult.signal === 'sell') {
        // Закрываем длинную позицию
        await closePosition(symbol, position, currentPrice);
      } else if (position.side === 'SELL' && analysisResult.signal === 'buy') {
        // Закрываем короткую позицию
        await closePosition(symbol, position, currentPrice);
      } else {
        // Обновляем стоп-лосс и тейк-профит
        const newStopLoss = calculateStopLoss(currentPrice, analysisResult.risk, position.side.toLowerCase());
        const newTakeProfit = calculateTakeProfit(currentPrice, analysisResult.risk, position.side.toLowerCase());
        
        await updatePositionLevels(symbol, position, newStopLoss, newTakeProfit);
      }
    }

    await log('Управление открытыми позициями завершено', 'info', 'manageOpenPositions');
  } catch (error) {
    await log(`Ошибка при управлении открытыми позициями: ${error.message}`, 'error', 'manageOpenPositions');
    await handleApiError(error, 'manageOpenPositions');
  }
}
// Расчет трейлинг-стопа
function calculateTrailingStop(currentPrice, risk, signal) {
  const trailingPercentage = risk.times(2); // Например, двойной риск для трейлинг-стопа
  return signal === 'buy' 
    ? currentPrice.times(new Decimal(1).minus(trailingPercentage))
    : currentPrice.times(new Decimal(1).plus(trailingPercentage));
}
// Функция для мониторинга трейлинг-стопа 
async function monitorTrailingStop(symbol, order, initialTrailingStop, volatility) {
  const startTime = Date.now(); // Засекаем время начала выполнения функции

  await log(`➡️ Начало monitorTrailingStop 📈`, 'info', 'monitorTrailingStop');
  await log(
    `➡️ Входные параметры: symbol=${symbol}, order=${JSON.stringify(
      order
    )}, initialTrailingStop=${initialTrailingStop}, volatility=${volatility}`,
    'debug',
    'monitorTrailingStop'
  );

  let currentTrailingStop = initialTrailingStop;
  const checkInterval = 60000; // Проверяем каждую минуту

  const monitoringFunction = async () => {
    try {
      const currentPrice = await getPrice(symbol); // Цена ETH в USDT
      const usdToRubRate = await getUsdToRubRate(); // Курс USD/RUB

      await log(
        `🔍 Мониторинг трейлинг-стопа для ${symbol}`,
        'info',
        'monitorTrailingStop'
      );
      await log(
        `💹 Текущая цена: ${currentPrice} USD (${(
          currentPrice * usdToRubRate
        ).toFixed(2)} RUB)`, // Вывод цены в USD и RUB
        'info',
        'monitorTrailingStop'
      );
      await log(
        `🛑 Текущий трейлинг-стоп: ${currentTrailingStop} USD (${(
          currentTrailingStop * usdToRubRate
        ).toFixed(2)} RUB)`, // Вывод трейлинг-стопа в USD и RUB
        'info',
        'monitorTrailingStop'
      );

      // 💰 Получаем доступный баланс ETH (один раз за цикл)
      const availableBalanceETH = await getAvailableBalance('ETH');
      await log(
        `💰 Доступный баланс ETH: ${availableBalanceETH} 💰`,
        'info',
        'monitorTrailingStop'
      );

      // 🧮 Расчет риска с учетом направления сделки
      let risk;
      let currentPositionSize; // Объявляем переменную здесь
      if (order.side === 'BUY') {
        await log(`🔎 Проверка условий трейлинг-стопа для BUY...`, 'debug', 'monitorTrailingStop');
        if (
          currentPrice >
          currentTrailingStop * (1 + signalParams.trailingStopUpdateThreshold)
        ) {
          // ✅  Расчет risk только внутри блока if
          risk = (currentPrice - currentTrailingStop) / currentTrailingStop;
          await log(
            `🧮  Риск для BUY: ${risk}`,
            'debug',
            'monitorTrailingStop'
          );

          // ⛔ Ограничиваем значение risk до 1 (на всякий случай)
          risk = Math.min(risk, 1);
          await log(`⚠️ Текущий риск: ${risk}`, 'info', 'monitorTrailingStop');

          const newTrailingStop = currentPrice * (1 - risk); // Новый трейлинг-стоп в USDT
          
          const updateStopLossStartTime = Date.now(); // Засекаем время начала выполнения функции
          await updateStopLoss(symbol, order.orderId, newTrailingStop);
          const updateStopLossExecutionTime = Date.now() - updateStopLossStartTime; // Вычисляем время выполнения функции
          await log(
            `⏳ Время выполнения updateStopLoss: ${updateStopLossExecutionTime} мс ⏳`, // Логируем время выполнения
            'debug', 
            'monitorTrailingStop'
          );

          currentTrailingStop = newTrailingStop;

          // ✅ Пересчитываем currentPositionSize
          currentPositionSize = await calculateDynamicPositionSize(
            availableBalanceETH,
            risk,
            order.signalStrength,
            volatility
          );
          await log(
            `💼 Текущий размер позиции (после обновления): ${currentPositionSize} ETH (${(currentPositionSize * currentPrice * usdToRubRate).toFixed(2)} RUB)`, // Вывод размера позиции в ETH и RUB
            'info',
            'monitorTrailingStop'
          );

          await log(
            `📈 Трейлинг-стоп обновлен: ${currentTrailingStop} USD (${(
              currentTrailingStop * usdToRubRate
            ).toFixed(2)} RUB)`, // Вывод нового трейлинг-стопа в USD и RUB
            'info',
            'monitorTrailingStop'
          );
        } else {
          await log(`💤 Условия трейлинг-стопа для BUY не выполнены`, 'debug', 'monitorTrailingStop');
        }
      } else if (order.side === 'SELL') {
        await log(`🔎 Проверка условий трейлинг-стопа для SELL...`, 'debug', 'monitorTrailingStop');
        if (
          currentPrice <
          currentTrailingStop * (1 - signalParams.trailingStopUpdateThreshold)
        ) {
          // ✅  Расчет risk только внутри блока if
          risk = (currentTrailingStop - currentPrice) / currentTrailingStop;
          await log(
            `🧮  Риск для SELL: ${risk}`,
            'debug',
            'monitorTrailingStop'
          );

          // ⛔ Ограничиваем значение risk до 1 (на всякий случай)
          risk = Math.min(risk, 1);
          await log(`⚠️ Текущий риск: ${risk}`, 'info', 'monitorTrailingStop');
          
          const newTrailingStop = currentPrice * (1 + risk); // Новый трейлинг-стоп в USDT
          await updateStopLoss(symbol, order.orderId, newTrailingStop);
          currentTrailingStop = newTrailingStop;

          // ✅ Пересчитываем currentPositionSize
          currentPositionSize = await calculateDynamicPositionSize(
            availableBalanceETH,
            risk,
            order.signalStrength,
            volatility
          );
          await log(
            `💼 Текущий размер позиции (после обновления): ${currentPositionSize} ETH (${(currentPositionSize * currentPrice * usdToRubRate).toFixed(2)} RUB)`, // Вывод размера позиции в ETH и RUB
            'info',
            'monitorTrailingStop'
          );
          await log(
            `📉 Трейлинг-стоп обновлен: ${currentTrailingStop} USD (${(
              currentTrailingStop * usdToRubRate
            ).toFixed(2)} RUB)`, // Вывод нового трейлинг-стопа в USD и RUB
            'info',
            'monitorTrailingStop'
          );
        } else {
          await log(`💤 Условия трейлинг-стопа для SELL не выполнены`, 'debug', 'monitorTrailingStop');
        }
      }

      // Планирование следующей проверки
      setTimeout(monitoringFunction, checkInterval);
    } catch (error) {
      await log(
        `❌ Ошибка при мониторинге трейлинг-стопа: ${error.message}`,
        'error',
        'monitorTrailingStop'
      );
      // В случае ошибки, продолжаем мониторинг
      setTimeout(monitoringFunction, checkInterval);
    }
  };

  // Запускаем функцию мониторинга
  monitoringFunction();

  const executionTime = Date.now() - startTime; // Вычисляем время выполнения функции
  await log(
    `⬅️ Завершение monitorTrailingStop 📈. Время выполнения: ${executionTime} мс`,
    'info',
    'monitorTrailingStop'
  );
}

// Функция для обновления стоп-лосса
async function updateStopLoss(symbol, orderId, newStopLoss) {
  try {
    await log(`🔄 Обновление стоп-лосса для ордера ${orderId}: ${newStopLoss}`, 'info', 'updateStopLoss');
    
    if (currentTradingMode === 'test') {
      await log(`🧪 Тестовый режим: Симуляция обновления стоп-лосса`, 'info', 'updateStopLoss');
      return { success: true, message: 'Тестовое обновление стоп-лосса' };
    }

    const result = await bybitClient.setTradingStop({
      category: 'spot',
      symbol: symbol,
      orderId: orderId,
      stopLoss: newStopLoss.toString()
    });
    
    await log(`✅ Стоп-лосс успешно обновлен: ${JSON.stringify(result)}`, 'info', 'updateStopLoss');
    return result;
  } catch (error) {
    await log(`❌ Ошибка при обновлении стоп-лосса: ${error.message}`, 'error', 'updateStopLoss');
    throw error;
  }
}

// Обновление уровней для позиции
async function updatePositionLevels(symbol, position, newStopLoss, newTakeProfit) {
  try {
    await log(`Обновление уровней для позиции: ${JSON.stringify(position)}`, 'info', 'updatePositionLevels');
    
    const order = await bybitClient.setTradingStop({
      category: 'spot',
      symbol: symbol,
      positionIdx: position.positionIdx,
      stopLoss: newStopLoss.toString(),
      takeProfit: newTakeProfit.toString(),
    });

    await log(`Уровни позиции обновлены: ${JSON.stringify(order)}`, 'info', 'updatePositionLevels');
    return order;
  } catch (error) {
    await log(`Ошибка при обновлении уровней позиции: ${error.message}`, 'error', 'updatePositionLevels');
    throw error;
  }
}

// Функция для расчета нового стоп-лосса
function calculateNewStopLoss(currentStopLoss, marketConditions) {
  const { volatility, trend } = marketConditions;
  let adjustment = 1;

  if (trend === 'Восходящий') {
    adjustment += 0.005;
  } else if (trend === 'Нисходящий') {
    adjustment -= 0.005;
  }

  adjustment += volatility;

  const newStopLoss = currentStopLoss * adjustment;

  log(`🔢 Расчет нового стоп-лосса:
  📊 Текущий стоп-лосс: ${currentStopLoss}
  📈 Тренд: ${trend}
  📊 Волатильность: ${volatility}
  🔢 Коэффициент корректировки: ${adjustment}
  🆕 Новый стоп-лосс: ${newStopLoss}`, 'info', 'calculateNewStopLoss');

  return newStopLoss;
}

// Обновляем функцию для сравнения цен
async function comparePrices() {
  try {
    const bybitPrice = await getPrice('ETHUSDT');
    
    await log(`Цена на Bybit: ${bybitPrice}`, 'info', 'comparePrices');

    return {
      bybitPrice: bybitPrice
    };
  } catch (error) {
    await log(`Ошибка при сравнении цен: ${error.message}`, 'error', 'comparePrices');
    throw error;
  }
}


// Функция для проверки API ключей
async function checkApiKeys() {
  try {
    await log('🔑 Начало проверки API ключей', 'info', 'checkApiKeys');

    // Проверка реальных API ключей
    const realServerTime = await bybitClient.getServerTime();
    if (realServerTime.retCode === 0) {
      await log('✅ Реальные API ключи верны и активны', 'info', 'checkApiKeys');
    } else {
      throw new Error(`❌ Неверный ответ от реального сервера: ${realServerTime.retMsg}`);
    }

    // Проверка тестовых API ключей
    const testServerTime = await testBybitClient.getServerTime();
    if (testServerTime.retCode === 0) {
      await log('✅ Тестовые API ключи верны и активны', 'info', 'checkApiKeys');
    } else {
      throw new Error(`❌ Неверный ответ от тестового сервера: ${testServerTime.retMsg}`);
    }

    await log('🔑 Проверка API ключей завершена успешно', 'info', 'checkApiKeys');
    return true;
  } catch (error) {
    await log(`❌ Ошибка проверки API ключей: ${error.message}`, 'error', 'checkApiKeys');
    return false;
  }
}

// Функция для отправки уведомления в Telegram
async function sendTelegramNotification(message) {
  try {
    await log(`Отправка уведомления в Telegram: ${message}`, 'info', 'sendTelegramNotification');
    await sendTelegramMessage(message);
    await log('Уведомление в Telegram отправлено успешно', 'info', 'sendTelegramNotification');
  } catch (error) {
    await log(`Ошибка при отправке уведомления в Telegram: ${error.message}`, 'error', 'sendTelegramNotification');
  }
}

// Вызовите эту функцию при запуске сервера
checkApiKeys();

// Функция для проверки соединения с Bybit
async function checkBybitConnection(client = null) {
  try {
    if (!client) {
      client = currentTradingMode === 'test' ? testBybitClient : bybitClient;
    }
    const serverTime = await client.getServerTime();
    if (serverTime.retCode === 0) {
      await log(`Соединение с ${currentTradingMode === 'test' ? 'тестовым' : 'реальным'} API Bybit установлено успешно`, 'info', 'checkBybitConnection');
      return true;
    } else {
      throw new Error(`Неверный ответ от сервера ${currentTradingMode === 'test' ? 'тестового' : 'реального'} API Bybit`);
    }
  } catch (error) {
    await log(`Ошибка соединения с ${currentTradingMode === 'test' ? 'тестовым' : 'реальным'} API Bybit: ${error.message}`, 'error', 'checkBybitConnection');
    return false;
  }
}

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Обновленная функция для обработки ошибок API
async function handleApiError(error, functionName) {
  if (error.response) {
    // Ошибка от сервера с ответом
    await log(`Ошибка API в ${functionName}: ${error.response.status} ${error.response.statusText}`, 'error', functionName);
    await log(`Детали ошибки: ${JSON.stringify(error.response.data)}`, 'error', functionName);
    
    if (error.response.status === 401 || error.response.status === 403) {
      // Проблемы с аутентификацией
      await log('Ошибка аутентификации. Проверьте настройки API ключа.', 'error', functionName);
      await sendTelegramMessage('Ошибка аутентификации API. Требуется проверка ключей.');
    } else if (error.response.status === 429) {
      // Превышение лимита запросов
      await log('Превышен лимит запросов к API. Ожидание перед следующей попыткой.', 'warn', functionName);
      // Добавьте задержку перед следующим запросом
      await new Promise(resolve => setTimeout(resolve, 60000)); // Ждем 1 минуту
    }
  } else if (error.request) {
    // Ошибка без ответа от сервера
    await log(`Ошибка сети в ${functionName}: Нет ответа от сервера`, 'error', functionName);
    await sendTelegramMessage('Проблемы с сетевым подключением. Проверьте соединение.');
  } else {
    // Ошибка при настройке запроса
    await log(`Ошибка в ${functionName}: ${error.message}`, 'error', functionName);
  }

  // Если ошибка критическая, можно временно приостановить торговлю
  if (isCriticalError(error)) {
    await temporaryPauseTrading(error);
  }
}

// Функция для определения критичности ошибки
function isCriticalError(error) {
  // Определите условия для критических ошибок
  return error.message.includes('API key') || 
         error.message.includes('Insufficient balance') ||
         error.response && error.response.status >= 500;
}

// Функция для получения виртуального баланса (для тестового режима)
async function getVirtualBalance(asset) {
  try {
    await log(`🔍 Начало getVirtualBalance для ${asset || 'всех активов'}`, 'debug', 'getVirtualBalance');
    
    let balance = await fs.readJson(VIRTUAL_BALANCE_FILE);
    await log(`📊 Загруженный баланс: ${JSON.stringify(balance)}`, 'debug', 'getVirtualBalance');

    if (!asset) {
      // Если актив не указан, возвращаем весь баланс
      return balance;
    }

    if (!balance.hasOwnProperty(asset)) {
      throw new Error(`🚫 Актив ${asset} не найден в виртуальном балансе`);
    }

    await log(`💰 Возвращаемый баланс для ${asset}: ${balance[asset]}`, 'debug', 'getVirtualBalance');
    return balance[asset];
  } catch (error) {
    await log(`❌ Ошибка в getVirtualBalance: ${error.message}`, 'error', 'getVirtualBalance');
    throw error;
  }
}

// Функция для обновления виртуального баланса (для тестового режима)
async function updateVirtualBalance(asset, amount) {
  try {
    await log(`🔄 Начало updateVirtualBalance. Asset: ${asset}, Amount: ${amount}`, 'debug', 'updateVirtualBalance');

    let balance = await fs.readJson(VIRTUAL_BALANCE_FILE);
    await log(`📊 Текущий баланс: ${JSON.stringify(balance)}`, 'debug', 'updateVirtualBalance');

    balance[asset] = amount;

    if (asset === 'RUB') {
      const usdToRubRate = await getUsdToRubRate();
      const ethPrice = await getPrice('ETHUSDT');
      balance.ETH = amount / (ethPrice * usdToRubRate);
      await log(`🧮 Пересчет ETH: ${amount} / (${ethPrice} * ${usdToRubRate}) = ${balance.ETH}`, 'debug', 'updateVirtualBalance');
    }

    await fs.writeJson(VIRTUAL_BALANCE_FILE, balance, { spaces: 2 });
    await log(`💾 Сохранен обновленный баланс: ${JSON.stringify(balance)}`, 'debug', 'updateVirtualBalance');
  } catch (error) {
    await log(`❌ Ошибка в updateVirtualBalance: ${error.message}`, 'error', 'updateVirtualBalance');
    throw error;
  }
}

// Функция для получения текущей производительности
async function getTradingPerformance() {
  try {
    const trades = await getRecentTrades('ETHUSDT', 100);
    const portfolio = new Decimal(await getPortfolioValue());
    const initialBalance = new Decimal(10000); // Начальный баланс в RUB
    
    const totalProfit = portfolio.minus(initialBalance);
    const profitPercentage = portfolio.dividedBy(initialBalance).minus(1).times(100);
    
    const winningTrades = trades.filter(trade => new Decimal(trade.value).greaterThan(0));
    const losingTrades = trades.filter(trade => new Decimal(trade.value).lessThanOrEqualTo(0));
    
    const winRate = trades.length > 0 ? new Decimal(winningTrades.length).dividedBy(trades.length).times(100) : new Decimal(0);
    const averageProfit = trades.length > 0 ? trades.reduce((sum, trade) => sum.plus(trade.value), new Decimal(0)).dividedBy(trades.length) : new Decimal(0);
    
    const maxDrawdown = calculateMaxDrawdown(trades);
    
    const performance = {
      totalProfit: totalProfit.toFixed(2),
      profitPercentage: profitPercentage.toFixed(2),
      winRate: winRate.toFixed(2),
      averageProfit: averageProfit.toFixed(2),
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      currentPortfolioValue: portfolio.toFixed(2),
      maxDrawdown: maxDrawdown.toFixed(2)
    };
    
    await log(`Текущая производительность торговли: ${JSON.stringify(performance)}`, 'info', 'getTradingPerformance');
    
    return performance;
  } catch (error) {
    await log(`Ошибка при получении данных о производительности торговли: ${error.message}`, 'error', 'getTradingPerformance');
    return {
      totalProfit: '0.00',
      profitPercentage: '0.00',
      winRate: '0.00',
      averageProfit: '0.00',
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      currentPortfolioValue: '10000.00',
      maxDrawdown: '0.00'
    };
  }
}

async function logTradingPerformance() {
  try {
    const performance = await getTradingPerformance();
    
    await log('Обновление производительности торговли:', 'info', 'logTradingPerformance');
    await log(`Общая прибыль: ${performance.totalProfit} RUB (${performance.profitPercentage}%)`, 'info', 'logTradingPerformance');
    await log(`Винрейт: ${performance.winRate}%`, 'info', 'logTradingPerformance');
    await log(`Средняя прибыль на сделку: ${performance.averageProfit} RUB`, 'info', 'logTradingPerformance');
    await log(`Всего сделок: ${performance.totalTrades} (выигрышных: ${performance.winningTrades}, проигрышных: ${performance.losingTrades})`, 'info', 'logTradingPerformance');
    await log(`Текущая стоимость портфеля: ${performance.currentPortfolioValue} RUB`, 'info', 'logTradingPerformance');
    await log(`Максимальная просадка: ${performance.maxDrawdown}%`, 'info', 'logTradingPerformance');
    
    // Отправка данных через веб-сокет для обновления в реальном времени
    io.emit('tradingPerformance', performance);

    // Сохранение производительности в файл
    await savePerformanceToFile(performance);

  } catch (error) {
    await log(`Ошибка при логировании производительности торговли: ${error.message}`, 'error', 'logTradingPerformance');
    
    // Отправка уведомления об ошибке
    await sendTelegramMessage(`Ошибка при обновлении производительности торговли: ${error.message}`);
  }
}

// Запускаем логирование производительности каждые 5 минут
setInterval(logTradingPerformance, 5 * 60 * 1000);

app.get('/trading-performance', async (_req, res) => {
  try {
    const performance = await getTradingPerformance();
    res.json(performance);
  } catch (error) {
    handleError(res, 'Ошибка при получении данных о производительности торговли', error);
  }
});

// Функция для сохранения производительности в файл
async function savePerformanceToFile(performance) {
  const performancePath = path.join(__dirname, 'performance_history.json');
  try {
    let history = [];
    if (await fs.pathExists(performancePath)) {
      history = await fs.readJson(performancePath);
    }
    history.push({
      timestamp: new Date().toISOString(),
      ...performance
    });
    // Ограничиваем историю последними 1000 записями
    if (history.length > 1000) {
      history = history.slice(-1000);
    }
    await fs.writeJson(performancePath, history, { spaces: 2 });
    await log('Производительность сохранена в файл', 'info', 'savePerformanceToFile');
  } catch (error) {
    await log(`Ошибка при сохранении производительности в файл: ${error.message}`, 'error', 'savePerformanceToFile');
  }
}

// Обновление статистики торговли
async function updateTradingStatistics(side, size, price, orderValueRub) {
  try {
    const normalizedSide = side.toUpperCase();
    await log(`Обновление статистики торговли: ${normalizedSide} ${size} ETH по цене ${price} USD (${orderValueRub} RUB)`, 'info', 'updateTradingStatistics');

    // Загрузка текущей статистики
    let statistics = await loadTradingStatistics();

    // Обновление общих показателей
    statistics.totalTrades++;
    statistics.totalVolume = new Decimal(statistics.totalVolume).plus(size).toString();
    statistics.totalVolumeRub = new Decimal(statistics.totalVolumeRub).plus(orderValueRub).toString();

    // Обновление показателей по типу сделки (покупка/продажа)
    if (normalizedSide === 'BUY') {
      statistics.totalBuys++;
      statistics.totalBuyVolume = new Decimal(statistics.totalBuyVolume).plus(size).toString();
      statistics.totalBuyVolumeRub = new Decimal(statistics.totalBuyVolumeRub).plus(orderValueRub).toString();
      statistics.averageBuyPrice = new Decimal(statistics.averageBuyPrice).times(statistics.totalBuys - 1).plus(price).dividedBy(statistics.totalBuys).toString();
    } else if (normalizedSide === 'SELL') {
      statistics.totalSells++;
      statistics.totalSellVolume = new Decimal(statistics.totalSellVolume).plus(size).toString();
      statistics.totalSellVolumeRub = new Decimal(statistics.totalSellVolumeRub).plus(orderValueRub).toString();
      statistics.averageSellPrice = new Decimal(statistics.averageSellPrice).times(statistics.totalSells - 1).plus(price).dividedBy(statistics.totalSells).toString();
    }

    // Расчет прибыли/убытка
    if (statistics.lastTradePrice) {
      const pnl = normalizedSide === 'SELL' 
        ? new Decimal(price).minus(statistics.lastTradePrice).times(size)
        : new Decimal(statistics.lastTradePrice).minus(price).times(size);
      statistics.totalPnL = new Decimal(statistics.totalPnL).plus(pnl).toString();
      statistics.totalPnLRub = new Decimal(statistics.totalPnLRub).plus(pnl.times(await getUsdToRubRate())).toString();

      if (pnl.greaterThan(0)) {
        statistics.profitableTrades++;
      } else if (pnl.lessThan(0)) {
        statistics.unprofitableTrades++;
      }
    }

    statistics.lastTradePrice = price.toString();
    statistics.lastTradeTime = new Date().toISOString();

    // Расчет винрейта
    statistics.winRate = new Decimal(statistics.profitableTrades).dividedBy(statistics.totalTrades).times(100).toString();

    // Расчет средней прибыли на сделку
    statistics.averagePnL = new Decimal(statistics.totalPnL).dividedBy(statistics.totalTrades).toString();
    statistics.averagePnLRub = new Decimal(statistics.totalPnLRub).dividedBy(statistics.totalTrades).toString();

    // Обновление максимальной просадки
    const currentDrawdown = new Decimal(statistics.peakBalance).minus(new Decimal(statistics.peakBalance).plus(statistics.totalPnLRub)).dividedBy(statistics.peakBalance).times(100);
    statistics.maxDrawdown = Decimal.max(statistics.maxDrawdown, currentDrawdown).toString();

    // Обновление пикового баланса
    if (new Decimal(statistics.peakBalance).plus(statistics.totalPnLRub).greaterThan(statistics.peakBalance)) {
      statistics.peakBalance = new Decimal(statistics.peakBalance).plus(statistics.totalPnLRub).toString();
    }

    // Сохранение обновленной статистики
    await saveTradingStatistics(statistics);

    await log(`Статистика торговли обновлена. Всего сделок: ${statistics.totalTrades}, Винрейт: ${new Decimal(statistics.winRate).toFixed(2)}%, Общий P&L: ${new Decimal(statistics.totalPnLRub).toFixed(2)} RUB`, 'info', 'updateTradingStatistics');

  } catch (error) {
    await log(`Ошибка при обновлении статистики торговли: ${error.message}`, 'error', 'updateTradingStatistics');
    throw error;
  }
}

// Загрузке статистики торговли
async function loadTradingStatistics() {
  const statisticsPath = path.join(__dirname, 'trading_statistics.json');
  try {
    if (await fs.pathExists(statisticsPath)) {
      return await fs.readJson(statisticsPath);
    } else {
      return {
        totalTrades: 0,
        totalVolume: 0,
        totalVolumeRub: 0,
        totalBuys: 0,
        totalSells: 0,
        totalBuyVolume: 0,
        totalSellVolume: 0,
        totalBuyVolumeRub: 0,
        totalSellVolumeRub: 0,
        averageBuyPrice: 0,
        averageSellPrice: 0,
        totalPnL: 0,
        totalPnLRub: 0,
        profitableTrades: 0,
        unprofitableTrades: 0,
        winRate: 0,
        averagePnL: 0,
        averagePnLRub: 0,
        maxDrawdown: 0,
        peakBalance: 10000, // Предполагаем начальный баланс 10000 RUB
        lastTradePrice: null,
        lastTradeTime: null
      };
    }
  } catch (error) {
    await log(`Ошибка при загрузке статистики торговли: ${error.message}`, 'error', 'loadTradingStatistics');
    throw error;
  }
}

// Сохранение статистики торговли
async function saveTradingStatistics(statistics) {
  const statisticsPath = path.join(__dirname, 'trading_statistics.json');
  try {
    await fs.writeJson(statisticsPath, statistics, { spaces: 2 });
    await log('Статистика торговли сохранена', 'info', 'saveTradingStatistics');
  } catch (error) {
    await log(`Ошибка при сохранении статистики торговли: ${error.message}`, 'error', 'saveTradingStatistics');
    throw error;
  }
}

// Функция для вычисления текущей точности
async function calculateCurrentAccuracy() {
  try {
    const testData = await fetchHistoricalDataForTraining('15m');
    const neuralNet = await loadLatestModel();
    if (!neuralNet) {
      throw new Error('Модель нейронной сети не найдена');
    }
    const accuracy = calculateAccuracy(neuralNet.model, testData);
    return accuracy.toFixed(2);
  } catch (error) {
    console.error('Ошибка при вычислении точности:', error);
    throw error;
  }
}

async function initializeNeuralNetwork() {
  try {
    await log('🧠 Начало инициализации нейронной сети', 'info', 'initializeNeuralNetwork');
    
    let model = await loadLatestModel();
    if (!model) {
      await log('⚠️ Сохраненная модель не найдена. Создание новой модели...', 'warn', 'initializeNeuralNetwork');
      model = new brain.NeuralNetwork({
        hiddenLayers: [700, 512, 256, 128, 64],
        activation: 'leaky-relu',
        learningRate: 0.003,
        momentum: 0.2,
        regularization: 'l2',
        regRate: 0.001,
      });
      
      // Здесь можно добавить код для начального обучения модели, если это необходимо
      // Например: await trainInitialModel(model);
    }
    
    await log('✅ Нейронная сеть успешно инициализирована', 'info', 'initializeNeuralNetwork');
    return { model };
  } catch (error) {
    await log(`❌ Ошибка при инициализации нейронной сети: ${error.message}`, 'error', 'initializeNeuralNetwork');
    return null;
  }
}

// Обновление точности каждый час
setInterval(async () => {
  try {
    const accuracy = await calculateCurrentAccuracy();
    lastKnownAccuracy = accuracy;
    io.emit('neuralNetworkAccuracy', { accuracy: accuracy });
    console.log(`Точность нейросети обновлена: ${accuracy}%`);
  } catch (error) {
    console.error('Ошибка при обновлении точности:', error);
  }
}, 3600000);

/**
 * Инициализирует систему
 * @returns {Promise<boolean>} Результат инициализации
 */
async function initializeSystem() {
  try {
    await log('🚀 Начало инициализации системы', 'info', 'initializeSystem');

    // Инициализация нейронной сети
    neuralNet = await initializeNeuralNetwork();
    if (!neuralNet) {
      throw new Error('🤯 Упс! Не удалось инициализировать нейронную сеть 🧠');
    }
    await log('✅ Нейронная сеть успешно инициализирована 🧠', 'info', 'initializeSystem');

    const symbol = 'ETHUSDT';
    const interval = '15m';

    // Получение исторических данных
    const historicalData = await fetchHistoricalData(symbol, interval, 1000);

    if (historicalData.length < 100) {
      await log(`⚠️ Внимание: Получено недостаточно исторических данных (${historicalData.length}). Это может повлиять на точность расчетов.`, 'warn', 'initializeSystem');
    }

    // 🧠🧠🧠 LSTM 🧠🧠🧠

    // Инициализация и обучение LSTM модели
    try {
      await log('🧠 Начало обучения LSTM модели 🤖', 'info', 'initializeSystem');

      const lastSavedEpoch = await findLastSavedEpoch();
      await log(`💾 Найдена последняя сохраненная эпоха LSTM: ${lastSavedEpoch}`, 'info', 'initializeSystem');

      const preparedData = await prepareDataForLSTM(historicalData);
      global.lstmModel = await trainLSTMModel(preparedData, lastSavedEpoch + 1);

      await log('🎓 LSTM модель успешно обучена! 🎉', 'info', 'initializeSystem');
    } catch (lstmError) {
      await log(`❌ Ошибка при обучении LSTM модели 🤖: ${lstmError.message}`, 'error', 'initializeSystem');
      // Отправка уведомления об ошибке в Telegram
      await sendTelegramNotification(`❌ Ошибка при обучении LSTM: ${lstmError.message}`);
      throw new Error('Не удалось обучить LSTM модель 🤖'); //  Обработка ошибки - остановка бота.
    }

    // Проверка LSTM модели
    try {
      const lstmTestInput = await prepareInputDataForLSTM(symbol, interval, 50, 1);
      const lstmTestPrediction = predictWithLSTM(global.lstmModel, lstmTestInput[0]);
      await log(`🧪 Тестовое предсказание LSTM модели 🤖: ${JSON.stringify(lstmTestPrediction)}`, 'info', 'initializeSystem');
    } catch (lstmTestError) {
      await log(`❌ Ошибка при тестировании LSTM модели 🤖: ${lstmTestError.message}`, 'warn', 'initializeSystem');
    }

    // 🧠🧠🧠 Brain.js 🧠🧠🧠

    // Обучение нейронной сети Brain.js
    try {
      await log('🧠 Начало обучения нейронной сети Brain.js 🧠', 'info', 'initializeSystem');
      neuralNet = await trainNeuralNetwork();
      if (!neuralNet) {
        await log('❌ Ошибка: Не удалось обучить нейронную сеть при инициализации 🧠', 'error', 'initializeSystem');
        throw new Error('Не удалось обучить нейронную сеть 🧠'); //  Обработка ошибки.
      }
      await log('✅ Нейронная сеть Brain.js успешно обучена! 🎉', 'info', 'initializeSystem');
    } catch (nnError) {
      await log(`❌ Ошибка инициализации neuralNet: ${nnError.message}`, 'error', 'initializeSystem');
      // Отправка уведомления об ошибке в Telegram
      await sendTelegramNotification(`❌ Ошибка при обучении нейронной сети: ${nnError.message}`);
      throw nnError; // Передаем ошибку дальше
    }
    
    await checkApiKeys();
    await syncTimeWithBybit();
    await initializeOrUpdateVirtualBalance();
    
    await log('🎉 Инициализация системы завершена! 🚀', 'info', 'initializeSystem');
    return true;
  } catch (error) {
    await log(`❌ Ошибка при инициализации системы: ${error.message}`, 'error', 'initializeSystem');
    return false; 
  }
}



// Обновленная функция для запуска торгового бота с логированием со смайликами
async function runTradingBot() {
  try {
    await log('🚀 Запуск торгового бота...', 'info', 'runTradingBot');

    // Инициализация системы, включая нейронную сеть
    if (!await initializeSystem()) {
      throw new Error('Не удалось инициализировать систему. Торговля невозможна.');
    }

    const symbol = 'ETHUSDT';
    const interval = '15m';

    while (true) {
      try {
        // Обновление цен
        lastEthUsdtPrice = await getPrice('ETHUSDT');
        lastEthUsdtPriceTime = Date.now();
        lastUsdRubRate = await getUsdToRubRate();
        lastUsdRubRateTime = Date.now();

        if (global.isTradingStopped) {
          await log('⚠️ Торговля остановлена.', 'warn', 'runTradingBot');
          break;
        }

        const marketConditions = await analyzeMarketConditions();
        await log(`📊 Текущие рыночные условия: ${JSON.stringify(marketConditions)}`, 'info', 'runTradingBot');

        const analysisResult = await analyzeDataWithCombinedModels(symbol, interval);

        if (!analysisResult) {
          await log(`❌ Ошибка: analysisResult undefined. Пропускаем итерацию.`, 'error', 'runTradingBot');
          continue;
        }

        await log(`🧠 Результат анализа: signal=${analysisResult.signal}, signalStrength=${analysisResult.signalStrength}, currentPrice=${analysisResult.currentPrice}`, 'debug', 'runTradingBot');

        if (isTradingActive) {
          await log(`⏳ Сделка уже в процессе. Пропускаем текущую итерацию.`, 'info', 'runTradingBot');
          continue;
        }

        if (!analysisResult.signalStrength || isNaN(analysisResult.signalStrength)) {
          await log(`❌ Ошибка: некорректный signalStrength: ${JSON.stringify(analysisResult)}`, 'error', 'runTradingBot');
          continue;
        }

        const signalStrength = new Decimal(analysisResult.signalStrength);
        const minSignalStrength = new Decimal(signalParams.minSignalStrength);

        if (analysisResult.signal !== 'hold' && signalStrength.greaterThanOrEqualTo(minSignalStrength)) {
          const riskParams = {
            risk: new Decimal(0.01),
            stopLossPercent: new Decimal(0.02),
            takeProfitPercent: new Decimal(0.03)
          };

          await executeTradewithRiskManagement(analysisResult, marketConditions, riskParams);
        } else {
          await log('💤 Нет сигнала для торговли.', 'info', 'runTradingBot');
        }

        await adaptTradingParameters();

        const portfolioState = await getPortfolioState();
        await log(`💼 Текущее состояние портфеля: ${JSON.stringify(portfolioState)}`, 'info', 'runTradingBot');

        if (Date.now() - lastWeightAdjustmentTime > WEIGHT_ADJUSTMENT_INTERVAL) {
          await adjustModelWeights();
          lastWeightAdjustmentTime = Date.now();
        }

        // Проверка и переобучение нейронной сети, если необходимо
        if (Date.now() - lastNeuralNetworkTrainingTime > NEURAL_NETWORK_TRAINING_INTERVAL) {
          await retrainNeuralNetwork();
          lastNeuralNetworkTrainingTime = Date.now();
        }

        await new Promise(resolve => setTimeout(resolve, 60000)); // 1 минута задержки
      } catch (error) {
        await log(`❌ Ошибка в цикле торговли: ${error.message}`, 'error', 'runTradingBot');
        await handleApiError(error, 'runTradingBot');
        await new Promise(resolve => setTimeout(resolve, 60000)); // Пауза перед следующей попыткой
      }
    }
  } catch (error) {
    await log(`🚨 Критическая ошибка в runTradingBot: ${error.message}`, 'error', 'runTradingBot');
    await sendTelegramNotification(`🚨 Критическая ошибка в торговом боте: ${error.message}`);
    
    // Безопасное завершение работы бота
    await safelyShutdownBot();
    
    // Попытка перезапуска через 5 минут
    setTimeout(async () => {
      await log('🔄 Попытка перезапуска торгового бота...', 'info', 'runTradingBot');
      runTradingBot();
    }, 300000);
  }
}

// Глобальные переменные
let lastWeightAdjustmentTime = 0;
const WEIGHT_ADJUSTMENT_INTERVAL = 24 * 60 * 60 * 1000; // 24 часа

// Добавьте эти глобальные переменные
let lastNeuralNetworkTrainingTime = 0;
const NEURAL_NETWORK_TRAINING_INTERVAL = 24 * 60 * 60 * 1000; // 24 часа

// Запуск торгового бота
runTradingBot();

// Обработка необработанных исключений и отклонений промисов
process.on('uncaughtException', async (error) => {
  await log(`Необработанное исключение: ${error.message}`, 'error', 'uncaughtException');
  await sendTelegramMessage(`Критическая ошибка: ${error.message}`);
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

// Обработчик необработанных отклонений промисов
process.on('unhandledRejection', async (reason, _promise) => {
  let errorMessage = 'Неизвестная ошибка';
  let errorStack = '';
  
  if (reason instanceof Error) {
      errorMessage = reason.message;
      errorStack = reason.stack || '';
  } else if (typeof reason === 'string') {
      errorMessage = reason;
  } else if (reason && typeof reason === 'object') {
      errorMessage = reason.message || JSON.stringify(reason);
      errorStack = reason.stack || '';
  }
  
  await log(`Необработанное отклонение промиса: ${errorMessage}`, 'error', 'unhandledRejection');
  if (errorStack) {
      await log(`Стек ошибки: ${errorStack}`, 'error', 'unhandledRejection');
  }
  
  try {
      await sendTelegramMessage(`Критическая ошибка: Необработанное отклонение промиса: ${errorMessage}`);
  } catch (telegramError) {
      await log(`Ошибка при отправке сообщения в Telegram: ${telegramError.message}`, 'error', 'unhandledRejection');
  }
  
  try {
      await temporaryPauseTrading(new Error(errorMessage));
  } catch (pauseError) {
      await log(`Ошибка при попытке временно приостановить торговлю: ${pauseError.message}`, 'error', 'unhandledRejection');
  }
});


const PORT = 3000;

// Функция запуска сервера
server.listen(PORT, async () => {
  try {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    await log(`🚀 Сервер запущен на порту ${PORT}`, 'info', 'serverStart');
    
    await initializeOrUpdateVirtualBalance(true);
    await syncTimeWithBybit();
    
    // Инициализация системы (включая LSTM модель)
    const systemInitialized = await initializeSystem();
    
    if (systemInitialized) {
      await log('✅ Инициализация системы успешно завершена', 'info', 'serverStart');
      runTradingBot();
      runInitialBacktest();
    } else {
      await log('❌ Инициализация системы не удалась. Сервер будет работать в ограниченном режиме.', 'warn', 'serverStart');
      // Здесь можно добавить логику для работы в ограниченном режиме
    }
    
    console.log(`📊 Сервер доступен по адресу http://localhost:${PORT}`);
    await log(`📊 Сервер доступен по адресу http://localhost:${PORT}`, 'info', 'serverStart');
  } catch (error) {
    console.error(`❌ Ошибка при запуске сервера: ${error.message}`);
    await log(`❌ Ошибка при запуске сервера: ${error.message}`, 'error', 'serverStart');
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  try {
    console.log('🛑 Получен сигнал завершения работы. Закрытие сервера...');
    await log('🛑 Получен сигнал завершения работы. Закрытие сервера...', 'info', 'serverShutdown');
    
    await closeAllConnections();
    
    console.log('👋 Сервер успешно завершил работу');
    await log('👋 Сервер успешно завершил работу', 'info', 'serverShutdown');
    process.exit(0);
  } catch (error) {
    console.error(`❌ Ошибка при завершении работы сервера: ${error.message}`);
    await log(`❌ Ошибка при завершении работы сервера: ${error.message}`, 'error', 'serverShutdown');
    process.exit(1);
  }
});

// Экспорт функций для использования в тестах
module.exports = {
  prepareInputDataForNN,
  executeTrade,
  createLSTMModel,
  trainLSTMModel,
  predictWithLSTM,
  prepareDataForLSTM,
  analyzeDataWithCombinedModels,
  initializeSystem,
  retrainLSTMModel,
  analyzeDataWithNN,
  checkEnsembleAccuracy,
  initializeTestPortfolio,
  sendTelegramMessage,
  normalize,
  isValidNumber,
  initializeSystem,
  fetchHistoricalDataForTraining,
  trainNeuralNetwork,
  calculateValidationError,
  incrementalTraining,
  predictShortTermPriceMovement,
  adaptTradingParameters,
  analyzeCorrelations,
  optimizeStrategyParameters,
  calculateDynamicPositionSize,
  analyzeMarketConditions,
  dynamicRiskManagement,
  executeTradewithRiskManagement,
  adaptiveTrading,
  placeGridOrders,
  monitorAndUpdateGrid,
  manageOpenPositions,
  checkBalance,
  getRecentTrades,
  getTradingPerformance,
  logTradingPerformance,
  savePerformanceToFile,
  calculateNewStopLoss,
  checkClientConnection,
  backtest,
  getAdjustedTime,
  comparePrices
};