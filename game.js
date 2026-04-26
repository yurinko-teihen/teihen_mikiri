/**
 * 刹那の見斬り – 反射神経ゲーム
 *
 * ファイル構成
 *   index.html  … エントリーポイント
 *   style.css   … レイアウト・タッチ無効化
 *   game.js     … ゲームロジック全体（このファイル）
 *
 * ステート遷移
 *   TITLE → CUTIN → WAITING → SIGNAL → RESULT → TITLE
 */

'use strict';

/* =========================================================
 * 1. アセット定義
 *    画像パスを一か所で管理。空文字やロード失敗時はフォールバック矩形で描画。
 * ========================================================= */
const ASSET_PATHS = {
  playerIdle:    'assets/player_idle.png',
  playerAttack:  'assets/player_attack.png',
  playerDead:    'assets/player_dead.png',
  giraiSet:      'assets/girai_set.png',
  enemyIdle:     'assets/enemy_idle.png',
  enemyAttack:   'assets/enemy_attack.png',
  enemyDead:     'assets/enemy_dead.png',
  bgImage:       'assets/bg_image.png',
  slashEffect:   'assets/slash_effect.png',
};

/** フォールバック色（キー名 → CSS色文字列） */
const FALLBACK_COLORS = {
  playerIdle:    '#4a90d9',
  playerAttack:  '#f5a623',
  playerDead:    '#9b9b9b',
  giraiSet:      '#4a90d9',
  enemyIdle:     '#d0021b',
  enemyAttack:   '#ff6b6b',
  enemyDead:     '#7f8c8d',
  bgImage:       '#1a1a2e',
  slashEffect:   '#ffffff',
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
  if (game.state === STATE.TITLE) {
    renderTitle();
  } else if (game.state !== STATE.CUTIN) {
    render();
  }
});

resizeCanvas();

/* =========================================================
 * 4. 難易度定義
 * ========================================================= */
const DIFFICULTIES = [
  { key: 'easy',   label: 'かんたん',   cpuMin: 0.5,  cpuMax: 1.0  },
  { key: 'normal', label: 'ふつう',     cpuMin: 0.2,  cpuMax: 0.5  },
  { key: 'hard',   label: 'むずかしい', cpuMin: 0.08, cpuMax: 0.25 },
];

/* =========================================================
 * 5. ゲームステート
 * ========================================================= */
/**
 * @typedef {'TITLE'|'CUTIN'|'WAITING'|'SIGNAL'|'RESULT'} GameState
 */

const STATE = {
  TITLE:   'TITLE',
  CUTIN:   'CUTIN',
  WAITING: 'WAITING',
  SIGNAL:  'SIGNAL',
  RESULT:  'RESULT',
};

/** カットインアニメーションの総時間（ms） */
const CUTIN_DURATION = 1400;

/**
 * タイトル画面の難易度ボタン矩形（renderTitle() 内で更新）
 * @type {Array<{key:string, label:string, x:number, y:number, w:number, h:number}>}
 */
let difficultyButtons = [];

/** ゲーム全体の状態 */
const game = {
  /** @type {GameState} */
  state: STATE.TITLE,

  /** 選択中の難易度インデックス（DIFFICULTIES 配列） */
  difficultyIndex: 1,

  /** カットインアニメーション開始時刻（ms） */
  cutinStartTime: 0,

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
 * 6. ステート遷移
 * ========================================================= */

/** 任意ステート → TITLE へ遷移 */
function enterTitle() {
  if (game.waitingTimerId !== null) {
    clearTimeout(game.waitingTimerId);
    game.waitingTimerId = null;
  }
  game.state = STATE.TITLE;
}

/**
 * TITLE → CUTIN へ遷移
 * @param {number} difficultyIndex DIFFICULTIES のインデックス
 */
function enterCutin(difficultyIndex) {
  game.difficultyIndex = difficultyIndex;
  game.state           = STATE.CUTIN;
  game.cutinStartTime  = performance.now();
}

/** CUTIN → WAITING へ遷移 */
function enterWaiting() {
  game.state            = STATE.WAITING;
  game.isFlying         = false;
  game.playerWon        = false;
  game.playerReactionMs = null;
  game.slashStartTime   = 0;

  const delayMs = (2 + Math.random() * 3) * 1000; // 2〜5秒
  game.waitingTimerId = setTimeout(enterSignal, delayMs);
}

/** WAITING → SIGNAL へ遷移 */
function enterSignal() {
  const difficulty = DIFFICULTIES[game.difficultyIndex];
  game.state         = STATE.SIGNAL;
  game.signalTime    = performance.now();
  game.cpuReactionMs = (difficulty.cpuMin + Math.random() * (difficulty.cpuMax - difficulty.cpuMin)) * 1000;
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

/* =========================================================
 * 7. 入力検知
 * ========================================================= */

/**
 * タップ座標をキャンバス座標に変換する
 * @param {Event} e
 * @returns {{x:number, y:number}}
 */
function getEventPos(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

/**
 * タップ（touchstart / mousedown）の統一ハンドラ
 * @param {Event} e
 */
function handleInput(e) {
  e.preventDefault();

  switch (game.state) {
    case STATE.TITLE: {
      const pos = getEventPos(e);
      for (let i = 0; i < difficultyButtons.length; i++) {
        const btn = difficultyButtons[i];
        if (
          pos.x >= btn.x && pos.x <= btn.x + btn.w &&
          pos.y >= btn.y && pos.y <= btn.y + btn.h
        ) {
          enterCutin(i);
          return;
        }
      }
      break;
    }

    case STATE.CUTIN:
      // カットイン中はタップ無効
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
      enterTitle();
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
 * 8. 描画処理
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

/**
 * 角丸矩形を描画するヘルパー
 */
function drawRoundRect(x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/* ---------- タイトル画面 ---------- */

/** タイトル画面を描画し、ボタン矩形を difficultyButtons に更新する */
function renderTitle() {
  const W = canvas.width;
  const H = canvas.height;

  // 背景
  drawSprite(ctx, 'bgImage', 0, 0, W, H);

  // 暗めのオーバーレイ
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  const fs = Math.min(W * 0.12, 52);

  // タイトル
  drawText('刹那の見斬り', cx, H * 0.18, fs * 1.25, '#ffe066');

  // 説明文
  const descFs = Math.min(W * 0.045, 18);
  drawText('「！」が出たら素早くタップ！', cx, H * 0.30, descFs, '#dddddd');
  drawText('敵より速く斬れば勝ち', cx, H * 0.30 + descFs * 1.6, descFs, '#dddddd');
  drawText('フライングに注意！', cx, H * 0.30 + descFs * 3.2, descFs, '#ffaa44');

  // 難易度ボタン
  const btnW  = Math.min(W * 0.65, 260);
  const btnH  = Math.min(H * 0.09, 56);
  const btnR  = 12;
  const btnFs = Math.min(W * 0.065, 26);
  const btnColors = [
    { fill: '#2e7d32', stroke: '#66bb6a' }, // かんたん
    { fill: '#1565c0', stroke: '#42a5f5' }, // ふつう
    { fill: '#b71c1c', stroke: '#ef5350' }, // むずかしい
  ];
  const btnStartY = H * 0.52;
  const btnGap    = btnH + H * 0.025;

  difficultyButtons = [];
  for (let i = 0; i < DIFFICULTIES.length; i++) {
    const bx = cx - btnW / 2;
    const by = btnStartY + i * btnGap;
    difficultyButtons.push({ key: DIFFICULTIES[i].key, label: DIFFICULTIES[i].label, x: bx, y: by, w: btnW, h: btnH });

    drawRoundRect(bx, by, btnW, btnH, btnR, btnColors[i].fill, btnColors[i].stroke);
    drawText(DIFFICULTIES[i].label, cx, by + btnH / 2, btnFs, '#ffffff');
  }

  // フッター
  drawText('難易度を選んでスタート', cx, H * 0.92, Math.min(W * 0.04, 16), '#888888');
}

/* ---------- カットインアニメーション ---------- */

/**
 * カットインアニメーションを描画する。
 * 終了時に enterWaiting() を呼ぶ。
 */
function renderCutin() {
  const W  = canvas.width;
  const H  = canvas.height;
  const elapsed = performance.now() - game.cutinStartTime;

  // まずゲームシーン（背景とキャラ）を描画しておく
  drawSprite(ctx, 'bgImage', 0, 0, W, H);
  drawGameCharacters(W, H);

  // カットインパネルのアニメーション
  // Phase 1 (0 ~ 35%): 上下パネルが中央へスライドイン
  // Phase 2 (35% ~ 65%): 閉じた状態でテキスト表示
  // Phase 3 (65% ~ 100%): パネルが上下へスライドアウト
  const t = Math.min(elapsed / CUTIN_DURATION, 1);

  let topOffset, botOffset;

  if (t < 0.35) {
    // ease-out でスライドイン
    const p = 1 - Math.pow(1 - t / 0.35, 3);
    topOffset = -H / 2 + (H / 2) * p;   // -H/2 → 0
    botOffset =  H / 2 - (H / 2) * p;   //  H/2 → 0
  } else if (t < 0.65) {
    topOffset = 0;
    botOffset = 0;
  } else {
    // ease-in でスライドアウト
    const p = Math.pow((t - 0.65) / 0.35, 2);
    topOffset = -(H / 2) * p;   // 0 → -H/2
    botOffset =  (H / 2) * p;   // 0 →  H/2
  }

  // 上パネル
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, topOffset, W, H / 2);
  // 斜めエッジ
  ctx.fillStyle = '#222222';
  ctx.beginPath();
  ctx.moveTo(0,      topOffset + H / 2);
  ctx.lineTo(W,      topOffset + H / 2 - H * 0.03);
  ctx.lineTo(W,      topOffset + H / 2);
  ctx.closePath();
  ctx.fill();

  // 下パネル
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, H / 2 + botOffset, W, H / 2);
  // 斜めエッジ
  ctx.fillStyle = '#222222';
  ctx.beginPath();
  ctx.moveTo(0, H / 2 + botOffset);
  ctx.lineTo(W, H / 2 + botOffset + H * 0.03);
  ctx.lineTo(W, H / 2 + botOffset);
  ctx.closePath();
  ctx.fill();

  // パネルが閉じているフェーズのテキスト
  if (t >= 0.35 && t < 0.65) {
    const difficulty = DIFFICULTIES[game.difficultyIndex];
    const centerY = H / 2;
    const fs1 = Math.min(W * 0.09, 38);
    const fs2 = Math.min(W * 0.055, 24);
    drawText('刹那の見斬り', W / 2, centerY - fs1 * 0.8, fs1, '#ffe066');
    drawText(`難易度：${difficulty.label}`, W / 2, centerY + fs2 * 0.9, fs2, '#ffffff');
  }

  // アニメーション終了 → WAITING へ
  if (elapsed >= CUTIN_DURATION) {
    enterWaiting();
  }
}

/* ---------- ゲームシーン ---------- */

/** メインレンダリング（ゲーム中） */
function render() {
  const W = canvas.width;
  const H = canvas.height;

  // ---------- 背景 ----------
  drawSprite(ctx, 'bgImage', 0, 0, W, H);

  // ---------- キャラクター（横並び） ----------
  drawGameCharacters(W, H);

  // ---------- 斬撃エフェクト ----------
  drawSlashEffect(W, H);

  // ---------- 中央メッセージ ----------
  drawCenterMessage(W, H);
}

/**
 * キャラクターを横並び（プレイヤー左・敵右）で描画する
 * @param {number} W
 * @param {number} H
 */
function drawGameCharacters(W, H) {
  // キャラサイズ：画面幅の約 35%、縦横比 1.4
  const charW = Math.min(W * 0.35, 150);
  const charH = charW * 1.4;

  // 縦位置：画面中央より少し上を基準に配置
  const charY = H * 0.30;

  // 横位置：プレイヤー左端、敵右端
  const playerX = W * 0.04;
  const enemyX  = W - charW - W * 0.04;

  let playerKey = 'giraiSet';
  let enemyKey  = 'enemyIdle';

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

  drawSprite(ctx, playerKey, playerX, charY, charW, charH);
  drawSprite(ctx, enemyKey,  enemyX,  charY, charW, charH);
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
      drawText('タップでタイトルへ', cx, H * 0.88, fs * 0.55, '#aaaaaa');
      break;
  }
}

/* =========================================================
 * 9. ゲームループ
 *    rAF で毎フレーム render を呼ぶ。
 *    SIGNAL ステートでは CPU 反応タイムアウトも監視する。
 * ========================================================= */
function gameLoop() {
  switch (game.state) {
    case STATE.TITLE:
      renderTitle();
      break;

    case STATE.CUTIN:
      renderCutin();
      break;

    default:
      // SIGNAL 状態で CPU 反応時間が経過したら強制 RESULT（CPU 勝利）
      if (game.state === STATE.SIGNAL) {
        const elapsed = performance.now() - game.signalTime;
        if (elapsed >= game.cpuReactionMs) {
          enterResult(false);
        }
      }
      render();
      break;
  }

  requestAnimationFrame(gameLoop);
}

/* =========================================================
 * 10. 初期化
 * ========================================================= */
preloadAssets().then(() => {
  gameLoop();
});
