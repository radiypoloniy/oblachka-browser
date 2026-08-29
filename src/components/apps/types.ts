import type { LucideIcon } from 'lucide-react'

// Описание приложения раздела. Отдельным файлом, чтобы хранилище настроек (storage.ts) не
// импортировало сам aiApps: тип нужен обоим, а реестр APPS — только ему.
export type AppId = string

export interface AppDef {
  id: AppId
  label: string
  kind: 'local' | 'web'
  icon: LucideIcon | null // null — буквенная иконка (пользовательские веб-приложения)
  gradient: string // токен из tokens/apps.css — не сырой цвет
  url?: string // только для kind 'web'
}
