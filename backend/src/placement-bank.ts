// Банк вопросов теста уровня. Сложность 0..5: 0-1 = A0, 2-3 = A1, 4-5 = A2.
// ВАЖНО: вопросы нужно проверить преподавателю нидерландского до запуска.
export type QType = 'mc' | 'gap' | 'listen';

export interface Question {
  id: string;
  level: number;
  type: QType;
  prompt: { nl: string; uk: string };
  say?: string; // текст для озвучивания в браузере (type = listen)
  options: string[];
  answer: number; // индекс верного варианта в options
}

const gap = (s: string) => `Kies het goede woord: ${s}`;
const gapUk = (s: string) => `Оберіть правильне слово: ${s}`;

export const BANK: Question[] = [
  // --- 0: A0, перші слова ---
  { id: 'p0a', level: 0, type: 'mc', prompt: { nl: 'Wat betekent “Goedemorgen”?', uk: 'Що означає «Goedemorgen»?' }, options: ['Доброго ранку', 'Добрий вечір', 'До побачення'], answer: 0 },
  { id: 'p0b', level: 0, type: 'mc', prompt: { nl: 'Wat betekent “Dank je wel”?', uk: 'Що означає «Dank je wel»?' }, options: ['Будь ласка', 'Дякую', 'Вибачте'], answer: 1 },
  { id: 'p0c', level: 0, type: 'listen', say: 'Goedenavond', prompt: { nl: 'Luister en kies de vertaling.', uk: 'Послухайте й оберіть переклад.' }, options: ['Добрий вечір', 'Доброго ранку', 'До побачення'], answer: 0 },
  { id: 'p0d', level: 0, type: 'mc', prompt: { nl: 'Wat betekent “drie”?', uk: 'Що означає «drie»?' }, options: ['2', '3', '4'], answer: 1 },
  { id: 'p0e', level: 0, type: 'mc', prompt: { nl: 'Wat betekent “het brood”?', uk: 'Що означає «het brood»?' }, options: ['Хліб', 'Сир', 'Яблуко'], answer: 0 },
  // --- 1: A0+, прості речення ---
  { id: 'p1a', level: 1, type: 'gap', prompt: { nl: gap('Ik ___ uit Oekraïne.'), uk: gapUk('Я з України.') }, options: ['kom', 'komt', 'komen'], answer: 0 },
  { id: 'p1b', level: 1, type: 'gap', prompt: { nl: gap('Hij ___ in Utrecht.'), uk: gapUk('Він живе в Утрехті.') }, options: ['woon', 'woont', 'wonen'], answer: 1 },
  { id: 'p1c', level: 1, type: 'mc', prompt: { nl: 'Wat betekent “de huisarts”?', uk: 'Що означає «de huisarts»?' }, options: ['Сімейний лікар', 'Аптека', 'Лікарня'], answer: 0 },
  { id: 'p1d', level: 1, type: 'mc', prompt: { nl: 'Welke zin is goed?', uk: 'Яке речення правильне?' }, options: ['Ik heet Olena.', 'Ik Olena heet.', 'Heet ik Olena.'], answer: 0 },
  { id: 'p1e', level: 1, type: 'mc', prompt: { nl: 'Wat betekent “links”?', uk: 'Що означає «links»?' }, options: ['Ліворуч', 'Праворуч', 'Прямо'], answer: 0 },
  // --- 2: A1 ---
  { id: 'p2a', level: 2, type: 'gap', prompt: { nl: gap('Wij ___ twee kinderen.'), uk: gapUk('У нас двоє дітей.') }, options: ['hebben', 'heeft', 'ben'], answer: 0 },
  { id: 'p2b', level: 2, type: 'gap', prompt: { nl: gap('___ is deze tas? — Het is mijn tas.'), uk: gapUk('Чия це сумка? — Це моя сумка.') }, options: ['Wie', 'Wat', 'Van wie'], answer: 2 },
  { id: 'p2c', level: 2, type: 'mc', prompt: { nl: 'Wat betekent “de afspraak”?', uk: 'Що означає «de afspraak»?' }, options: ['Домовленість про зустріч, запис', 'Адреса', 'Рахунок'], answer: 0 },
  { id: 'p2d', level: 2, type: 'mc', prompt: { nl: 'Welke zin is goed?', uk: 'Яке речення правильне?' }, options: ['De huis is groot.', 'Het huis is groot.', 'Huis het is groot.'], answer: 1 },
  { id: 'p2e', level: 2, type: 'listen', say: 'Ik woon in Utrecht en ik werk in een magazijn.', prompt: { nl: 'Luister. Waar werkt de persoon?', uk: 'Послухайте. Де працює ця людина?' }, options: ['In een magazijn', 'In een winkel', 'In een ziekenhuis'], answer: 0 },
  // --- 3: A1+ ---
  { id: 'p3a', level: 3, type: 'gap', prompt: { nl: gap('Ik wil een afspraak maken ___ de huisarts.'), uk: gapUk('Я хочу записатися до сімейного лікаря.') }, options: ['bij', 'met', 'aan'], answer: 0 },
  { id: 'p3b', level: 3, type: 'mc', prompt: { nl: 'Wat betekent “Ik heb hoofdpijn”?', uk: 'Що означає «Ik heb hoofdpijn»?' }, options: ['У мене болить голова', 'У мене болить живіт', 'У мене температура'], answer: 0 },
  { id: 'p3c', level: 3, type: 'gap', prompt: { nl: gap('Zij ___ morgen naar de dokter.'), uk: gapUk('Вона завтра йде до лікаря.') }, options: ['ga', 'gaat', 'gaan'], answer: 1 },
  { id: 'p3d', level: 3, type: 'gap', prompt: { nl: gap('Ik kom te laat, ___ de bus te laat was.'), uk: gapUk('Я запізнююся, тому що автобус запізнився.') }, options: ['omdat', 'daarom', 'want als'], answer: 0 },
  { id: 'p3e', level: 3, type: 'mc', prompt: { nl: 'De bus vertrekt om half drie. Hoe laat is dat?', uk: 'Автобус відправляється о «half drie». О котрій це?' }, options: ['14:30', '15:30', '14:15'], answer: 0 },
  // --- 4: A2 ---
  { id: 'p4a', level: 4, type: 'gap', prompt: { nl: gap('Gisteren ___ ik naar de markt gegaan.'), uk: gapUk('Вчора я ходив на ринок.') }, options: ['ben', 'heb', 'word'], answer: 0 },
  { id: 'p4b', level: 4, type: 'gap', prompt: { nl: gap('Ik heb mijn sleutels ___.'), uk: gapUk('Я загубив свої ключі.') }, options: ['verloren', 'verlies', 'verliezen'], answer: 0 },
  { id: 'p4c', level: 4, type: 'gap', prompt: { nl: gap('Kunt u mij vertellen ___ het station is?'), uk: gapUk('Не могли б ви сказати, де вокзал?') }, options: ['waar', 'wat', 'wie'], answer: 0 },
  { id: 'p4d', level: 4, type: 'mc', prompt: { nl: 'Wat is het meervoud van “het boek”?', uk: 'Яка форма множини від «het boek»?' }, options: ['Boekes', 'Boeken', 'Boekens'], answer: 1 },
  { id: 'p4e', level: 4, type: 'listen', say: 'Mijn afspraak bij de tandarts is verplaatst naar donderdag.', prompt: { nl: 'Luister. Wanneer is de afspraak nu?', uk: 'Послухайте. Коли тепер запис?' }, options: ['Op donderdag', 'Op dinsdag', 'Vandaag'], answer: 0 },
  // --- 5: A2+ ---
  { id: 'p5a', level: 5, type: 'gap', prompt: { nl: gap('Ik woon hier ___ 2023.'), uk: gapUk('Я живу тут з 2023 року.') }, options: ['sinds', 'voor', 'na'], answer: 0 },
  { id: 'p5b', level: 5, type: 'gap', prompt: { nl: gap('Als ik meer tijd had, ___ ik vaker sporten.'), uk: gapUk('Якби в мене було більше часу, я б займався спортом частіше.') }, options: ['zou', 'zal', 'wil'], answer: 0 },
  { id: 'p5c', level: 5, type: 'gap', prompt: { nl: gap('Ik heb geen zin ___ naar school te gaan.'), uk: gapUk('Мені не хочеться йти до школи.') }, options: ['om', 'voor', 'aan'], answer: 0 },
  { id: 'p5d', level: 5, type: 'mc', prompt: { nl: 'Welke zin is goed?', uk: 'Яке речення правильне?' }, options: ['Hoewel het regende, gingen we naar buiten.', 'Hoewel het regende, we gingen naar buiten.', 'Hoewel het regende gingen naar buiten we.'], answer: 0 },
  { id: 'p5e', level: 5, type: 'mc', prompt: { nl: 'Wat betekent “Ik ben het ermee eens”?', uk: 'Що означає «Ik ben het ermee eens»?' }, options: ['Я з цим згоден', 'Я з цим не згоден', 'Я цього не розумію'], answer: 0 },
];
