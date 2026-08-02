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
