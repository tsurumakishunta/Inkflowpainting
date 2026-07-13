# Ink Flow Painting

**日本語** | [English](./README.en.md)

水面へ落とした墨が、滲み、混ざり、流れながら少しずつ薄くなっていく様子を描く、インタラクティブなWebアプリケーションです。

![墨流しの動作デモ](./docs/assets/墨流し.gif)

## 特徴

- 黒・朱・緑・蒼から色を選んで描く手描きモード
- 色がゆっくり変化する「色うつろい」モード
- 墨滴と散らしを自動で重ねる「墨流し」モード
- クリック中は墨を流し、クリックしていないマウス移動では水流だけを変化
- マウスの移動方向と速さに応じた水の流れ
- 墨の拡散と減衰による、自然な滲みと薄まり
- 筆幅、墨の濃さ、水流、滴下間隔の調整
- 一時停止、水面の消去、PNG保存

## フォルダー構成

```text
Inkflowpainting/
├─ docs/        アプリの説明とデモGIF
├─ source/      Webアプリケーションのソースコード
├─ README.md    日本語のプロジェクト概要
├─ README.en.md 英語のプロジェクト概要
└─ LICENSE
```

詳しい動作と仕組みは、[アプリケーション説明](./docs/README.md)をご覧ください。

## ローカルでの起動

Node.js 22.13以降を用意し、次のコマンドを実行します。

```bash
cd source
npm install
npm run dev
```

ビルドと自動テストは次のコマンドで実行できます。

```bash
npm run build
npm test
```

## 主な技術

- React / Next.js
- TypeScript
- WebGL2
- GPUシェーダーによる流体・顔料シミュレーション
- Vinext / Vite
