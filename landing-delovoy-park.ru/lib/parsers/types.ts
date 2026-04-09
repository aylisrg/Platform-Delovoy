/**
 * Review data structure from Yandex Maps
 */
export type Review = {
  id: string;           // Уникальный ID (hash от author + date)
  author: string;       // Имя автора
  rating: number;       // 1-5
  text: string;         // Текст отзыва
  date: string;         // Дата (может быть "2 месяца назад" или ISO)
  source: "yandex";     // Источник (расширяемо: google, 2gis)
};

/**
 * Reviews cache structure in Redis
 */
export type ReviewsCache = {
  fetchedAt: number;    // Unix timestamp
  reviews: Review[];
};
