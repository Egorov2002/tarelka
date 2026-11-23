# Тарелка

Рацион питания на неделю по ценам выбранного магазина. Без подписки, рекламы и
скрытых платежей — полная стоимость продуктов видна сразу.

**Сайт:** https://2wrs6cmulcvii.space.mcode.io
**Установка Android:** https://7qp0lm0uafn19.space.mcode.io

## Что внутри

```
index.html              оболочка приложения
manifest.webmanifest    PWA-манифест
sw.js                   service worker (офлайн-кэш)
css/app.css             дизайн-система, светлая и тёмная темы
js/model.js             цены, аллергены, порции          ← чистые функции
js/planner.js           подбор рациона и список покупок   ← чистые функции
js/store.js             состояние и localStorage
js/ui.js                экраны и нижние листы
js/app.js               маршрутизация и мастер настройки
data/catalog.json       101 продукт, 13 магазинов, 54 рецепта
data/prices-live.json   цены, собранные с сайтов магазинов
assets/food/            64 фотографии блюд + миниатюры
tools/collector.py      сборщик цен с сайтов магазинов
tools/build_android.sh  сборка .aab / .apk (TWA)
```

## Сборка Android-пакета

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
./tools/build_android.sh https://ваш-домен
```

Готовые файлы: `android/app-release-bundle.aab` (для Play Console) и
`android/app-release-signed.apk` (для установки напрямую).

## Как включить GitHub Pages

1. Создайте файл `.github/workflows/pages.yml` — содержимое лежит в этом
   репозитории в `pages-workflow.yml` (просто переименуйте и перенесите).
2. В репозитории: Settings → Pages → Source: **GitHub Actions**.
3. Сайт появится на `https://egorov2002.github.io/tarelka/`.

Workflow сам скачивает фотографии блюд и APK, собирает статику и выкладывает её.
После этого обновление цен из `data/prices-live.json` попадает на сайт автоматически.

## Как добавить фотографии и APK в этот репозиторий

Текстовые файлы (код, стили, каталог, цены) уже загружены. Бинарные — фотографии
блюд и APK — нужно добавить обычным git, они не проходят через API:

```bash
git clone https://github.com/Egorov2002/tarelka.git
cd tarelka
cp -r ../racion/assets ./assets
cp ../racion/Tarelka-1.0.0.apk .
git add -A && git commit -m "фотографии блюд и APK" && git push
```

После этого workflow сам соберёт сайт и выложит его на Pages.

## Обновление цен

```bash
python3 tools/collector.py --all --pages 6
```

Workflow `update-prices.yml` (в этом же репозитории) запускает сборщик раз в сутки.
Часть сетей режет запросы с серверных IP — для них запускайте сборщик
с российского или домашнего адреса.

## Приватность

Приложение не собирает и никуда не передаёт персональные данные: бюджет,
состав семьи и ограничения хранятся только на устройстве.
