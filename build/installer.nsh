; Регистрация Oblako как браузера в Windows.
;
; Зачем это здесь, а не в коде приложения: в системном списке «Приложения по умолчанию»
; Windows показывает только те программы, что объявили себя через RegisteredApplications →
; Capabilities → URLAssociations. Без этих ключей кнопка «Сделать браузером по умолчанию»
; открывала бы системное окно, в котором Oblako попросту нет.
;
; Сам выбор по умолчанию отсюда НЕ назначается и назначен быть не может: UserChoice в реестре
; подписан хэшем пользователя, и запись мимо системного диалога Windows считает подделкой
; (см. electron/DefaultBrowser.ts). Здесь только «мы умеем открывать http/https и .html».
;
; SHCTX — контекст установки, который electron-builder выставляет сам: HKCU при установке в
; профиль пользователя (наш случай, perMachine: false), HKLM при машинной. Жёстко писать HKCU
; нельзя — иначе машинная установка зарегистрировала бы приложение не там.

; ── Вид мастера ───────────────────────────────────────────────────────────────
;
; ⚠️ ПОТОЛОК НАЗВАН ЧЕСТНО: мастер рисует Windows штатными контролами, своей вёрстки в нём быть
; не может. Настраиваются ровно три вещи — две картинки (боковина приветствия и полоска шапки,
; см. scripts/make-installer-art.mjs), цвета фона/текста и собственные заголовки страниц. Всё
; «воздушное» здесь живёт в картинках и цвете, а не в раскладке. Настоящий свой экран потребовал
; бы отдельного окна-лаунчера — это другая задача и другой класс риска.
;
; ⚠️ Через MUI_BGCOLOR перекрашивается фон страниц приветствия и завершения — именно тех, где
; лежит наша боковина. Без него картинка соседствовала бы с системным белым, и стык был бы виден
; полосой. Значение — тот же почти-белый, в который у нас растворяется низ боковины.
!define MUI_BGCOLOR "FAFBFE"
!define MUI_TEXTCOLOR "2A2E37"

; Заголовки — свои, вместо безличных «Welcome to the … Setup Wizard».
!define MUI_WELCOMEPAGE_TITLE "Oblako"
!define MUI_WELCOMEPAGE_TEXT "Приватный браузер со встроенными VPN и ИИ.$\r$\n$\r$\nУстановка займёт минуту и не потребует прав администратора: Oblako ставится в ваш профиль.$\r$\n$\r$\nНажмите «Далее», чтобы продолжить."
!define MUI_FINISHPAGE_TITLE "Готово"
!define MUI_FINISHPAGE_TEXT "Oblako установлен.$\r$\n$\r$\nЧтобы сделать его браузером по умолчанию, откройте «Настройки → Браузер»: Windows не разрешает программам назначать себя самим."

!macro customInstall
  ; ProgID — «класс документа», на который ссылаются ассоциации.
  WriteRegStr SHCTX "Software\Classes\Oblako.HTML" "" "Oblako HTML Document"
  WriteRegStr SHCTX "Software\Classes\Oblako.HTML\Application" "ApplicationName" "Oblako"
  WriteRegStr SHCTX "Software\Classes\Oblako.HTML\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Oblako.HTML\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; Возможности приложения: какие схемы и типы файлов мы открываем.
  WriteRegStr SHCTX "Software\Oblako\Capabilities" "ApplicationName" "Oblako"
  WriteRegStr SHCTX "Software\Oblako\Capabilities" "ApplicationDescription" "Приватный браузер со встроенными VPN и ИИ"
  WriteRegStr SHCTX "Software\Oblako\Capabilities\URLAssociations" "http" "Oblako.HTML"
  WriteRegStr SHCTX "Software\Oblako\Capabilities\URLAssociations" "https" "Oblako.HTML"
  WriteRegStr SHCTX "Software\Oblako\Capabilities\FileAssociations" ".htm" "Oblako.HTML"
  WriteRegStr SHCTX "Software\Oblako\Capabilities\FileAssociations" ".html" "Oblako.HTML"

  ; Заявка в общий список приложений системы — именно она делает нас видимыми в настройках.
  WriteRegStr SHCTX "Software\RegisteredApplications" "Oblako" "Software\Oblako\Capabilities"
!macroend

!macro customUnInstall
  ; Чистим за собой полностью: оставленный ProgID показывался бы в системных списках как
  ; приложение-призрак, которое ничего не открывает.
  DeleteRegKey SHCTX "Software\Classes\Oblako.HTML"
  DeleteRegKey SHCTX "Software\Oblako"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Oblako"
!macroend
