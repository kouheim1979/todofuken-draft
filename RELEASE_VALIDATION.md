# 公開後の検証追記 — 2.0.0-rc.1

QA.mdは初回コミット前の記録です。この追記は2026-10-14の公開後の実行結果です。

## 公開済み

ゲーム本体コミット: `795389296889148ee06a4bb14f67b7013552bf82`
GitHub Pagesのrun `38509347596` はsuccessで終了しました。
公開先: https://kouheim1979.github.io/todofuken-draft/

## 初回の実ブラウザーCI

Game quality checks: https://github.com/kouheim1979/todofuken-draft/actions/runs/38509348417

- 対戦ロジック 1,355チェック: PASS。
- 模擬REST同期プロトコル 16チェック: PASS。
- 通常HTTPのChromium・WebKit: URLから起動、3ラウンド完走、実ストレージの再読み込み復元、戦績保存がPASS。ページのJavaScriptエラー0。
- 公開HTTPSのChromium: 通し対戦・保存復元・オフライン再読み込みがPASS。
- 公開HTTPSのWebKit: 通し対戦・保存復元は完了。オフライン化後の再読み込みでテストエンジンが `WebKit encountered an internal error` を返し、初回CI全体はfailure。

## WebKitのオフライン試験は「未確認」

同様の現象がPlaywright公式Issue #42775で再現・報告されています。
https://github.com/microsoft/playwright/issues/42775

現在のテストはWebKitでもオフライン再読み込みを実際に試します。この特定の内部エラーだけは `NOT_VERIFIED` として明示し、集計を `PASS_WITH_COVERAGE_GAP` とします。エラーを合格に言い換えません。その他のエラーや検証不一致は引き続きCIを失敗させます。
WebKitのService Workerの制御状態とキャッシュ作成は検査しますが、キャッシュの存在だけをオフライン再読み込み成功とは扱いません。

初回のエラーを解消したというアプリ改修はしていません。テストツールの既知の制約を独立した未確認項目として記録した変更です。

## 販売開始前の残り

実機iPhone Safariのオフライン動作、物理的に別の端末での招待ルームの通し対戦、継続利用のプレイテスト、負荷・荒らし対策は未確認です。
招待ルームは共同操作βで、プレイヤー別の操作権限をサーバーで強制する競技用オンライン対戦ではありません。
決済、広告、アクセス解析は追加していません。ゲーム能力値は実統計ではなく創作のゲーム用設定です。
