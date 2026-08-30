import type React from 'react';
import type { TabState, PasswordIndicatorState, PageTranslateState, PageTranslateProgress } from '../../../shared/ipc';
import type { SearchEngineId } from '../../../shared/searchEngines';
import type { PopoverFlags } from './usePopoverFlags';
import type { CapsuleMode } from './useOmniboxGeometry';
import type { ProfileBadge } from './useProfileBadge';
import { OmniboxInput } from './OmniboxInput';
import { ShieldButton } from './ShieldButton';
import { EngineCapsule } from './EngineCapsule';
import { PageActions } from './PageActions';
import { ISLAND_HEIGHT, omniField } from '../../styles/island';

/**
 * Пилюля омнибокса: щит, поле адреса и кнопки страницы.
 *
 * ⚠️ Пропсов много, и это честная цена, а не небрежность. Пилюля — единственное место тулбара,
 * где сходятся ВСЕ его состояния сразу: что во вкладке, что набрано, что запомнено, что открыто
 * поповером. Свести их в один объект значило бы завести ещё одну сущность, которой в программе
 * нет; оставить разметку внутри Toolbar() — держать двести строк вёрстки посреди движка
 * подсказок. Из двух зол выбрано то, что ловится типами.
 *
 * ⚠️ ЛОГИКИ ЗДЕСЬ НЕТ И БЫТЬ НЕ ДОЛЖНО. Разбор ввода, подсказки и их ранжирование остались в
 * Toolbar — это ровно то место, где проект дважды откатывался, и трогать его заодно с вёрсткой
 * нельзя.
 */
export interface OmniboxPillProps {
  tab: TabState | undefined;
  isHub: boolean;
  value: string;
  copied: boolean;
  bookmarked: boolean;
  vpnOn: boolean;
  profile: ProfileBadge | null;
  permHint: 'ask' | 'blocked' | null;
  popovers: PopoverFlags;
  passwordIndicator: PasswordIndicatorState | null;
  searchEngineId: SearchEngineId;
  inputRef: React.RefObject<HTMLInputElement>;
  omniboxPillRef: React.RefObject<HTMLDivElement>;
  siteControlRef: React.RefObject<HTMLButtonElement>;
  passwordControlRef: React.RefObject<HTMLDivElement>;
  draftsRef: React.MutableRefObject<Map<string, string>>;
  focusTracker: React.MutableRefObject<{ isRealFocus: boolean; mouseDownOnInput: boolean }>;
  pointerInInputRef: React.MutableRefObject<boolean>;
  selectAllPendingRef: React.MutableRefObject<boolean>;
  setValue: (v: string) => void;
  setEditing: (v: boolean) => void;
  copyUrl: () => void;
  toggleBookmark: () => void;
  triggerSuggest: (q: string) => void;
  showTopSites: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  togglePasswordPopover: () => void;
  toggleSitePopover: () => void;
  // Капсула поисковика и перевод страницы: их состояние тоже сходится здесь.
  capsuleMode: CapsuleMode;
  placeholderVisible: boolean;
  engineMenuOpen: boolean;
  setEngineMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  engineBtnRef: React.RefObject<HTMLButtonElement>;
  pickEngine: (id: SearchEngineId) => void;
  pageTranslateState: PageTranslateState;
  pageTranslateProgress: PageTranslateProgress | null;
}

export function OmniboxPill(p: OmniboxPillProps) {
  const {
    tab, isHub, copied, bookmarked, vpnOn, profile, permHint, popovers,
    passwordIndicator, searchEngineId, omniboxPillRef, siteControlRef,
    passwordControlRef, copyUrl, toggleBookmark, togglePasswordPopover, toggleSitePopover,
    capsuleMode, engineMenuOpen, setEngineMenuOpen, engineBtnRef, pickEngine,
    pageTranslateState, pageTranslateProgress,
  } = p;
  return (
  <div ref={omniboxPillRef} style={{
    ...omniField(),
    display: 'flex', alignItems: 'center', gap: 8, height: ISLAND_HEIGHT,
    padding: '0 12px', borderRadius: 'var(--radius-pill)',
  }}>
    {/* Щит — вход в карточку сайта (см. toolbar/ShieldButton.tsx). */}
    <ShieldButton
      btnRef={siteControlRef}
      vpnOn={vpnOn}
      popoverOpen={popovers.site}
      profile={profile}
      permHint={permHint}
      onToggle={toggleSitePopover}
    />
      <OmniboxInput {...p} />
    <PageActions
      visible={!isHub && !!tab?.url}
      hasPasswords={!!passwordIndicator}
      passwordsRef={passwordControlRef}
      passwordsOpen={popovers.password}
      onTogglePasswords={togglePasswordPopover}
      copied={copied}
      onCopy={copyUrl}
      bookmarked={bookmarked}
      onToggleBookmark={toggleBookmark}
      translateState={pageTranslateState}
      translateProgress={pageTranslateProgress}
      onMore={() => { void window.oblako.showOmniboxMoreMenu(); }}
    />
    {/* Капсула выбора поисковика — только на хабе, в контентных вкладках не рендерится вовсе.
        Схлопывается по тому же принципу, что VPN-пилюля (см. capsuleMode выше): на дефолтном
        окне омнибокс уже узкий (VPN-режим 'short' даёт ~278px) — полное имя туда не влезает
        и вылезает за скруглённый край пилюли, поэтому ниже CAPSULE_FULL_THRESHOLD показываем
        только первую букву названия. */}
    {isHub && (
      <EngineCapsule
        mode={capsuleMode}
        engineId={searchEngineId}
        open={engineMenuOpen}
        onToggle={() => setEngineMenuOpen((v) => !v)}
        onPick={pickEngine}
        btnRef={engineBtnRef}
      />
    )}
  </div>
  );
}
