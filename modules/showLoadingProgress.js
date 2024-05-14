// modules/showLoadingProgress.js
const { io, logger } = require('./utils'); // Импортируем io и logger

let progress = 0;

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

module.exports = showLoadingProgress;