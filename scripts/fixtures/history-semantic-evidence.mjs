// Свежие пары для проверки переноса; короткие фрагменты даны целиком, без подсказки правильного ответа.
const page=(key,title,snippet)=>({key,title,snippet,url:'https://evidence.test/article/'+key});
const german=page('german','Pflegehinweise','Eine kühle Lithiumbatterie altert beim Laden langsamer. Gute Kühlung schützt den Akku während des Ladevorgangs.'),
  english=page('english','Maintenance notes','Keeping a lithium battery cool reduces degradation during charging.'),
  russian=page('russian','Уход за батареей','Охлаждение литиевого аккумулятора уменьшает износ при зарядке.');
const mac=page('mac','Установка приложения','В macOS приложение устанавливают из пакета pkg. Этот пакет не предназначен для Windows.'),
  win=page('win','Установка приложения','В Windows приложение устанавливают из файла exe. Этот файл не предназначен для macOS.'),
  linux=page('linux','Установка приложения','В Linux приложение устанавливают через apt. Установка для macOS не описана.');
const local=page('local','Перевод документов','Локальная модель переводит текст на компьютере без подключения к интернету. Отправка текста на сервер не требуется.'),
  cloud=page('cloud','Перевод документов','Перевод текста выполняется облачным сервисом. Нужен интернет, документ отправляют на сервер.');
const leaf=page('leaf','Уход за электромобилем','Nissan Leaf: срок службы аккумулятора зависит от температуры и привычек зарядки. Статья посвящена Nissan Leaf.'),
  prius=page('prius','Уход за гибридом','Toyota Prius: срок службы аккумулятора зависит от температуры и состояния охлаждения. Nissan Leaf здесь не рассматривается.');
const anc=page('anc','Устройство наушников','Активное шумоподавление создаёт противофазный сигнал и уменьшает окружающий шум, который слышит человек.'),
  passive=page('passive','Устройство наушников','Плотные амбушюры физически изолируют уши от шума. Электронное шумоподавление не используется.');
export const evidenceHeldout=[
  {key:'fresh-german',query:'найди немецкую заметку об износе аккумулятора при зарядке',target:'german',acceptable:['german'],forbidden:['english','russian'],candidates:[russian,english,german]},
  {key:'fresh-macos',query:'как установить приложение в macOS, без инструкции для Windows',target:'mac',acceptable:['mac'],forbidden:['win','linux'],candidates:[win,linux,mac]},
  {key:'fresh-offline',query:'чтобы переводить текст без сети и отправки на сервер',target:'local',acceptable:['local'],forbidden:['cloud'],candidates:[cloud,local]},
  {key:'fresh-leaf',query:'от чего зависит ресурс аккумулятора Nissan Leaf',target:'leaf',acceptable:['leaf'],forbidden:['prius'],candidates:[prius,leaf]},
  {key:'fresh-sound',query:'как наушники гасят окружающий грохот встречным сигналом',target:'anc',acceptable:['anc'],forbidden:['passive'],candidates:[passive,anc]},
  {key:'fresh-missing-french',query:'найди французский материал про износ аккумулятора при зарядке',target:null,acceptable:[],forbidden:[],candidates:[german,english,russian]},
  {key:'fresh-missing-apple',query:'инструкция по установке приложения в iOS',target:null,acceptable:[],forbidden:[],candidates:[mac,win,linux]},
];
