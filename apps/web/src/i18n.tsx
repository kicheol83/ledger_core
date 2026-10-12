import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AmountErrorCode } from './lib/money';

export type Lang = 'ko' | 'en' | 'uz';

export const LANGS: Lang[] = ['ko', 'en', 'uz'];

type TimeUnit = 's' | 'm' | 'h' | 'd';

const en = {
  skip: 'Skip to content',
  strapline: 'Every amount here is derived from the entry log. Nothing is stored as a total.',
  navAria: 'Sections',
  langAria: 'Language',
  navAccounts: 'Accounts',
  navAccountsHint: 'Balances derived from entries',
  navTransfer: 'Move money',
  navTransferHint: 'Transfer, deposit, withdraw',
  navJournal: 'Journal',
  navJournalHint: 'Every transaction, both sides',
  navDelivery: 'Delivery',
  navDeliveryHint: 'Outbox events and dead letters',
  notFoundTitle: 'No such page',
  notFoundHint: 'Pick a section from the list on the left.',
  retry: 'Try again',
  trace: 'Trace',

  accountsIntro:
    "No balance is stored. Each figure below is the sum of that account's entries, computed when this page loaded.",
  accountsLoading: 'Reading accounts…',
  accountsNone: 'This person has no accounts yet. Open one above to start.',
  accountsNoPerson: "Enter a person's id to see their accounts, or create one.",
  ledgerChecking: 'Checking the ledger…',
  ledgerCheck: 'Ledger check',
  ledgerBalanced:
    'Every currency sums to zero across all accounts. Value has been neither created nor destroyed.',
  ledgerOutBy: (currency: string, amount: string): string => `${currency} is out by ${amount}`,
  ledgerBroken: 'Stop and investigate before trusting any figure on this page.',
  personId: 'Person id',
  showAccounts: 'Show accounts',
  addSomeone: 'Or add someone new',
  adding: 'Adding…',
  addPerson: 'Add person',
  createPersonFailed: 'Could not create the person.',
  openAnAccount: 'Open an account',
  opening: 'Opening…',
  openAccount: 'Open account',
  openAccountFailed: 'Could not open the account.',
  noEntriesYet: 'No entries yet',
  summedFrom: (count: number): string =>
    `Summed from ${count} ${count === 1 ? 'entry' : 'entries'}`,
  throughEntry: ', through entry ',
  summing: 'Summing…',
  viewEntries: 'View entries',
  zeroNote: 'Balanced to zero, the entries cancel out rather than being absent.',
  accountStatus: { ACTIVE: 'Active', FROZEN: 'Frozen', CLOSED: 'Closed' },

  transferIntro:
    'Each of these writes two entries that sum to zero. Send the same request several times with one key to see it applied once.',
  operationAria: 'Operation',
  opTransfer: 'Transfer',
  opDeposit: 'Deposit',
  opWithdraw: 'Withdraw',
  fromAccount: 'From account',
  toAccount: 'To account',
  account: 'Account',
  amount: 'Amount',
  currency: 'Currency',
  idempotencyKey: 'Idempotency key',
  newKey: 'New key',
  keyHelp:
    "Keep the key and press again: the second request returns the first one's stored answer instead of moving money twice. Change the key and it becomes a new instruction.",
  copies: 'Copies to send at once',
  sending: 'Sending…',
  send: 'Send',
  sendCopies: (count: number): string => `Send ${count} copies`,
  checkAmount: 'Check the amount.',
  whatHappened: 'What happened',
  movedTimes: (count: number): string =>
    count === 1 ? 'Money moved once' : `Money moved ${count} times`,
  replayedCopies: (count: number): string =>
    `, and ${count} ${count === 1 ? 'copy' : 'copies'} got the stored answer back`,
  outcome: { applied: 'Applied', replayed: 'Replayed', refused: 'Refused', failed: 'Failed' },
  entriesWritten: 'The entries written',
  debit: 'Debit',
  credit: 'Credit',
  debitsMinusCredits: 'Debits minus credits:',
  balancesNote:
    '— the transaction balances, which is what the database checked before it committed.',
  amountError: (code: AmountErrorCode, currency: string, exponent: number): string =>
    ({
      empty: 'Enter an amount.',
      format: 'Use digits and at most one decimal point.',
      noDecimals: `${currency} has no smaller unit, so no decimals.`,
      tooManyDecimals: `${currency} goes to ${exponent} decimal places.`,
      notPositive: 'Enter an amount above zero.',
    })[code],

  journalIntro:
    'Every movement on one account, newest first. Amounts sit on the side they moved: out on the left, in on the right.',
  accountId: 'Account id',
  showJournal: 'Show journal',
  journalEnterId: 'Enter an account id to read its journal.',
  journalLoading: 'Reading the journal…',
  journalEmpty: 'Nothing has moved on this account yet.',
  reading: 'Reading…',
  earlierEntries: 'Earlier entries',
  journalEnd: 'That is the whole journal for this account.',
  out: 'Out',
  in: 'In',
  entry: 'Entry',
  reversed: 'Reversed',
  readingBothSides: 'Reading both sides…',
  readTransactionFailed: 'Could not read this transaction.',
  reverseFailed: 'Could not reverse it.',
  transaction: 'Transaction',
  status: 'Status',
  undoes: 'Undoes',
  entriesCaption:
    'Every ledger entry belonging to this transaction, with its account and direction.',
  thisAccount: ' · this account',
  sum: 'Sum',
  reversing: 'Reversing…',
  reverseTransaction: 'Reverse this transaction',
  reverseNote: 'Writes the mirror image as a new transaction. Nothing here is edited or removed.',
  transactionType: {
    TRANSFER: 'Transfer',
    DEPOSIT: 'Deposit',
    WITHDRAWAL: 'Withdrawal',
    REVERSAL: 'Reversal',
  },
  transactionStatus: {
    PENDING: 'Pending',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    REVERSED: 'Reversed',
  },

  deliveryIntro:
    'Every movement of money writes an event in the same transaction as its entries. A separate worker takes them from here and sends them out.',
  queueLoading: 'Reading the queue…',
  filterAria: 'Filter events',
  filterAll: 'Everything',
  waiting: 'Waiting',
  delivered: 'Delivered',
  givenUp: 'Given up',
  refreshEvery: 'Refresh every 2s',
  eventsLoading: 'Reading events…',
  noneGivenUp: 'Nothing has been given up on. Every event has been delivered or is still trying.',
  noEvents: 'No events yet. Move some money and they will appear here.',
  oldestWaiting: 'Oldest waiting',
  healthFailed:
    'Some events were given up on. Nothing will retry them on its own, a person has to decide what to do.',
  healthStalled:
    'Events have been waiting longer than expected. Check that the worker process is running.',
  healthOk:
    'The queue is draining. Money already moved regardless, delivery is what happens afterwards.',
  eventsCaption: 'Outbox events with their delivery status, attempt count and last error.',
  event: 'Event',
  state: 'State',
  tries: 'Tries',
  when: 'When',
  ago: (value: number, unit: TimeUnit): string => `${value}${unit} ago`,
};

export type Messages = typeof en;

const ko: Messages = {
  skip: '본문으로 건너뛰기',
  strapline: '여기 있는 모든 금액은 엔트리 기록에서 계산합니다. 합계로 저장된 값은 없습니다.',
  navAria: '메뉴',
  langAria: '언어',
  navAccounts: '계좌',
  navAccountsHint: '엔트리에서 계산한 잔액',
  navTransfer: '자금 이동',
  navTransferHint: '이체, 입금, 출금',
  navJournal: '분개장',
  navJournalHint: '모든 거래의 양쪽 엔트리',
  navDelivery: '이벤트 전달',
  navDeliveryHint: 'Outbox 이벤트와 전달 포기',
  notFoundTitle: '페이지를 찾을 수 없습니다',
  notFoundHint: '왼쪽 목록에서 메뉴를 선택하세요.',
  retry: '다시 시도',
  trace: 'Trace',

  accountsIntro:
    '잔액은 저장하지 않습니다. 아래 금액은 이 페이지를 열 때 각 계좌의 엔트리를 합산한 값입니다.',
  accountsLoading: '계좌를 읽는 중…',
  accountsNone: '아직 계좌가 없습니다. 위에서 계좌를 개설하세요.',
  accountsNoPerson: '사용자 ID를 입력해 계좌를 보거나, 새 사용자를 추가하세요.',
  ledgerChecking: '원장을 검사하는 중…',
  ledgerCheck: '원장 검사',
  ledgerBalanced: '모든 통화의 전체 계좌 합계가 0입니다. 돈이 새로 생기거나 사라지지 않았습니다.',
  ledgerOutBy: (currency, amount) => `${currency} 불일치 ${amount}`,
  ledgerBroken: '이 페이지의 숫자를 믿기 전에 먼저 원인을 조사하세요.',
  personId: '사용자 ID',
  showAccounts: '계좌 보기',
  addSomeone: '또는 새 사용자 추가',
  adding: '추가하는 중…',
  addPerson: '사용자 추가',
  createPersonFailed: '사용자를 만들지 못했습니다.',
  openAnAccount: '계좌 개설',
  opening: '개설하는 중…',
  openAccount: '계좌 개설',
  openAccountFailed: '계좌를 개설하지 못했습니다.',
  noEntriesYet: '아직 엔트리가 없습니다',
  summedFrom: (count) => `엔트리 ${count}개 합산`,
  throughEntry: ', 마지막 엔트리 ',
  summing: '합산하는 중…',
  viewEntries: '엔트리 보기',
  zeroNote: '잔액 0: 엔트리가 없는 것이 아니라 서로 상쇄된 결과입니다.',
  accountStatus: { ACTIVE: '활성', FROZEN: '동결', CLOSED: '해지' },

  transferIntro:
    '모든 작업은 합이 0인 엔트리 두 개를 기록합니다. 같은 키로 요청을 여러 번 보내도 한 번만 적용되는 것을 확인할 수 있습니다.',
  operationAria: '작업',
  opTransfer: '이체',
  opDeposit: '입금',
  opWithdraw: '출금',
  fromAccount: '보내는 계좌',
  toAccount: '받는 계좌',
  account: '계좌',
  amount: '금액',
  currency: '통화',
  idempotencyKey: '멱등성 키',
  newKey: '새 키',
  keyHelp:
    '키를 그대로 두고 다시 누르면 두 번째 요청은 돈을 다시 옮기지 않고 첫 요청의 저장된 응답을 돌려받습니다. 키를 바꾸면 새로운 요청이 됩니다.',
  copies: '동시에 보낼 요청 수',
  sending: '보내는 중…',
  send: '보내기',
  sendCopies: (count) => `${count}개 동시에 보내기`,
  checkAmount: '금액을 확인하세요.',
  whatHappened: '결과',
  movedTimes: (count) => (count === 1 ? '돈은 한 번 이동했습니다' : `돈이 ${count}번 이동했습니다`),
  replayedCopies: (count) => `, 나머지 ${count}개 요청은 저장된 응답을 돌려받았습니다`,
  outcome: { applied: '적용됨', replayed: '저장된 응답', refused: '거부됨', failed: '실패' },
  entriesWritten: '기록된 엔트리',
  debit: '차변',
  credit: '대변',
  debitsMinusCredits: '차변 − 대변:',
  balancesNote: '— 거래가 균형을 이루며, 데이터베이스가 커밋 전에 이를 검사했습니다.',
  amountError: (code, currency, exponent) =>
    ({
      empty: '금액을 입력하세요.',
      format: '숫자와 소수점 하나만 사용하세요.',
      noDecimals: `${currency}는 더 작은 단위가 없어 소수점을 쓸 수 없습니다.`,
      tooManyDecimals: `${currency}는 소수점 ${exponent}자리까지 입력할 수 있습니다.`,
      notPositive: '0보다 큰 금액을 입력하세요.',
    })[code],

  journalIntro:
    '한 계좌의 모든 움직임을 최신순으로 보여 줍니다. 나간 금액은 왼쪽, 들어온 금액은 오른쪽에 있습니다.',
  accountId: '계좌 ID',
  showJournal: '분개장 보기',
  journalEnterId: '계좌 ID를 입력하면 분개장을 볼 수 있습니다.',
  journalLoading: '분개장을 읽는 중…',
  journalEmpty: '이 계좌에는 아직 움직임이 없습니다.',
  reading: '읽는 중…',
  earlierEntries: '이전 엔트리',
  journalEnd: '이 계좌의 분개장은 여기까지입니다.',
  out: '나감',
  in: '들어옴',
  entry: '엔트리',
  reversed: '취소됨',
  readingBothSides: '양쪽 엔트리를 읽는 중…',
  readTransactionFailed: '이 거래를 읽지 못했습니다.',
  reverseFailed: '취소하지 못했습니다.',
  transaction: '거래',
  status: '상태',
  undoes: '취소 대상',
  entriesCaption: '이 거래에 속한 모든 원장 엔트리와 각 계좌, 방향',
  thisAccount: ' · 이 계좌',
  sum: '합계',
  reversing: '취소하는 중…',
  reverseTransaction: '이 거래 취소',
  reverseNote: '반대 방향의 새 거래를 기록합니다. 기존 기록은 수정하거나 삭제하지 않습니다.',
  transactionType: { TRANSFER: '이체', DEPOSIT: '입금', WITHDRAWAL: '출금', REVERSAL: '취소' },
  transactionStatus: { PENDING: '대기', COMPLETED: '완료', FAILED: '실패', REVERSED: '취소됨' },

  deliveryIntro:
    '모든 자금 이동은 엔트리와 같은 트랜잭션에 이벤트를 기록합니다. 별도의 워커가 여기서 이벤트를 가져가 외부로 보냅니다.',
  queueLoading: '큐를 읽는 중…',
  filterAria: '이벤트 필터',
  filterAll: '전체',
  waiting: '대기',
  delivered: '전달됨',
  givenUp: '전달 포기',
  refreshEvery: '2초마다 새로고침',
  eventsLoading: '이벤트를 읽는 중…',
  noneGivenUp: '전달을 포기한 이벤트가 없습니다. 모든 이벤트가 전달됐거나 아직 시도 중입니다.',
  noEvents: '아직 이벤트가 없습니다. 자금을 이동하면 여기에 나타납니다.',
  oldestWaiting: '가장 오래 대기',
  healthFailed:
    '전달을 포기한 이벤트가 있습니다. 자동으로 재시도하지 않으므로 사람이 처리 방법을 결정해야 합니다.',
  healthStalled:
    '이벤트가 예상보다 오래 대기하고 있습니다. 워커 프로세스가 실행 중인지 확인하세요.',
  healthOk: '큐가 정상적으로 비워지고 있습니다. 돈은 이미 이동했고, 전달은 그다음 단계입니다.',
  eventsCaption: 'Outbox 이벤트와 전달 상태, 시도 횟수, 마지막 오류',
  event: '이벤트',
  state: '상태',
  tries: '시도',
  when: '시각',
  ago: (value, unit) => `${value}${{ s: '초', m: '분', h: '시간', d: '일' }[unit]} 전`,
};

const uz: Messages = {
  skip: "Asosiy qismga o'tish",
  strapline:
    'Bu yerdagi har bir summa yozuvlar jurnalidan hisoblanadi. Hech qanday jami saqlanmaydi.',
  navAria: "Bo'limlar",
  langAria: 'Til',
  navAccounts: 'Hisoblar',
  navAccountsHint: 'Yozuvlardan hisoblangan balans',
  navTransfer: 'Pul harakati',
  navTransferHint: "O'tkazma, kiritish, yechish",
  navJournal: 'Jurnal',
  navJournalHint: 'Har bir tranzaksiya, ikkala tomoni',
  navDelivery: 'Yetkazish',
  navDeliveryHint: 'Outbox hodisalari va yetkazilmaganlar',
  notFoundTitle: "Bunday sahifa yo'q",
  notFoundHint: "Chapdagi ro'yxatdan bo'limni tanlang.",
  retry: 'Qayta urinish',
  trace: 'Trace',

  accountsIntro:
    "Balans saqlanmaydi. Quyidagi har bir summa sahifa ochilganda hisobning yozuvlarini qo'shib hisoblangan.",
  accountsLoading: "Hisoblar o'qilmoqda…",
  accountsNone: "Bu shaxsda hali hisob yo'q. Boshlash uchun yuqorida hisob oching.",
  accountsNoPerson: "Hisoblarni ko'rish uchun shaxs ID sini kiriting yoki yangisini qo'shing.",
  ledgerChecking: 'Ledger tekshirilmoqda…',
  ledgerCheck: 'Ledger tekshiruvi',
  ledgerBalanced:
    "Barcha hisoblar bo'yicha har bir valyuta yig'indisi nolga teng. Qiymat paydo ham bo'lmagan, yo'qolmagan ham.",
  ledgerOutBy: (currency, amount) => `${currency} farqi ${amount}`,
  ledgerBroken: "Bu sahifadagi raqamlarga ishonishdan oldin to'xtab, sababini tekshiring.",
  personId: 'Shaxs ID',
  showAccounts: "Hisoblarni ko'rish",
  addSomeone: "Yoki yangi shaxs qo'shing",
  adding: "Qo'shilmoqda…",
  addPerson: "Shaxs qo'shish",
  createPersonFailed: "Shaxsni yaratib bo'lmadi.",
  openAnAccount: 'Hisob ochish',
  opening: 'Ochilmoqda…',
  openAccount: 'Hisob ochish',
  openAccountFailed: "Hisobni ochib bo'lmadi.",
  noEntriesYet: "Hali yozuv yo'q",
  summedFrom: (count) => `${count} ta yozuvdan hisoblandi`,
  throughEntry: ', oxirgi yozuv ',
  summing: 'Hisoblanmoqda…',
  viewEntries: "Yozuvlarni ko'rish",
  zeroNote: "Balans nol: yozuvlar yo'q emas, ular bir-birini qoplagan.",
  accountStatus: { ACTIVE: 'Faol', FROZEN: 'Muzlatilgan', CLOSED: 'Yopilgan' },

  transferIntro:
    "Har bir amal yig'indisi nolga teng ikkita yozuv yozadi. Bitta kalit bilan so'rovni bir necha marta yuborib, faqat bir marta bajarilishini ko'ring.",
  operationAria: 'Amal',
  opTransfer: "O'tkazma",
  opDeposit: 'Kiritish',
  opWithdraw: 'Yechish',
  fromAccount: 'Qaysi hisobdan',
  toAccount: 'Qaysi hisobga',
  account: 'Hisob',
  amount: 'Summa',
  currency: 'Valyuta',
  idempotencyKey: 'Idempotentlik kaliti',
  newKey: 'Yangi kalit',
  keyHelp:
    "Kalitni o'zgartirmay yana bossangiz, ikkinchi so'rov pulni qayta o'tkazmaydi, birinchisining saqlangan javobini qaytaradi. Kalitni o'zgartirsangiz, bu yangi buyruq bo'ladi.",
  copies: 'Bir vaqtda yuboriladigan nusxalar',
  sending: 'Yuborilmoqda…',
  send: 'Yuborish',
  sendCopies: (count) => `${count} ta nusxa yuborish`,
  checkAmount: 'Summani tekshiring.',
  whatHappened: "Nima bo'ldi",
  movedTimes: (count) =>
    count === 1 ? "Pul bir marta o'tkazildi" : `Pul ${count} marta o'tkazildi`,
  replayedCopies: (count) => `, ${count} ta nusxa saqlangan javobni oldi`,
  outcome: {
    applied: 'Bajarildi',
    replayed: 'Saqlangan javob',
    refused: 'Rad etildi',
    failed: 'Xato',
  },
  entriesWritten: 'Yozilgan yozuvlar',
  debit: 'Debet',
  credit: 'Kredit',
  debitsMinusCredits: 'Debet minus kredit:',
  balancesNote: "— tranzaksiya muvozanatda; ma'lumotlar bazasi buni commit'dan oldin tekshirgan.",
  amountError: (code, currency, exponent) =>
    ({
      empty: 'Summani kiriting.',
      format: "Faqat raqamlar va bitta o'nlik nuqta ishlating.",
      noDecimals: `${currency}da kichik birlik yo'q, kasr ishlatilmaydi.`,
      tooManyDecimals: `${currency} ${exponent} xonali kasrgacha.`,
      notPositive: 'Noldan katta summa kiriting.',
    })[code],

  journalIntro:
    "Bitta hisobdagi barcha harakatlar, eng yangisi birinchi. Chiqim chapda, kirim o'ngda.",
  accountId: 'Hisob ID',
  showJournal: "Jurnalni ko'rish",
  journalEnterId: "Jurnalni ko'rish uchun hisob ID sini kiriting.",
  journalLoading: "Jurnal o'qilmoqda…",
  journalEmpty: "Bu hisobda hali harakat bo'lmagan.",
  reading: "O'qilmoqda…",
  earlierEntries: 'Oldingi yozuvlar',
  journalEnd: 'Bu hisobning jurnali shu yerda tugaydi.',
  out: 'Chiqim',
  in: 'Kirim',
  entry: 'Yozuv',
  reversed: 'Bekor qilingan',
  readingBothSides: "Ikkala tomon o'qilmoqda…",
  readTransactionFailed: "Bu tranzaksiyani o'qib bo'lmadi.",
  reverseFailed: "Bekor qilib bo'lmadi.",
  transaction: 'Tranzaksiya',
  status: 'Holat',
  undoes: 'Bekor qiladi',
  entriesCaption: "Ushbu tranzaksiyaga tegishli barcha yozuvlar, hisobi va yo'nalishi bilan.",
  thisAccount: ' · shu hisob',
  sum: "Yig'indi",
  reversing: 'Bekor qilinmoqda…',
  reverseTransaction: 'Bu tranzaksiyani bekor qilish',
  reverseNote:
    "Teskari yo'nalishdagi yangi tranzaksiya yoziladi. Hech narsa tahrirlanmaydi yoki o'chirilmaydi.",
  transactionType: {
    TRANSFER: "O'tkazma",
    DEPOSIT: 'Kiritish',
    WITHDRAWAL: 'Yechish',
    REVERSAL: 'Bekor qilish',
  },
  transactionStatus: {
    PENDING: 'Kutilmoqda',
    COMPLETED: 'Bajarilgan',
    FAILED: 'Xato',
    REVERSED: 'Bekor qilingan',
  },

  deliveryIntro:
    'Har bir pul harakati yozuvlari bilan bitta tranzaksiyada hodisa yozadi. Alohida worker ularni shu yerdan olib, tashqariga yuboradi.',
  queueLoading: "Navbat o'qilmoqda…",
  filterAria: 'Hodisalarni filtrlash',
  filterAll: 'Hammasi',
  waiting: 'Kutilmoqda',
  delivered: 'Yetkazildi',
  givenUp: 'Voz kechildi',
  refreshEvery: 'Har 2 soniyada yangilash',
  eventsLoading: "Hodisalar o'qilmoqda…",
  noneGivenUp: "Voz kechilgan hodisa yo'q. Hammasi yetkazilgan yoki hali urinilmoqda.",
  noEvents: "Hali hodisa yo'q. Pul o'tkazsangiz, shu yerda paydo bo'ladi.",
  oldestWaiting: 'Eng uzoq kutayotgan',
  healthFailed:
    "Ba'zi hodisalardan voz kechildi. Ular o'z-o'zidan qayta yuborilmaydi, nima qilishni odam hal qilishi kerak.",
  healthStalled: 'Hodisalar kutilganidan uzoq kutmoqda. Worker jarayoni ishlayotganini tekshiring.',
  healthOk:
    "Navbat bo'shayapti. Pul baribir allaqachon o'tkazilgan, yetkazish undan keyin bo'ladi.",
  eventsCaption: 'Outbox hodisalari, yetkazish holati, urinishlar soni va oxirgi xato bilan.',
  event: 'Hodisa',
  state: 'Holat',
  tries: 'Urinish',
  when: 'Vaqt',
  ago: (value, unit) => `${value} ${{ s: 'soniya', m: 'daqiqa', h: 'soat', d: 'kun' }[unit]} oldin`,
};

const MESSAGES: Record<Lang, Messages> = { ko, en, uz };

const STORAGE_KEY = 'ledgercore.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en' || saved === 'uz') {
      return saved;
    }
  } catch {
    return 'ko';
  }
  return 'ko';
}

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Messages;
}

const I18nContext = createContext<I18n | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18n>(
    () => ({
      lang,
      t: MESSAGES[lang],
      setLang: (next) => {
        setLangState(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          return;
        }
      },
    }),
    [lang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return value;
}
