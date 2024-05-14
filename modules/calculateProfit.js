// modules/calculateProfit.js

// Функция для расчета прибыли
function calculateProfit(buyPrice, sellPrice, amount = 0.01) {
    const profit = (sellPrice - buyPrice) * amount;
    return profit;
  }
  
  module.exports = calculateProfit;