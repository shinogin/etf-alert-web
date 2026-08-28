#!/usr/bin/env python3
# 公開直前に、HTML内のローカルJS/CSS参照へバージョン(?v=コミットSHA)を付与する。
# GitHub Pagesはキャッシュヘッダを設定できず、ブラウザやホーム画面PWAが古いjsを掴み続けるため、
# デプロイのたびにURLを変えることで確実に最新版を読ませる。
import os, re, sys, pathlib

version = (os.environ.get("GITHUB_SHA") or "dev")[:8]
root = pathlib.Path("web")

# href/src がローカルの .js / .css を指している場合のみ ?v= を付ける(CDN等の絶対URLは触らない)
pattern = re.compile(r'(\b(?:src|href)=")(?!https?://|//)([^"?#]+\.(?:js|css))((?:\?[^"]*)?)(")')

def repl(m):
    return f'{m.group(1)}{m.group(2)}?v={version}{m.group(4)}'

count = 0
for path in root.rglob("*.html"):
    text = path.read_text(encoding="utf-8")
    new, n = pattern.subn(repl, text)
    if n:
        path.write_text(new, encoding="utf-8")
        count += n

print(f"バージョン {version} を {count} 箇所に付与しました")
