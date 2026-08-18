// Простой CSS-тумблер — вынесен из Settings.tsx в отдельный файл, чтобы AdBlockSitePanel.tsx
// (живёт в изолированной WebContentsView поповера, см. vpnpopover.tsx) не тянул за собой весь
// Settings.tsx с его паролями/VPN-настройками ради одного маленького компонента (Rollup иначе
// кладёт Toggle в общий чанк Settings — лишние ~50кБ в лёгкий оверлей поверх страницы).
export default function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        // radius-pill (999) клэмпится до половины высоты (24/2=12) — визуально та же капсула,
        // что и раньше литералом 12, но теперь через токен вместо magic number.
        position: 'relative', width: 44, height: 24, borderRadius: 'var(--radius-pill)',
        border: 'none', cursor: 'default', flex: 'none', padding: 0,
        // Трек в покое — recessed well (тот же токен, что и «chip track», см. colors.css::
        // --surface-sunken), не сырой --neutral-300.
        background: checked ? 'var(--accent)' : 'var(--surface-sunken)',
        transition: 'background var(--dur-base) var(--ease-standard)',
      }}
    >
      <span style={{
        // Бегунок ездит ТРАНСФОРМОМ, а не свойством left: left — это вёрстка, браузер
        // пересчитывает её на каждом кадре, и переключатель выглядел мёртвым. transform
        // живёт на компоновщике и идёт ровно.
        position: 'absolute', top: 3, left: 3,
        transform: checked ? 'translateX(20px)' : 'none',
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        // Лёгкий перелёт: бегунок чуть проскакивает и возвращается — от этого переключение
        // читается как физическое действие, а не как смена картинки. Это сознательное
        // отступление от «no bounces» в токенах движения: там правило про интерфейс в целом,
        // а тумблер — единственный элемент, который человек буквально «дёргает».
        transition: 'transform var(--dur-base) var(--ease-out)',
        // Литерал намеренно: ближайший токен --shadow-chip (0 1px 2px rgba(30,25,60,.07)) заметно
        // слабее/светлее — бегунку нужна более контрастная тень, чтобы читаться поверх заливки
        // трека (--accent/--surface-sunken), готового токена под это в системе нет.
        boxShadow: '0 1px 3px rgba(0,0,0,.2)',
      }} />
    </button>
  );
}
