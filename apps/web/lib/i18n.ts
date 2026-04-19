export type Locale = "uz" | "ru";

export const locales: Locale[] = ["uz", "ru"];

export const dict: Record<Locale, Dict> = {
  uz: {
    idleTitle: "Mashhurlardan kimga o'xshashingizni bilib oling!",
    idleCta: "Kamera oldida ✌️ ko'rsating",
    headlineDefault: "Qaysi yulduzga o'xshaysiz?",
    subtitleDefault: "Yaqinroq keling va kameraga ✌️ ko'rsating",
    readyToSee: "Bilmoqchimisiz?",
    stepBackHint: "Kamera tasvirdagi yuzingizni aniqlaydi",
    consent: "✌️ belgisini ko'rsatib, siz rasmingizni qayta ishlashga rozilik bildirasiz.",
    analyzing: "Tahlil qilinmoqda...",
    analyzingHint: "Yuz xususiyatlari solishtirilmoqda",
    similarity: "o'xshashlik",
    match: "MOS KELISH",
    celebritiesShown: "Har kuni yangilanadi",
    scanQr: "Natijani saqlash uchun QR-kodni skan qiling",
    secondsLeft: "soniya qoldi",
    share: "Ulashish",
    shareTelegram: "Telegram",
    copyLink: "Havolani nusxalash",
    linkCopied: "Havola nusxalandi",
    promo: "Do'konimizdan promokod",
    tryAgain: "Yana bir bor urinish",
    resultExpired: "Natija muddati tugagan",
    brandLogoAlt: "Brend logotipi",
    demoBadge: "Namuna natija",
    demoHint: "Bu haqiqiy mijoz natijasiga o'xshash ko'rinish",
  },
  ru: {
    idleTitle: "Узнай на кого из знаменитостей ты похож!",
    idleCta: "Покажи ✌️ в камеру",
    headlineDefault: "На кого из звёзд ты похож?",
    subtitleDefault: "Подойди ближе и покажи ✌️ в камеру",
    readyToSee: "Готов узнать?",
    stepBackHint: "Камера определит твоё лицо в кадре",
    consent: "Показывая ✌️, вы соглашаетесь на обработку своей фотографии.",
    analyzing: "Анализируем...",
    analyzingHint: "Сравниваем черты лица",
    similarity: "сходства",
    match: "СОВПАДЕНИЕ",
    celebritiesShown: "Обновляется каждый день",
    scanQr: "Сканируй QR-код, чтобы сохранить результат",
    secondsLeft: "секунд осталось",
    share: "Поделиться",
    shareTelegram: "Telegram",
    copyLink: "Скопировать ссылку",
    linkCopied: "Ссылка скопирована",
    promo: "Промокод от магазина",
    tryAgain: "Попробовать ещё раз",
    resultExpired: "Срок действия результата истёк",
    brandLogoAlt: "Логотип бренда",
    demoBadge: "Пример результата",
    demoHint: "Так выглядит результат настоящего гостя",
  },
};

export type Dict = {
  idleTitle: string;
  idleCta: string;
  headlineDefault: string;
  subtitleDefault: string;
  readyToSee: string;
  stepBackHint: string;
  consent: string;
  analyzing: string;
  analyzingHint: string;
  similarity: string;
  match: string;
  celebritiesShown: string;
  scanQr: string;
  secondsLeft: string;
  share: string;
  shareTelegram: string;
  copyLink: string;
  linkCopied: string;
  promo: string;
  tryAgain: string;
  resultExpired: string;
  brandLogoAlt: string;
  demoBadge: string;
  demoHint: string;
};

export function t(locale: Locale): Dict {
  return dict[locale] ?? dict.uz;
}

export const FONT_FAMILIES = ["manrope"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export function fontFamilyVar(_name?: string | null): string {
  return "var(--font-manrope)";
}
