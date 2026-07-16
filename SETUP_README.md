# セットアップ手順(順番通りに進めてください)

所要時間の目安: 30〜60分。難しい言葉が出てきますが、コピー&ペーストが中心です。

---

## 全体像(もう一度確認)

- **Supabase**: データを保存する場所(どのETFを監視するか、通知履歴など)
- **GitHub Actions**: 定期的に(30分おき、平日9:00-15:30)株価をチェックして通知を送るロボット
- **GitHub Pages**: スマホで見るアプリ画面を公開する場所

すべて無料の範囲で収まる想定です。

---

## ステップ1: Supabaseにデータの入れ物を作る

1. https://supabase.com にログインし、新しいプロジェクトを作成(名前は何でもよい、例: `etf-alert`)
2. 作成したプロジェクトの画面左メニューから「SQL Editor」を開く
3. `supabase/schema.sql` の中身を全部コピーして貼り付け、右下の「Run」を押す
   → 「Success」と出ればOKです
4. 画面左メニュー「Project Settings」→「API」を開き、次の2つをメモしておく
   - **Project URL**(例: `https://xxxxx.supabase.co`)
   - **anon public key**(長い英数字の文字列)
   - もう1つ、**service_role key**という別の鍵もメモしておく(これは絶対に人に見せない・アプリ画面には書かない)

---

## ステップ2: カタログデータ(ETF一覧)を登録する

今回用意したのはサンプル8銘柄のみです。日本の全ETF(~300銘柄)を登録するには、正式な一覧データ(JPXが公開しているExcel/CSV)から変換する作業が別途必要です。**まずはこの8銘柄で全体が動くか確認してから、全銘柄化を次のステップとして進めることをおすすめします。**

サンプルデータを登録する場合:

1. パソコンにNode.jsが入っていれば、`supabase`フォルダで以下を実行
   ```
   SUPABASE_URL="さっきのProject URL" SUPABASE_SERVICE_KEY="さっきのservice_role key" node seed.mjs
   ```
2. Node.jsが無い/操作が難しい場合は、Supabaseの「Table Editor」画面から`etf_catalog`テーブルを開き、`seed-catalog.json`の内容を見ながら1行ずつ手入力することも可能です(手間はかかります)。

---

## ステップ3: 通知用の鍵(VAPIDキー)を作る

これは「誰からの通知か」を証明するための鍵です。

1. パソコンでNode.jsが使える場合:
   ```
   npx web-push generate-vapid-keys
   ```
   を実行すると、Public KeyとPrivate Keyが表示されます。
2. Node.jsが無い場合は、検索エンジンで「web push vapid key generator」と調べると、ブラウザ上で生成できるサイトがいくつかあります。

表示された2つの鍵をメモしておいてください。

---

## ステップ4: GitHubリポジトリを作る

1. GitHubで新しいリポジトリを作成(例: `etf-alert-web`)
2. このZIPの中身(`ETFAlertWeb`フォルダの中身)をそのリポジトリにアップロード
   - GitHubの画面で「Add file」→「Upload files」からドラッグ&ドロップでもできます

---

## ステップ5: GitHubに秘密の鍵を登録する(Secrets)

これは「見張りロボット」だけが使う、外部に見せてはいけない鍵です。

1. リポジトリの「Settings」→「Secrets and variables」→「Actions」を開く
2. 「New repository secret」で以下4つを1つずつ登録
   - `SUPABASE_URL` : ステップ1のProject URL
   - `SUPABASE_SERVICE_KEY` : ステップ1のservice_role key(絶対に他では使わない)
   - `VAPID_PUBLIC_KEY` : ステップ3のPublic Key
   - `VAPID_PRIVATE_KEY` : ステップ3のPrivate Key

---

## ステップ6: アプリ画面用の設定ファイルを書き換える

`web/js/config.js` を開いて、以下を書き換えます(これらは公開しても問題ない情報です):

```js
const SUPABASE_URL = "ステップ1のProject URL";
const SUPABASE_ANON_KEY = "ステップ1のanon public key";
const VAPID_PUBLIC_KEY = "ステップ3のPublic Key";
```

書き換えたら、GitHubにアップロードし直してください(上書き保存)。

---

## ステップ7: GitHub Pagesでアプリ画面を公開する

1. リポジトリの「Settings」→「Pages」を開く
2. 「Source」を「Deploy from a branch」にし、ブランチを`main`、フォルダを`/web`(または該当フォルダ)に設定
3. 数分待つと `https://あなたのユーザー名.github.io/リポジトリ名/` でアプリが見られるようになります

---

## ステップ8: iPhoneで開いて「ホーム画面に追加」する

1. iPhoneのSafariでステップ7のURLを開く
2. 共有ボタン(四角に矢印のアイコン)→「ホーム画面に追加」
3. ホーム画面のアイコンから開く(Safariのタブで開いたままだと通知が来ません)
4. 「設定」タブ→「この端末で通知を受け取る」を押す→通知を許可する

---

## ステップ9: 動作確認

1. GitHubリポジトリの「Actions」タブを開く
2. 「ETF価格チェック」というワークフローがあるので、「Run workflow」ボタンで手動実行してみる
3. 数十秒後に完了(緑のチェックマーク)になれば成功
4. カタログタブから銘柄を「監視」に設定し、翌営業日以降に自動でチェックが走るのを待つ

---

## 困ったときは

- Actionsが赤い×で失敗する → 「Run workflow」の実行結果をクリックしてエラーメッセージを見る(Secretsの入力ミスが多い原因)
- 通知が来ない → iPhoneの「設定」→「通知」→ Safari(または追加したアプリ)の通知が許可されているか確認
- 分からないエラーが出た → エラーメッセージをそのままコピーして聞いてください。一緒に解決します。
