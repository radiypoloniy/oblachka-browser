import type React from 'react';
import type { ImportDataType, ImportTypeResult } from '../../../shared/ipc';
import { sp, CAPS, TEXT, DISPLAY, RADIUS } from '../../styles/system';
import { btnGhost } from '../settings/kit';

// Мелочи, общие для шагов мастера. Живут отдельно, потому что нужны и корню, и шагу переноса:
// держать их в Onboarding.tsx значило бы импортировать экран из его собственной части.

export const TYPE_LABELS: Record<ImportDataType, string> = {
  bookmarks: 'Закладки',
  history: 'История',
  passwords: 'Пароли',
};

export function resultLine(type: ImportDataType, res: ImportTypeResult | null): string {
  const label = TYPE_LABELS[type];
  if (res === null) return `${label}: не удалось прочитать`;
  const parts = [`перенесено ${res.inserted}`];
  if (res.skipped > 0) parts.push(`уже были ${res.skipped}`);
  if (res.unsupported && res.unsupported > 0) parts.push(`не поддержано ${res.unsupported}`);
  return `${label}: ${parts.join(', ')}`;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ ...TEXT.body, color: 'var(--text-faint)', lineHeight: 1.5 }}>{children}</div>;
}

/** Крупная тихая кнопка мастера: те же роли, больше поле — экран разговаривает крупнее. */
export const bigGhost: React.CSSProperties = {
  ...btnGhost,
  padding: '11px 18px',
  fontSize: 'var(--fs-md)',
};

export // Крупный факт для карточки модели: подпись капсом сверху, число дисплейной гарнитурой снизу.
// ⚠️ Размер файла и требование к видеопамяти — единственные числа, по которым человек решает,
// соглашаться ли на загрузку. Они обязаны читаться первыми, а не быть серой строкой через «·».
function BigFact({ cap, value }: { cap: string; value: string }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: sp(1) }}>
      <span style={{ ...CAPS }}>{cap}</span>
      <span style={{
        ...DISPLAY, fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em',
        color: 'var(--text-strong)', lineHeight: 1,
      }}>{value}</span>
    </span>
  );
}

export // Оговорка шага индексации. Тире, а не значок: набор случайных иконок рядом с текстом читался
// как «странные символы» и мешал, вместо того чтобы помогать.
function IndexNote({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: 'flex', gap: sp(2), ...TEXT.body, color: 'var(--text-muted)', lineHeight: 1.5 }}>
      <span style={{ color: 'var(--text-faint)' }}>—</span>
      <span>{children}</span>
    </span>
  );
}

export // Полоса хода работы — общая для загрузки модели и чтения истории: обе долгие, обе продолжаются
// в фоне, и подпись про фон здесь не украшение, а единственное место, где человек узнаёт, что
// уходить со страницы можно.
function Progress({ done, total, label, hint }: { done: number; total: number | null; label: string; hint: string }) {
  const pct = total && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
      <div style={{ height: 10, borderRadius: RADIUS.pill, background: 'var(--surface-sunken)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: RADIUS.pill, background: 'var(--accent)',
          // Неизвестная длина — не повод врать полосой: показываем узкую «живую» вместо доли.
          width: pct === null ? '25%' : `${pct}%`,
          transition: 'width var(--dur-base) var(--ease-out)',
        }} />
      </div>
      <div style={{ ...TEXT.section, fontWeight: 550, color: 'var(--text-strong)' }}>{label}</div>
      <Muted>{hint}</Muted>
    </div>
  );
}

export function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} ГБ`;
}
