#!/usr/bin/env python3
# 公開直前に、HTML内のローカルJS/CSS参照へバージョン(?v=コミットSHA)を付与する。
# GitHub Pagesはキャッシュヘッダを設定できず、ブラウザやホーム画面PWAが古いjsを掴み続けるため、
# デプロイのたびにURLを変えることで確実に最新版を読ませる。
import os, re, sys, pathlib, datetime

version = (os.environ.get("GITHUB_SHA") or "dev")[:8]
root = pathlib.Path("web")

# href/src がローカルの .js / .css を指している場合のみ ?v= を付ける(CDN等の絶対URLは触らない)
pattern = re.compile(r'(\b(?:src|href)=")(?!https?://|//)([^"?#]+\.(?:js|css))((?:\?[^"]*)?)(")')

def repl(m):
    return f'{m.group(1)}{m.group(2)}?v={version}{m.group(4)}'

# 画面に出すビルド識別子(どの版が読み込まれているか目視で判別するため)
build_label = f"{datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d %H:%M')} JST / {version}"

count = 0
builds = 0
for path in root.rglob("*.html"):
    text = path.read_text(encoding="utf-8")
    new, n = pattern.subn(repl, text)
    if "{{BUILD}}" in new:
        new = new.replace("{{BUILD}}", build_label)
        builds += 1
    if new != text:
        path.write_text(new, encoding="utf-8")
        count += n

print(f"バージョン {version} を {count} 箇所に付与、ビルド表示を {builds} ファイルに埋め込みました")
