/**
 * 刹那の見斬り – 反射神経ゲーム
 *
 * ファイル構成
 *   index.html  … エントリーポイント
 *   style.css   … レイアウト・タッチ無効化
 *   game.js     … ゲームロジック全体（このファイル）
 *
 * ステート遷移
 *   START → WAITING → SIGNAL → RESULT → START
 */

'use strict';

/* =========================================================
 * 1. アセット定義
 *    画像パスを一か所で管理。空文字やロード失敗時はフォールバック矩形で描画。
 * ========================================================= */
const ASSET_PATHS = {
  playerIdle:   'assets/player_idle.png',
  playerAttack: 'assets/player_attack.png',
  playerDead:   'assets/player_dead.png',
  enemyIdle:    'assets/enemy_idle.png',
  enemyAttack:  'assets/enemy_attack.png',
  enemyDead:    'assets/enemy_dead.png',
  bgImage:      'assets/bg_image.png',
  slashEffect:  'assets/slash_effect.png',
};

/** フォールバック色（キー名 → CSS色文字列） */
const FALLBACK_COLORS = {
  playerIdle:   '#4a90d9',
  playerAttack: '#f5a623',
  playerDead:   '#9b9b9b',
  enemyIdle:    '#d0021b',
  enemyAttack:  '#ff6b6b',
  enemyDead:    '#7f8c8d',
  bgImage:      '#1a1a2e',
  slashEffect:  '#ffffff',
};

/* =========================================================
 * 2. 画像ローダー
 * ========================================================= */
/**
 * 画像オブジェクトのキャッシュ。
 * 値が null ならフォールバック矩形を描画する。
 * @type {Object.<string, HTMLImageElement|null>}
 */
const imageCache = {};

/**
 * ASSET_PATHS に定義された画像を非同期でプリロードする。
 * ロード失敗・パス空の場合はキャッシュに null をセットする。
 * @returns {Promise<void>}
 */
function preloadAssets() {
  const promises = Object.entries(ASSET_PATHS).map(([key, path]) => {
    return new Promise((resolve) => {
      if (!path) {
        imageCache[key] = null;
        resolve();
        return;
      }
      const img = new Image();
      img.onload = () => {
        imageCache[key] = img;
        resolve();
      };
      img.onerror = () => {
        imageCache[key] = null;
        resolve();
      };
      img.src = path;
    });
  });
  return Promise.all(promises);
}

/**
 * 画像またはフォールバック矩形を描画する。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} key   ASSET_PATHS のキー名
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
function drawSprite(ctx, key, x, y, w, h) {
  const img = imageCache[key];
  if (img) {
    ctx.drawImage(img, x, y, w, h);
  } else {
    ctx.fillStyle = FALLBACK_COLORS[key] || '#888888';
    ctx.fillRect(x, y, w, h);
  }
}

/* =========================================================
 * 3. Canvas セットアップ
 * ========================================================= */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

/** Canvas をビューポートにフィットさせる */
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('resize', () => {
  resizeCanvas();
  render();
});

resizeCanvas();

/* =========================================================
 * 4. ゲームステート
 * ========================================================= */
/**
 * @typedef {'START'|'WAITING'|'SIGNAL'|'RESULT'} GameState
 */

const STATE = {
  START:   'START',
  WAITING: 'WAITING',
  SIGNAL:  'SIGNAL',
  RESULT:  'RESULT',
};

/** ゲーム全体の状態 */
const game = {
  /** @type {GameState} */
  state: STATE.START,

  /** WAITING 状態で設定するタイマーID */
  waitingTimerId: null,

  /** SIGNAL 状態でのシグナル表示時刻（ms） */
  signalTime: 0,

  /** CPU の反応時間（ms） */
  cpuReactionMs: 0,

  /** プレイヤーの反応時間（ms）。null = まだ入力なし */
  playerReactionMs: null,

  /** 勝敗フラグ */
  playerWon: false,

  /** フライングフラグ */
  isFlying: false,

  /** 斬撃エフェクト表示用タイムスタンプ */
  slashStartTime: 0,

  /** 斬撃エフェクト表示時間（ms） */
  slashDuration: 300,
};

/* =========================================================
 * 5. ステート遷移
 * ========================================================= */

/** START → WAITING へ遷移 */
function enterWaiting() {
  game.state         = STATE.WAITING;
  game.isFlying      = false;
  game.playerWon     = false;
  game.playerReactionMs = null;
  game.slashStartTime   = 0;

  const delayMs = (2 + Math.random() * 3) * 1000; // 2〜5秒
  game.waitingTimerId = setTimeout(enterSignal, delayMs);
}

/** WAITING → SIGNAL へ遷移 */
function enterSignal() {
  game.state          = STATE.SIGNAL;
  game.signalTime     = performance.now();
  game.cpuReactionMs  = (0.2 + Math.random() * 0.3) * 1000; // 200〜500ms
  game.waitingTimerId = null;
}

/**
 * SIGNAL → RESULT へ遷移
 * @param {boolean} playerInputted プレイヤーがタップした場合 true
 */
function enterResult(playerInputted) {
  if (playerInputted) {
    game.playerReactionMs = performance.now() - game.signalTime;
    game.playerWon        = game.playerReactionMs < game.cpuReactionMs;
  } else {
    // CPU が先に攻撃（タイムアウト）
    game.playerReactionMs = null;
    game.playerWon        = false;
  }
  game.state          = STATE.RESULT;
  game.slashStartTime = performance.now();
}

/** RESULT → START へ遷移 */
function enterStart() {
  game.state = STATE.START;
}

/* =========================================================
 * 6. 入力検知
 * ========================================================= */

/**
 * タップ（touchstart / mousedown）の統一ハンドラ
 * @param {Event} e
 */
function handleInput(e) {
  e.preventDefault();

  switch (game.state) {
    case STATE.START:
      enterWaiting();
      break;

    case STATE.WAITING:
      // フライング
      clearTimeout(game.waitingTimerId);
      game.waitingTimerId = null;
      game.isFlying       = true;
      game.playerWon      = false;
      game.state          = STATE.RESULT;
      game.slashStartTime = performance.now();
      break;

    case STATE.SIGNAL:
      enterResult(true);
      break;

    case STATE.RESULT:
      enterStart();
      break;
  }
}

// タッチイベント（スマホ）
canvas.addEventListener('touchstart', handleInput, { passive: false });
// マウスイベント（デスクトップ確認用）
canvas.addEventListener('mousedown', handleInput);

// ピンチズーム無効化
document.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => { e.preventDefault(); });
document.addEventListener('gesturechange', (e) => { e.preventDefault(); });
document.addEventListener('gestureend', (e) => { e.preventDefault(); });

/* =========================================================
 * 7. 描画処理
 * ========================================================= */

/** テキスト描画ヘルパー（影付き） */
function drawText(text, x, y, fontSize, color, align = 'center') {
  ctx.font         = `bold ${fontSize}px 'Hiragino Sans', 'Yu Gothic', sans-serif`;
  ctx.textAlign    = align;
  ctx.textBaseline = 'middle';

  ctx.shadowColor   = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur    = 8;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = color;
  ctx.fillText(text, x, y);

  // シャドウをリセット
  ctx.shadowColor   = 'transparent';
  ctx.shadowBlur    = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/** メインレンダリング */
function render() {
  const W = canvas.width;
  const H = canvas.height;

  // ---------- 背景 ----------
  drawSprite(ctx, 'bgImage', 0, 0, W, H);

  // ---------- レイアウト寸法 ----------
  const charW  = Math.min(W * 0.5, 200);
  const charH  = charW * 1.4;
  const charX  = (W - charW) / 2;

  // 敵：画面上部 1/4 付近
  const enemyY = H * 0.05;
  // プレイヤー：画面下部 1/4 付近
  const playerY = H - charH - H * 0.05;

  // ---------- キャラクター描画 ----------
  drawCharacters(charX, enemyY, charX, playerY, charW, charH);

  // ---------- 斬撃エフェクト ----------
  drawSlashEffect(W, H);

  // ---------- 中央メッセージ ----------
  drawCenterMessage(W, H);
}

/**
 * ステートに応じてキャラクタースプライトを描画する
 */
function drawCharacters(enemyX, enemyY, playerX, playerY, charW, charH) {
  let enemyKey  = 'enemyIdle';
  let playerKey = 'playerIdle';

  if (game.state === STATE.RESULT) {
    if (game.isFlying) {
      enemyKey  = 'enemyIdle';
      playerKey = 'playerDead';
    } else if (game.playerWon) {
      enemyKey  = 'enemyDead';
      playerKey = 'playerAttack';
    } else {
      enemyKey  = 'enemyAttack';
      playerKey = 'playerDead';
    }
  }

  drawSprite(ctx, enemyKey,  enemyX,  enemyY,  charW, charH);
  drawSprite(ctx, playerKey, playerX, playerY, charW, charH);
}

/** 斬撃エフェクト（RESULT 直後の短い時間だけ表示） */
function drawSlashEffect(W, H) {
  if (game.state !== STATE.RESULT || game.slashStartTime === 0) return;

  const elapsed = performance.now() - game.slashStartTime;
  if (elapsed > game.slashDuration) return;

  const alpha = 1 - elapsed / game.slashDuration;
  ctx.globalAlpha = alpha;

  const effW = W * 0.8;
  const effH = effW * 0.4;
  drawSprite(ctx, 'slashEffect', (W - effW) / 2, (H - effH) / 2, effW, effH);

  ctx.globalAlpha = 1;
}

/** 画面中央のメッセージ描画 */
function drawCenterMessage(W, H) {
  const cx = W / 2;
  const cy = H / 2;
  const fs = Math.min(W * 0.12, 52);

  switch (game.state) {
    case STATE.START:
      drawText('タップしてはじめる', cx, cy, fs * 0.75, '#ffffff');
      break;

    case STATE.WAITING:
      drawText('かまえて！', cx, cy, fs, '#f0e68c');
      break;

    case STATE.SIGNAL:
      drawText('！', cx, cy, fs * 1.8, '#ff4444');
      break;

    case STATE.RESULT:
      if (game.isFlying) {
        drawText('フライング！', cx, cy - fs, fs, '#ff4444');
        drawText('はやまった…', cx, cy + fs, fs * 0.65, '#ffffff');
      } else if (game.playerWon) {
        const sec = (game.playerReactionMs / 1000).toFixed(3);
        drawText(`${sec}秒！`, cx, cy - fs, fs, '#ffe066');
        drawText('勝利！', cx, cy + fs, fs * 0.9, '#7fff00');
      } else {
        const msg = game.playerReactionMs !== null
          ? `${(game.playerReactionMs / 1000).toFixed(3)}秒（遅い）`
          : 'やられた…';
        drawText(msg, cx, cy - fs, fs * 0.75, '#cccccc');
        drawText('敗北…', cx, cy + fs, fs * 0.9, '#ff6b6b');
      }
      drawText('タップで次へ', cx, H * 0.88, fs * 0.55, '#aaaaaa');
      break;
  }
}

/* =========================================================
 * 8. ゲームループ
 *    rAF で毎フレーム render を呼ぶ。
 *    SIGNAL ステートでは CPU 反応タイムアウトも監視する。
 * ========================================================= */
function gameLoop() {
  // SIGNAL 状態で CPU 反応時間が経過したら強制 RESULT（CPU 勝利）
  if (game.state === STATE.SIGNAL) {
    const elapsed = performance.now() - game.signalTime;
    if (elapsed >= game.cpuReactionMs) {
      enterResult(false);
    }
  }

  render();
  requestAnimationFrame(gameLoop);
}

/* =========================================================
 * 9. 初期化
 * ========================================================= */
preloadAssets().then(() => {
  gameLoop();
});
