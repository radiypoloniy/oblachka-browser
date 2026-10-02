// Тема стоит после естественной формулировки воспоминания, за прежним лимитом восьми частей.
export const intentCases=[
  {key:'battery',query:'Найди пожалуйста ту статью которую я недавно читал в браузере про литиевые батареи',topic:'литиевые батареи',target:'battery',evidence:'Охлаждение литиевых батарей уменьшает износ'},
  {key:'dns',query:'Где найти тот материал который я раньше смотрел в браузере о DNS over HTTPS',topic:'DNS over HTTPS',target:'dns',evidence:'DNS over HTTPS шифрует запросы'},
  {key:'backup',query:'Покажи пожалуйста ту страницу которую я недавно открывал в браузере про резервное копирование',topic:'резервное копирование',target:'backup',evidence:'Резервное копирование по правилу 3-2-1'},
  {key:'camera',query:'Где та статья которую я читал на прошлой неделе об экспозиции',topic:'экспозиции',target:'camera',evidence:'Компенсация экспозиции помогает сохранить детали снега'},
  {key:'plants',query:'Найди тот материал который я недавно читал в браузере про суккуленты',topic:'суккуленты',target:'short',evidence:'Суккуленты поливают только после полного высыхания грунта.'},
  {key:'english',query:'Find the article that I read a few days ago about lithium battery',topic:'lithium battery',target:'english',evidence:'Keeping a lithium battery cool reduces degradation'},
  {key:'aurora',query:'Show me the page that I read earlier in the browser about полярное сияние',topic:'полярное сияние',target:'start',evidence:'Полярное сияние возникает'},
  {key:'missing',query:'Найди тот материал который я недавно читал в браузере про нейтринный телескоп',topic:'нейтринный телескоп',target:null},
];
