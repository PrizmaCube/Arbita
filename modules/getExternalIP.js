// modules/getExternalIP.js
const axios = require('axios');
const { logger } = require('./utils'); // Импортируем logger

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

module.exports = getExternalIP;