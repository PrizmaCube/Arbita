// modules/fetchAllOrdersForExchange.js
const ccxt = require('ccxt');
const { exchangeConfigs, fetchOrdersBySymbol, fetchOpenOrders } = require('./utils'); // Импортируем необходимые константы

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

module.exports = fetchAllOrdersForExchange;