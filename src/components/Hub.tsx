import { useState } from 'react';
import { Sparkles, ArrowUp, Lock } from 'lucide-react';

// Упрощённый AI-хаб для прототипа ядра: поле ввода, которое создаёт реальную
// вкладку. Полный хаб (режимы AI/веб, выбор модели, недавние чаты) — Этап 5.
export default function Hub({ onSubmit }: { onSubmit: (input: string) => void }) {
  const [value, setValue] = useState('');
  const submit = () => { const v = value.trim(); if (v) { onSubmit(v); setValue(''); } };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 32, overflowY: 'auto',
    }}>
      <h1 style={{
        margin: '0 0 8px', fontSize: 'var(--fs-3xl)', fontWeight: 700,
        letterSpacing: 'var(--ls-tight)', color: 'var(--text-strong)', textAlign: 'center',
      }}>
        Чем займёмся, <span style={{ color: 'var(--accent)' }}>Антон</span>?
      </h1>
      <p style={{ margin: '0 0 28px', color: 'var(--text-muted)', textAlign: 'center', fontSize: 'var(--fs-md)' }}>
        Введите адрес или поисковый запрос, чтобы открыть страницу.
      </p>

      <div style={{
        width: '100%', maxWidth: 680, background: 'var(--surface-island)',
        backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)',
        borderRadius: 'var(--radius-island)', boxShadow: 'var(--shadow-island)',
        padding: 18, overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sparkles size={20} style={{ color: 'var(--accent)', flex: 'none' }} />
          <input
            autoFocus value={value}
            placeholder="Спросите что угодно или вставьте ссылку…"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontSize: 'var(--fs-lg)', color: 'var(--text-strong)',
            }}
          />
          <button onClick={submit} title="Открыть" style={{
            width: 38, height: 38, flex: 'none', borderRadius: 'var(--radius-chip)',
            border: 'none', cursor: 'default', background: 'var(--accent)',
            color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}><ArrowUp size={18} /></button>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7, marginTop: 14,
          fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
        }}>
          <Lock size={12} /> Локальный режим — запрос остаётся на вашем устройстве
        </div>
      </div>
    </div>
  );
}
