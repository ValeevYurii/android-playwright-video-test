# Playwright: видео рецепта на Android

Готовый TypeScript-проект для проверки сайта `кухня.рф` в мобильном Chrome. Сценарий открывает главную, проверяет ссылку каталога, переходит в рецепт, нажимает «Начать готовить», делает четыре свайпа влево и после каждого свайпа проверяет, что открылось новое видео и воспроизведение действительно продолжается.

## Быстрый запуск в VS Code

1. Откройте в VS Code папку `android-playwright-video-test`.
2. Убедитесь, что установлен NVM и версия Node.js 22 из `.nvmrc`. Конфигурации Run and Debug и Tasks автоматически выбирают её, даже если сам VS Code был открыт под старой версией Node.js.
3. Подключите Android по USB или через ADB по Wi-Fi и подтвердите отладку на телефоне.
4. Проверьте устройство:

   ```bash
   adb devices -l
   ```

5. Установите зависимости (если запускаете из терминала, сначала выполните `nvm use 22`):

   ```bash
   npm install
   ```

6. Откройте **Run and Debug** и выберите **Playwright: Android device**.

Если подключено ровно одно устройство, тест выберет его автоматически. Для ADB по Wi-Fi сначала выполните сопряжение и подключение с адресами, показанными в разделе «Беспроводная отладка» на телефоне:

```bash
adb pair <IP>:<порт-сопряжения>
adb connect <IP>:<порт-отладки>
adb devices -l
```

Если устройств несколько, передайте serial из `adb devices -l` (для Wi-Fi это адрес вида `192.168.1.25:37123`):

```bash
ANDROID_SERIAL=<serial-из-adb> npm run test:android
```

Если Playwright видит телефон, но долго не может подключиться к Chrome, откройте на устройстве `chrome://flags/#enable-command-line-on-non-rooted-devices`, включите флаг и перезапустите Chrome.

## Остальные команды

```bash
npm run typecheck
npm run test:unit
npm run test:mobile
npm run test:android
npm run report
```

`test:mobile` запускает эмуляцию Pixel 7 в установленном Google Chrome. Это важно: ролики сайта используют H.264/AVC, которого нет в комплектном Chromium Playwright.

## Настройки сценария

Параметры можно переопределять переменными окружения:

- `ANDROID_SERIAL` — серийный номер телефона из `adb devices -l`;
- `RECIPE_URL` — другой рецепт;
- `SWIPE_COUNT` — число свайпов, по умолчанию `4`;
- `STALL_TIMEOUT_MS` — ожидание загрузки/прогресса видео, по умолчанию `45000`;
- `MINIMUM_PROGRESS_SECONDS` — минимальный подтверждённый прогресс видео, по умолчанию `0.4` секунды.

При ошибке Playwright сохраняет `trace.zip`, снимок экрана и JSON-отчёт в `test-results`. Трассировку можно открыть командой:

```bash
npx playwright show-trace test-results/<папка-теста>/trace.zip
```
