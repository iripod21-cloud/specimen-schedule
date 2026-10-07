# 検体スケジュール（iPhone 版）

Mac の Shiny アプリ（specimen_schedule_app.R）と同じ CSV を、Dropbox の **アプリ専用フォルダ** で直接読み書きする、スマホ向けのページです。

- このリポジトリにはページの仕組みだけを置きます。**検体のデータは置きません**（データは Dropbox にだけあります）。
- 通信先は Dropbox の API だけです（Content-Security-Policy で制限）。外部のライブラリは読み込みません。
- Dropbox のログインは OAuth（PKCE）。App secret は使いません。
- ルール（群・採取ポイント・休診日）は `config.js` と R 側の「0. 設定」を同じにしておくこと。
- 祝日は Dropbox の `holidays.csv`（内閣府のデータ。Mac のアプリが毎年自動更新）を使い、無ければ `holidays.js` を使います。
- `?demo` を付けて開くと、架空のデータで動作確認できます（Dropbox には書き込みません）。
