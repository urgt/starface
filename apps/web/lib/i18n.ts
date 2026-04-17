export type Locale = "uz" | "ru";

export const locales: Locale[] = ["uz", "ru"];

export const dict = {
  uz: {
    idleTitle: "Mashhurlardan kimga o'xshashingizni bilib oling!",
    idleCta: "Kamera oldida ✌️ ko'rsating",
    consent: "✌️ belgisini ko'rsatib, siz rasmingizni qayta ishlashga rozilik bildirasiz.",
    analyzing: "Tahlil qilinmoqda...",
    similarity: "o'xshashlik",
    scanQr: "Natijani saqlash uchun QR-kodni skan qiling",
    secondsLeft: "soniya qoldi",
    share: "Ulashish",
    shareTelegram: "Telegram",
    copyLink: "Havolani nusxalash",
    linkCopied: "Havola nusxalandi",
    promo: "Do'konimizdan promokod",
    resultExpired: "Natija muddati tugagan",
    brandLogoAlt: "Brend logotipi",
  },
  ru: {
    idleTitle: "Узнай на кого из знаменитостей ты похож!",
    idleCta: "Покажи ✌️ в камеру",
    consent: "Показывая ✌️, вы соглашаетесь на обработку своей фотографии.",
    analyzing: "Анализируем...",
    similarity: "сходства",
    scanQr: "Сканируй QR-код, чтобы сохранить результат",
    secondsLeft: "секунд осталось",
    share: "Поделиться",
    shareTelegram: "Telegram",
    copyLink: "Скопировать ссылку",
    linkCopied: "Ссылка скопирована",
    promo: "Промокод от магазина",
    resultExpired: "Срок действия результата истёк",
    brandLogoAlt: "Логотип бренда",
  },
} as const;

export type Dict = typeof dict.uz;

export function t(locale: Locale): Dict {
  return dict[locale] ?? dict.uz;
}
