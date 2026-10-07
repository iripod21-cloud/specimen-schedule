// ===== 設定 =====
// Dropbox の App Console で作ったアプリの「App key」を入れる（App secret は入れない・不要）。
// App key は公開して問題ない値です（PKCE 方式なのでパスワードの代わりにはなりません）。
window.APP_CONFIG = {
  DROPBOX_APP_KEY: "",          // 例: "abcd1234efgh567"

  // Dropbox のアプリ専用フォルダ内のファイル名（Mac の Shiny アプリと同じ CSV を使う）
  DATA_FILE: "/specimen_schedule.csv",
  CLOSED_FILE: "/closed_days.csv",
  HOLIDAY_FILE: "/holidays.csv",

  // ↓ Mac の specimen_schedule_app.R の「0. 設定」と同じにしておく
  GROUPS: [
    { name: "健常",   color: "#3b7ea1" },
    { name: "AD",     color: "#b5483d" },
    { name: "炎症Ct", color: "#7a6ab0" }
  ],
  VISIT_PLAN: [
    { visit: "W0",  label: "0週",          week: 0,  tol: 0,  color: "#1f63bf" },
    { visit: "W8",  label: "8週（2ヶ月）",  week: 8,  tol: 7,  color: "#0a7a58" },
    { visit: "W24", label: "24週（6ヶ月）", week: 24, tol: 14, color: "#c06621" }
  ],
  CLOSED_WDAYS: [0],        // 常に休診の曜日（0=日 … 6=土）
  SAT_CLOSED_NTH: [1, 3],   // 休診にする土曜（第n土曜）
  SAT_ASK_NTH: [5],         // 都度決める土曜（第n土曜）
  USE_JHOLIDAY: true        // 祝日を休診扱いにする
};
