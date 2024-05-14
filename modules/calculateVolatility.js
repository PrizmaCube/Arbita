// modules/calculateVolatility.js

// Функция для расчета волатильности
function calculateVolatility(prices) {
    const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - avg, 2), 0) / prices.length;
    const volatility = Math.sqrt(variance);
    return volatility;
  }
  
  module.exports = calculateVolatility;