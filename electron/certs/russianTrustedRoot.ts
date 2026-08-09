// Корень «Russian Trusted Root CA» (НУЦ Минцифры) — вшит в код, а не читается с диска: это якорь
// доверия, и файл рядом с приложением можно подменить, а строку в подписанной сборке — нет.
//
// ⚠️ Подлинность сверена ДВУМЯ независимыми источниками, отпечатки совпали:
//   • официальная точка распространения Госуслуг (gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer)
//   • живая TLS-цепочка www.sberbank.ru, где этот корень присылает сам сервер банка
// SHA-256: D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31
// Срок: 2022-03-01 … 2032-02-27. Отпечаток продублирован константой в CertificateTrust.ts и
// сверяется в рантайме — сам по себе этот файл ничего не разрешает.
export const RUSSIAN_TRUSTED_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIIFwjCCA6qgAwIBAgICEAAwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUxPzA9BgNVBAoM
NlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFuZCBDb21tdW5pY2F0aW9uczEg
MB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3QgQ0EwHhcNMjIwMzAxMjEwNDE1WhcNMzIwMjI3
MjEwNDE1WjBwMQswCQYDVQQGEwJSVTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwg
RGV2ZWxvcG1lbnQgYW5kIENvbW11bmljYXRpb25zMSAwHgYDVQQDDBdSdXNzaWFuIFRydXN0ZWQg
Um9vdCBDQTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAMfFOZ8pUAL3+r2nqqE0Zp52
selXsKGFYoG0GM5bwz1bSFtCt+AZQMhkWQheI3poZAToYJu69pHLKS6QXBiwBC1cvzYmUYKMYZC7
jE5YhEU2bSL0mX7NaMxMDmH2/NwuOVRj8OImVa5s1F4Uzn4Kv3PFlDBjjSjXKVY9kmjUBsXQrIHe
aqmUIsPIlNWUnimXS0I0abExqkbdrXbXYwCOXhOO2pDUx3ckmJlCMUGacUTnylyQW2VsJIyIGA8V
0xzdaeUXg0VZ6ZmNUr5YBer/EAOLPb8NYpsAhJe2mXjMB/J9HNsoFMBFJ0lLOT/+dQvjbdRZoOT8
eqJpWnVDU+QL/qEZnz57N88OWM3rabJkRNdU/Z7x5SFIM9FrqtN8xewsiBWBI0K6XFuOBOTD4V08
o4TzJ8+Ccq5XlCUW2L48pZNCYuBDfBh7FxkB7qDgGDiaftEkZZfApRg2E+M9G8wkNKTPLDc4wH0F
DTijhgxR3Y4PiS1HL2Zhw7bD3CbslmEGgfnnZojNkJtcLeBHBLa52/dSwNU4WWLubaYSiAmA9IUM
X1/RpfpxOxd4Ykmhz97oFbUaDJFipIggx5sXePAlkTdWnv+RWBxlJwMQ25oEHmRguNYf4Zr/Rxr9
cS93Y+mdXIZaBEE0KS2iLRqaOiWBki9IMQU4phqPOBAaG7A+eP8PAgMBAAGjZjBkMB0GA1UdDgQW
BBTh0YHlzlpfBKrS6badZrHF+qwshzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzAS
BgNVHRMBAf8ECDAGAQH/AgEEMA4GA1UdDwEB/wQEAwIBhjANBgkqhkiG9w0BAQsFAAOCAgEAALIY
1wkilt/urfEVM5vKzr6utOeDWCUczmWX/RX4ljpRdgF+5fAIS4vHtmXkqpSCOVeWUrJV9QvZn6L2
27ZwuE15cWi8DCDal3Ue90WgAJJZMfTshN4OI8cqW9E4EG9wglbEtMnObHlms8F3CHmrw3k6KmUk
WGoa+/ENmcVl68u/cMRl1JbW2bM+/3A+SAg2c6iPDlehczKx2oa95QW0SkPPWGuNA/CE8CpyANIh
u9XFrj3RQ3EqeRcSAQQod1RNuHpfETLU/A2gMmvn/w/sx7TB3W5BPs6rprOA37tutPq9u6FTZOcG
1OqjC/B7yTqgI7rbyvox7DEXoX7rIiEqyNNUguTk/u3SZ4VXE2kmxdmSh3TQvybfbnXV4JbCZVaq
iZraqc7oZMnRoWrXRG3ztbnbes/9qhRGI7PqXqeKJBztxRTEVj8ONs1dWN5szTwaPIvhkhO3CO5E
rU2rVdUr89wKpNXbBODFKRtgxUT70YpmJ46VVaqdAhOZD9EUUn4YaeLaS8AjSF/h7UkjOibNc4qV
DiPP+rkehFWM66PVnP1Msh93tc+taIfCEYVMxjh8zNbFuoc7fzvvrFILLe7ifvEIUqSVIC/AzplM
/Jxw7buXFeGP1qVCBEHq391d/9RAfaZ12zkwFsl+IKwE/OZxW8AHa9i1p4GO0YSNuczzEm4=
-----END CERTIFICATE-----`
