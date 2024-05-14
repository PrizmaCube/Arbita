// modules/calculateTotalVolume.js

// Функция для расчета общего объема
function calculateTotalVolume(prices) {
    const totalVolume = Object.values(prices).reduce((sum, price) => sum + price, 0);
    return totalVolume;
  }
  
  module.exports = calculateTotalVolume;