/**
 * Переиспользуемые варианты анимаций для Framer Motion
 * Согласно PRD: Mega-Landing Enhancement
 */

import type { Variants } from "framer-motion";

/**
 * Fade-in с движением вверх
 * Используется для: hero-секция, заголовки секций
 */
export const fadeInUp: Variants = {
  initial: { opacity: 0, y: 40 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -40 },
};

/**
 * Fade-in с движением вверх (с transition)
 * Более детальная версия с настройками transition
 */
export const fadeInUpWithTransition = {
  initial: { opacity: 0, y: 40 },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: "easeOut"
    }
  },
};

/**
 * Контейнер для stagger-анимаций
 * Используется для: grid карточек офисов, услуг, преимуществ
 */
export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

/**
 * Stagger container с кастомной задержкой для мобильных
 */
export const staggerContainerMobile: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
};

/**
 * Элемент stagger-контейнера
 * Используется внутри staggerContainer
 */
export const staggerItem: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: "easeOut"
    }
  },
};

/**
 * Scale эффект при hover
 * Используется для: кнопки, карточки, иконки
 */
export const scaleOnHover: Variants = {
  rest: { scale: 1 },
  hover: {
    scale: 1.05,
    transition: { duration: 0.2, ease: "easeOut" }
  },
};

/**
 * Lift эффект при hover (поднятие вверх с тенью)
 * Используется для: карточки офисов
 */
export const liftOnHover: Variants = {
  rest: { y: 0 },
  hover: {
    y: -8,
    transition: { duration: 0.2, ease: "easeOut" }
  },
};

/**
 * Parallax эффект для Hero background
 * Используется для: фоновые элементы Hero секции
 */
export const parallaxVariants = {
  initial: { y: 0 },
  animate: { y: -50 },
};

/**
 * Slide in справа
 * Используется для: мобильное меню
 */
export const slideInFromRight: Variants = {
  initial: { x: "100%" },
  animate: {
    x: 0,
    transition: {
      duration: 0.3,
      ease: "easeOut"
    }
  },
  exit: {
    x: "100%",
    transition: {
      duration: 0.3,
      ease: "easeIn"
    }
  },
};

/**
 * Slide in сверху
 * Используется для: toast notifications
 */
export const slideInFromTop: Variants = {
  initial: { y: -100, opacity: 0 },
  animate: {
    y: 0,
    opacity: 1,
    transition: {
      duration: 0.4,
      ease: "easeOut"
    }
  },
  exit: {
    y: -100,
    opacity: 0,
    transition: {
      duration: 0.3,
      ease: "easeIn"
    }
  },
};

/**
 * Glow эффект для кнопок (через box-shadow)
 * Используется для: CTA-кнопки в Hero
 */
export const glowEffect: Variants = {
  rest: {
    boxShadow: "0 0 0 rgba(0, 153, 255, 0)"
  },
  hover: {
    boxShadow: "0 0 20px rgba(0, 153, 255, 0.6)",
    transition: { duration: 0.3 }
  },
};

/**
 * Rotate эффект при hover
 * Используется для: иконки контактов
 */
export const rotateOnHover: Variants = {
  rest: { rotate: 0 },
  hover: {
    rotate: 15,
    transition: { duration: 0.2 }
  },
};

/**
 * Pulse анимация (для "Sold Out" badge)
 * Используется для: badge "Все места заняты"
 */
export const pulseEffect: Variants = {
  initial: { scale: 1 },
  animate: {
    scale: [1, 1.05, 1],
    transition: {
      duration: 2,
      ease: "easeInOut",
      repeat: Infinity,
    }
  },
};

/**
 * Navbar scroll transition
 * Используется для: переход navbar при скролле
 */
export const navbarScrollTransition = {
  transparent: {
    backgroundColor: "rgba(0, 0, 0, 0)",
    backdropFilter: "blur(0px)",
  },
  solid: {
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    backdropFilter: "blur(12px)",
  },
  transition: {
    duration: 0.3,
    ease: "easeInOut",
  },
};

/**
 * Counter animation config
 * Используется для: animated counters в Hero статистике
 */
export const counterAnimationConfig = {
  duration: 2,
  ease: "easeOut",
};

/**
 * Viewport configuration для scroll-triggered анимаций
 * Используется для: все секции
 */
export const defaultViewport = {
  once: true,  // Анимация срабатывает только один раз
  amount: 0.2, // Триггер когда 20% элемента видно
};
