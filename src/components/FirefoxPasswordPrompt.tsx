import { Lock } from 'lucide-react';
import { islandPlate } from '../styles/island';
import { RADIUS, TEXT, sp, pad } from '../styles/system';

// Просьба ввести мастер-пароль Firefox при импорте. Общий блок для ДВУХ экранов — диалога импорта
// в настройках и шага переноса в мастере первого запуска.
//
// ⚠️ Отдельным компонентом, потому что копий должно быть ноль. Текст здесь не украшение, а
// объяснение единственного исхода импорта, который человек может исправить сам; разъехавшись,
// две копии дали бы два разных объяснения одному и тому же, и одно из них рано или поздно
// перестало бы соответствовать поведению.
//
// ⚠️ Показывать ЗАРАНЕЕ нельзя. Мастер-пароль в Firefox по умолчанию не задан, и у подавляющего
// большинства поле осталось бы пустым — то есть Oblako без причины просил бы пароль на первом же
// экране. Блок появляется только после того, как импорт в него действительно уткнулся.

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Enter в поле = повторить импорт: пароль вводят ради одного действия, тянуться к кнопке незачем. */
  onSubmit: () => void;
}

export default function FirefoxPasswordPrompt({ value, onChange, onSubmit }: Props) {
  return (
    <div style={{
      ...islandPlate, borderRadius: RADIUS.content, padding: pad(4),
      display: 'flex', flexDirection: 'column', gap: sp(3),
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: sp(3) }}>
        <Lock size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
        <span style={{ ...TEXT.body, color: 'var(--text-body)', lineHeight: 1.5 }}>
          Пароли в этом профиле Firefox закрыты мастер-паролем. Введите его, чтобы перенести —
          он нужен только на время импорта и никуда не сохраняется.
        </span>
      </div>
      <input
        type="password"
        value={value}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
        placeholder="Мастер-пароль Firefox"
        style={{
          ...TEXT.body, width: '100%', padding: `${sp(2)}px ${sp(3)}px`,
          borderRadius: RADIUS.control, border: '1px solid var(--divider-strong)',
          background: 'var(--surface)', color: 'var(--text-strong)',
          fontFamily: 'inherit', outline: 'none',
        }}
      />
    </div>
  );
}
